const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const captureNoiseButton = document.getElementById("captureNoiseButton");
const statusDiv = document.getElementById("status");
const inputVolumeFill = document.getElementById("inputVolumeFill");
const outputVolumeFill = document.getElementById("outputVolumeFill");
const applySettingsButton = document.getElementById("applySettingsButton");
const toggleAdvancedRealtimeButton = document.getElementById("toggleAdvancedRealtimeButton");
const advancedRealtimeParametersDiv = document.getElementById("advancedRealtimeParameters");

let socket;
let audioContext;
let microphoneNode;
let dataSenderNode; 
let gainNode; 
let audioWorkletNode; 

const CHUNK_DURATION_MS = 100;
const WEBSOCKET_URL = "ws://localhost:8001/ws/realtime_cancelling"; 

let isCapturingNoise = false;
let noiseCaptureTimeout;


const WORKLET_PATH = '/js/ring-buffer-processor.js';


const MSG_TYPE_CONFIG = "config";
const MSG_TYPE_CONTROL = "control";
const CMD_START_NOISE_CAPTURE = "start_noise_capture";
const CMD_UPDATE_PARAMS = "update_params";



function toggleAdvancedSettings() {
    if (!advancedRealtimeParametersDiv) {
        console.error("Gelişmiş ayarlar bölümü (advancedRealtimeParameters) bulunamadı!");
        return;
    }
    const isHidden = advancedRealtimeParametersDiv.style.display === "none";
    if (isHidden) {
        advancedRealtimeParametersDiv.style.display = "block";
        if (toggleAdvancedRealtimeButton) toggleAdvancedRealtimeButton.textContent = "Gelişmiş Ayarları Gizle";
    } else {
        advancedRealtimeParametersDiv.style.display = "none";
        if (toggleAdvancedRealtimeButton) toggleAdvancedRealtimeButton.textContent = "Gelişmiş Ayarları Göster";
    }
}

function applySettings() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("Ayarları uygulamak için önce bağlantıyı başlatın.");
        return;
    }

    const params = {
        humFrequenciesStr: document.getElementById('cfgHumFrequencies').value,
        humBandwidthHz: parseFloat(document.getElementById('cfgHumBandwidth').value),
        humAttenuationFactor: parseFloat(document.getElementById('cfgHumAttenuation').value),
        spectralGateThresholdFactor: parseFloat(document.getElementById('cfgSpectralGateThreshold').value),
        noiseAttenuationFactor: parseFloat(document.getElementById('cfgNoiseAttenuation').value),
        
        frameSize: parseInt(document.getElementById('cfgFrameSize').value),
        hopLengthDivisor: parseInt(document.getElementById('cfgHopLengthDivisor').value)
    };

    
    if (isNaN(params.humBandwidthHz) || isNaN(params.humAttenuationFactor) ||
        isNaN(params.spectralGateThresholdFactor) || isNaN(params.noiseAttenuationFactor) ||
        isNaN(params.frameSize) || isNaN(params.hopLengthDivisor) ||
        params.frameSize < 256 || params.hopLengthDivisor < 1) { 
        alert("Lütfen tüm sayısal alanlara geçerli değerler girin. Frame size >= 256 ve Hop böleni >= 1 olmalıdır.");
        return;
    }
    

    const settingsMsg = {
        type: MSG_TYPE_CONTROL,
        command: CMD_UPDATE_PARAMS,
        payload: params
    };

    console.log("Sunucuya yeni ayarlar gönderiliyor:", settingsMsg);
    socket.send(JSON.stringify(settingsMsg));
    statusDiv.textContent = "Sunucu: Yeni ayarlar gönderildi. Gürültü profili yeniden oluşturulabilir.";
}

