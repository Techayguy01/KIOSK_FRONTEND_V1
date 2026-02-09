/**
 * Voice Relay Client (Phase 8.3)
 * 
 * Connects to Backend Voice Relay instead of directly to Deepgram.
 * Deepgram API key is now 100% server-side.
 * 
 * Architecture:
 *   Browser AudioWorklet → Backend Relay (ws://localhost:3001) → Deepgram Nova-2
 *   Deepgram Transcripts → Backend Relay → This Client → VoiceRuntime
 * 
 * SECURITY: No Deepgram credentials in browser bundle.
 */

type InterimCallback = (transcript: string, isFinal: boolean) => void;
type EndOfTurnCallback = (accumulatedTranscript: string, confidence?: number) => void;
type SpeechStartedCallback = () => void;  // Phase 9.4: Barge-in trigger
type ErrorCallback = (error: Error) => void;  // Phase 10: Network failure

import { AudioCapture } from "./audioCapture";

// Backend relay URL (configurable via env for production)
const RELAY_URL = import.meta.env.VITE_VOICE_RELAY_URL || 'ws://localhost:3001';

// Phase 10: Network failure codes
const RECOVERABLE_CLOSE_CODES = [1006, 1011, 1012, 1013];
const RETRY_DELAY_MS = 1000;

class VoiceRelayClient {
    private socket: WebSocket | null = null;
    private interimCallback: InterimCallback | null = null;
    private endOfTurnCallback: EndOfTurnCallback | null = null;
    private speechStartedCallback: SpeechStartedCallback | null = null;  // Phase 9.4
    private errorCallback: ErrorCallback | null = null;  // Phase 10
    private isConnected: boolean = false;

    // Phase 9.9: Aggressive Finalization state
    private interimTimer: ReturnType<typeof setTimeout> | null = null;
    private accumulatedTranscript: string = "";
    private lastInterimTranscript: string = "";
    private lastConfidence: number = 0;

    // Phase 10: Retry state
    private hasRetriedOnce: boolean = false;
    private lastSampleRate: number = 48000;

    constructor() {
        console.log("[VoiceRelay] Client initialized (Phase 10 - Production Hardening)");
    }

    public onInterim(callback: InterimCallback) {
        this.interimCallback = callback;
    }

    public onEndOfTurn(callback: EndOfTurnCallback) {
        this.endOfTurnCallback = callback;
    }

    // Phase 9.4: Barge-in trigger
    public onSpeechStarted(callback: SpeechStartedCallback) {
        this.speechStartedCallback = callback;
    }

    // Phase 10: Error callback for network failures
    public onError(callback: ErrorCallback) {
        this.errorCallback = callback;
    }

    public connect(): void {
        if (this.isConnected) {
            console.warn("[VoiceRelay] Already connected.");
            return;
        }

        // Get native sample rate from AudioCapture
        const sampleRate = AudioCapture.getSampleRate();

        // Build URL with sample_rate query param (forwarded to backend → Deepgram)
        const relayUrl = `${RELAY_URL}?sample_rate=${sampleRate}`;
        this.lastSampleRate = sampleRate;

        console.log(`[VoiceRelay] Connecting to backend relay at ${relayUrl}...`);

        // Connect to backend relay (not directly to Deepgram)
        this.socket = new WebSocket(relayUrl);
        this.accumulatedTranscript = "";

        this.socket.onopen = () => {
            console.log(`[VoiceRelay] Connected to backend relay (sample_rate=${sampleRate})`);
            this.isConnected = true;
            this.hasRetriedOnce = false;  // Reset retry flag on successful connect
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Check for relay errors
                if (data.error) {
                    console.error("[VoiceRelay] Backend error:", data.error);
                    this.errorCallback?.(new Error(data.error));
                    return;
                }

                this.handleNovaMessage(data);
            } catch (error) {
                console.error("[VoiceRelay] Failed to parse message:", error);
            }
        };

        this.socket.onerror = (error) => {
            console.error("[VoiceRelay] WebSocket error:", error);
            this.errorCallback?.(new Error("WebSocket error"));
        };

