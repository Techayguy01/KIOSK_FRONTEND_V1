/**
 * Voice Relay Client
 *
 * Browser AudioWorklet -> Backend Relay -> Deepgram
 * Deepgram transcripts -> Backend Relay -> Browser
 */

type InterimCallback = (transcript: string, isFinal: boolean) => void;
type EndOfTurnCallback = (accumulatedTranscript: string, confidence?: number) => void;
type SpeechStartedCallback = () => void;
type ErrorCallback = (error: Error) => void;

import { AudioCapture } from "./audioCapture";

const RELAY_URL = import.meta.env.VITE_VOICE_RELAY_URL || "ws://localhost:3001";
const STT_LANGUAGE = (import.meta.env.VITE_STT_LANGUAGE || "").trim();
const ENABLE_INTERIM_COMMIT = import.meta.env.VITE_ENABLE_INTERIM_COMMIT === "true";
const INTERIM_COMMIT_MS = Number(import.meta.env.VITE_INTERIM_COMMIT_MS || 5000);
const MIN_INTERIM_COMMIT_CONFIDENCE = Number(import.meta.env.VITE_INTERIM_COMMIT_CONFIDENCE || 0.8);
const MIN_INTERIM_COMMIT_CHARS = Number(import.meta.env.VITE_INTERIM_COMMIT_CHARS || 12);
const FINAL_COMMIT_GRACE_MS = Number(import.meta.env.VITE_FINAL_COMMIT_GRACE_MS || 250);
const MAX_PENDING_AUDIO_CHUNKS = Number(import.meta.env.VITE_MAX_PENDING_AUDIO_CHUNKS || 64);

const RECOVERABLE_CLOSE_CODES = [1006, 1011, 1012, 1013];
const RETRY_DELAY_MS = 1000;

class VoiceRelayClient {
    private socket: WebSocket | null = null;
    private interimCallback: InterimCallback | null = null;
    private endOfTurnCallback: EndOfTurnCallback | null = null;
    private speechStartedCallback: SpeechStartedCallback | null = null;
    private errorCallback: ErrorCallback | null = null;
    private isConnected = false;

    private interimTimer: ReturnType<typeof setTimeout> | null = null;
    private finalCommitTimer: ReturnType<typeof setTimeout> | null = null;
    private accumulatedTranscript = "";
    private finalTranscriptParts: string[] = [];
    private lastInterimTranscript = "";
    private lastConfidence = 0;
    private pendingAudioChunks: ArrayBuffer[] = [];

    private hasRetriedOnce = false;
    private lastSampleRate = 48000;

    constructor() {
        console.log("[VoiceRelay] Client initialized");
    }

    public onInterim(callback: InterimCallback) {
        this.interimCallback = callback;
    }

    public onEndOfTurn(callback: EndOfTurnCallback) {
        this.endOfTurnCallback = callback;
    }

    public onSpeechStarted(callback: SpeechStartedCallback) {
        this.speechStartedCallback = callback;
    }

    public onError(callback: ErrorCallback) {
        this.errorCallback = callback;
    }

    public connect(sampleRateOverride?: number): void {
        if (this.isConnected) {
            console.warn("[VoiceRelay] Already connected.");
            return;
        }

        const sampleRate = sampleRateOverride || AudioCapture.getSampleRate();
        const relayUrl = `${RELAY_URL}?sample_rate=${sampleRate}${STT_LANGUAGE ? `&language=${encodeURIComponent(STT_LANGUAGE)}` : ""}`;
        this.lastSampleRate = sampleRate;

        console.log(`[VoiceRelay] Connecting to backend relay at ${relayUrl}...`);

        this.socket = new WebSocket(relayUrl);
        this.accumulatedTranscript = "";
        this.finalTranscriptParts = [];
        this.lastInterimTranscript = "";
        this.lastConfidence = 0;

        this.socket.onopen = () => {
            console.log(`[VoiceRelay] Connected (sample_rate=${sampleRate})`);
            this.isConnected = true;
            this.hasRetriedOnce = false;
            this.flushPendingAudio();
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
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

            const isRecoverable = RECOVERABLE_CLOSE_CODES.includes(event.code);
            const isClientStop = event.code === 1000 && event.reason === "client_stop";

            if (isRecoverable && !this.hasRetriedOnce) {
                console.log("[VoiceRelay] Recoverable disconnect, retrying once...");
                this.hasRetriedOnce = true;
                setTimeout(() => {
                    this.connect(this.lastSampleRate);
                }, RETRY_DELAY_MS);
                return;
            }

            if (!isClientStop) {
                this.errorCallback?.(
                    new Error(`Voice relay disconnected (code=${event.code}, reason=${event.reason || "none"})`)
                );
            }
        };
    }

