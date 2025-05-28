// DOM Elementleri
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const captureNoiseButton = document.getElementById("captureNoiseButton");
const statusDiv = document.getElementById("status");
const inputVolumeFill = document.getElementById("inputVolumeFill");
const outputVolumeFill = document.getElementById("outputVolumeFill");
const applySettingsButton = document.getElementById("applySettingsButton");
const toggleAdvancedRealtimeButton = document.getElementById("toggleAdvancedRealtimeButton");
const advancedRealtimeParametersDiv = document.getElementById("advancedRealtimeParameters");

// Global Değişkenler
let socket;
let audioContext;
let microphoneNode;
let dataSenderNode; // ScriptProcessorNode için
let gainNode; // Çıkış sesi için
let audioWorkletNode; // İşlenmiş sesi çalmak için

const CHUNK_DURATION_MS = 100; // Ses parçalarının milisaniye cinsinden süresi
// WEBSOCKET_URL GÜNCELLENDİ: ws:// yerine wss:// kullanılıyor
const WEBSOCKET_URL = "wss://noise-cancel-backend.alpeerkaraca.site/ws/realtime_cancelling";

let isCapturingNoise = false;
let noiseCaptureTimeout;

// AudioWorklet işlemcisinin yolu (Spring Boot static altından sunulacak)
const WORKLET_PATH = '/js/ring-buffer-processor.js'; // Bu dosyanın doğru yolda olduğundan emin olun

// WebSocket Mesaj Tipleri ve Komutları (Backend ile tutarlı olmalı)
const MSG_TYPE_CONFIG = "config";
const MSG_TYPE_CONTROL = "control";
const CMD_START_NOISE_CAPTURE = "start_noise_capture";
const CMD_UPDATE_PARAMS = "update_params";


// Gelişmiş ayarlar bölümünü göster/gizle
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

