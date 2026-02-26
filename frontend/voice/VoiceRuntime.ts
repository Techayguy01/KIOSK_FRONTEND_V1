import { VoiceEvent } from "./voice.types";
import { AudioCapture } from "./audioCapture";
import { DeepgramClient } from "./deepgramClient";
import { WebSpeechClient } from "./webSpeechClient";
import { normalizeTranscript } from "./normalizeTranscript";
import { TTSController } from "./TTSController";

/**
 * Voice Runtime (Phase 10 - Production Hardening)
 * 
 * Full duplex voice controller with production safety features.
 * 
 * VoiceMode:
 * - idle: Not listening, not speaking
 * - listening: STT active, mic on
 * - speaking: TTS active, mic paused
 * 
 * Production Features (Phase 10):
 * - Voice Session Watchdog (20s timeout)
 * - Silence Loop Protection (2-3 turns)
 * - Session Privacy (clear on reset)
 * - Network retry on disconnect
 * - Debug observability
 */

export type VoiceMode = "idle" | "listening" | "speaking";
type StopReason = "user" | "pause";
type SttProvider = "deepgram" | "webspeech";
export type VoiceTurnState = "IDLE" | "USER_SPEAKING" | "PROCESSING" | "SYSTEM_RESPONDING";

// Configuration
const CONFIG = {
    // Allow short confirmations like "ha", "na", "ok".
    MIN_CHARS: Number(import.meta.env.VITE_MIN_TRANSCRIPT_CHARS || 1),
    FILLERS: ["uh", "um", "hmm", "huh", "ah", "oh"],
    NO_SPEECH_TIMEOUT_MS: Number(import.meta.env.VITE_NO_SPEECH_TIMEOUT_MS || 8000),
    NO_RESULT_TIMEOUT_MS: Number(import.meta.env.VITE_NO_RESULT_TIMEOUT_MS || 12000),
    MAX_SESSION_DURATION_MS: 30000,
    MIN_CONFIDENCE: Number(import.meta.env.VITE_MIN_TRANSCRIPT_CONFIDENCE || 0.2),
    MAX_RECONNECTS_PER_MINUTE: 5,

    // Phase 10: Production Hardening
    VOICE_SESSION_WATCHDOG_MS: 20000,  // 20s max without activity
    MAX_SILENT_TURNS: 3,               // After 3 silent turns → reset
    WARN_SILENT_TURNS: 2,              // After 2 → play warning
    NETWORK_RETRY_DELAY_MS: 1000,      // Wait before retry
    DEBUG_MODE: import.meta.env.DEV,   // Only in dev
    STT_PROVIDER: import.meta.env.VITE_STT_PROVIDER === "webspeech" ? "webspeech" : "deepgram",
    ENABLE_WEBSPEECH_FALLBACK: import.meta.env.VITE_ENABLE_WEBSPEECH_FALLBACK !== "false",
};

// Phase 10: Debug session tracking
interface SessionMetrics {
    sessionId: string;
    turnCount: number;
    silentTurnCount: number;
    startTime: number;
    sttLatencies: number[];
    ttsLatencies: number[];
}

class VoiceRuntimeService {
    private listeners: ((event: VoiceEvent) => void)[] = [];
    private modeListeners: ((mode: VoiceMode) => void)[] = [];

    private mode: VoiceMode = "idle";
    private isListeningActive: boolean = false;
    private activeSttProvider: SttProvider = CONFIG.STT_PROVIDER;

    // Timing state
    private sessionStartTime: number = 0;
    private hasReceivedAnyTranscript: boolean = false;
    private hasReceivedFinalTranscript: boolean = false;

    // Timers
    private noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
    private noResultTimer: ReturnType<typeof setTimeout> | null = null;
    private sessionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    // Reconnect protection
    private reconnectTimestamps: number[] = [];

    // Intentional Stop Flag - prevents auto-reconnect on user stop
    private isIntentionalStop: boolean = false;

    // Phase 10: Silence Loop Protection
    private consecutiveSilentTurns: number = 0;

    // Phase 10: Network retry
    private isRetrying: boolean = false;

    // Phase 10: Debug metrics (dev only)
    private metrics: SessionMetrics = this.createEmptyMetrics();
    private transcriptBuffer: string[] = [];  // For privacy clearing

