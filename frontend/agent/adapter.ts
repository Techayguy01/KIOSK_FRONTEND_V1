import { Intent } from "@contracts/intents";
import { UiState, VOICE_COMMAND_MAP, STATE_INPUT_MODES, STATE_SPEECH_MAP } from "./index";
import { VoiceRuntime } from "../voice/VoiceRuntime";
import { VoiceEvent } from "../voice/voice.types";
import { SpeechOutputController } from "../voice/SpeechOutputController";
import { TTSController } from "../voice/TTSController";
import { StateMachine } from "../state/uiState.machine";
import { UIState } from "@contracts/backend.contract";
import { buildTenantApiUrl, getTenantHeaders } from "../services/tenantContext";
import { getTenant } from "../services/tenantContext";

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
    BOOKING_COLLECT: true,
    BOOKING_SUMMARY: true,
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

type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'URGENT';

class AgentAdapterService {
    private state: UiState = "IDLE";
    private viewData: Record<string, any> = {};
    private listeners: ((state: UiState, data?: any) => void)[] = [];

    // Intent de-duplication guard (Phase 8.4)
    private lastIntent: string | null = null; // Phase 8.6: De-duplication
    private lastIntentTime: number = 0;
    private readonly DEDUP_WINDOW_MS = 800;

    // Phase 8.6: Rate limiting
    private intentTimestamps: number[] = [];
    private readonly RATE_LIMIT_COOLDOWN_MS = 2000;  // Max 1 intent per 2s
    private readonly RATE_LIMIT_BURST_MAX = 3;       // Max 3 intents per 10s
    private readonly RATE_LIMIT_BURST_WINDOW_MS = 10000;

    // Phase 13: Emotion Engine 🧠
    private frustrationScore = 0;
    private frustrationThreshold = 2; // Escalate after 2 bad turns

    // Phase 9.4: Confidence thresholds for LLM safety gating
    private readonly CONFIDENCE_THRESHOLD_HIGH = 0.85;
    private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
    private pendingCancelConfirmation = false;

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

    // 1. THE SENTIMENT ENGINE 🧠
    // Quick, local analysis to catch anger instantly
    private analyzeSentiment(text: string): Sentiment {
        const lower = text.toLowerCase();

        // A. Immediate Escalation Keywords
        const urgentWords = ['manager', 'human', 'supervisor', 'emergency', 'shutup', 'shut up'];
        if (urgentWords.some(w => lower.includes(w))) return 'URGENT';

        // B. Frustration Keywords
        const badWords = [
            'stupid', 'hate', 'broken', 'doesn\'t work', 'confused',
            'ridiculous', 'slow', 'shit', 'damn', 'useless', 'wrong'
        ];
        if (badWords.some(w => lower.includes(w))) return 'FRUSTRATED';

        // C. Positive/Neutral
        const goodWords = ['thanks', 'good', 'great', 'cool', 'perfect'];
        if (goodWords.some(w => lower.includes(w))) return 'POSITIVE';

        return 'NEUTRAL';
    }

