import { Intent } from "../contracts/intents";
import { processIntent, UiState, VOICE_COMMAND_MAP, STATE_INPUT_MODES } from "./index";
import { VoiceRuntime } from "../voice/VoiceRuntime";
import { VoiceEvent } from "../voice/voice.types";
import { SpeechOutputController } from "../voice/SpeechOutputController";
import { TTSController } from "../voice/TTSController";

/**
 * AgentAdapter (Singleton) - Phase 9.4: TTS UX, Barge-In & Audio Authority
 * 
 * The SOLE bridge between the Frontend (React) and the Agent Brain (processIntent).
 * - Maintains the current authoritative state.
 * - Dispatches intents to the pure Agent function.
 * - Notifies subscribers (UI) of state changes.
 * - Acts as a CONTROLLER/ROUTER for Voice Events.
 * - Manages voice turn state transitions.
 * - De-duplicates intents to prevent double-firing.
 * - Rate limiting to prevent abuse (Phase 8.6)
 * - Instant barge-in on user speech (Phase 9.4)
 * - TTS speech output with audio authority (Phase 9.4)
 */

// Phase 8.6: Explicit Voice Authority Matrix
// Voice commands are ONLY processed if this returns true
const VOICE_AUTHORITY_MATRIX: Record<UiState, boolean> = {
    IDLE: false,
    WELCOME: true,
    AI_CHAT: true,
    MANUAL_MENU: true,
    SCAN_ID: false,     // Security - no voice during ID scan
    ROOM_SELECT: true,
    PAYMENT: false,     // Security - no voice during payment
    KEY_DISPENSING: false,
    COMPLETE: false,
    ERROR: false,       // No voice during error states
};

// Phase 8.6: Telemetry Event Types
type VoiceTelemetryEvent =
    | "VOICE_SESSION_STARTED"
    | "VOICE_TRANSCRIPT_ACCEPTED"
    | "VOICE_TRANSCRIPT_REJECTED"
    | "VOICE_COMMAND_DISPATCHED"
    | "VOICE_COMMAND_BLOCKED"
    | "VOICE_RATE_LIMITED"
    | "VOICE_SESSION_ERROR";

class AgentAdapterService {
    private state: UiState = "IDLE";
    private listeners: ((state: UiState) => void)[] = [];

    // Intent de-duplication guard (Phase 8.4)
    private lastIntent: Intent | null = null;
    private lastIntentTime: number = 0;
    private readonly DEDUP_WINDOW_MS = 800;

    // Phase 8.6: Rate limiting
    private intentTimestamps: number[] = [];
    private readonly RATE_LIMIT_COOLDOWN_MS = 2000;  // Max 1 intent per 2s
    private readonly RATE_LIMIT_BURST_MAX = 3;       // Max 3 intents per 10s
    private readonly RATE_LIMIT_BURST_WINDOW_MS = 10000;

    // Phase 9.4: Confidence thresholds for LLM safety gating
    private readonly CONFIDENCE_THRESHOLD_HIGH = 0.85;
    private readonly LLM_API_URL = 'http://localhost:3002/api/chat';

    constructor() {
        console.log("[AgentAdapter] Initialized (Phase 9.4 - LLM Confidence Gating)");

        // Subscribe to Voice Runtime (Input Source)
        VoiceRuntime.subscribe(this.handleVoiceEvent.bind(this));

        // Phase 9.4.1: Subscribe to TTS events for polite turn-taking
        TTSController.subscribe((event) => {
            if (event.type === "TTS_ENDED") {
                this.handleTTSEnded();
            }
        });
    }

    /**
     * Phase 9.4.1: Polite Turn-Taking
     * After TTS finishes, start listening if state allows voice.
     */
    private handleTTSEnded(): void {
        // Check if current state allows voice input
        const allowsVoice = this.hasVoiceAuthority();

        if (allowsVoice) {
            console.log("[AgentAdapter] TTS ended, starting listening after 200ms");
            // Wait 200ms to clear audio buffers, then start listening
            setTimeout(() => {
                // Double-check we're still in a voice-enabled state
                if (this.hasVoiceAuthority()) {
                    VoiceRuntime.startListening();
                }
            }, 200);
        } else {
            console.log("[AgentAdapter] TTS ended, but state doesn't allow voice");
        }
    }

