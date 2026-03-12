import { VoiceEvent } from "./voice.types";
import { WebSpeechClient } from "./webSpeechClient";
import { normalizeTranscript } from "./normalizeTranscript";
import { TTSController } from "./TTSController";
import { getCurrentTenantLanguage } from "../services/tenantContext";

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
type StopReason = "user" | "pause" | "timeout_no_speech" | "timeout_no_result" | "session_timeout" | "permission_denied" | "hard_stop";
type SttProvider = "webspeech";
export type VoiceTurnState = "IDLE" | "USER_SPEAKING" | "PROCESSING" | "SYSTEM_RESPONDING";

type RuntimeSttError = Error & {
    code?: string;
    fatal?: boolean;
    recoverable?: boolean;
    expected?: boolean;
    permissionDenied?: boolean;
};

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
    VOICE_SESSION_WATCHDOG_MS: 30000,  // 30s max without activity
    MAX_SILENT_TURNS: 3,               // After 3 silent turns → reset
    WARN_SILENT_TURNS: 2,              // After 2 → play warning
    NETWORK_RETRY_DELAY_MS: 1000,      // Wait before retry
    DEBUG_MODE: import.meta.env.DEV,   // Only in dev
    STT_PROVIDER: "webspeech" as SttProvider,
    ENABLE_WEBSPEECH_FALLBACK: true,
    STT_PERMISSION_DENIED_COOLDOWN_MS: Number(import.meta.env.VITE_STT_PERMISSION_DENIED_COOLDOWN_MS || 15000),
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

    // Configuration (Mutable for Adaptive VAD)
    private noSpeechTimeoutMs: number = CONFIG.NO_SPEECH_TIMEOUT_MS;
    private noResultTimeoutMs: number = CONFIG.NO_RESULT_TIMEOUT_MS;

    // Timers
    private noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
    private noResultTimer: ReturnType<typeof setTimeout> | null = null;
    private sessionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    // Reconnect protection
    private reconnectTimestamps: number[] = [];

    // Intentional Stop Flag - prevents auto-reconnect on user stop
    private isIntentionalStop: boolean = false;
    private permissionDeniedCooldownUntil: number = 0;

    // Phase 10: Silence Loop Protection
    private consecutiveSilentTurns: number = 0;

    // Phase 10: Watchdog state
    private isWatchdogPaused: boolean = false;

    // Phase 10: Network retry
    private isRetrying: boolean = false;

    // Phase 10: Debug metrics (dev only)
    private metrics: SessionMetrics = this.createEmptyMetrics();
    private transcriptBuffer: string[] = [];  // For privacy clearing

    // HMR cleanup: store unsubscribe functions so destroy() can remove ghost callbacks
    private disposers: (() => void)[] = [];

    constructor() {
        console.log("[VoiceRuntime] Initialized (Phase 10 - Production Hardening)");
        console.log(`[VoiceRuntime] STT provider: ${this.activeSttProvider}`);

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
                // Long utterances may stream partials for several seconds before a final commit.
                // Refresh the no-result window on every partial so booking details spoken in one go
                // do not get cut off mid-sentence.
                this.clearNoResultTimer();
                this.startNoResultTimer();
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
            console.log(`[VoiceRuntime] Final raw: "${accumulatedTranscript}"`);
            console.log(`[VoiceRuntime] Final normalized: "${normalized}"`);
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

            console.log(`[VoiceRuntime] Final accepted: "${normalized}"`);
            this.emit({ type: "VOICE_TRANSCRIPT_READY", transcript: normalized });
        };



        WebSpeechClient.onSpeechStarted(handleSpeechStarted);
        WebSpeechClient.onInterim((transcript) => {
            handleInterimTranscript(transcript);
        });
        WebSpeechClient.onEndOfTurn(handleFinalTranscript);
        WebSpeechClient.onError((error) => {
            const sttError = error as RuntimeSttError;
            const errorCode = String(sttError.code || "");

            // Expected lifecycle stop/reset aborts are informational, not runtime failures.
            if (sttError.expected || errorCode === "aborted") {
                this.logDebug(`Expected STT abort ignored (${errorCode || "aborted"})`);
                return;
            }

            if (sttError.permissionDenied || errorCode === "not-allowed" || errorCode === "service-not-allowed") {
                this.permissionDeniedCooldownUntil = Date.now() + CONFIG.STT_PERMISSION_DENIED_COOLDOWN_MS;
                console.warn("[VoiceRuntime] STT permission denied. Auto-retry disabled during cooldown.");

                if (this.isListeningActive) {
                    this.stopListening("permission_denied");
                } else {
                    this.clearAllTimers();
                    this.clearWatchdog();
                    this.setMode("idle");
                }

                this.emit({
                    type: "VOICE_SESSION_ERROR",
                    reason: "stt_permission_denied",
                    fatal: true,
                    recoverable: false,
                    detail: sttError.message || "permission_denied",
                });
                return;
            }

            const recoverable = Boolean(sttError.recoverable);
            const fatal = Boolean(sttError.fatal) || !recoverable;
            const reason = fatal ? "stt_fatal" : "stt_recoverable";
            console.warn(`[VoiceRuntime] STT ${reason}: ${sttError.message || errorCode || "unknown"}`);
            this.emit({
                type: "VOICE_SESSION_ERROR",
                reason,
                fatal,
                recoverable,
                detail: sttError.message || (errorCode || "unknown_error"),
            });
        });

        // TTS lifecycle events — store unsubscribe for HMR cleanup
        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === "TTS_ENDED" || event.type === "TTS_CANCELLED" || event.type === "TTS_ERROR") {
                if (this.mode === "speaking") {
                    console.log("[VoiceRuntime] TTS lifecycle completed, returning to idle");
                    this.setMode("idle");
                }
                this.clearWatchdog();
            }
            if (event.type === "TTS_ERROR") {
                // Phase 10: TTS failure - emit for UI to show text
                console.warn("[VoiceRuntime] TTS failed, emitting for text fallback");
                this.emit({
                    type: "VOICE_SESSION_ERROR",
                    reason: "tts_failure",
                    fatal: false,
                    recoverable: true,
                    detail: event.error || "tts_failure",
                });
            }
        });
        this.disposers.push(unsubTTS);
    }

    private async startActiveStt(): Promise<void> {
        if (!WebSpeechClient.isSupported()) {
            throw new Error("Web Speech API is not supported in this browser.");
        }

        WebSpeechClient.connect();
    }

    private stopActiveStt(_reason: StopReason): string {
        return WebSpeechClient.close();
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
            this.speak(this.getSilentTurnPrompt(), getCurrentTenantLanguage());
        }
    }

    private getSilentTurnPrompt(): string {
        switch (getCurrentTenantLanguage()) {
            case "hi":
                return "मैं समझ नहीं पाई। कृपया फिर से बोलिए या स्क्रीन पर टैप कीजिए।";
            case "mr":
                return "मला नीट समजले नाही. कृपया पुन्हा बोला किंवा स्क्रीनवर टॅप करा.";
            default:
                return "I didn't catch that. Please speak or tap the screen.";
        }
    }

    // === Phase 10: Watchdog Timer ===

    private startWatchdog(): void {
        this.clearWatchdog();
        if (this.isWatchdogPaused) return;

        this.watchdogTimer = setTimeout(() => {
            if (this.isListeningActive || this.mode === "speaking") {
                console.log("[VoiceRuntime] WATCHDOG: Session stalled, aborting");
                this.emit({ type: "VOICE_SESSION_ABORTED" });
                this.hardStopAll();
            }
        }, CONFIG.VOICE_SESSION_WATCHDOG_MS);
    }

    public pauseWatchdog(): void {
        console.log("[VoiceRuntime] Watchdog PAUSED");
        this.isWatchdogPaused = true;
        this.clearWatchdog();
    }

    public resumeWatchdog(): void {
        console.log("[VoiceRuntime] Watchdog RESUMED");
        this.isWatchdogPaused = false;
        this.resetWatchdog();
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

        // Reset timeouts to defaults when returning to idle
        if (newMode === "idle") {
            this.noSpeechTimeoutMs = CONFIG.NO_SPEECH_TIMEOUT_MS;
            this.noResultTimeoutMs = CONFIG.NO_RESULT_TIMEOUT_MS;
        }

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

    // === Adaptive Timeouts ===

    /**
     * Update the VAD timeouts for the current interaction phase.
     */
    public updateTimeouts(noSpeech: number, noResult: number): void {
        console.log(`[VoiceRuntime] Updating timeouts: noSpeech=${noSpeech}ms, noResult=${noResult}ms`);
        this.noSpeechTimeoutMs = noSpeech;
        this.noResultTimeoutMs = noResult;
    }

    // === Full Duplex API ===

    /**
     * Start listening. Stops TTS first (priority).
     */
    public async startListening(language?: string): Promise<void> {
        // Update STT language if provided
        if (language) {
            WebSpeechClient.setLanguage(language);
        }

        // Stop any active TTS (barge-in)
        if (TTSController.isSpeaking()) {
            console.log("[VoiceRuntime] Stopping TTS to start listening");
            TTSController.hardStop();
        }

        if (this.mode === "listening") {
            return;
        }

        if (Date.now() < this.permissionDeniedCooldownUntil) {
            const retryInMs = Math.max(0, this.permissionDeniedCooldownUntil - Date.now());
            console.warn(`[VoiceRuntime] STT blocked by permission cooldown (${retryInMs}ms remaining)`);
            this.emit({
                type: "VOICE_SESSION_ERROR",
                reason: "stt_permission_denied",
                fatal: true,
                recoverable: false,
                detail: `permission_cooldown_${retryInMs}ms`,
            });
            return;
        }



        try {
            this.isListeningActive = true;
            this.isIntentionalStop = false; // Reset flag on new session
            this.hasReceivedAnyTranscript = false;
            this.hasReceivedFinalTranscript = false;
            this.sessionStartTime = Date.now();

            await this.startActiveStt();
            this.permissionDeniedCooldownUntil = 0;

            this.startNoSpeechTimer();
            this.startNoResultTimer();
            this.startSessionTimeout();
            this.startWatchdog();  // Phase 10

            this.setMode("listening");
            this.emit({ type: "VOICE_SESSION_STARTED" });
        } catch (error) {
            const sttError = error as RuntimeSttError;
            const errorCode = String(sttError?.code || "");
            console.error("[VoiceRuntime] Failed to start listening:", error);
            this.isListeningActive = false;
            this.clearAllTimers();
            this.clearWatchdog();
            this.setMode("idle");

            if (sttError?.permissionDenied || errorCode === "not-allowed" || errorCode === "service-not-allowed") {
                this.permissionDeniedCooldownUntil = Date.now() + CONFIG.STT_PERMISSION_DENIED_COOLDOWN_MS;
                this.emit({
                    type: "VOICE_SESSION_ERROR",
                    reason: "stt_permission_denied",
                    fatal: true,
                    recoverable: false,
                    detail: sttError?.message || "permission_denied",
                });
                return;
            }

            const recoverable = Boolean(sttError?.recoverable);
            const fatal = Boolean(sttError?.fatal) || !recoverable;
            this.emit({
                type: "VOICE_SESSION_ERROR",
                reason: fatal ? "stt_fatal" : "stt_recoverable",
                fatal,
                recoverable,
                detail: sttError?.message || "stt_start_failed",
            });
        }
    }

    /**
     * Stop listening (user-initiated or timeout).
     */
    public stopListening(reason: StopReason = "user"): void {
        if (!this.isListeningActive) return;

        console.log(`[VoiceRuntime] Stop listening (${reason}).`);
        const hadTranscript = this.hasReceivedAnyTranscript || this.hasReceivedFinalTranscript;
        if (reason === "permission_denied") {
            this.permissionDeniedCooldownUntil = Math.max(
                this.permissionDeniedCooldownUntil,
                Date.now() + CONFIG.STT_PERMISSION_DENIED_COOLDOWN_MS
            );
        }

        // Set flag: "This was intentional, don't reconnect!"
        this.isIntentionalStop = reason === "user";
        this.isListeningActive = false;
        this.clearAllTimers();
        this.clearWatchdog();
        const recoveredTranscript = this.stopActiveStt(reason);

        if (!this.hasReceivedFinalTranscript && recoveredTranscript.trim()) {
            const normalizedRecovered = normalizeTranscript(recoveredTranscript);
            const validation = this.validateTranscript(normalizedRecovered);
            if (validation.valid) {
                console.log(`[VoiceRuntime] Recovered final from interim buffer (${reason}): "${normalizedRecovered}"`);
                this.hasReceivedFinalTranscript = true;
                this.emit({ type: "VOICE_TRANSCRIPT_READY", transcript: normalizedRecovered });
            } else {
                this.logDebug(`Recovered interim transcript rejected: ${validation.reason}`);
            }
        }

        this.setMode("idle");
        this.emit({ type: "VOICE_SESSION_ENDED", reason, hadTranscript });
    }

    /**
     * Speak text. Stops mic first (no overlap).
     */
    public async speak(text: string, language?: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Stop listening before speaking (no overlap)
        if (this.mode === "listening") {
            console.log("[VoiceRuntime] Pausing mic to speak");
            this.stopListening("pause");
        }

        this.setMode("speaking");
        this.startWatchdog();  // Phase 10: Monitor TTS too

        try {
            await TTSController.speak(text, language);
        } catch (error) {
            console.error("[VoiceRuntime] TTS error:", error);
            // Phase 10: TTS failure should not block - emit for text fallback
            this.emit({
                type: "VOICE_SESSION_ERROR",
                reason: "tts_failure",
                fatal: false,
                recoverable: true,
                detail: error instanceof Error ? error.message : "tts_failure",
            });
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
        const hadTranscript = this.hasReceivedAnyTranscript || this.hasReceivedFinalTranscript;

        // Stop TTS
        TTSController.hardStop();

        // Stop STT
        if (this.isListeningActive) {
            this.isListeningActive = false;
            this.clearAllTimers();
            this.stopActiveStt("hard_stop");
            this.emit({ type: "VOICE_SESSION_ENDED", reason: "hard_stop", hadTranscript });
        } else {
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
                this.stopListening("timeout_no_speech");
            }
        }, this.noSpeechTimeoutMs);
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
                this.stopListening("timeout_no_result");
            }
        }, this.noResultTimeoutMs);
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
                this.stopListening("session_timeout");
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

    public async startSession(language?: string): Promise<void> {
        return this.startListening(language);
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
    /**
     * Destroy this instance — stop listening and clear all listeners.
     * Called during HMR to prevent ghost instances.
     */
    public destroy(): void {
        this.stopListening();
        this.clearAllTimers();
        // Unsubscribe from TTSController's listener array
        this.disposers.forEach(unsub => unsub());
        this.disposers = [];
        // Clear own listener arrays
        this.listeners = [];
        this.modeListeners = [];
        // Clear WebSpeechClient callbacks to prevent ghost voice sessions
        WebSpeechClient.onSpeechStarted(() => { });
        WebSpeechClient.onInterim(() => { });
        WebSpeechClient.onEndOfTurn(() => { });
        WebSpeechClient.onError(() => { });
        console.log("[VoiceRuntime] Destroyed (HMR cleanup)");
    }
}

export const VoiceRuntime = new VoiceRuntimeService();

// Vite HMR: Clean up old instance before replacement
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        VoiceRuntime.destroy();
    });
}