async function startAudioProcessing() {
    try {
        if (audioContext && audioContext.state === 'running') {
            console.warn("AudioContext zaten çalışıyor. Önce durdurun veya sayfa yenileyin.");
            
        }
        await disconnectAndCleanup(false); 

        statusDiv.textContent = "Mikrofon erişimi isteniyor...";

        const idealSampleRate = 44100;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: idealSampleRate,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
            video: false,
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const actualSampleRate = audioContext.sampleRate;
        statusDiv.textContent = `Mikrofon erişimi başarılı. Gerçek Örnekleme Hızı: ${actualSampleRate} Hz`;

        microphoneNode = audioContext.createMediaStreamSource(stream);

        statusDiv.textContent = "Ses işlemci modülü yükleniyor...";
        console.log("AudioWorklet modülü yükleniyor:", WORKLET_PATH);
        try {
            await audioContext.audioWorklet.addModule(WORKLET_PATH);
            console.log("AudioWorklet modülü başarıyla yüklendi.");
        } catch (e) {
            console.error("AudioWorklet modülü yüklenirken hata:", e);
            statusDiv.textContent = "Hata: Ses işlemci modülü yüklenemedi. Konsolu kontrol edin.";
            disconnectAndCleanup();
            return;
        }

        audioWorkletNode = new AudioWorkletNode(audioContext, 'ring-buffer-player-processor', {
            processorOptions: { bufferLengthSeconds: 0.5 }
        });
        console.log("AudioWorkletNode (ring-buffer-player-processor) oluşturuldu.");

        gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
        audioWorkletNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        console.log("AudioWorkletNode -> GainNode -> Destination bağlantıları yapıldı.");

        const CHUNK_DURATION_SECONDS = CHUNK_DURATION_MS / 1000;
        let bufferSize = Math.pow(2, Math.floor(Math.log2(actualSampleRate * CHUNK_DURATION_SECONDS)));
        if (bufferSize < 256) bufferSize = 256;
        if (bufferSize > 16384) bufferSize = 16384;
        console.log(`Veri gönderme için ScriptProcessor bufferSize: ${bufferSize}`);

        if (audioContext.createScriptProcessor) {
            dataSenderNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
        } else if (audioContext.createJavaScriptNode) {
            dataSenderNode = audioContext.createJavaScriptNode(bufferSize, 1, 1);
        } else {
            alert("Tarayıcınız ScriptProcessorNode/createJavaScriptNode desteklemiyor.");
            disconnectAndCleanup();
            return;
        }

        dataSenderNode.onaudioprocess = (audioProcessingEvent) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                let sumSquares = 0.0;
                for (const sample of inputData) { sumSquares += sample * sample; }
                const rms = Math.sqrt(sumSquares / inputData.length);
                inputVolumeFill.style.width = Math.min(100, rms * 300) + "%";
                socket.send(inputData.buffer);
            }
        };
        microphoneNode.connect(dataSenderNode);
        const dummyGain = audioContext.createGain();
        dummyGain.gain.value = 0;
        dataSenderNode.connect(dummyGain);
        dummyGain.connect(audioContext.destination);

        connectWebSocket(actualSampleRate);

        startButton.disabled = true;
        stopButton.disabled = false;
        captureNoiseButton.disabled = false;

    } catch (err) {
        console.error("Başlatma sırasında genel hata:", err);
        statusDiv.textContent = "Hata: " + err.message;
        disconnectAndCleanup();
    }
}

function connectWebSocket(clientSampleRate) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.warn("Zaten açık veya açılmakta olan bir WebSocket bağlantısı var.");
        return;
    }
    statusDiv.textContent = "WebSocket sunucusuna bağlanılıyor...";
    socket = new WebSocket(WEBSOCKET_URL);

    socket.onopen = () => {
        statusDiv.textContent = "Bağlantı kuruldu. Sunucuya konfigürasyon gönderiliyor...";
        const initialConfig = {
            type: MSG_TYPE_CONFIG, 
            payload: { sampleRate: clientSampleRate },
        };
        console.log("Sunucuya konfigürasyon gönderiliyor:", initialConfig);
        socket.send(JSON.stringify(initialConfig));
        statusDiv.textContent = `Bağlantı kuruldu (SR: ${clientSampleRate} Hz).`;
    };

    socket.onmessage = async (event) => {
        let audioDataBuffer;
        if (event.data instanceof ArrayBuffer) {
            audioDataBuffer = event.data;
        } else if (event.data instanceof Blob) {
            console.debug("Sunucudan Blob alındı, ArrayBuffer'a çevriliyor.");
            try {
                audioDataBuffer = await event.data.arrayBuffer();
            } catch (e) {
                console.error("Blob'u ArrayBuffer'a çevirirken hata:", e);
                return;
            }
        } else {
            try {
                const serverMsg = JSON.parse(event.data);
                console.log("Sunucudan metin mesajı:", serverMsg);
                if (serverMsg.type === 'status') {
                    statusDiv.textContent = "Sunucu: " + serverMsg.message;
                    if (serverMsg.message && (serverMsg.message.toLowerCase().includes("profil oluşturuldu") || serverMsg.message.toLowerCase().includes("profil tahmin edildi"))) {
                        console.log("Gürültü profili backend'de oluşturuldu/güncellendi. Frontend ring buffer temizleniyor.");
                        if (audioWorkletNode && audioWorkletNode.port) {
                            audioWorkletNode.port.postMessage({ type: 'clearBuffer' });
                        }
                    }
                } else {
                    console.log("Sunucudan bilinmeyen metin mesajı tipi:", serverMsg);
                }
            } catch (e) {
                console.log("Sunucudan parse edilemeyen metin mesajı:", event.data);
            }
            return;
        }

        if (audioDataBuffer && audioWorkletNode && audioWorkletNode.port) {
            const processedAudioChunk = new Float32Array(audioDataBuffer);
            if (processedAudioChunk.length > 0) {
                audioWorkletNode.port.postMessage({ type: 'audioData', audioData: processedAudioChunk });
                let sumSquares = 0.0;
                for (const sample of processedAudioChunk) { sumSquares += sample * sample; }
                const rms = Math.sqrt(sumSquares / processedAudioChunk.length);
                outputVolumeFill.style.width = Math.min(100, rms * 300) + "%";
            } else {
                console.warn("Sunucudan boş işlenmiş ses parçası (ArrayBuffer) alındı.");
            }
        }
    };

    socket.onerror = (error) => {
        console.error("WebSocket Hatası:", error);
        statusDiv.textContent = "WebSocket Hatası. Lütfen konsolu kontrol edin.";
        
    };

    socket.onclose = (event) => {
        console.log("WebSocket bağlantısı kapandı:", event.reason, "Kod:", event.code);
        statusDiv.textContent = "Bağlantı kesildi: " + (event.reason || "Bilinmeyen neden");
        disconnectAndCleanup(true); 
    };
}