    // 3. ESCALATION ROUTINE 🚨
    private async escalateToHuman(message: string) {
        console.warn("[Agent] 🚨 AUTO-ESCALATION TRIGGERED");

        // 1. Speak the reassurance (using this.speak for Captions)
        this.speak(message);

        // 2. Force the State Machine to Help
        // We use a small delay so the TTS can start
        setTimeout(() => {
            this.handleIntent('HELP_SELECTED');
            this.frustrationScore = 0; // Reset
        }, 3000);
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
                this.hasProcessedTranscript = false; // Reset flag
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
                this.hasProcessedTranscript = true;

                // Phase 8.6: Authority check before processing
                if (!this.hasVoiceAuthority()) {
                    this.emitTelemetry("VOICE_TRANSCRIPT_REJECTED", {
                        reason: "NO_AUTHORITY",
                        transcript: event.transcript
                    });
                    VoiceRuntime.setTurnState("IDLE");
                    return;
                }

                // Phase 12: Emit Final Transcript
                this.emitTranscript(event.transcript, true, 'user');

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

                // Phase 13: Emotional Intelligence Processing
                const emotion = this.analyzeSentiment(transcript);
                console.log(`[Agent] Sentiment: ${emotion} | Score: ${this.frustrationScore}`);

                // B. Handle Escalation
                if (emotion === 'URGENT') {
                    this.escalateToHuman("I am connecting you to a supervisor immediately.");
                    return;
                }

                if (emotion === 'FRUSTRATED') {
                    this.frustrationScore++;

                    // If they are repeatedly angry, give up and call help
                    if (this.frustrationScore >= this.frustrationThreshold) {
                        this.escalateToHuman("I sense you are having trouble. Let me get a human to help.");
                        return;
                    }

                    // Soft Apology for first offense
                    this.speak("I apologize. Let's try that again.");
                    // Continue to normal LLM processing...
                } else {
                    // Reset score on good interactions
                    if (emotion === 'POSITIVE') this.frustrationScore = 0;
                }

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

                // Silence Recovery
                if (!this.hasProcessedTranscript) {
                    console.log("[Agent] 🔇 Silence Detected. Attempting Re-engagement.");
                    this.handleSilence();
                }
                this.hasProcessedTranscript = false;
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
                // Phase 12: Emit Partial Transcript
                this.resetInactivityTimer();
                this.emitTranscript(event.transcript, false, 'user');
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

    // HELPER: Map LLM "fuzzy" intents to Strict Machine Events
    private mapIntentToEvent(llmIntent: string): string {
        const upper = (llmIntent || '').toUpperCase().trim();

        // Explicit LLM intent enum mapping (backend/contracts.ts)
        switch (upper) {
            case 'CHECK_IN':
                return 'CHECK_IN_SELECTED';
            case 'BOOK_ROOM':
                return 'BOOK_ROOM_SELECTED';
            case 'RECOMMEND_ROOM':
                // Move forward from ROOM_SELECT to booking flow.
                // Room data selection remains a separate concern.
                return 'ROOM_SELECTED';
            case 'HELP':
                return 'HELP_SELECTED';
            case 'SCAN_ID':
                return 'SCAN_COMPLETED';
            case 'PAYMENT':
                return 'CONFIRM_PAYMENT';
            case 'WELCOME':
                return 'CANCEL_REQUESTED';
            case 'IDLE':
                return 'RESET';
            case 'SELECT_ROOM':
                return this.state === 'ROOM_SELECT' ? 'ROOM_SELECTED' : 'SELECT_ROOM';
            case 'PROVIDE_GUESTS':
            case 'PROVIDE_DATES':
            case 'PROVIDE_NAME':
            case 'CONFIRM_BOOKING':
            case 'MODIFY_BOOKING':
            case 'CANCEL_BOOKING':
            case 'ASK_ROOM_DETAIL':
            case 'ASK_PRICE':
                return upper;
            case 'REPEAT':
            case 'GENERAL_QUERY':
            case 'UNKNOWN':
                return 'GENERAL_QUERY';
        }

        // Fuzzy fallback mapping
        if (upper.includes('CHECK_IN') || upper.includes('RESERVATION')) return 'CHECK_IN_SELECTED';
        if (upper.includes('BOOK') || upper.includes('NEW_RESERVATION')) return 'BOOK_ROOM_SELECTED';
        if (upper.includes('HELP') || upper.includes('SUPPORT')) return 'HELP_SELECTED';
        if (upper.includes('SCAN')) return 'SCAN_COMPLETED';
        if (upper.includes('PAYMENT') || upper.includes('PAY')) return 'CONFIRM_PAYMENT';
        if (upper.includes('WELCOME') || upper.includes('HOME') || upper.includes('START')) return 'CANCEL_REQUESTED';
        if (upper.includes('CANCEL')) return 'CANCEL_BOOKING';
        if (upper.includes('MODIFY') || upper.includes('CHANGE')) return 'MODIFY_BOOKING';
        if (upper.includes('DATE')) return 'PROVIDE_DATES';
        if (upper.includes('GUEST')) return 'PROVIDE_GUESTS';
        if (upper.includes('NAME')) return 'PROVIDE_NAME';

        return 'GENERAL_QUERY';
    }

    /**
     * Phase 9.4 + 9.5: Process transcript with LLM Brain
     * Calls /api/chat, maps intent, and mediates transitions.
     */
    public async processWithLLMBrain(transcript: string, sessionId?: string): Promise<void> {
        if (!transcript || transcript.trim().length < 2) return;

        try {
            if (this.pendingCancelConfirmation) {
                if (this.isAffirmative(transcript)) {
                    this.pendingCancelConfirmation = false;
                    this.speak("Okay, cancelling the booking and returning to the main screen.");
                    this.transitionTo("WELCOME", "CANCEL_REQUESTED", { transcript });
                    return;
                }
                if (this.isNegative(transcript)) {
                    this.pendingCancelConfirmation = false;
                    this.speak("Okay, continuing your booking.");
                    return;
                }
                this.speak("Please say yes to confirm cancellation, or no to continue.");
                return;
            }

            const bookingStates: UiState[] = ['ROOM_SELECT', 'BOOKING_COLLECT', 'BOOKING_SUMMARY'];
            const targetUrl = bookingStates.includes(this.state)
                ? buildTenantApiUrl("chat/booking")
                : buildTenantApiUrl("chat");

            // 1. Call LLM Brain with session ID for memory
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getTenantHeaders() },
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

            // 2. Map Fuzzy Intent -> Strict Event
            const rawIntent = decision.intent;
            let strictEvent = this.mapIntentToEvent(rawIntent);
            const inferredRoom = this.state === "ROOM_SELECT" ? this.inferRoomFromTranscript(transcript) : null;
            if (this.state === "ROOM_SELECT" && inferredRoom) {
                strictEvent = "ROOM_SELECTED";
            }
            if (strictEvent === "CANCEL_BOOKING" || strictEvent === "CANCEL_REQUESTED") {
                this.pendingCancelConfirmation = true;
                this.speak("Do you want to cancel this booking? Please say yes or no.");
                return;
            }
            if (this.state === "ROOM_SELECT" && strictEvent === "ROOM_SELECTED" && !inferredRoom) {
                // Prevent false-positive jumps when no actual room was identified.
                strictEvent = "GENERAL_QUERY";
            }

            console.log(`[Agent] Mapping Intent: ${rawIntent} -> ${strictEvent}`);

            // 3. Handle "Talking" (TTS)
            if (decision.speech) {
                this.speak(decision.speech);
            }

            // 4. Handle "Moving" (State Machine)
            // Use dispatch() instead of handleIntent() to avoid killing the TTS we just started.
            // dispatch() respects the State Machine and Voice Authority without hard-stopping audio.
            if (strictEvent !== 'GENERAL_QUERY') {
                // Convert string to Intent type if possible, or cast (User provided string return type)
                this.dispatch(strictEvent as Intent, {
                    transcript,
                    llmIntent: rawIntent,
                    room: inferredRoom,
                    slots: decision.accumulatedSlots || decision.extractedSlots,
                    missingSlots: decision.missingSlots,
                    nextSlotToAsk: decision.nextSlotToAsk,
                    isComplete: decision.isComplete
                });
            }

        } catch (error) {
            console.error("[AgentAdapter] LLM Error:", error);
            this.speak("Please use the touch screen.");
        }
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
     * Returns the current state synchronously.
     */
    public getState(): UiState {
        return this.state;
    }

    /**
     * Subscribe to state changes.
     * Returns an unsubscribe function.
     */
    public subscribe(listener: (state: UiState, data?: any) => void): () => void {
        this.listeners.push(listener);

        // Emit current state immediately to new subscriber
        const metadata = StateMachine.getMetadata(this.state as UIState);
        const fullData = {
            ...this.viewData,
            metadata: {
                ...metadata,
                listening: this.hasVoiceAuthority() // Approximate check
            }
        };
        listener(this.state, fullData);

        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private getProgress(state: UiState) {
        const steps = ['ID Scan', 'Room', 'Payment', 'Key'];
        switch (state) {
            case 'SCAN_ID': return { currentStep: 1, totalSteps: 4, steps };
            case 'ROOM_SELECT': return { currentStep: 2, totalSteps: 4, steps };
            case 'PAYMENT': return { currentStep: 3, totalSteps: 4, steps };
            case 'COMPLETE': return { currentStep: 4, totalSteps: 4, steps };
            default: return this.viewData.progress ?? null;
        }
    }

    private applyPayloadData(intent: string, payload?: any, nextState?: UiState): void {
        const merged: Record<string, any> = { ...this.viewData };

        if (payload?.room) {
            merged.selectedRoom = payload.room;
        }

        if (Array.isArray(payload?.rooms)) {
            merged.rooms = payload.rooms;
        }

        if (payload?.slots) {
            merged.bookingSlots = { ...(merged.bookingSlots || {}), ...payload.slots };
        }

        if (payload?.missingSlots) {
            merged.missingSlots = payload.missingSlots;
        }

        if (payload?.nextSlotToAsk !== undefined) {
            merged.nextSlotToAsk = payload.nextSlotToAsk;
        }

        if (intent === 'ROOM_SELECTED' && !merged.selectedRoom && Array.isArray(merged.rooms)) {
            const text = String(payload?.transcript || '').toLowerCase();
            merged.selectedRoom = merged.rooms.find((r: any) => String(r.name || '').toLowerCase().includes(text))
                || merged.rooms.find((r: any) => text.includes('deluxe') && String(r.name || '').toLowerCase().includes('deluxe'))
                || null;
        }

        const progressState = nextState || this.state;
        merged.progress = this.getProgress(progressState);
        this.viewData = merged;
    }

    private resetInactivityTimer(): void {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }

        if (this.state === "IDLE") return;

        this.inactivityTimer = setTimeout(() => {
            console.warn("[AgentAdapter] Inactivity timeout reached. Returning to IDLE.");
            this.hardStopAll();
            this.state = "IDLE";
            this.notifyListeners();
        }, this.INACTIVITY_TIMEOUT_MS);
    }

    private inferRoomFromTranscript(transcript: string): any | null {
        const t = (transcript || "").toLowerCase();
        if (!t) return null;

        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) return null;
        const byName = rooms.find((r: any) => t.includes(String(r.name).toLowerCase()));
        if (byName) return byName;

        if (t.includes("deluxe") || t.includes("ocean")) {
            return rooms.find((r: any) => String(r.name).toLowerCase().includes("deluxe")) || null;
        }
        if (t.includes("executive") || t.includes("suite")) {
            return rooms.find((r: any) => String(r.name).toLowerCase().includes("executive")) || null;
        }
        if (t.includes("standard") || t.includes("queen")) {
            return rooms.find((r: any) => String(r.name).toLowerCase().includes("standard")) || null;
        }

        return null;
    }

