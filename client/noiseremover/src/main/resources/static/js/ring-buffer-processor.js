class RingBuffer {
    constructor(length) {
        this.buffer = new Float32Array(length);
        this.length = length;
        this.writePtr = 0;
        this.readPtr = 0;
        this.availableWrite = length;
        this.availableRead = 0;
    }

    write(data) {
        if (data.length > this.availableWrite) {
            console.warn("RingBuffer: Yazma sırasında buffer taştı, veri kaybı olabilir.");
            
        }
        const written = Math.min(data.length, this.availableWrite);
        for (let i = 0; i < written; i++) {
            this.buffer[(this.writePtr + i) % this.length] = data[i];
        }
        this.writePtr = (this.writePtr + written) % this.length;
        this.availableWrite -= written;
        this.availableRead += written;
        return written;
    }

    read(data) {
        if (data.length > this.availableRead) {
            
            for (let i = this.availableRead; i < data.length; i++) {
                data[i] = 0;
            }
        }
        const read = Math.min(data.length, this.availableRead);
        for (let i = 0; i < read; i++) {
            data[i] = this.buffer[(this.readPtr + i) % this.length];
        }
        this.readPtr = (this.readPtr + read) % this.length;
        this.availableRead -= read;
        this.availableWrite += read;
        return read;
    }

    isFull() {
        return this.availableWrite === 0;
    }

    isEmpty() {
        return this.availableRead === 0;
    }

    getAvailableRead() {
        return this.availableRead;
    }

    getAvailableWrite() {
        return this.availableWrite;
    }
}


class RingBufferPlayerProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        
        const bufferLengthSeconds = options.processorOptions && options.processorOptions.bufferLengthSeconds ? options.processorOptions.bufferLengthSeconds : 0.5; 
        
        this.ringBuffer = new RingBuffer(Math.floor(sampleRate * bufferLengthSeconds));
        this.running = true;

        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                
                this.ringBuffer.write(event.data.audioData);
            } else if (event.data.type === 'stop') {
                this.running = false;
            } else if (event.data.type === 'clearBuffer') {
                console.log("RingBufferProcessor: Buffer temizleniyor.");
                this.ringBuffer = new RingBuffer(this.ringBuffer.length); 
            }
        };
        console.log(`RingBufferPlayerProcessor oluşturuldu. Örnekleme Hızı: ${sampleRate}, Buffer Uzunluğu (saniye): ${bufferLengthSeconds}`);
    }

    process(inputs, outputs, parameters) {
        if (!this.running) {
            return false; 
        }

        const outputChannel = outputs[0][0];

        if (this.ringBuffer.getAvailableRead() >= outputChannel.length) {
            this.ringBuffer.read(outputChannel);
        } else {
            
            for (let i = 0; i < outputChannel.length; i++) {
                outputChannel[i] = 0; 
            }
        }
        return true; 
    }
}

registerProcessor('ring-buffer-player-processor', RingBufferPlayerProcessor);