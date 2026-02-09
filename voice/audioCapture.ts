/**
 * Audio Capture Module (Phase 8.2 - AudioWorklet)
 * 
 * Captures raw PCM audio from browser microphone using AudioWorklet.
 * AudioWorklet runs on a separate thread, eliminating main-thread stalls.
 * 
 * This is MANDATORY for production-grade, low-latency STT.
 * ScriptProcessorNode caused "ghost speech" due to main-thread blocking.
 * 
 * STRATEGY:
 * - Capture at native browser sample rate (44.1k / 48k)
 * - Convert Float32 → Int16 INSIDE the worklet (off main thread)
 * - Send Int16Array chunks to main thread via postMessage
 * - Zero resampling, zero buffering hacks
 */

type AudioChunkCallback = (chunk: Int16Array) => void;

// AudioWorklet processor code (embedded as Blob for Vite compatibility)
const workletCode = `
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
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

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0]) {
            const channelData = input[0];
            
            // === DIAGNOSTIC: Energy Probe ===
            // Calculate RMS volume every ~50 frames to detect silence
            this.frameCount++;
            if (this.frameCount % 50 === 0) {
                let sum = 0;
                const sampleCount = Math.min(100, channelData.length);
                for (let i = 0; i < sampleCount; i++) {
                    sum += channelData[i] * channelData[i];
                }
                const volume = Math.sqrt(sum / sampleCount);
                // Send volume to main thread for logging
                this.port.postMessage({ type: 'volume', volume: volume });
            }
            // === END DIAGNOSTIC ===
            
            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bufferIndex++] = channelData[i];
                
                if (this.bufferIndex >= this.bufferSize) {
                    // Convert to Int16 and send to main thread
                    const int16Chunk = this.float32ToInt16(this.buffer);
                    this.port.postMessage({ type: 'audio', buffer: int16Chunk.buffer }, [int16Chunk.buffer]);
                    
                    // Reset buffer
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }
            }
        }
        return true; // Keep processor alive
    }
}

registerProcessor('pcm-processor', PCMProcessor);
`;

class AudioCaptureService {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private chunkCallback: AudioChunkCallback | null = null;
    private isCapturing: boolean = false;
    private sampleRate: number = 48000;

    constructor() {
        console.log("[AudioCapture] Initialized (Phase 8.2 - AudioWorklet)");
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
            // Request microphone permission
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1, // Mono
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            // FIX: Remove sampleRate constraint - use Native Rate (48k/44.1k)
            // Browser captures at native rate, we tell Deepgram the REAL rate
            this.audioContext = new AudioContext({
                latencyHint: 'interactive'
                // sampleRate removed - uses native rate
            });

            // Get the REAL rate
            this.sampleRate = this.audioContext.sampleRate;
            console.log(`[AudioCapture] Context created at NATIVE rate: ${this.sampleRate}Hz`);

            // Create Blob URL for worklet (Vite-safe)
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            // Register the AudioWorklet
            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);

            // Create source from stream
            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create AudioWorkletNode
            this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

            // Receive messages from worklet
            this.workletNode.port.onmessage = (event) => {
                const msg = event.data;

                if (msg.type === 'volume') {
                    // === DIAGNOSTIC: Energy Probe Log ===
                    console.log(`[AudioProbe] Mic Volume: ${msg.volume.toFixed(4)}`);
                } else if (msg.type === 'audio') {
                    if (this.chunkCallback) {
                        const int16Chunk = new Int16Array(msg.buffer);
                        this.chunkCallback(int16Chunk);
                    }
                }
            };

            // Connect: source → worklet → destination (must connect to destination to stay alive)
            this.source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            this.isCapturing = true;
            console.log("[AudioCapture] Started capturing audio with AudioWorklet.");
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

        // Disconnect and cleanup
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.port.onmessage = null;
            this.workletNode = null;
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
        console.log("[AudioCapture] Stopped capturing audio.");
    }

    public getIsCapturing(): boolean {
        return this.isCapturing;
    }
}

export const AudioCapture = new AudioCaptureService();
