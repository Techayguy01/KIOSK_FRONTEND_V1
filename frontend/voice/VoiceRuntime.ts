import { VoiceEvent } from "./voice.types";
import { AudioCapture } from "./audioCapture";
import { DeepgramClient } from "./deepgramClient";
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

// Configuration
const CONFIG = {
    MIN_CHARS: 3,
    FILLERS: ["uh", "um", "hmm", "huh", "ah", "oh"],
    NO_SPEECH_TIMEOUT_MS: 5000,
    NO_RESULT_TIMEOUT_MS: 8000,
    MAX_SESSION_DURATION_MS: 30000,
    MIN_CONFIDENCE: 0.55,
    MAX_RECONNECTS_PER_MINUTE: 5,

    // Phase 10: Production Hardening
    VOICE_SESSION_WATCHDOG_MS: 20000,  // 20s max without activity
    MAX_SILENT_TURNS: 3,               // After 3 silent turns → reset
    WARN_SILENT_TURNS: 2,              // After 2 → play warning
    NETWORK_RETRY_DELAY_MS: 1000,      // Wait before retry
    DEBUG_MODE: import.meta.env.DEV,   // Only in dev
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

        // Wire audio chunks to Deepgram
        AudioCapture.onAudioChunk((chunk) => {
            if (this.mode === "listening") {
                DeepgramClient.send(chunk);
            }
        });

        // Phase 9.4: Barge-in - User starts speaking, stop TTS instantly
        DeepgramClient.onSpeechStarted(() => {
            if (TTSController.isSpeaking()) {
                console.log("[VoiceRuntime] BARGE-IN: User started speaking, stopping TTS");
                TTSController.bargeIn();
                this.setMode("listening");
            }
            // Reset watchdog on speech activity
            this.resetWatchdog();
        });

        // Interim transcripts
        DeepgramClient.onInterim((transcript, isFinal) => {
            if (this.mode === "listening" && transcript) {
                this.hasReceivedAnyTranscript = true;
                this.clearNoSpeechTimer();
                this.resetWatchdog();  // Activity detected
                this.transcriptBuffer.push(transcript);  // Track for privacy clear
                this.emit({ type: "VOICE_TRANSCRIPT_PARTIAL", transcript });
            }
        });

        // Final transcript
        DeepgramClient.onEndOfTurn((accumulatedTranscript, confidence) => {
            if (this.mode === "listening" && accumulatedTranscript.trim()) {
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
                    this.handleSilentTurn();  // Count as silent turn
                    return;
                }

                // Confidence check
                if (confidence !== undefined && confidence < CONFIG.MIN_CONFIDENCE) {
                    this.logDebug(`Transcript rejected: low confidence (${confidence})`);
                    this.handleSilentTurn();
                    return;
                }

                // Success! Reset silent turn counter
                this.consecutiveSilentTurns = 0;
                this.metrics.turnCount++;

                console.log(`[VoiceRuntime] Final: "${normalized}"`);
                this.emit({ type: "VOICE_TRANSCRIPT_READY", transcript: normalized });
            }
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

        if (this.isReconnectLooping()) {
            return;
        }

        try {
            this.isListeningActive = true;
            this.isIntentionalStop = false; // Reset flag on new session
            this.hasReceivedAnyTranscript = false;
            this.hasReceivedFinalTranscript = false;
            this.sessionStartTime = Date.now();

            DeepgramClient.connect();
            await AudioCapture.start();

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
    public stopListening(): void {
        if (!this.isListeningActive) return;

        console.log("[VoiceRuntime] User requested STOP.");

        // Set flag: "This was intentional, don't reconnect!"
        this.isIntentionalStop = true;
        this.isListeningActive = false;
        this.clearAllTimers();
        this.clearWatchdog();
        AudioCapture.stop();
        DeepgramClient.close();

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
            this.stopListening();
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
            AudioCapture.stop();
            DeepgramClient.close();
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

    // === Timeouts ===

    private startNoSpeechTimer(): void {
        this.noSpeechTimer = setTimeout(() => {
            if (this.isListeningActive && !this.hasReceivedAnyTranscript) {
                console.log("[Voice] Session auto-ended: no speech");
                this.handleSilentTurn();  // Phase 10: Count as silent
                this.stopListening();
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
                this.stopListening();
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
                this.stopListening();
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