        this.socket.onclose = (event) => {
            console.log(`[VoiceRelay] WebSocket closed: ${event.code} ${event.reason}`);
            this.isConnected = false;

            // Phase 10: Auto-retry on recoverable disconnect
            if (RECOVERABLE_CLOSE_CODES.includes(event.code) && !this.hasRetriedOnce) {
                console.log("[VoiceRelay] Recoverable disconnect, retrying once...");
                this.hasRetriedOnce = true;
                setTimeout(() => {
                    this.connect();
                }, RETRY_DELAY_MS);
            }
        };
    }

    /**
     * Handle Nova-2 message format (passed through from backend).
     * Nova-2 uses: type="Results", channel.alternatives[0].transcript, speech_final
     */
    private handleNovaMessage(data: any) {
        // === DIAGNOSTIC: Raw Truth Probe ===
        if (data.type === "Results" || data.channel) {
            console.log("[RawProbe] RAW DEEPGRAM JSON:", JSON.stringify(data));
        }
        // === END DIAGNOSTIC ===

        const msgType = data.type;

        switch (msgType) {
            case "Results":
                const channel = data.channel;
                const alternative = channel?.alternatives?.[0];
                const transcript = alternative?.transcript || "";
                const confidence = alternative?.confidence ?? 0;
                const isFinal = data.is_final === true;

                // Note: We ignore speech_final. If text is final, we go.

                if (transcript) {
                    // 1. Emit Interim Results (Visuals)
                    if (this.interimCallback) {
                        this.interimCallback(transcript, isFinal);
                    }

                    // 2. AGGRESSIVE FINALIZATION 🚀
                    if (isFinal) {
                        this.clearInterimTimer();
                        this.accumulatedTranscript = transcript.trim();
                        this.lastConfidence = confidence;

                        // FIRE IMMEDIATELY. Do not wait.
                        this.triggerEndOfTurn();
                    }
                    // 3. Handle Partial Text (Interim Commit Fallback)
                    else {
                        this.lastInterimTranscript = transcript.trim();
                        this.lastConfidence = confidence;
                        this.startInterimTimer();
                    }
                }
                break;

            case "SpeechStarted":
                this.clearInterimTimer();
                this.accumulatedTranscript = "";
                this.lastInterimTranscript = "";
                if (this.speechStartedCallback) this.speechStartedCallback();
                break;

            case "UtteranceEnd":
                // Backup only. Usually isFinal handles it first.
                this.triggerEndOfTurn();
                break;

            case "Metadata":
                // Ignore metadata messages
                break;

            default:
                // console.log("[VoiceRelay] Unknown message type:", msgType);
                break;
        }
    }

    private triggerEndOfTurn() {
        this.clearInterimTimer();

        // Prefer finalized text, fall back to interim
        const finalValidText = this.accumulatedTranscript || this.lastInterimTranscript;

        // CRITICAL: Check if we actually have text to send
        if (finalValidText && finalValidText.trim().length > 0) {
            console.log(`[VoiceRelay] EndOfTurn Triggered: "${finalValidText}"`);

            if (this.endOfTurnCallback) {
                this.endOfTurnCallback(finalValidText.trim(), this.lastConfidence);
            }

            // RESET IMMEDIATELY to prevent double-sends
            this.accumulatedTranscript = "";
            this.lastInterimTranscript = "";
            this.lastConfidence = 0;
        }
    }

    private startInterimTimer() {
        this.clearInterimTimer();
        // If we get stuck on a partial for 2.0s, force it through.
        this.interimTimer = setTimeout(() => {
            console.warn(`[VoiceRelay] Interim Commit: Forcing finalize on "${this.lastInterimTranscript}"`);
            this.accumulatedTranscript = this.lastInterimTranscript;
            this.triggerEndOfTurn();
        }, 2000);
    }

    private clearInterimTimer() {
        if (this.interimTimer) {
            clearTimeout(this.interimTimer);
            this.interimTimer = null;
        }
    }

    /**
     * Send audio chunk to backend relay.
     * Backend forwards to Deepgram.
     */
    public send(audioChunk: Int16Array): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        // === DIAGNOSTIC: Data Type Probe ===
        if (Math.random() < 0.01) {
            const sample = audioChunk[0];
            const isFloat = Math.abs(sample) < 1.0 && sample !== 0;
            console.log(`[SocketProbe] Sample: ${sample} | Type: ${isFloat ? "FLOAT (BAD ❌)" : "INT (GOOD ✅)"}`);
        }
        // === END DIAGNOSTIC ===

        // Send raw Int16 PCM buffer to backend relay
        this.socket.send(audioChunk.buffer);
    }

    public close(): string {
        const transcript = this.accumulatedTranscript;

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.isConnected = false;
        this.accumulatedTranscript = "";

        return transcript;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }
}

// Export as DeepgramClient for backwards compatibility with VoiceRuntime
export const DeepgramClient = new VoiceRelayClient();