    constructor() {
        console.log("[VoiceRuntime] Initialized (Phase 10 - Production Hardening)");
        console.log(`[VoiceRuntime] STT provider: ${this.activeSttProvider}`);

        // Wire audio chunks to Deepgram only when Deepgram is active.
        AudioCapture.onAudioChunk((chunk) => {
            if (this.mode === "listening" && this.activeSttProvider === "deepgram") {
                DeepgramClient.send(chunk);
            }
        });

        const handleSpeechStarted = () => {
            if (TTSController.isSpeaking()) {
                console.log("[VoiceRuntime] BARGE-IN: User started speaking, stopping TTS");
                TTSController.bargeIn();
                this.setMode("listening");
            }
            this.resetWatchdog();
        };

        const handleInterimTranscript = (transcript: string) => {
            if (this.mode === "listening" && transcript) {
                this.hasReceivedAnyTranscript = true;
                this.clearNoSpeechTimer();
                this.resetWatchdog();
                this.transcriptBuffer.push(transcript);
                this.emit({ type: "VOICE_TRANSCRIPT_PARTIAL", transcript });
            }
        };

        const handleFinalTranscript = (accumulatedTranscript: string, confidence?: number) => {
            if (this.mode !== "listening" || !accumulatedTranscript.trim()) {
                return;
            }

            this.hasReceivedFinalTranscript = true;
            this.clearNoResultTimer();
            this.resetWatchdog();

            const normalized = normalizeTranscript(accumulatedTranscript);
            this.transcriptBuffer.push(normalized);

            // Log STT latency (dev only)
            this.recordSTTLatency();

            // Quality gate
            const validation = this.validateTranscript(normalized);
            if (!validation.valid) {
                this.logDebug(`Transcript rejected: ${validation.reason}`);
                this.handleSilentTurn();
                return;
            }

            // Confidence check
            if (
                confidence !== undefined &&
                confidence < CONFIG.MIN_CONFIDENCE &&
                !this.isCommandLikeTranscript(normalized)
            ) {
                this.logDebug(`Transcript rejected: low confidence (${confidence})`);
                this.handleSilentTurn();
                return;
            }

            this.consecutiveSilentTurns = 0;
            this.metrics.turnCount++;

            console.log(`[VoiceRuntime] Final: "${normalized}"`);
            this.emit({ type: "VOICE_TRANSCRIPT_READY", transcript: normalized });
        };

        DeepgramClient.onSpeechStarted(handleSpeechStarted);
        DeepgramClient.onInterim((transcript) => {
            handleInterimTranscript(transcript);
        });
        DeepgramClient.onEndOfTurn(handleFinalTranscript);
        DeepgramClient.onError((error) => {
            this.handleDeepgramFailure(error);
        });

        WebSpeechClient.onSpeechStarted(handleSpeechStarted);
        WebSpeechClient.onInterim((transcript) => {
            handleInterimTranscript(transcript);
        });
        WebSpeechClient.onEndOfTurn(handleFinalTranscript);
        WebSpeechClient.onError((error) => {
            console.error("[VoiceRuntime] Web Speech STT error:", error.message);
            this.emit({ type: "VOICE_SESSION_ERROR" });
        });

        // TTS lifecycle events
        TTSController.subscribe((event) => {
            if (event.type === "TTS_ENDED" || event.type === "TTS_CANCELLED") {
                if (this.mode === "speaking") {
                    console.log("[VoiceRuntime] TTS ended, returning to idle");
                    this.setMode("idle");
                }
            }
            if (event.type === "TTS_ERROR") {
                // Phase 10: TTS failure - emit for UI to show text
                console.warn("[VoiceRuntime] TTS failed, emitting for text fallback");
                this.emit({ type: "VOICE_SESSION_ERROR" });
            }
        });
    }

    private async startActiveStt(): Promise<void> {
        if (this.activeSttProvider === "deepgram") {
            await AudioCapture.start();

            // Important: connect AFTER AudioCapture.start() so we forward the real native sample rate.
            if (!DeepgramClient.getIsConnected()) {
                DeepgramClient.connect(AudioCapture.getSampleRate());
            }
            return;
        }

        if (!WebSpeechClient.isSupported()) {
            throw new Error("Web Speech API is not supported in this browser.");
        }

        WebSpeechClient.connect();
    }