    private handleNovaMessage(data: any) {
        const msgType = data.type;

        switch (msgType) {
            case "Results": {
                const alternative = data.channel?.alternatives?.[0];
                const transcript = alternative?.transcript || "";
                const confidence = alternative?.confidence ?? 0;
                const isFinal = data.is_final === true;
                const isSpeechFinal = data.speech_final === true;

                if (!transcript) {
                    return;
                }

                this.interimCallback?.(transcript, isFinal);

                if (isFinal) {
                    this.clearInterimTimer();
                    const cleaned = transcript.trim();
                    if (cleaned) {
                        this.finalTranscriptParts.push(cleaned);
                        this.accumulatedTranscript = cleaned;
                    }
                    this.lastConfidence = Math.max(this.lastConfidence, confidence);
                    this.scheduleFinalCommit();
                    if (isSpeechFinal) {
                        this.triggerEndOfTurn();
                    }
                } else {
                    this.lastInterimTranscript = transcript.trim();
                    this.lastConfidence = confidence;
                    if (ENABLE_INTERIM_COMMIT) {
                        this.startInterimTimer();
                    }
                }
                break;
            }

            case "SpeechStarted":
                this.clearInterimTimer();
                this.clearFinalCommitTimer();
                this.accumulatedTranscript = "";
                this.finalTranscriptParts = [];
                this.lastInterimTranscript = "";
                this.speechStartedCallback?.();
                break;

            case "UtteranceEnd":
                this.triggerEndOfTurn();
                break;

            case "Metadata":
                break;

            default:
                break;
        }
    }

    private scheduleFinalCommit(): void {
        this.clearFinalCommitTimer();
        this.finalCommitTimer = setTimeout(() => {
            this.triggerEndOfTurn();
        }, FINAL_COMMIT_GRACE_MS);
    }

    private triggerEndOfTurn() {
        this.clearInterimTimer();
        this.clearFinalCommitTimer();

        const joinedFinal = this.finalTranscriptParts.join(" ").trim();
        const finalValidText = joinedFinal || this.accumulatedTranscript || this.lastInterimTranscript;

        if (finalValidText && finalValidText.trim().length > 0) {
            console.log(`[VoiceRelay] EndOfTurn: "${finalValidText}"`);
            this.endOfTurnCallback?.(finalValidText.trim(), this.lastConfidence);

            this.accumulatedTranscript = "";
            this.finalTranscriptParts = [];
            this.lastInterimTranscript = "";
            this.lastConfidence = 0;
        }
    }

    private startInterimTimer() {
        this.clearInterimTimer();
        this.interimTimer = setTimeout(() => {
            const candidate = this.lastInterimTranscript.trim();
            if (
                candidate.length < MIN_INTERIM_COMMIT_CHARS ||
                this.lastConfidence < MIN_INTERIM_COMMIT_CONFIDENCE
            ) {
                return;
            }

            this.accumulatedTranscript = candidate;
            this.triggerEndOfTurn();
        }, INTERIM_COMMIT_MS);
    }

    private clearInterimTimer() {
        if (this.interimTimer) {
            clearTimeout(this.interimTimer);
            this.interimTimer = null;
        }
    }

    private clearFinalCommitTimer() {
        if (this.finalCommitTimer) {
            clearTimeout(this.finalCommitTimer);
            this.finalCommitTimer = null;
        }
    }

    public send(audioChunk: Int16Array): void {
        if (!this.socket) {
            return;
        }

        if (this.socket.readyState !== WebSocket.OPEN) {
            if (this.socket.readyState === WebSocket.CONNECTING) {
                if (this.pendingAudioChunks.length >= MAX_PENDING_AUDIO_CHUNKS) {
                    this.pendingAudioChunks.shift();
                }
                this.pendingAudioChunks.push(audioChunk.slice().buffer);
            }
            return;
        }

        this.socket.send(audioChunk.buffer);
    }

    private flushPendingAudio(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        if (this.pendingAudioChunks.length === 0) {
            return;
        }

        console.log(`[VoiceRelay] Flushing ${this.pendingAudioChunks.length} buffered chunks`);
        for (const chunk of this.pendingAudioChunks) {
            this.socket.send(chunk);
        }
        this.pendingAudioChunks = [];
    }

    public close(): string {
        const transcript = this.finalTranscriptParts.join(" ").trim() || this.accumulatedTranscript;

        this.clearInterimTimer();
        this.clearFinalCommitTimer();

        if (this.socket) {
            this.socket.close(1000, "client_stop");
            this.socket = null;
        }

        this.isConnected = false;
        this.accumulatedTranscript = "";
        this.finalTranscriptParts = [];
        this.lastInterimTranscript = "";
        this.lastConfidence = 0;
        this.pendingAudioChunks = [];

        return transcript;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }
}

export const DeepgramClient = new VoiceRelayClient();