    // === Phase 8.6: Structured Telemetry ===

    private emitTelemetry(
        event: VoiceTelemetryEvent,
        data: Record<string, unknown> = {}
    ): void {
        const payload = {
            event,
            state: this.state,
            timestamp: Date.now(),
            ...data
        };

        // Console log (dev)
        console.info(`[VOICE_TELEMETRY] ${event}`, payload);

        // Future: Forward to backend logging service
        // await VoiceAnalyticsService.log(payload);
    }

    // === Phase 8.6: Rate Limiting ===

    private isRateLimited(): boolean {
        const now = Date.now();

        // Clean old timestamps
        this.intentTimestamps = this.intentTimestamps.filter(
            ts => now - ts < this.RATE_LIMIT_BURST_WINDOW_MS
        );

        // Check cooldown (1 per 2s)
        const lastTimestamp = this.intentTimestamps[this.intentTimestamps.length - 1];
        if (lastTimestamp && now - lastTimestamp < this.RATE_LIMIT_COOLDOWN_MS) {
            this.emitTelemetry("VOICE_RATE_LIMITED", {
                reason: "COOLDOWN",
                timeSinceLastMs: now - lastTimestamp
            });
            return true;
        }

        // Check burst limit (3 per 10s)
        if (this.intentTimestamps.length >= this.RATE_LIMIT_BURST_MAX) {
            this.emitTelemetry("VOICE_RATE_LIMITED", {
                reason: "BURST_LIMIT",
                intentsInWindow: this.intentTimestamps.length
            });
            return true;
        }

        return false;
    }

    private recordIntent(): void {
        this.intentTimestamps.push(Date.now());
    }

    // === Voice Authority Check ===

    private hasVoiceAuthority(): boolean {
        return VOICE_AUTHORITY_MATRIX[this.state] ?? false;
    }

    /**
     * Handle incoming Voice Events (Router Logic)
     * strictly maps Input -> Intent based on Agent Rules.
     * Does NOT interpret language or decide navigation.
     */
    private handleVoiceEvent(event: VoiceEvent) {
        console.log(`[AgentAdapter] Received Voice Event: ${event.type}`);

        switch (event.type) {
            case "VOICE_SESSION_STARTED":
                // Phase 8.6: Check voice authority matrix
                if (!this.hasVoiceAuthority()) {
                    this.emitTelemetry("VOICE_COMMAND_BLOCKED", {
                        reason: "NO_AUTHORITY",
                        state: this.state
                    });
                    VoiceRuntime.cancelSession();
                    return;
                }

                // Check if Voice is allowed in current state (legacy check)
                if (this.isVoiceAllowed()) {
                    this.emitTelemetry("VOICE_SESSION_STARTED");
                    this.dispatch("VOICE_STARTED");
                } else {
                    this.emitTelemetry("VOICE_COMMAND_BLOCKED", {
                        reason: "STATE_INPUT_MODE",
                        state: this.state
                    });
                    VoiceRuntime.cancelSession();
                }
                break;

            case "VOICE_TRANSCRIPT_READY":
                // Phase 8.6: Authority check before processing
                if (!this.hasVoiceAuthority()) {
                    this.emitTelemetry("VOICE_TRANSCRIPT_REJECTED", {
                        reason: "NO_AUTHORITY",
                        transcript: event.transcript
                    });
                    VoiceRuntime.setTurnState("IDLE");
                    return;
                }

                // Phase 8.6: Rate limiting check
                if (this.isRateLimited()) {
                    this.emitTelemetry("VOICE_TRANSCRIPT_REJECTED", {
                        reason: "RATE_LIMITED",
                        transcript: event.transcript
                    });
                    VoiceRuntime.setTurnState("USER_SPEAKING");
                    return;
                }

                const transcript = event.transcript.toLowerCase().trim();

                // Phase 9.7: Use LLM Brain instead of Regex
                console.log(`[AgentAdapter] Handing off to Brain: "${transcript}"`);

                // Transition: PROCESSING -> SYSTEM_RESPONDING
                VoiceRuntime.setTurnState("SYSTEM_RESPONDING");

                // Call the Brain (Async)
                this.processWithLLMBrain(transcript).then(() => {
                    // After brain finishes, return to IDLE
                    setTimeout(() => {
                        VoiceRuntime.setTurnState("IDLE");
                    }, 500);
                }).catch(err => {
                    console.error("[AgentAdapter] Brain failed:", err);
                    VoiceRuntime.setTurnState("IDLE");
                });

                break;

            case "VOICE_SESSION_ENDED":
                console.log("[AgentAdapter] Voice Session Ended.");
                VoiceRuntime.setTurnState("IDLE");
                break;

            // Phase 10: Production Hardening - Recovery Events
            case "VOICE_SESSION_ABORTED":
                console.log("[AgentAdapter] Voice Session ABORTED (watchdog/silence)");
                VoiceRuntime.setTurnState("IDLE");
                VoiceRuntime.clearSessionData();  // Privacy
                // Transition to WELCOME for recovery
                if (this.state !== "WELCOME" && this.state !== "ERROR") {
                    this.dispatch("CANCEL_REQUESTED");
                }
                break;

            case "VOICE_SESSION_ERROR":
                console.warn("[AgentAdapter] Voice Session ERROR");
                VoiceRuntime.setTurnState("IDLE");
                // Don't block navigation - just log and continue
                // UI can show text fallback if needed
                break;

            case "VOICE_TRANSCRIPT_PARTIAL":
                // Just for live display, no action needed
                break;
        }
    }

