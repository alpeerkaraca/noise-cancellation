import numpy as np
import librosa
import scipy
import logging

logger = logging.getLogger(__name__)


def estimate_noise_profile(noise_segment, frame_size, hop_length):
    logger.debug(
        f"estimate_noise_profile çağrıldı. Segment boyutu: {len(noise_segment)}, frame_size: {frame_size}"
    )
    if not isinstance(noise_segment, np.ndarray) or noise_segment.size < frame_size:
        logger.warning(
            f"estimate_noise_profile: Gürültü segmenti geçersiz veya n_fft ({frame_size}) için çok kısa ({noise_segment.size}). Boş bir profil döndürülüyor veya varsayılan."
        )
        num_freq_bins = frame_size // 2 + 1
        return np.zeros(num_freq_bins, dtype=np.float32)
    try:
        noise_stft = librosa.stft(
            noise_segment, n_fft=frame_size, hop_length=hop_length, center=True
        )
        noise_power_spectrum = np.abs(noise_stft) ** 2
        avg_noise_profile = np.mean(noise_power_spectrum, axis=1)
        return avg_noise_profile
    except Exception as e:
        logger.error(f"Error in estimate_noise_profile: {e}", exc_info=True)
        raise


def remove_hum_and_background_noise(
    signal,
    sample_rate,
    frame_size,
    hop_length,
    hum_frequencies,
    hum_bandwidth_hz=5.0,
    hum_attenuation_factor=0.0,
    noise_profile=None,
    noise_estimation_duration_sec=0.5,
    spectral_gate_threshold_factor=1.5,
    noise_attenuation_factor=0.1,
):

    logger.info("remove_hum_and_background_noise işlemi başlatılıyor...")
    logger.debug(
        f"Giriş sinyal boyutu: {len(signal)}, frame_size (n_fft): {frame_size}"
    )

    if not isinstance(signal, np.ndarray) or signal.ndim != 1:
        logger.error(
            "remove_hum_and_background_noise: Giriş sinyali geçerli bir numpy dizisi değil."
        )
        raise ValueError("Giriş sinyali bir numpy dizisi olmalı.")

    if signal.size == 0:
        logger.warning(
            "remove_hum_and_background_noise: Boş sinyal alındı, boş sinyal döndürülüyor."
        )
        return np.array([], dtype=signal.dtype)

    original_length = len(signal)
    processed_signal = np.copy(signal)

    if signal.size < frame_size:
        logger.warning(
            f"Sinyal ({signal.size}) n_fft'den ({frame_size}) kısa. STFT ve gürültü azaltma atlanıyor. Sinyal olduğu gibi döndürülüyor."
        )
        return processed_signal
    try:
        original_length = len(signal)

        stft_matrix = librosa.stft(
            signal, n_fft=frame_size, hop_length=hop_length, center=True
        )
        frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=frame_size)

        processed_stft_matrix = np.copy(stft_matrix)

        for hum_freq in hum_frequencies:
            lower_bound_hz = hum_freq - hum_bandwidth_hz / 2
            upper_bound_hz = hum_freq + hum_bandwidth_hz / 2
            target_bins_indices = np.where(
                (frequencies >= lower_bound_hz) & (frequencies <= upper_bound_hz)
            )[0]

            if len(target_bins_indices) > 0:
                processed_stft_matrix[target_bins_indices, :] *= hum_attenuation_factor

        if noise_profile is None:
            noise_segment_len = int(noise_estimation_duration_sec * sample_rate)
            if len(signal) < noise_segment_len:
                noise_segment_for_profile = signal
            else:
                noise_segment_for_profile = signal[:noise_segment_len]

            avg_noise_profile_power = estimate_noise_profile(
                noise_segment_for_profile, frame_size, hop_length
            )
        else:
            avg_noise_profile_power = noise_profile

        signal_power_spectrum_frames = np.abs(processed_stft_matrix) ** 2

        for i in range(signal_power_spectrum_frames.shape[1]):
            for j in range(signal_power_spectrum_frames.shape[0]):
                signal_power = signal_power_spectrum_frames[j, i]
                noise_power_threshold = (
                    avg_noise_profile_power[j] * spectral_gate_threshold_factor
                )

                if signal_power < noise_power_threshold:
                    processed_stft_matrix[j, i] *= noise_attenuation_factor

        filtered_signal = librosa.istft(
            processed_stft_matrix,
            hop_length=hop_length,
            length=original_length,
            center=True,
        )

        return filtered_signal
    except Exception as e:
        logger.error(f"Error in remove_hum_and_background_noise: {e}", exc_info=True)
        raise