    private isAffirmative(text: string): boolean {
        const t = (text || "").toLowerCase();
        return /\b(yes|yeah|yep|confirm|sure|ok|okay|proceed|cancel it|do it)\b/.test(t);
    }

    private isNegative(text: string): boolean {
        const t = (text || "").toLowerCase();
        return /\b(no|nope|dont|don't|not now|continue|resume|go on)\b/.test(t);
    }

    private resolveNextStateFromIntent(currentState: UiState, intent: string): UiState {
        // ROOM_SELECT must not auto-advance on generic queries/amenity questions.
        if (currentState === "ROOM_SELECT") {
            if (intent === "ASK_ROOM_DETAIL" || intent === "ASK_PRICE" || intent === "GENERAL_QUERY" || intent === "HELP_SELECTED") {
                return "ROOM_SELECT";
            }
            if (intent === "PROVIDE_GUESTS" || intent === "PROVIDE_DATES" || intent === "PROVIDE_NAME" || intent === "CONFIRM_BOOKING" || intent === "MODIFY_BOOKING") {
                return "ROOM_SELECT";
            }
        }

        // If booking-style intents arrive while still on ROOM_SELECT, bootstrap into BOOKING_COLLECT.
        const bookingIntents = new Set([
            "PROVIDE_GUESTS",
            "PROVIDE_DATES",
            "PROVIDE_NAME",
            "CONFIRM_BOOKING",
            "MODIFY_BOOKING",
            "CANCEL_BOOKING",
            "ASK_ROOM_DETAIL",
            "ASK_PRICE",
            "GENERAL_QUERY",
            "HELP_SELECTED",
        ]);

        if (currentState === "ROOM_SELECT" && bookingIntents.has(intent)) {
            // Strict page-by-page progression: booking-related intent from ROOM_SELECT
            // enters BOOKING_COLLECT first. No direct jump.
            return "ROOM_SELECT";
        }

        if (intent === 'BACK_REQUESTED' || intent === 'CANCEL_REQUESTED') {
            return StateMachine.getPreviousState(currentState as UIState) as UiState;
        }

        if (intent === 'RESET') {
            return 'IDLE';
        }

        return StateMachine.transition(currentState as UIState, intent as any) as UiState;
    }

    /**
     * Phase 11.5: Touch Authority Override
     * Handle inputs from UI Buttons (Touch) or Internal Events.
     * This acts as a "Super Dispatch" that ensures Touch interrupts Voice.
     */
    public handleIntent(intent: string, payload?: any) {
        console.log(`[AgentAdapter] 👆 Handle Intent (Touch Authority): ${intent}`, payload || '');
        this.resetInactivityTimer();

        // 1. TOUCH AUTHORITY CHECK 🛡️
        const INTERRUPT_INTENTS = [
            "CHECK_IN_SELECTED", "BOOK_ROOM_SELECTED",
            "HELP_SELECTED", "SCAN_COMPLETED",
            "ROOM_SELECTED", "CONFIRM_PAYMENT",
            "BACK_REQUESTED", "RESET", "TOUCH_SELECTED",
            "CANCEL_REQUESTED", "PROXIMITY_DETECTED",
            "SCAN_ID_SELECTED", "PAYMENT_SELECTED"
        ];

        if (INTERRUPT_INTENTS.includes(intent)) {
            console.log("[AgentAdapter] 👆 Touch Interrupt detected. Killing Audio.");
            TTSController.hardStop();
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

        // 2. CALCULATE TRANSITION (Centralized State Machine)
        const nextState = this.resolveNextStateFromIntent(this.state, intent);

        // 3. EXECUTE
        if (nextState !== this.state) {
            this.transitionTo(nextState, intent, payload);
        } else {
            this.applyPayloadData(intent, payload, nextState);
            this.notifyListeners();
            console.log(`[AgentAdapter] No Transition: ${this.state} + ${intent} -> ${nextState}`);
        }
    }

    // === Phase 11.8: Enterprise Hardening ===
    private hasProcessedTranscript = false;

    private handleSilence() {
        // Don't nag if we are Idle or in Manual Mode
        if (this.state === 'IDLE' || this.state === 'MANUAL_MENU') return;

        // Gentle Nudge
        const nudges = [
            "I'm still listening.",
            "Did you need more time?",
            "You can say 'Check In' or 'Help'."
        ];
        const randomNudge = nudges[Math.floor(Math.random() * nudges.length)];

        // Speak, but don't force listening immediately to avoid loops
        TTSController.speak(randomNudge);
    }

    /**
     * Internal transition helper to handle side-effects
     */
    private transitionTo(nextState: UiState, intent?: string, payload?: any) {
        console.log(`[Mediator] Requesting: ${this.state} -> ${nextState}`);

        // ENTERPRISE RULE #1: Recursive Transitions are Valid
        // If the AI wants to stay on the same page to chat, LET IT.
        if (nextState === this.state) {
            console.log(`[Mediator] 🗣️ Conversational Turn (Staying on ${this.state})`);
            // We don't update this.state, but we ALLOW the flow to continue 
            // so the TTS can play the AI's response.

            // Speak Agent response even if state didn't change (if mapped, or if LLM provided speech)
            // Note: LLM speech is handled in processWithLLMBrain usually before calling dispatch/transition?
            // Actually, transitionTo is called when DISPATCH happens.
            // If LLM says "GENERAL_QUERY", we map to "GENERAL_QUERY" intent.
            // StateMachine says "WELCOME" -> "WELCOME".
            // So we end up here.
            // We should ensure any speech associated with the intent (if defined in STATE_SPEECH_MAP) is spoken,
            // OR rely on the LLM's direct speech which was called in processWithLLMBrain.
            // But processWithLLMBrain only speaks if intent is IDLE or UNKNOWN?
            // Wait, processWithLLMBrain says: "if (decision.speech) this.speak(decision.speech);"
            // THEN "this.dispatch(fsmIntent)".
            // So speech is ALREADY handled by the time we get here.
            // So we just return.
            return;
        }

        const previousState = this.state;
        this.state = nextState;
        this.applyPayloadData(intent || 'UNKNOWN', payload, nextState);
        this.resetInactivityTimer();

        console.log(`[AgentAdapter] State Transition: ${previousState} -> ${this.state}`);

        // Phase 9.4.1: On state change, stop any active TTS and listening
        VoiceRuntime.stopSpeaking();
        VoiceRuntime.stopListening();

        // Notify Listeners
        this.notifyListeners();

        // Speak Agent response (lookup from legacy map)
        const speech = STATE_SPEECH_MAP[nextState];
        if (speech) {
            const resolvedSpeech = this.withTenantName(speech);
            console.log(`[AgentAdapter] Speaking: "${resolvedSpeech}"`);
            this.speak(resolvedSpeech);
        } else {
            // If no speech, check if we should listen
            // Start listening if applicable
            if (this.hasVoiceAuthority()) {
                setTimeout(() => {
                    if (this.hasVoiceAuthority()) {
                        VoiceRuntime.startListening();
                    }
                }, 100);
            }
        }
    }

    /**
     * Dispatch an Intent to the Agent Brain (Legacy / Voice Path).
     * Now routes through handleIntent logic logic but without Touch Authority Kill?
     * Actually, Voice dispatch should probably NOT use handleIntent because handleIntent kills voice.
     */
    public dispatch(intent: Intent, payload?: any) {
        this.resetInactivityTimer();
        // Voice dispatch uses StateMachine too.
        // We can reuse the calculation logic from handleIntent, but skip the "Kill Audio" part.

        // 2. CALCULATE TRANSITION (Centralized State Machine)
        const nextState = this.resolveNextStateFromIntent(this.state, intent);

        if (nextState !== this.state) {
            // We can check if we should speak here.
            // But for now, just transition.
            this.transitionTo(nextState, intent, payload);
        } else {
            this.applyPayloadData(intent, payload, nextState);
            this.notifyListeners();
        }
    }

    // === Phase 12: Real-Time Captions ===
    private transcriptListeners: ((text: string, isFinal: boolean, source: 'user' | 'ai') => void)[] = [];

    public onTranscript(listener: (text: string, isFinal: boolean, source: 'user' | 'ai') => void): () => void {
        this.transcriptListeners.push(listener);
        return () => {
            this.transcriptListeners = this.transcriptListeners.filter(l => l !== listener);
        };
    }

    private emitTranscript(text: string, isFinal: boolean, source: 'user' | 'ai') {
        this.transcriptListeners.forEach(l => l(text, isFinal, source));
    }

    /**
     * Phase 9.4: Speak text from Agent via VoiceRuntime.
     * Wrapped to emit 'ai' transcript events.
     */
    public speak(text: string): void {
        this.emitTranscript(text, true, 'ai');
        VoiceRuntime.speak(text);
    }

    private withTenantName(text: string): string {
        const tenantName = getTenant()?.name || "our hotel";
        return text.replace(/\{\{TENANT_NAME\}\}/g, tenantName);
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
        const metadata = StateMachine.getMetadata(this.state as UIState);
        const fullData = {
            ...this.viewData,
            metadata: {
                ...metadata,
                listening: this.hasVoiceAuthority()
            }
        };
        this.listeners.forEach(listener => listener(this.state, fullData));
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