    /**
     * Intent de-duplication check.
     * Prevents double-firing from interim/final overlap.
     */
    private isDuplicateIntent(intent: Intent): boolean {
        const now = Date.now();

        if (this.lastIntent === intent && (now - this.lastIntentTime) < this.DEDUP_WINDOW_MS) {
            return true;
        }

        // Record this intent
        this.lastIntent = intent;
        this.lastIntentTime = now;
        return false;
    }

    private isVoiceAllowed(): boolean {
        const allowedModes = STATE_INPUT_MODES[this.state] || [];
        return allowedModes.includes("VOICE");
    }

    private mapTranscriptToIntent(transcript: string): Intent | null {
        const stateCommands = VOICE_COMMAND_MAP[this.state];
        if (!stateCommands) return null;

        return stateCommands[transcript] || null;
    }

    /**
     * Phase 9.4 + 9.5: Process transcript with LLM Brain
     * Calls /api/chat, applies confidence gating, and mediates transitions.
     */
    public async processWithLLMBrain(transcript: string, sessionId?: string): Promise<void> {
        if (!transcript || transcript.trim().length < 2) return;

        try {
            // 1. Call LLM Brain with session ID for memory
            const response = await fetch(this.LLM_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript,
                    currentState: this.state,
                    sessionId: sessionId || this.getSessionId()
                })
            });

            if (!response.ok) {
                throw new Error(`LLM API error: ${response.status}`);
            }

            const decision = await response.json();
            console.log(`[AgentAdapter] LLM Decision:`, decision);

            // 2. Skip non-actionable intents
            if (decision.intent === "IDLE" || decision.intent === "UNKNOWN") {
                if (decision.speech) this.speak(decision.speech);
                return;
            }

            // 3. MEDIATION LAYER (The Bouncer) 🛡️
            const isLegal = this.validateProposal(decision.intent);

            if (!isLegal) {
                // ILLEGAL MOVE -> Block & Redirect
                console.warn(`[Mediator] Blocked illegal move: ${this.state} -> ${decision.intent}`);
                this.speak("I can't do that right now. Please follow the screen options.");
                return;
            }

            // 4. CONFIDENCE GATE 🛡️
            if (decision.confidence >= this.CONFIDENCE_THRESHOLD_HIGH) {
                // High Confidence -> Execute
                console.log(`[AgentAdapter] Confidence HIGH (${decision.confidence}). Executing.`);

                if (decision.speech) this.speak(decision.speech);

                const fsmIntent = this.mapLLMIntentToFSM(decision.intent);
                if (fsmIntent) {
                    this.dispatch(fsmIntent, { transcript, llmIntent: decision.intent });
                }
            } else {
                // Low Confidence -> Clarify but don't transition
                console.warn(`[AgentAdapter] Confidence LOW (${decision.confidence}). Asking for confirmation.`);

                const clarification = `Just to confirm, did you want to ${decision.intent.toLowerCase().replace('_', ' ')}?`;
                this.speak(decision.speech || clarification);
            }

        } catch (error) {
            console.error("[AgentAdapter] LLM Error:", error);
            this.speak("Please use the touch screen.");
        }
    }

    // Phase 9.8: Helper for FSM Valid Transitions
    private getValidTransitionsForState(state: UiState): string[] {
        const validTransitions: Record<UiState, string[]> = {
            IDLE: ["WELCOME"],
            WELCOME: ["CHECK_IN", "HELP", "SCAN_ID"],
            AI_CHAT: ["CHECK_IN", "HELP", "WELCOME", "SCAN_ID", "PAYMENT"],
            MANUAL_MENU: ["CHECK_IN", "HELP", "WELCOME"],
            SCAN_ID: ["HELP"],
            ROOM_SELECT: ["PAYMENT", "HELP"],
            PAYMENT: ["HELP"],
            KEY_DISPENSING: [],
            COMPLETE: ["WELCOME"],
            ERROR: ["WELCOME", "HELP"],
        };
        return validTransitions[state] || [];
    }

    /**
     * Phase 9.5: The Bouncer 🛡️
     * Checks if the LLM's proposed intent is legal in the current state.
     */
    private validateProposal(proposedIntent: string): boolean {
        // Always allow meta-intents
        if (proposedIntent === "IDLE" || proposedIntent === "UNKNOWN" || proposedIntent === "REPEAT" || proposedIntent === "HELP") {
            return true;
        }

        // Use the centralized transition map
        const allowed = this.getValidTransitionsForState(this.state);
        return allowed.includes(proposedIntent);
    }

    /**
     * Get or generate session ID for memory.
     */
    private sessionId: string | null = null;

    private getSessionId(): string {
        if (!this.sessionId) {
            this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        return this.sessionId;
    }

    /**
     * Clear session for privacy (called on WELCOME transition).
     */
    public clearSession(): void {
        this.sessionId = null;
        console.log("[AgentAdapter] Session cleared for privacy");
    }

    /**
     * Map LLM intent strings to FSM Intent type.
     * Returns null if not mappable.
     */
    private mapLLMIntentToFSM(llmIntent: string): Intent | null {
        const intentMap: Record<string, Intent> = {
            "CHECK_IN": "CHECK_IN_SELECTED",
            "SCAN_ID": "TOUCH_SELECTED",
            "PAYMENT": "TOUCH_SELECTED",
            "HELP": "BACK_REQUESTED",
            "WELCOME": "PROXIMITY_DETECTED",
            "REPEAT": "VOICE_STARTED",
        };
        return intentMap[llmIntent] || null;
    }

    /**
     * Returns the current state synchronously.
     */
    public getState(): UiState {
        return this.state;
    }

    /**
     * Subscribe to state changes.
     * Returns an unsubscribe function.
     */
    public subscribe(listener: (state: UiState) => void): () => void {
        this.listeners.push(listener);
        // Emit current state immediately to new subscriber
        listener(this.state);

        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Phase 11.5: Touch Authority Override
     * Handle inputs from UI Buttons (Touch) or Internal Events.
     * This acts as a "Super Dispatch" that ensures Touch interrupts Voice.
     */
    public handleIntent(intent: string, payload?: any) {
        console.log(`[AgentAdapter] 👆 Handle Intent (Touch Authority): ${intent}`, payload || '');

        // 1. TOUCH AUTHORITY CHECK 🛡️
        // If this is a Navigation Intent, we must kill Voice/TTS immediately.
        const NAVIGATION_INTENTS = [
            "CHECK_IN_SELECTED",
            "BOOK_ROOM_SELECTED",
            "TOUCH_SELECTED",
            "BACK_REQUESTED",
            "HELP_SELECTED",
            "PROXIMITY_DETECTED",
            "SCAN_ID_SELECTED",
            "SCAN_COMPLETED",
            "ROOM_SELECTED",
            "PAYMENT_SELECTED",
            "CONFIRM_PAYMENT",
            "RESET"
        ];

        // Check if it's a Nav intent OR if it's in our valid transitions list
        const isNavigation = NAVIGATION_INTENTS.includes(intent);

        if (isNavigation) {
            console.log("[AgentAdapter] 👆 Touch Interrupt detected. Killing Audio.");

            // A. Kill the Mouth
            TTSController.hardStop();

            // B. Kill the Ears
            VoiceRuntime.stopListening();

            // C. Special Handling for Generic Touch
            if (intent === "TOUCH_SELECTED") {
                // If they touched while we were "Listening" (AI_CHAT), just stop listening but stay.
                if (this.state === "AI_CHAT") {
                    console.log("[AgentAdapter] User touched screen to stop listening.");
                    return;
                }
            }
        }

        // 2. Dispatch to FSM
        this.dispatch(intent as Intent, payload);
    }

    /**
     * Dispatch an Intent to the Agent Brain.
     * This is the ONLY way to change state.
     * Phase 9.4.1: Polite Turn-Taking - mic opens AFTER TTS ends, not immediately.
     */
    public dispatch(intent: Intent, payload?: any) {
        console.log(`[AgentAdapter] Dispatching Intent: ${intent}`, payload ? payload : "");

        // 1. Ask Brain for next state
        const response = processIntent(intent, this.state, (msg) => console.log(msg));

        // 2. Check if state actually changed
        if (response.ui_state !== this.state) {
            const previousState = this.state;
            this.state = response.ui_state;

            console.log(`[AgentAdapter] State Transition: ${previousState} -> ${this.state}`);

            // Phase 9.4.1: On state change, stop any active TTS and listening
            // This prevents the race condition
            VoiceRuntime.stopSpeaking();
            VoiceRuntime.stopListening();

            // 3. Notify Listeners (UI updates)
            this.notifyListeners();

            // 4. Phase 9.4.1: Speak Agent response
            // Mic will auto-start via handleTTSEnded() when speech finishes
            if (response.speech) {
                console.log(`[AgentAdapter] Speaking: "${response.speech.substring(0, 50)}..."`); VoiceRuntime.speak(response.speech);
            } else {
                // No speech for this state - start listening immediately if allowed
                if (this.hasVoiceAuthority()) {
                    setTimeout(() => {
                        if (this.hasVoiceAuthority()) {
                            VoiceRuntime.startListening();
                        }
                    }, 100);
                }
            }
        } else {
            console.log(`[AgentAdapter] No Transition (Stuck): ${this.state}`);
        }
    }

    /**
     * Phase 9.4: Speak text from Agent via VoiceRuntime.
     */
    public speak(text: string): void {
        VoiceRuntime.speak(text);
    }

    /**
     * Phase 9.4: Stop any active speech.
     */
    public stopSpeech(): void {
        VoiceRuntime.stopSpeaking();
    }

    /**
     * Phase 9.4: Hard stop ALL audio (STT + TTS).
     * Called on: ERROR, CANCEL, route change, app unmount.
     */
    public hardStopAll(): void {
        VoiceRuntime.hardStopAll();
    }

    /**
     * Phase 9.4: Check if currently speaking.
     */
    public isSpeaking(): boolean {
        return VoiceRuntime.getMode() === 'speaking';
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener(this.state));
    }

    // debug / testing utility to force reset if needed
    public _reset() {
        this.state = "IDLE";
        this.lastIntent = null;
        this.lastIntentTime = 0;
        this.intentTimestamps = [];
        this.notifyListeners();
    }
}

export const AgentAdapter = new AgentAdapterService();
