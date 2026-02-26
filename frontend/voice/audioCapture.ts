/**
 * Audio Capture Module
 *
 * Captures raw PCM audio from browser microphone via AudioWorklet.
 */

type AudioChunkCallback = (chunk: Int16Array) => void;

const workletCode = `
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        this.frameCount = 0;
    }

    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            const channelData = input[0];

            this.frameCount++;
            if (this.frameCount % 50 === 0) {
                let sum = 0;
                const sampleCount = Math.min(100, channelData.length);
                for (let i = 0; i < sampleCount; i++) {
                    sum += channelData[i] * channelData[i];
                }
                const volume = Math.sqrt(sum / sampleCount);
                this.port.postMessage({ type: 'volume', volume: volume });
            }

            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bufferIndex++] = channelData[i];

                if (this.bufferIndex >= this.bufferSize) {
                    const int16Chunk = this.float32ToInt16(this.buffer);
                    this.port.postMessage({ type: 'audio', buffer: int16Chunk.buffer }, [int16Chunk.buffer]);
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }
            }
        }
        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
`;

class AudioCaptureService {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private silentGain: GainNode | null = null;
    private chunkCallback: AudioChunkCallback | null = null;
    private isCapturing = false;
    private sampleRate = 48000;

    constructor() {
        console.log("[AudioCapture] Initialized");
    }

    public onAudioChunk(callback: AudioChunkCallback) {
        this.chunkCallback = callback;
    }

    public getSampleRate(): number {
        return this.sampleRate;
    }

    public async start(): Promise<void> {
        if (this.isCapturing) {
            console.warn("[AudioCapture] Already capturing.");
            return;
        }

        try {
            const enableEchoCancellation = import.meta.env.VITE_ECHO_CANCELLATION === "true";
            const enableNoiseSuppression = import.meta.env.VITE_NOISE_SUPPRESSION !== "false";
            const enableAutoGainControl = import.meta.env.VITE_AUTO_GAIN_CONTROL === "true";

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: enableEchoCancellation,
                    noiseSuppression: enableNoiseSuppression,
                    autoGainControl: enableAutoGainControl,
                }
            });

            this.audioContext = new AudioContext({ latencyHint: "interactive" });
            this.sampleRate = this.audioContext.sampleRate;
            console.log(`[AudioCapture] Context native sample rate: ${this.sampleRate}Hz`);

            const blob = new Blob([workletCode], { type: "application/javascript" });
            const workletUrl = URL.createObjectURL(blob);
            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);

            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");

            this.workletNode.port.onmessage = (event) => {
                const msg = event.data;
                if (msg.type === "volume") {
                    console.log(`[AudioProbe] Mic Volume: ${msg.volume.toFixed(4)}`);
                } else if (msg.type === "audio" && this.chunkCallback) {
                    this.chunkCallback(new Int16Array(msg.buffer));
                }
            };

            this.source.connect(this.workletNode);

            // Route through a muted gain node to keep the graph alive without audible loopback.
            this.silentGain = this.audioContext.createGain();
            this.silentGain.gain.value = 0;
            this.workletNode.connect(this.silentGain);
            this.silentGain.connect(this.audioContext.destination);

            this.isCapturing = true;
            console.log("[AudioCapture] Started");
        } catch (error) {
            console.error("[AudioCapture] Failed to start:", error);
            throw error;
        }
    }

    public stop(): void {
        if (!this.isCapturing) {
            console.warn("[AudioCapture] Not capturing.");
            return;
        }

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.port.onmessage = null;
            this.workletNode = null;
        }

        if (this.silentGain) {
            this.silentGain.disconnect();
            this.silentGain = null;
        }

        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isCapturing = false;
        console.log("[AudioCapture] Stopped");
    }

    public getIsCapturing(): boolean {
        return this.isCapturing;
    }
}

export const AudioCapture = new AudioCaptureService();