function stopAudioProcessing() {
    disconnectAndCleanup(true); 
}

function captureNoiseProfile() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("Lütfen önce mikrofonu başlatıp sunucuya bağlanın.");
        return;
    }
    if (isCapturingNoise) return;

    isCapturingNoise = true;
    statusDiv.textContent = "Gürültü profili yakalanıyor (2 saniye)... Lütfen sadece ortam sesi olsun.";
    captureNoiseButton.disabled = true;

    const startCaptureMsg = {
        type: MSG_TYPE_CONTROL,
        command: CMD_START_NOISE_CAPTURE,
        duration_sec: 2
    };
    console.log("Sunucuya gürültü yakalama başlatma komutu gönderiliyor:", startCaptureMsg);
    socket.send(JSON.stringify(startCaptureMsg));

    clearTimeout(noiseCaptureTimeout);
    noiseCaptureTimeout = setTimeout(() => {
        isCapturingNoise = false;
        statusDiv.textContent = "Gürültü profili yakalama tamamlandı. Normal işleme devam ediyor.";
        if (stopButton.disabled === false) { 
            captureNoiseButton.disabled = false;
        }
    }, 2000);
}

async function disconnectAndCleanup(resetButtons = true) {
    console.log("disconnectAndCleanup çağrıldı, resetButtons:", resetButtons);
    if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            console.log("WebSocket kapatılıyor...");
            socket.close(1000, "İstemci bağlantıyı normal şekilde kapattı");
        }
        socket = null;
    }

    if (dataSenderNode) {
        dataSenderNode.disconnect();
        dataSenderNode.onaudioprocess = null;
        dataSenderNode = null;
        console.log("dataSenderNode temizlendi.");
    }

    if (audioWorkletNode && audioWorkletNode.port) { 
        audioWorkletNode.port.postMessage({ type: 'stop' });
        audioWorkletNode.disconnect();
        audioWorkletNode = null;
        console.log("audioWorkletNode temizlendi.");
    }

    if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
        console.log("gainNode temizlendi.");
    }

    if (microphoneNode) {
        microphoneNode.disconnect();
        if (microphoneNode.mediaStream) {
            microphoneNode.mediaStream.getTracks().forEach((track) => track.stop());
            console.log("Mikrofon izleri durduruldu.");
        }
        microphoneNode = null;
    }

    if (audioContext && audioContext.state !== "closed") {
        console.log("AudioContext kapatılıyor...");
        try {
            await audioContext.close();
            console.log("AudioContext başarıyla kapatıldı.");
        } catch (e) {
            console.warn("AudioContext kapatılırken hata (muhtemelen zaten kapanmıştı):", e);
        }
        audioContext = null;
    }

    clearTimeout(noiseCaptureTimeout);
    isCapturingNoise = false;

    if (resetButtons) {
        statusDiv.textContent = "Durduruldu. Yeniden başlatmak için mikrofonu başlatın.";
        if (startButton) startButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
        if (captureNoiseButton) captureNoiseButton.disabled = true;
    }
    if (inputVolumeFill) inputVolumeFill.style.width = "0%";
    if (outputVolumeFill) outputVolumeFill.style.width = "0%";
}


document.addEventListener('DOMContentLoaded', (event) => {
    
    if (startButton) {
        startButton.onclick = startAudioProcessing;
    } else {
        console.error("Başlat butonu (startButton) bulunamadı!");
    }

    if (stopButton) {
        stopButton.onclick = stopAudioProcessing;
    } else {
        console.error("Durdur butonu (stopButton) bulunamadı!");
    }

    if (captureNoiseButton) {
        captureNoiseButton.onclick = captureNoiseProfile;
    } else {
        console.error("Gürültü Yakala butonu (captureNoiseButton) bulunamadı!");
    }

    if (applySettingsButton) {
        applySettingsButton.onclick = applySettings;
    } else {
        console.error("Ayarları Uygula butonu (applySettingsButton) bulunamadı!");
    }

    if (toggleAdvancedRealtimeButton) {
        toggleAdvancedRealtimeButton.onclick = toggleAdvancedSettings;
    } else {
        console.error("Gelişmiş Ayarları Göster/Gizle butonu (toggleAdvancedRealtimeButton) bulunamadı!");
    }

    if (advancedRealtimeParametersDiv) {
        advancedRealtimeParametersDiv.style.display = "none";
    }
});