    private stopActiveStt(reason: StopReason): void {
        if (this.activeSttProvider === "deepgram") {
            if (AudioCapture.getIsCapturing()) {
                AudioCapture.stop();
            }
            // Keep websocket alive during TTS pause to avoid close/reconnect churn.
            if (reason === "user") {
                DeepgramClient.close();
            }
            return;
        }

        WebSpeechClient.close();
    }

    private handleDeepgramFailure(error: Error): void {
        if (this.activeSttProvider !== "deepgram") {
            return;
        }

        console.error("[VoiceRuntime] Deepgram STT failed:", error.message);

        if (CONFIG.ENABLE_WEBSPEECH_FALLBACK && WebSpeechClient.isSupported()) {
            console.warn("[VoiceRuntime] Switching STT provider: Deepgram -> Web Speech fallback");
            this.activeSttProvider = "webspeech";

            if (AudioCapture.getIsCapturing()) {
                AudioCapture.stop();
            }
            DeepgramClient.close();

            if (this.isListeningActive) {
                try {
                    WebSpeechClient.connect();
                    return;
                } catch (fallbackError) {
                    console.error("[VoiceRuntime] Web Speech fallback failed:", fallbackError);
                }
            } else {
                return;
            }
        }

        this.emit({ type: "VOICE_SESSION_ERROR" });
    }

    // === Phase 10: Silence Loop Protection ===

    private handleSilentTurn(): void {
        this.consecutiveSilentTurns++;
        this.logDebug(`Silent turn ${this.consecutiveSilentTurns}/${CONFIG.MAX_SILENT_TURNS}`);

        if (this.consecutiveSilentTurns >= CONFIG.MAX_SILENT_TURNS) {
            console.log("[VoiceRuntime] Too many silent turns, aborting session");
            this.emit({ type: "VOICE_SESSION_ABORTED" });
            this.hardStopAll();
        } else if (this.consecutiveSilentTurns >= CONFIG.WARN_SILENT_TURNS) {
            // Speak warning
            this.speak("I didn't catch that. Please speak or tap the screen.");
        }
    }

    // === Phase 10: Watchdog Timer ===

    private startWatchdog(): void {
        this.clearWatchdog();
        this.watchdogTimer = setTimeout(() => {
            if (this.isListeningActive || this.mode === "speaking") {
                console.log("[VoiceRuntime] WATCHDOG: Session stalled, aborting");
                this.emit({ type: "VOICE_SESSION_ABORTED" });
                this.hardStopAll();
            }
        }, CONFIG.VOICE_SESSION_WATCHDOG_MS);
    }

    private resetWatchdog(): void {
        if (this.isListeningActive || this.mode !== "idle") {
            this.startWatchdog();
        }
    }