// Kullanıcı arayüzünden alınan ayarları backend'e gönderir
function applySettings() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        // alert() yerine statusDiv'i kullanmak daha iyi olabilir veya özel bir modal.
        statusDiv.textContent = "Hata: Ayarları uygulamak için önce bağlantıyı başlatın.";
        console.warn("Ayarları uygulamak için önce bağlantıyı başlatın.");
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

    // Temel doğrulama
    if (isNaN(params.humBandwidthHz) || isNaN(params.humAttenuationFactor) ||
        isNaN(params.spectralGateThresholdFactor) || isNaN(params.noiseAttenuationFactor) ||
        isNaN(params.frameSize) || isNaN(params.hopLengthDivisor) ||
        params.frameSize < 256 || params.hopLengthDivisor < 1) {
        statusDiv.textContent = "Hata: Lütfen tüm sayısal alanlara geçerli değerler girin. Frame size >= 256 ve Hop böleni >= 1 olmalıdır.";
        console.warn("Geçersiz ayar değerleri girildi.");
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

// Ses işleme zincirini başlatır
async function startAudioProcessing() {
    try {
        if (audioContext && audioContext.state === 'running') {
            console.warn("AudioContext zaten çalışıyor. Önce durdurun veya sayfa yenileyin.");
            // Kullanıcıya bilgi verilebilir: statusDiv.textContent = "Ses işleme zaten aktif.";
            // return; // İsteğe bağlı olarak burada fonksiyondan çıkılabilir.
        }
        // Önceki bağlantıları ve kaynakları temizle
        await disconnectAndCleanup(false); // Butonları resetlemeden temizle

        statusDiv.textContent = "Mikrofon erişimi isteniyor...";

        const idealSampleRate = 44100; // İstenen örnekleme hızı
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: idealSampleRate, // Tarayıcı destekliyorsa bu hızı kullanır
                echoCancellation: false,    // Gürültü engellemeyi backend yapacağı için kapatıyoruz
                noiseSuppression: false,    // Gürültü engellemeyi backend yapacağı için kapatıyoruz
                autoGainControl: false,     // Otomatik kazanç kontrolünü kapatıyoruz
            },
            video: false,
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const actualSampleRate = audioContext.sampleRate; // Tarayıcının verdiği gerçek örnekleme hızı
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
            disconnectAndCleanup(); // Hata durumunda her şeyi temizle
            return;
        }

        // AudioWorkletNode (ring-buffer-player-processor) oluşturuluyor
        // Bu node, backend'den gelen işlenmiş sesi çalacak.
        audioWorkletNode = new AudioWorkletNode(audioContext, 'ring-buffer-player-processor', {
            processorOptions: { bufferLengthSeconds: 0.5 } // Yarım saniyelik bir buffer
        });
        console.log("AudioWorkletNode (ring-buffer-player-processor) oluşturuldu.");

        // Çıkış ses seviyesi için GainNode
        gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(1.0, audioContext.currentTime); // Varsayılan kazanç 1.0
        audioWorkletNode.connect(gainNode);
        gainNode.connect(audioContext.destination); // Son olarak hoparlöre bağla
        console.log("AudioWorkletNode -> GainNode -> Destination bağlantıları yapıldı.");


        // dataSenderNode (ScriptProcessorNode) ayarları
        // Bu node, mikrofondan gelen sesi alıp WebSocket ile backend'e gönderecek.
        const CHUNK_DURATION_SECONDS = CHUNK_DURATION_MS / 1000;
        // Buffer boyutunu örnekleme hızına ve chunk süresine göre ayarla (2'nin kuvveti olması tercih edilir)
        let bufferSize = Math.pow(2, Math.floor(Math.log2(actualSampleRate * CHUNK_DURATION_SECONDS)));
        if (bufferSize < 256) bufferSize = 256; // Minimum buffer boyutu
        if (bufferSize > 16384) bufferSize = 16384; // Maksimum buffer boyutu (tarayıcı limitleri dahilinde)
        console.log(`Veri gönderme için ScriptProcessor bufferSize: ${bufferSize}`);

        // ScriptProcessorNode (eski API, AudioWorklet'e geçiş önerilir ama veri gönderme için hala kullanılabilir)
        if (audioContext.createScriptProcessor) {
            dataSenderNode = audioContext.createScriptProcessor(bufferSize, 1, 1); // bufferSize, 1 giriş kanalı, 1 çıkış kanalı
        } else if (audioContext.createJavaScriptNode) { // Eski tarayıcılar için fallback
            dataSenderNode = audioContext.createJavaScriptNode(bufferSize, 1, 1);
        } else {
            // alert() yerine statusDiv kullanılabilir.
            statusDiv.textContent = "Hata: Tarayıcınız ScriptProcessorNode/createJavaScriptNode desteklemiyor.";
            console.error("Tarayıcı ScriptProcessorNode/createJavaScriptNode desteklemiyor.");
            disconnectAndCleanup();
            return;
        }

        dataSenderNode.onaudioprocess = (audioProcessingEvent) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0); // Sol kanalı al (mono varsayılıyor)
                // Giriş ses seviyesini görselleştir
                let sumSquares = 0.0;
                for (const sample of inputData) { sumSquares += sample * sample; }
                const rms = Math.sqrt(sumSquares / inputData.length);
                if (inputVolumeFill) inputVolumeFill.style.width = Math.min(100, rms * 300) + "%"; // RMS'e göre bar genişliği

                socket.send(inputData.buffer); // Ham Float32Array buffer'ını gönder
            }
        };
        microphoneNode.connect(dataSenderNode);
        // ScriptProcessorNode'un çalışması için bir çıkışa bağlanması gerekir, ancak sesi duymak istemiyoruz.
        // Bu yüzden sesi susturulmuş bir GainNode'a bağlayıp onu da destination'a bağlıyoruz.
        const dummyGain = audioContext.createGain();
        dummyGain.gain.value = 0; // Sesi tamamen kıs
        dataSenderNode.connect(dummyGain);
        dummyGain.connect(audioContext.destination); // Bu bağlantı ScriptProcessor'ın çalışması için gerekli.

        // Her şey hazır, WebSocket bağlantısını kur
        connectWebSocket(actualSampleRate);

        // Buton durumlarını güncelle
        if (startButton) startButton.disabled = true;
        if (stopButton) stopButton.disabled = false;
        if (captureNoiseButton) captureNoiseButton.disabled = false;

    } catch (err) {
        console.error("Başlatma sırasında genel hata:", err);
        statusDiv.textContent = "Hata: " + err.message;
        disconnectAndCleanup(); // Hata durumunda her şeyi temizle
    }
}

