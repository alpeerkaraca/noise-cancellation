import json
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
import asyncio
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import shutil
import os
import uuid
from typing import Optional, List
import logging
from fastapi.websockets import WebSocketState
from pydantic import ValidationError
import websockets
import time

import librosa
import numpy as np
import scipy
from scipy import signal
import soundfile as sf

from models.response import NoiseRemoverResponse
from models.realtime import RealtimeInitialConfig, RealtimeProcessingParams
import plotting_utils as utils
import core

app = FastAPI()
logger = logging.getLogger(__name__)

OUTPUT_FILES_DIRECTORY = "uploads/processed"
os.makedirs(OUTPUT_FILES_DIRECTORY, exist_ok=True)

app.mount(
    f"/{OUTPUT_FILES_DIRECTORY}",
    StaticFiles(directory=OUTPUT_FILES_DIRECTORY),
    name="processed_files",
)


@app.post("/remove_noise", response_model=NoiseRemoverResponse)
async def remove_noise(
    request: Request,
    file: UploadFile = File(..., description="İşlenecek WAV ses dosyası"),
    hum_frequencies_str: str = Form(
        "60,120,180,240,300", description="Uğultu frekansları (virgülle ayrılmış)"
    ),
    hum_bandwidth_hz: float = Form(6.0, description="Uğultu bant genişliği (Hz)"),
    hum_attenuation_factor: float = Form(
        0.1, description="Uğultu zayıflatma faktörü (0=tamamen kaldır)"
    ),
    noise_estimation_duration_sec: float = Form(
        0.5, description="Gürültü profili tahmin süresi (saniye)"
    ),
    spectral_gate_threshold_factor: float = Form(
        2.0, description="Gürültü eşik faktörü"
    ),
    noise_attenuation_factor: float = Form(
        0.1, description="Genel gürültü zayıflatma faktörü"
    ),
    frame_size: int = Form(2048, description="STFT için çerçeve (FFT) boyutu"),
    hop_length_divisor: int = Form(
        4,
        description="Hop uzunluğu böleni (hop_length = frame_size / hop_length_divisor)",
    ),
):

    session_id = str(uuid.uuid4())
    session_specific_dir = os.path.join(OUTPUT_FILES_DIRECTORY, session_id)
    os.makedirs(session_specific_dir, exist_ok=True)

    input_filename = file.filename
    temp_input_filename = f"input_{input_filename}"
    temp_input_path = os.path.join(session_specific_dir, temp_input_filename)

    try:
        with open(temp_input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Yüklenen dosya kaydedilemedi: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Yüklenen dosya kaydedilemedi. Tekrar deneyin.",
        )
    finally:
        file.file.close()

    plot_urls = {}
    relative_output_path = None

    try:
        wave, sample_rate = librosa.load(temp_input_path, sr=None, mono=True)
        logger.info(f"Yüklenen dosya: {temp_input_path}, Örnekleme hızı: {sample_rate}")

        try:
            hum_frequencies = [
                float(f.strip()) for f in hum_frequencies_str.split(",") if f.strip()
            ]
        except ValueError as e:
            logger.error(f"Hum frekansları dönüştürülürken hata: {e}", exc_info=True)
            raise HTTPException(
                status_code=400,
                detail="Hum frekansları geçersiz formatta. Lütfen virgülle ayrılmış sayılar girin.",
            )

        hop_length = frame_size // hop_length_divisor

        plot_org_prefix = f"{str(uuid.uuid4())[:8]}_original"
        plot_filt_prefix = f"{str(uuid.uuid4())[:8]}_filtered"

        try:
            original_plot_filename = utils.plot_signal_to_file(
                signal=wave,
                sample_rate=sample_rate,
                output_directory=session_specific_dir,
                filename_prefix=plot_org_prefix,
                title=f"Orijinal Ses Sinyali ({input_filename})",
            )
            plot_urls["original_signal"] = (
                f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{original_plot_filename}"
            )

            if len(wave) >= frame_size:
                window = scipy.signal.windows.get_window(
                    "hann", frame_size, fftbins=False
                )
                windowed_frame_original = wave[:frame_size] * window
                fft_first_frame_original = np.fft.rfft(windowed_frame_original)

                lin_name, db_name = utils.plot_magnitude_spectrum_frame_to_file(
                    fft_first_frame_original,
                    frame_size,
                    sample_rate,
                    session_specific_dir,
                    plot_org_prefix,
                    "Orijinal Sinyal Spektrumu",
                )
                plot_urls["original_spectrum_linear_plot"] = (
                    f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{lin_name}"
                )
                plot_urls["original_spectrum_db_plot"] = (
                    f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{db_name}"
                )
            else:
                logger.warning("Orijinal sinyal spektrum çizimi için çok kısa.")
        except Exception as plot_exc:
            logger.error(
                f"Orijinal sinyal grafikleri oluşturulurken hata: {plot_exc}",
                exc_info=True,
            )

        logger.info("Core'de")

        filtered_wave = core.remove_hum_and_background_noise(
            signal=wave,
            sample_rate=sample_rate,
            hum_frequencies=hum_frequencies,
            hum_bandwidth_hz=hum_bandwidth_hz,
            hum_attenuation_factor=hum_attenuation_factor,
            noise_estimation_duration_sec=noise_estimation_duration_sec,
            spectral_gate_threshold_factor=spectral_gate_threshold_factor,
            noise_attenuation_factor=noise_attenuation_factor,
            frame_size=frame_size,
            hop_length=hop_length,
            noise_profile=None,
        )

        try:
            # Sinyal grafiği
            filtered_signal_plot_filename = utils.plot_signal_to_file(
                filtered_wave,
                sample_rate,
                session_specific_dir,
                plot_filt_prefix,
                f"Filtrelenmiş Sinyal",
            )
            plot_urls["filtered_signal_plot"] = (
                f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{filtered_signal_plot_filename}"
            )

            # Spektrum grafiği (ilk frame için)
            if len(filtered_wave) >= frame_size:
                window = scipy.signal.windows.get_window(
                    "hann", frame_size, fftbins=False
                )
                windowed_frame_filtered = filtered_wave[:frame_size] * window
                fft_first_frame_filtered = np.fft.rfft(windowed_frame_filtered)

                lin_name_f, db_name_f = utils.plot_magnitude_spectrum_frame_to_file(
                    fft_first_frame_filtered,
                    frame_size,
                    sample_rate,
                    session_specific_dir,
                    plot_filt_prefix,
                    "Filtrelenmiş İlk Çerçeve Spektrumu",
                )
                plot_urls["filtered_spectrum_linear_plot"] = (
                    f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{lin_name_f}"
                )
                plot_urls["filtered_spectrum_db_plot"] = (
                    f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{session_id}/{db_name_f}"
                )
            else:
                logger.warning("Filtrelenmiş sinyal spektrum çizimi için çok kısa.")
        except Exception as plot_exc:
            logger.error(
                f"Filtrelenmiş sinyal grafikleri oluşturulurken hata: {plot_exc}",
                exc_info=True,
            )

        processed_aud_fname = (
            f"{str(uuid.uuid4())[:8]}_filtered_{input_filename.replace(' ', '_')}"
        )
        processed_aud_fpath = os.path.join(session_specific_dir, processed_aud_fname)

        sf.write(processed_aud_fpath, filtered_wave, sample_rate)

        relative_output_path = f"{session_id}/{processed_aud_fname}"
        response = NoiseRemoverResponse(
            status="success",
            message="Ses dosyası başarıyla işlendi.",
            input_file=input_filename,
            output_file=processed_aud_fname,
            processed_audio_url=f"{str(request.base_url).rstrip('/')}/{OUTPUT_FILES_DIRECTORY}/{relative_output_path}",
            plot_urls=plot_urls,
            session_id=session_id,
        )
        logger.error(f"Hey Here is The Response info it You Dumbass: {response}")
        return response

    except HTTPException:
        raise
    except librosa.LibrosaError as librosa_err:
        logger.error(f"Librosa hatası: {librosa_err}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=f"Ses dosyası işlenirken hata (librosa): {str(librosa_err)}",
        )
    except Exception as e:
        logger.error(f"Ses işleme sırasında genel bir hata oluştu: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Sunucu hatası: {str(e)}")
    finally:
        if os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
                logger.info(f"Geçici giriş dosyası '{temp_input_path}' silindi.")
            except OSError as e_remove:
                logger.warning(
                    f"Geçici giriş dosyası '{temp_input_path}' silinemedi: {e_remove}"
                )