    private clearWatchdog(): void {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    // === Phase 10: Session Privacy ===

    /**
     * Clear all session data for privacy.
     * Called on: WELCOME transition, hardStopAll, session end
     */
    public clearSessionData(): void {
        this.logDebug("Clearing session data for privacy");

        // Clear transcript buffer
        this.transcriptBuffer = [];

        // Reset metrics
        this.metrics = this.createEmptyMetrics();

        // Reset counters
        this.consecutiveSilentTurns = 0;
        this.hasReceivedAnyTranscript = false;
        this.hasReceivedFinalTranscript = false;

        // Clear any audio buffers (in AudioCapture if needed)
        // Note: AudioCapture doesn't store buffers, so nothing to clear there
    }

    private createEmptyMetrics(): SessionMetrics {
        return {
            sessionId: Math.random().toString(36).slice(2, 10),
            turnCount: 0,
            silentTurnCount: 0,
            startTime: Date.now(),
            sttLatencies: [],
            ttsLatencies: [],
        };
    }

    // === Phase 10: Debug Observability ===

    private logDebug(message: string): void {
        if (CONFIG.DEBUG_MODE) {
            console.log(`[Voice:${this.metrics.sessionId}] ${message}`);
        }
    }

    private recordSTTLatency(): void {
        if (CONFIG.DEBUG_MODE && this.sessionStartTime > 0) {
            const latency = Date.now() - this.sessionStartTime;
            this.metrics.sttLatencies.push(latency);
        }
    }

    public getDebugMetrics(): SessionMetrics | null {
        return CONFIG.DEBUG_MODE ? { ...this.metrics } : null;
    }

    // === Mode Management ===

    private setMode(newMode: VoiceMode): void {
        if (this.mode === newMode) return;
        console.log(`[VoiceRuntime] Mode: ${this.mode} → ${newMode}`);
        this.mode = newMode;
        this.modeListeners.forEach(cb => cb(newMode));
    }

    public getMode(): VoiceMode {
        return this.mode;
    }

    public onModeChange(cb: (mode: VoiceMode) => void): () => void {
        this.modeListeners.push(cb);
        return () => {
            this.modeListeners = this.modeListeners.filter(l => l !== cb);
        };
    }

    // === Full Duplex API ===

    /**
     * Start listening. Stops TTS first (priority).
     */
    public async startListening(): Promise<void> {
        // Stop any active TTS (barge-in)
        if (TTSController.isSpeaking()) {
            console.log("[VoiceRuntime] Stopping TTS to start listening");
            TTSController.hardStop();
        }

        if (this.mode === "listening") {
            return;
        }

        // Reconnect protection applies to Deepgram websocket reconnects only.
        if (
            this.activeSttProvider === "deepgram" &&
            !DeepgramClient.getIsConnected() &&
            this.isReconnectLooping()
        ) {
            return;
        }

        try {
            this.isListeningActive = true;
            this.isIntentionalStop = false; // Reset flag on new session
            this.hasReceivedAnyTranscript = false;
            this.hasReceivedFinalTranscript = false;
            this.sessionStartTime = Date.now();

            await this.startActiveStt();

            this.startNoSpeechTimer();
            this.startNoResultTimer();
            this.startSessionTimeout();
            this.startWatchdog();  // Phase 10

            this.setMode("listening");
            this.emit({ type: "VOICE_SESSION_STARTED" });
        } catch (error) {
            console.error("[VoiceRuntime] Failed to start listening:", error);
            this.isListeningActive = false;

            // Phase 10: Emit error for recovery
            this.emit({ type: "VOICE_SESSION_ERROR" });
        }
    }

    /**
     * Stop listening (user-initiated or timeout).
     */
    public stopListening(reason: StopReason = "user"): void {
        if (!this.isListeningActive) return;

        console.log(`[VoiceRuntime] Stop listening (${reason}).`);

        // Set flag: "This was intentional, don't reconnect!"
        this.isIntentionalStop = reason === "user";
        this.isListeningActive = false;
        this.clearAllTimers();
        this.clearWatchdog();
        this.stopActiveStt(reason);

        this.setMode("idle");
        this.emit({ type: "VOICE_SESSION_ENDED" });
    }

    /**
     * Speak text. Stops mic first (no overlap).
     */
    public async speak(text: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Stop listening before speaking (no overlap)
        if (this.mode === "listening") {
            console.log("[VoiceRuntime] Pausing mic to speak");
            this.stopListening("pause");
        }

        this.setMode("speaking");
        this.startWatchdog();  // Phase 10: Monitor TTS too

        try {
            await TTSController.speak(text);
        } catch (error) {
            console.error("[VoiceRuntime] TTS error:", error);
            // Phase 10: TTS failure should not block - emit for text fallback
            this.emit({ type: "VOICE_SESSION_ERROR" });
        }

        // Mode transitions handled by TTS event subscription
    }

    /**
     * Stop speaking immediately.
     */
    public stopSpeaking(): void {
        if (this.mode === "speaking" || TTSController.isSpeaking()) {
            TTSController.hardStop();
            this.setMode("idle");
        }
    }

    /**
     * Hard stop ALL audio (STT + TTS).
     * Called on: route change, state reset, ERROR, session timeout, app unmount.
     * Phase 10: Also clears session data for privacy.
     */
    public hardStopAll(): void {
        console.log("[VoiceRuntime] HARD STOP ALL AUDIO");

        // Stop TTS
        TTSController.hardStop();

        // Stop STT
        if (this.isListeningActive) {
            this.isListeningActive = false;
            this.clearAllTimers();
            this.stopActiveStt("user");
        } else {
            if (AudioCapture.getIsCapturing()) {
                AudioCapture.stop();
            }
            DeepgramClient.close();
            WebSpeechClient.close();
        }

        this.clearWatchdog();
        this.clearSessionData();  // Phase 10: Privacy
        this.setMode("idle");
    }

    // === Quality Gate ===

    private validateTranscript(text: string): { valid: boolean; reason?: string } {
        const cleaned = text.trim().toLowerCase();
        if (cleaned.length < CONFIG.MIN_CHARS) {
            return { valid: false, reason: "too_short" };
        }
        if (CONFIG.FILLERS.includes(cleaned)) {
            return { valid: false, reason: "filler_only" };
        }
        return { valid: true };
    }

    private isCommandLikeTranscript(text: string): boolean {
        const t = text.toLowerCase();
        return /\b(book|booking|room|check ?in|pay|payment|confirm|cancel|back|go back|help|yes|no|continue|proceed|modify|change|amenit|price)\b/.test(t);
    }

    // === Timeouts ===

    private startNoSpeechTimer(): void {
        this.noSpeechTimer = setTimeout(() => {
            if (this.isListeningActive && !this.hasReceivedAnyTranscript) {
                console.log("[Voice] Session auto-ended: no speech");
                this.handleSilentTurn();  // Phase 10: Count as silent
                this.stopListening("pause");
            }
        }, CONFIG.NO_SPEECH_TIMEOUT_MS);
    }

    private clearNoSpeechTimer(): void {
        if (this.noSpeechTimer) {
            clearTimeout(this.noSpeechTimer);
            this.noSpeechTimer = null;
        }
    }

    private startNoResultTimer(): void {
        this.noResultTimer = setTimeout(() => {
            if (this.isListeningActive && !this.hasReceivedFinalTranscript) {
                console.log("[Voice] Session auto-ended: no result");
                this.handleSilentTurn();  // Phase 10
                this.stopListening("pause");
            }
        }, CONFIG.NO_RESULT_TIMEOUT_MS);
    }

    private clearNoResultTimer(): void {
        if (this.noResultTimer) {
            clearTimeout(this.noResultTimer);
            this.noResultTimer = null;
        }
    }

    private startSessionTimeout(): void {
        this.sessionTimeoutTimer = setTimeout(() => {
            if (this.isListeningActive) {
                console.log("[Voice] Session auto-ended: max duration");
                this.stopListening("pause");
            }
        }, CONFIG.MAX_SESSION_DURATION_MS);
    }

    private clearSessionTimeout(): void {
        if (this.sessionTimeoutTimer) {
            clearTimeout(this.sessionTimeoutTimer);
            this.sessionTimeoutTimer = null;
        }
    }

    private clearAllTimers(): void {
        this.clearNoSpeechTimer();
        this.clearNoResultTimer();
        this.clearSessionTimeout();
    }

    // === Reconnect Protection ===

    private isReconnectLooping(): boolean {
        const now = Date.now();
        this.reconnectTimestamps = this.reconnectTimestamps.filter(ts => ts > now - 60000);
        if (this.reconnectTimestamps.length >= CONFIG.MAX_RECONNECTS_PER_MINUTE) {
            console.log("[Voice] Session blocked: reconnect loop");
            return true;
        }
        this.reconnectTimestamps.push(now);
        return false;
    }

    // === Events ===

    public subscribe(cb: (event: VoiceEvent) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }

    private emit(event: VoiceEvent) {
        const logInfo = 'transcript' in event ? event.transcript : '';
        console.log(`[VoiceRuntime] Emitting: ${event.type}`, logInfo);
        this.listeners.forEach(cb => cb(event));
    }

    // === Legacy Compatibility ===

    public async startSession(): Promise<void> {
        return this.startListening();
    }

    public endSession(): void {
        this.stopListening();
    }

    public cancelSession(): void {
        this.stopListening();
    }

    public getIsActive(): boolean {
        return this.isListeningActive;
    }

    public canStartVoice(): boolean {
        return this.mode === "idle";
    }

    public getTurnState() {
        switch (this.mode) {
            case "listening": return "USER_SPEAKING";
            case "speaking": return "SYSTEM_RESPONDING";
            default: return "IDLE";
        }
    }

    public setTurnState(state: string): void {
        if (state === "IDLE") this.setMode("idle");
    }

    public onTurnStateChange(cb: (state: any) => void): () => void {
        return this.onModeChange((mode) => {
            cb(this.getTurnState());
        });
    }
}

export const VoiceRuntime = new VoiceRuntimeService();