// WebSocket bağlantısını kurar
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
            payload: { sampleRate: clientSampleRate }, // İstemcinin örnekleme hızını gönder
        };
        console.log("Sunucuya konfigürasyon gönderiliyor:", initialConfig);
        socket.send(JSON.stringify(initialConfig));
        statusDiv.textContent = `Bağlantı kuruldu (Örnekleme Hızı: ${clientSampleRate} Hz).`;
    };

    socket.onmessage = async (event) => {
        let audioDataBuffer;
        if (event.data instanceof ArrayBuffer) {
            audioDataBuffer = event.data;
        } else if (event.data instanceof Blob) { // Bazı sunucular Blob gönderebilir
            console.debug("Sunucudan Blob alındı, ArrayBuffer'a çevriliyor.");
            try {
                audioDataBuffer = await event.data.arrayBuffer();
            } catch (e) {
                console.error("Blob'u ArrayBuffer'a çevirirken hata:", e);
                return; // İşleme devam etme
            }
        } else { // Metin mesajı (JSON bekleniyor)
            try {
                const serverMsg = JSON.parse(event.data);
                console.log("Sunucudan metin mesajı:", serverMsg);
                if (serverMsg.type === 'status') {
                    statusDiv.textContent = "Sunucu: " + serverMsg.message;
                    // Gürültü profili backend'de oluşturulduğunda/güncellendiğinde ring buffer'ı temizle
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
            return; // Ses verisi değilse fonksiyondan çık
        }

        // Gelen ses verisini AudioWorklet'e gönder
        if (audioDataBuffer && audioWorkletNode && audioWorkletNode.port) {
            const processedAudioChunk = new Float32Array(audioDataBuffer);
            if (processedAudioChunk.length > 0) {
                audioWorkletNode.port.postMessage({ type: 'audioData', audioData: processedAudioChunk });

                // Çıkış ses seviyesini görselleştir
                let sumSquares = 0.0;
                for (const sample of processedAudioChunk) { sumSquares += sample * sample; }
                const rms = Math.sqrt(sumSquares / processedAudioChunk.length);
                if (outputVolumeFill) outputVolumeFill.style.width = Math.min(100, rms * 300) + "%";
            } else {
                console.warn("Sunucudan boş işlenmiş ses parçası (ArrayBuffer) alındı.");
            }
        }
    };

    socket.onerror = (error) => {
        console.error("WebSocket Hatası:", error);
        statusDiv.textContent = "WebSocket Hatası. Lütfen konsolu kontrol edin.";
        // disconnectAndCleanup çağrılmıyor çünkü onclose zaten çağrılacak.
    };

    socket.onclose = (event) => {
        console.log("WebSocket bağlantısı kapandı:", event.reason, "Kod:", event.code);
        statusDiv.textContent = "Bağlantı kesildi: " + (event.reason || "Bilinmeyen neden");
        disconnectAndCleanup(true); // Bağlantı kapandığında her şeyi temizle ve butonları resetle
    };
}

// Ses işlemeyi durdurur ve kaynakları serbest bırakır
function stopAudioProcessing() {
    disconnectAndCleanup(true); // Her şeyi temizle ve butonları resetle
}

// Backend'e gürültü profili yakalama komutunu gönderir
function captureNoiseProfile() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        // alert() yerine statusDiv
        statusDiv.textContent = "Hata: Lütfen önce mikrofonu başlatıp sunucuya bağlanın.";
        console.warn("Gürültü yakalamak için önce bağlantıyı başlatın.");
        return;
    }
    if (isCapturingNoise) return; // Zaten yakalama yapılıyorsa tekrar başlatma

    isCapturingNoise = true;
    statusDiv.textContent = "Gürültü profili yakalanıyor (2 saniye)... Lütfen sadece ortam sesi olsun.";
    if (captureNoiseButton) captureNoiseButton.disabled = true;

    const startCaptureMsg = {
        type: MSG_TYPE_CONTROL,
        command: CMD_START_NOISE_CAPTURE,
        duration_sec: 2 // Backend'in ne kadar süreyle gürültü yakalayacağı
    };
    console.log("Sunucuya gürültü yakalama başlatma komutu gönderiliyor:", startCaptureMsg);
    socket.send(JSON.stringify(startCaptureMsg));

    // Butonu ve durumu eski haline getirmek için zamanlayıcı
    clearTimeout(noiseCaptureTimeout);
    noiseCaptureTimeout = setTimeout(() => {
        isCapturingNoise = false;
        // Sunucudan gelen status mesajı bunu güncelleyebilir, ama fallback olarak burada da var.
        if (statusDiv.textContent.startsWith("Gürültü profili yakalanıyor")) {
             statusDiv.textContent = "Gürültü profili yakalama tamamlandı. Normal işleme devam ediyor.";
        }
        if (stopButton && !stopButton.disabled) { // Sadece işlem devam ediyorsa butonu aktif et
            if (captureNoiseButton) captureNoiseButton.disabled = false;
        }
    }, 2000 + 500); // 2 saniye yakalama + 0.5 saniye backend işleme payı
}