MSG_TYPE_CONFIG = "config"
MSG_TYPE_CONTROL = "control"
CMD_START_NOISE_CAPTURE = "start_noise_capture"
CMD_UPDATE_PARAMS = "update_params"


@app.websocket("/ws/realtime_cancelling")
async def websocket_realtime_cancelling(websocket: WebSocket):
    await websocket.accept()
    client_addr = f"{websocket.client.host}:{websocket.client.port}"
    logger.info(f"WebSocket bağlantısı kabul edildi: {client_addr}")

    # --- Bağlantı Başı Değişkenleri ---
    ws_sr: int = 0

    # STFT ve İşleme Parametrelerini bir sözlükte tutmak daha yönetilebilir
    current_stft_params = {
        "frame_size": 2048,
        "hop_length_divisor": 4,
        "hop_length": 0,
    }
    current_noise_reduction_params = {
        "hum_frequencies": [60.0, 120.0],  # Liste olarak sakla
        "hum_bandwidth_hz": 6.0,
        "hum_attenuation_factor": 0.0,
        "spectral_gate_threshold_factor": 1.8,
        "noise_attenuation_factor": 0.15,
        "noise_estimation_dur_sec_manual": 2.0,
    }
    logger.info(f"[{client_addr}] Başlangıç STFT: {current_stft_params}")
    logger.info(
        f"[{client_addr}] Başlangıç Gürültü Engelleme: {current_noise_reduction_params}"
    )

    initial_noise_buffer = np.array([], dtype=np.float32)
    noise_profile_estimated = None
    noise_buffer_target_len_manual: int = 0
    noise_profile_is_ready: bool = False
    is_capturing_noise_for_profile: bool = False
    noise_capture_end_time: float = 0

    try:
        # 1. İLK KONFİGÜRASYON (sampleRate)
        logger.info(
            f"[{client_addr}] İstemciden ilk konfigürasyon (sampleRate) bekleniyor..."
        )
        config_message_str = await websocket.receive_text()
        logger.debug(
            f"[{client_addr}] Alınan ham konfigürasyon string'i: {config_message_str}"
        )

        config_data = json.loads(config_message_str)
        logger.info(
            f"[{client_addr}] Parse edilmiş konfigürasyon mesajı: {config_data}"
        )

        if config_data.get("type") == MSG_TYPE_CONFIG:
            payload = config_data.get("payload", {})
            try:
                initial_config = RealtimeInitialConfig(**payload)
                ws_sr = initial_config.sampleRate

                logger.info(
                    f"[{client_addr}] WebSocket sampleRate yapılandırması: SR = {ws_sr} Hz"
                )
            except ValidationError as e_val:  # Pydantic ValidationError
                logger.error(
                    f"[{client_addr}] İlk konfigürasyon Pydantic validasyon hatası: {e_val.errors()}",
                    exc_info=False,
                )
                await websocket.close(
                    code=1008, reason=f"Konfigürasyon payload hatası: {e_val.errors()}"
                )
                return
            except Exception as e_gen_val:  # Diğer olası hatalar
                logger.error(
                    f"[{client_addr}] İlk konfigürasyon işleme hatası: {e_gen_val}",
                    exc_info=True,
                )
                await websocket.close(
                    code=1008, reason=f"Konfigürasyon hatası: {str(e_gen_val)}"
                )
                return
        else:
            logger.warning(
                f"[{client_addr}] İlk mesaj 'config' tipinde değil. Bağlantı kapatılıyor."
            )
            await websocket.close(
                code=1008,
                reason="Geçerli bir başlangıç konfigürasyon mesajı alınamadı.",
            )
            return

        if ws_sr <= 0:
            logger.error(
                f"[{client_addr}] Geçersiz sampleRate: {ws_sr}. Bağlantı kapatılıyor."
            )
            await websocket.close(code=1008, reason="Geçersiz sampleRate değeri.")
            return

        current_stft_params["hop_length"] = (
            current_stft_params["frame_size"]
            // current_stft_params["hop_length_divisor"]
        )
        logger.info(
            f"[{client_addr}] İlk STFT parametreleri hesaplandı: {current_stft_params}"
        )

        # 2. ANA MESAJ DÖNGÜSÜ
        while True:
            message = await websocket.receive()

            if "text" in message:
                text_data = message["text"]
                logger.debug(f"[{client_addr}] Metin mesajı alındı: {text_data}")
                try:
                    control_msg = json.loads(text_data)
                    msg_type = control_msg.get("type")

                    if msg_type == MSG_TYPE_CONTROL:
                        command = control_msg.get("command")
                        payload = control_msg.get("payload", {})

                        if command == CMD_START_NOISE_CAPTURE:
                            capture_duration = float(
                                payload.get(
                                    "duration_sec",
                                    current_noise_reduction_params[
                                        "noise_estimation_dur_sec_manual"
                                    ],
                                )
                            )
                            logger.info(
                                f"[{client_addr}] Gürültü yakalama komutu. Süre: {capture_duration}s"
                            )
                            is_capturing_noise_for_profile = True
                            noise_profile_is_ready = False
                            noise_profile_estimated = None
                            initial_noise_buffer = np.array([], dtype=np.float32)
                            noise_capture_end_time = time.time() + capture_duration
                            noise_buffer_target_len_manual = int(
                                capture_duration * ws_sr
                            )
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "type": "status",
                                        "message": "Gürültü yakalama başlatıldı.",
                                    }
                                )
                            )

                        elif command == CMD_UPDATE_PARAMS:
                            logger.info(
                                f"[{client_addr}] Parametre güncelleme komutu alındı: {payload}"
                            )
                            stft_params_changed_flag = False
                            try:
                                new_params = RealtimeProcessingParams(
                                    **payload
                                )  # Pydantic ile validate et

                                # Gürültü engelleme parametrelerini güncelle
                                if new_params.humFrequenciesStr is not None:
                                    try:
                                        current_noise_reduction_params[
                                            "hum_frequencies"
                                        ] = [
                                            float(f.strip())
                                            for f in new_params.humFrequenciesStr.split(
                                                ","
                                            )
                                            if f.strip()
                                        ]
                                    except ValueError:
                                        logger.warning(
                                            f"[{client_addr}] Geçersiz humFrequenciesStr: {new_params.humFrequenciesStr}"
                                        )
                                if new_params.humBandwidthHz is not None:
                                    current_noise_reduction_params[
                                        "hum_bandwidth_hz"
                                    ] = new_params.humBandwidthHz
                                if new_params.humAttenuationFactor is not None:
                                    current_noise_reduction_params[
                                        "hum_attenuation_factor"
                                    ] = new_params.humAttenuationFactor
                                if new_params.spectralGateThresholdFactor is not None:
                                    current_noise_reduction_params[
                                        "spectral_gate_threshold_factor"
                                    ] = new_params.spectralGateThresholdFactor
                                if new_params.noiseAttenuationFactor is not None:
                                    current_noise_reduction_params[
                                        "noise_attenuation_factor"
                                    ] = new_params.noiseAttenuationFactor

                                # STFT parametrelerini güncelle
                                if (
                                    new_params.frameSize is not None
                                    and new_params.frameSize
                                    != current_stft_params["frame_size"]
                                ):
                                    current_stft_params["frame_size"] = (
                                        new_params.frameSize
                                    )
                                    stft_params_changed_flag = True
                                if (
                                    new_params.hopLengthDivisor is not None
                                    and new_params.hopLengthDivisor
                                    != current_stft_params["hop_length_divisor"]
                                ):
                                    current_stft_params["hop_length_divisor"] = (
                                        new_params.hopLengthDivisor
                                    )
                                    stft_params_changed_flag = True

                                if stft_params_changed_flag:
                                    current_stft_params["hop_length"] = (
                                        current_stft_params["frame_size"]
                                        // current_stft_params["hop_length_divisor"]
                                    )
                                    logger.info(
                                        f"[{client_addr}] STFT parametreleri değişti, gürültü profili sıfırlanıyor. Yeni STFT: {current_stft_params}"
                                    )
                                    noise_profile_is_ready = False
                                    noise_profile_estimated = None
                                    initial_noise_buffer = np.array(
                                        [], dtype=np.float32
                                    )
                                    is_capturing_noise_for_profile = False
                                    await websocket.send_text(
                                        json.dumps(
                                            {
                                                "type": "status",
                                                "message": "STFT ayarları değişti. Gürültü profilini yeniden yakalayın.",
                                            }
                                        )
                                    )
                                else:
                                    await websocket.send_text(
                                        json.dumps(
                                            {
                                                "type": "status",
                                                "message": "Gürültü ayarları güncellendi.",
                                            }
                                        )
                                    )

                                logger.info(
                                    f"[{client_addr}] Güncel Gürültü Parametreleri: {current_noise_reduction_params}"
                                )
                                logger.info(
                                    f"[{client_addr}] Güncel STFT Parametreleri: {current_stft_params}"
                                )

                            except (
                                ValidationError
                            ) as e_val_update:  # Pydantic ValidationError
                                logger.error(
                                    f"[{client_addr}] Parametre güncelleme Pydantic validasyon hatası: {e_val_update.errors()}",
                                    exc_info=False,
                                )
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "type": "status",
                                            "message": f"Ayar format/değer hatası: {e_val_update.errors()}",
                                        }
                                    )
                                )
                            except Exception as e_gen_update:  # Diğer hatalar
                                logger.error(
                                    f"[{client_addr}] Parametre güncelleme sırasında genel hata: {e_gen_update}",
                                    exc_info=True,
                                )
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "type": "status",
                                            "message": "Ayarlar güncellenirken bir hata oluştu.",
                                        }
                                    )
                                )
                except Exception as e_text_msg:
                    logger.warning(
                        f"[{client_addr}] Metin mesajı işlenirken genel hata: {e_text_msg}",
                        exc_info=True,
                    )

            elif "bytes" in message:
                audio_chunk_bytes = message["bytes"]
                if not audio_chunk_bytes:
                    continue  # Boş chunk'ı atla

                try:
                    audio_chunk_np = np.frombuffer(audio_chunk_bytes, dtype=np.float32)
                except Exception as e_conv:
                    logger.error(
                        f"[{client_addr}] Ses byte'ları numpy'a çevrilemedi: {e_conv}",
                        exc_info=True,
                    )
                    continue

                if is_capturing_noise_for_profile:
                    initial_noise_buffer = np.concatenate(
                        (initial_noise_buffer, audio_chunk_np)
                    )
                    logger.debug(
                        f"[{client_addr}] Gürültü yakalama: buffer={len(initial_noise_buffer)}, hedef={noise_buffer_target_len_manual}"
                    )

                    if time.time() >= noise_capture_end_time:
                        logger.info(
                            f"[{client_addr}] Gürültü yakalama süresi doldu. Profil tahmin ediliyor..."
                        )
                        if (
                            len(initial_noise_buffer) >= noise_buffer_target_len_manual
                            and len(initial_noise_buffer)
                            >= current_stft_params["frame_size"]
                        ):
                            try:
                                noise_profile_estimated = core.estimate_noise_profile(
                                    noise_segment=initial_noise_buffer[
                                        :noise_buffer_target_len_manual
                                    ],
                                    frame_size=current_stft_params["frame_size"],
                                    hop_length=current_stft_params["hop_length"],
                                )
                                noise_profile_is_ready = True
                                logger.info(
                                    f"[{client_addr}] Gürültü profili manuel yakalama ile tahmin edildi."
                                )
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "type": "status",
                                            "message": "Gürültü profili oluşturuldu.",
                                        }
                                    )
                                )
                            except Exception as e_profile_timed:
                                logger.error(
                                    f"[{client_addr}] Manuel gürültü yakalama sonrası profil tahmin hatası: {e_profile_timed}",
                                    exc_info=True,
                                )
                                noise_profile_is_ready = False
                        else:
                            logger.warning(
                                f"[{client_addr}] Manuel gürültü yakalama sonrası profil için yeterli veri yok veya n_fft'den kısa."
                            )
                            noise_profile_is_ready = False
                        is_capturing_noise_for_profile = False
                        initial_noise_buffer = np.array([], dtype=np.float32)
                    continue

                if noise_profile_is_ready and noise_profile_estimated is not None:
                    try:
                        if len(audio_chunk_np) < current_stft_params["frame_size"]:
                            logger.warning(
                                f"[{client_addr}] Ses parçası ({len(audio_chunk_np)}) n_fft'den ({current_stft_params['frame_size']}) kısa. Orijinal gönderiliyor."
                            )
                            await websocket.send_bytes(audio_chunk_np.tobytes())
                            continue

                        processed_chunk_np = core.remove_hum_and_background_noise(
                            signal=audio_chunk_np,
                            sample_rate=ws_sr,
                            frame_size=current_stft_params["frame_size"],
                            hop_length=current_stft_params["hop_length"],
                            hum_frequencies=current_noise_reduction_params[
                                "hum_frequencies"
                            ],
                            hum_bandwidth_hz=current_noise_reduction_params[
                                "hum_bandwidth_hz"
                            ],
                            hum_attenuation_factor=current_noise_reduction_params[
                                "hum_attenuation_factor"
                            ],
                            noise_profile=noise_profile_estimated,
                            spectral_gate_threshold_factor=current_noise_reduction_params[
                                "spectral_gate_threshold_factor"
                            ],
                            noise_attenuation_factor=current_noise_reduction_params[
                                "noise_attenuation_factor"
                            ],
                        )
                        await websocket.send_bytes(processed_chunk_np.tobytes())
                    except Exception as e_proc:
                        logger.error(
                            f"[{client_addr}] Ses işleme hatası: {e_proc}",
                            exc_info=True,
                        )
                        await websocket.send_bytes(audio_chunk_np.tobytes())
                else:
                    await websocket.send_bytes(audio_chunk_np.tobytes())

    except WebSocketDisconnect:
        logger.info(f"WebSocket bağlantısı istemci tarafından kapatıldı: {client_addr}")
    except json.JSONDecodeError as json_err:
        logger.error(
            f"[{client_addr}] Başlangıç config mesajı JSON formatında değil: {json_err}",
            exc_info=True,
        )
        if (
            websocket.client_state == WebSocketState.CONNECTED
        ):  # starlette.websockets.WebSocketState
            await websocket.close(
                code=1008, reason="Konfigürasyon mesajı JSON formatında değil."
            )
    except Exception as e_main_loop:
        logger.error(
            f"[{client_addr}] WebSocket ana döngüsünde beklenmedik hata: {e_main_loop}",
            exc_info=True,
        )
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close(
                    code=1011, reason=f"Sunucu hatası: {str(e_main_loop)[:100]}"
                )
            except RuntimeError:  # Zaten kapalıysa veya kapatılıyorsa
                pass
            except Exception:
                pass
    finally:
        logger.info(f"WebSocket bağlantısı sonlandırılıyor (finally): {client_addr}")