// Tüm ses kaynaklarını ve WebSocket bağlantısını temizler
async function disconnectAndCleanup(resetButtons = true) {
    console.log("disconnectAndCleanup çağrıldı, resetButtons:", resetButtons);
    if (socket) {
        // Event listener'ları kaldır
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null; // onclose içinde tekrar disconnectAndCleanup çağrılmasını engellemek için
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            console.log("WebSocket kapatılıyor...");
            socket.close(1000, "İstemci bağlantıyı normal şekilde kapattı");
        }
        socket = null; // Referansı kaldır
    }

    if (dataSenderNode) {
        dataSenderNode.disconnect(); // Tüm bağlantılarını kes
        dataSenderNode.onaudioprocess = null; // Event listener'ı kaldır
        dataSenderNode = null;
        console.log("dataSenderNode temizlendi.");
    }

    if (audioWorkletNode && audioWorkletNode.port) {
        audioWorkletNode.port.postMessage({ type: 'stop' }); // Worklet'e durma mesajı gönder
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
        if (microphoneNode.mediaStream) { // MediaStream'i durdur
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

    // UI elementlerini sıfırla
    if (resetButtons) {
        statusDiv.textContent = "Durduruldu. Yeniden başlatmak için mikrofonu başlatın.";
        if (startButton) startButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
        if (captureNoiseButton) captureNoiseButton.disabled = true;
    }
    if (inputVolumeFill) inputVolumeFill.style.width = "0%";
    if (outputVolumeFill) outputVolumeFill.style.width = "0%";
}

// Sayfa yüklendiğinde butonlara event listener'ları ata
document.addEventListener('DOMContentLoaded', (event) => {
    // Butonların varlığını kontrol et
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

    // Başlangıçta gelişmiş ayarlar gizli olsun
    if (advancedRealtimeParametersDiv) {
        advancedRealtimeParametersDiv.style.display = "none";
    }
});
