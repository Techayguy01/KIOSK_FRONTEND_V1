import { Intent } from "@contracts/intents";
import { UiState, VOICE_COMMAND_MAP, STATE_INPUT_MODES, STATE_SPEECH_MAP } from "./index";
import { VoiceRuntime } from "../voice/VoiceRuntime";
import { VoiceEvent } from "../voice/voice.types";
import { SpeechOutputController } from "../voice/SpeechOutputController";
import { TTSController } from "../voice/TTSController";
import { StateMachine } from "../state/uiState.machine";
import { UIState } from "@contracts/backend.contract";
import { buildTenantApiUrl, getTenantHeaders, getTenant, getTenantSlug } from "../services/tenantContext";

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
    PAYMENT: true,
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

export type BookingSlotKey =
    | "roomType"
    | "adults"
    | "children"
    | "checkInDate"
    | "checkOutDate"
    | "guestName";

export type BookingSlotExpectedType = "number" | "date" | "string";

export interface SlotContext {
    activeSlot: BookingSlotKey | null;
    expectedType: BookingSlotExpectedType | null;
    promptAsked: string;
}

const SLOT_EXPECTED_TYPE_MAP: Record<BookingSlotKey, BookingSlotExpectedType> = {
    roomType: "string",
    adults: "number",
    children: "number",
    checkInDate: "date",
    checkOutDate: "date",
    guestName: "string",
};

const SLOT_TO_INTENT_MAP: Record<BookingSlotKey, string> = {
    roomType: "SELECT_ROOM",
    adults: "PROVIDE_GUESTS",
    children: "PROVIDE_GUESTS",
    checkInDate: "PROVIDE_DATES",
    checkOutDate: "PROVIDE_DATES",
    guestName: "PROVIDE_NAME",
};

const SLOT_PROMPT_LOOKUP: Array<{
    slot: BookingSlotKey;
    expectedType: BookingSlotExpectedType;
    prompts: string[];
}> = [
    {
        slot: "roomType",
        expectedType: "string",
        prompts: [
            "which room would you like to book",
            "please tell me which room you would like to book",
            "would you like to book it"
        ],
    },
    {
        slot: "adults",
        expectedType: "number",
        prompts: ["how many adults will be staying"],
    },
    {
        slot: "children",
        expectedType: "number",
        prompts: ["how many children will be staying"],
    },
    {
        slot: "checkInDate",
        expectedType: "date",
        prompts: [
            "please tell me your check in and check out dates",
            "what is your check in date"
        ],
    },
    {
        slot: "checkOutDate",
        expectedType: "date",
        prompts: ["what is your check out date"],
    },
    {
        slot: "guestName",
        expectedType: "string",
        prompts: [
            "what name should i use for this booking",
            "what name should i use for the booking"
        ],
    },
];

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
    private readonly RATE_LIMIT_COOLDOWN_MS = 600;   // Keep abuse protection, allow natural dialog pace
    private readonly RATE_LIMIT_BURST_MAX = 6;       // Allow short back-and-forth without blocking
    private readonly RATE_LIMIT_BURST_WINDOW_MS = 12000;

    // Phase 13: Emotion Engine ðŸ§ 
    private frustrationScore = 0;
    private frustrationThreshold = 2; // Escalate after 2 bad turns

    // Phase 9.4: Confidence thresholds for LLM safety gating
    private readonly CONFIDENCE_THRESHOLD_HIGH = 0.85;
    private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
    private pendingCancelConfirmation = false;
    private hasAnnouncedRoomOptions = false;
    private suppressFinalTranscriptUntil = 0;
    private lastRealtimeIntent: Intent | null = null;
    private lastRealtimeIntentAt = 0;
    private readonly REALTIME_INTENT_DEDUP_MS = 1500;
    private slotContext: SlotContext = {
        activeSlot: null,
        expectedType: null,
        promptAsked: "",
    };

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

    // 1. THE SENTIMENT ENGINE ðŸ§ 
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

    // 3. ESCALATION ROUTINE ðŸš¨
    private async escalateToHuman(message: string) {
        console.warn("[Agent] ðŸš¨ AUTO-ESCALATION TRIGGERED");

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
                if (Date.now() < this.suppressFinalTranscriptUntil) {
                    console.debug("[AgentAdapter] Final transcript ignored (realtime command already handled)");
                    return;
                }
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

                // Always try deterministic command handling first on final transcript.
                // This keeps navigation fast even when interim packets were delayed.
                if (this.maybeHandleRealtimeCommand(event.transcript, "final")) {
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
                    console.log("[Agent] ðŸ”‡ Silence Detected. Attempting Re-engagement.");
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
                this.maybeHandleRealtimeCommand(event.transcript, "partial");
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
     * Deterministic high-priority routing for critical commands.
     * Used as a fallback when STT text is noisy or LLM confidence is unstable.
     */
    private getFastPathIntent(rawTranscript: string): Intent | null {
        const transcript = (rawTranscript || "").toLowerCase().trim();
        if (!transcript) return null;

        // Exact phrase match from state command map first.
        const exact = this.mapTranscriptToIntent(transcript);
        if (exact) return exact;

        if (/\b(go back|back|previous page|one page back|previous)\b/.test(transcript)) {
            return "BACK_REQUESTED";
        }
        if (this.state !== "IDLE" && /\b(cancel|cancel booking|stop booking|start over|abort)\b/.test(transcript)) {
            return "CANCEL_REQUESTED";
        }
        if (this.state === "BOOKING_SUMMARY") {
            if (/\b(confirm|yes|proceed|continue|pay|looks good|done)\b/.test(transcript)) {
                return "CONFIRM_PAYMENT";
            }
            if (/\b(modify|change|edit)\b/.test(transcript)) {
                return "MODIFY_BOOKING";
            }
        }
        if (this.state === "PAYMENT") {
            if (/\b(pay|confirm payment|process payment|continue|proceed|card)\b/.test(transcript)) {
                return "CONFIRM_PAYMENT";
            }
        }

        const voiceEntryStates: UiState[] = ["WELCOME", "AI_CHAT", "MANUAL_MENU"];
        if (voiceEntryStates.includes(this.state)) {
            const roomBookingSignal =
                /(book|booking|reserve|reservation)\b/.test(transcript) ||
                /room\s*book|book\s*room/.test(transcript) ||
                (/\b(room|kamra)\b/.test(transcript) && /(want|need|looking|find|take|new|chahiye|chaiye)/.test(transcript)) ||
                /\b(kamra|book karna|booking karna|room chahiye)\b/.test(transcript);

            if (roomBookingSignal) {
                return "BOOK_ROOM_SELECTED";
            }
            if (/(check\s*in|checkin|reservation\s*check|booking\s*check)/.test(transcript)) {
                return "CHECK_IN_SELECTED";
            }
            if (/(help|support|staff|human|manager|madad|sahayata)/.test(transcript)) {
                return "HELP_SELECTED";
            }
        }

        if (this.state === "ROOM_SELECT") {
            if (this.isRoomInfoQuery(transcript)) {
                return null;
            }
            const inferredRoom = this.inferRoomFromTranscript(transcript) || this.resolveRoomFromHint(transcript);
            if (inferredRoom) {
                return "ROOM_SELECTED";
            }
        }

        return null;
    }

    private buildRoomSelectionPrompt(rooms: any[]): string {
        const names = rooms
            .map((room: any) => String(room?.name || "").trim())
            .filter(Boolean)
            .slice(0, 4);
        if (names.length === 0) {
            return "Please tell me which room you would like to book.";
        }
        if (names.length === 1) {
            return `I found ${names[0]}. Would you like to book it?`;
        }
        const readable = `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
        return `Available rooms are ${readable}. Which room would you like to book?`;
    }

    private buildBookingCollectPrompt(): string {
        const slots = (this.viewData.bookingSlots || {}) as Record<string, any>;
        const selectedRoomName = this.viewData.selectedRoom?.name;

        if (slots.adults == null) {
            return selectedRoomName
                ? `Great choice. ${selectedRoomName} is selected. How many adults will be staying?`
                : "Great. How many adults will be staying?";
        }

        if (!slots.checkInDate || !slots.checkOutDate) {
            return "Please tell me your check in and check out dates.";
        }

        if (!slots.guestName) {
            return "What name should I use for this booking?";
        }

        return "Please review the details. Say confirm booking when you are ready.";
    }

    private setActiveSlot(slot: BookingSlotKey, expectedType: BookingSlotExpectedType, promptAsked: string): void {
        this.slotContext = {
            activeSlot: slot,
            expectedType,
            promptAsked,
        };
        console.log(`[AgentAdapter] Active Slot: ${slot} (expecting: ${expectedType})`);
    }

    private clearActiveSlot(): void {
        this.slotContext = {
            activeSlot: null,
            expectedType: null,
            promptAsked: "",
        };
    }

    private normalizePromptText(text: string): string {
        return String(text || "")
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private maybeTrackSlotFromPrompt(text: string): void {
        if (!text || !["ROOM_SELECT", "BOOKING_COLLECT", "BOOKING_SUMMARY"].includes(this.state)) {
            return;
        }

        const normalized = this.normalizePromptText(text);
        for (const rule of SLOT_PROMPT_LOOKUP) {
            if (rule.prompts.some((prompt) => normalized.includes(prompt))) {
                this.setActiveSlot(rule.slot, rule.expectedType, text);
                return;
            }
        }
    }

    private maybeClearFilledActiveSlot(payloadSlots: Record<string, unknown>): void {
        const active = this.slotContext.activeSlot;
        if (!active) return;
        if (!Object.prototype.hasOwnProperty.call(payloadSlots, active)) return;

        const value = payloadSlots[active];
        if (value !== null && value !== undefined && String(value).trim() !== "") {
            console.log(`[AgentAdapter] Slot filled: ${active}=${String(value)}`);
            this.clearActiveSlot();
        }
    }

    private applyBookingCollectIntentGuardrail(rawIntent: string, mappedIntent: string): string {
        if (this.state !== "BOOKING_COLLECT") {
            return mappedIntent;
        }

        const activeSlot = this.slotContext.activeSlot;
        if (!activeSlot) {
            return mappedIntent;
        }

        const normalizedRaw = (rawIntent || "").toUpperCase().trim();
        const suspiciousIntents = new Set(["SELECT_ROOM", "GENERAL_QUERY", "UNKNOWN"]);
        if (!suspiciousIntents.has(normalizedRaw)) {
            return mappedIntent;
        }

        const correctedIntent = SLOT_TO_INTENT_MAP[activeSlot] || mappedIntent;
        if (correctedIntent !== mappedIntent) {
            console.log(`[Agent] Correcting misfire: ${normalizedRaw || "UNKNOWN"} -> ${correctedIntent}`);
        }
        return correctedIntent;
    }

    private isRoomInfoQuery(rawTranscript: string): boolean {
        const transcript = (rawTranscript || "").toLowerCase().trim();
        if (!transcript) return false;
        const asksAmenities = /(amenit|facility|feature|include|what.*have|what.*get|suvidha)/.test(transcript);
        const asksPrice = /(price|cost|rate|tariff|how much|per night|kimat)/.test(transcript);
        const asksCompare = /(compare|difference|each room|every room|all rooms|which room)/.test(transcript);
        return asksAmenities || asksPrice || asksCompare;
    }

    private maybeHandleRealtimeCommand(rawTranscript: string, source: "partial" | "final" = "partial"): boolean {
        const transcript = (rawTranscript || "").trim();
        if (transcript.length < 2) return false;

        if (this.state === "ROOM_SELECT" && this.isRoomInfoQuery(transcript)) {
            return false;
        }

        const fastIntent = this.getFastPathIntent(transcript);
        if (!fastIntent) return false;

        const inferredRoom = this.state === "ROOM_SELECT"
            ? this.inferRoomFromTranscript(transcript) || this.resolveRoomFromHint(transcript)
            : null;

        if (fastIntent === "ROOM_SELECTED" && !inferredRoom) {
            return false;
        }

        const now = Date.now();
        if (
            this.lastRealtimeIntent === fastIntent &&
            now - this.lastRealtimeIntentAt < this.REALTIME_INTENT_DEDUP_MS
        ) {
            return true;
        }

        this.lastRealtimeIntent = fastIntent;
        this.lastRealtimeIntentAt = now;
        if (source === "partial") {
            this.suppressFinalTranscriptUntil = now + 1400;
        }

        if (fastIntent === "CANCEL_REQUESTED" || fastIntent === "CANCEL_BOOKING") {
            if (!this.pendingCancelConfirmation) {
                this.pendingCancelConfirmation = true;
                this.speak("Are you sure you want to cancel? Please say yes or no.");
            }
            this.hasProcessedTranscript = true;
            return true;
        }

        this.dispatch(fastIntent, { transcript, room: inferredRoom });
        this.hasProcessedTranscript = true;
        return true;
    }

    private resolveRoomFromHint(hint: unknown): any | null {
        if (!hint) return null;
        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) return null;

        const normalized = String(hint).toLowerCase().trim();
        if (!normalized) return null;

        const roomText = (room: any) => `${String(room?.name || "")} ${String(room?.code || "")}`.toLowerCase();

        const byExactCode = rooms.find((room: any) => String(room?.code || "").toLowerCase() === normalized);
        if (byExactCode) return byExactCode;

        const byCode = rooms.find((room: any) => {
            const code = String(room?.code || "").toLowerCase();
            return Boolean(code) && (code.includes(normalized) || normalized.includes(code));
        });
        if (byCode) return byCode;

        const byName = rooms.find((room: any) => {
            const name = String(room?.name || "").toLowerCase();
            return Boolean(name) && (name.includes(normalized) || normalized.includes(name));
        });
        if (byName) return byName;

        const ignoredTokens = new Set([
            "room", "rooms", "suite", "type", "please", "book", "booking",
            "want", "need", "for", "the", "and", "with", "a", "an"
        ]);
        const tokens = normalized
            .split(/[^a-z0-9]+/g)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3 && !ignoredTokens.has(token));

        if (tokens.length > 0) {
            let bestRoom: any | null = null;
            let bestScore = 0;
            for (const room of rooms) {
                const text = roomText(room);
                const score = tokens.reduce((acc, token) => acc + (text.includes(token) ? 1 : 0), 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestRoom = room;
                }
            }
            if (bestRoom && bestScore >= Math.max(1, Math.ceil(tokens.length / 2))) {
                return bestRoom;
            }
        }

        const keywordChecks: Array<{ pattern: RegExp; pick: (text: string) => boolean }> = [
            { pattern: /(deluxe|ocean)/, pick: (text) => text.includes("deluxe") || text.includes("ocean") },
            { pattern: /(presidential|premium|luxury)/, pick: (text) => text.includes("presidential") || text.includes("premium") || text.includes("luxury") },
            { pattern: /(standard|single|queen|classic)/, pick: (text) => text.includes("standard") || text.includes("single") || text.includes("queen") || text.includes("classic") },
            { pattern: /(bunk|dorm|shared)/, pick: (text) => text.includes("bunk") || text.includes("dorm") || text.includes("shared") },
            { pattern: /(executive|business)/, pick: (text) => text.includes("executive") || text.includes("business") },
            { pattern: /(suite)/, pick: (text) => text.includes("suite") },
        ];

        for (const rule of keywordChecks) {
            if (rule.pattern.test(normalized)) {
                const match = rooms.find((room: any) => rule.pick(roomText(room)));
                if (match) return match;
            }
        }

        return null;
    }

    private maybeHandleRoomInfoQuery(rawTranscript: string): boolean {
        if (this.state !== "ROOM_SELECT") {
            return false;
        }

        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) {
            return false;
        }

        const transcript = (rawTranscript || "").toLowerCase().trim();
        if (!this.isRoomInfoQuery(transcript)) {
            return false;
        }

        const specificRoom = this.inferRoomFromTranscript(transcript) || this.resolveRoomFromHint(transcript);
        const formatRoomLine = (room: any) => {
            const name = String(room?.name || "Room");
            const price = room?.price != null ? `${room.currency || "USD"} ${room.price}` : "price on request";
            const features = Array.isArray(room?.features) ? room.features.slice(0, 4).join(", ") : "standard amenities";
            return `${name} is ${price} per night with ${features}.`;
        };

        if (specificRoom) {
            this.speak(formatRoomLine(specificRoom));
            return true;
        }

        const topRooms = rooms.slice(0, 4);
        const summary = topRooms.map((room: any) => formatRoomLine(room)).join(" ");
        this.speak(`${summary} Which room would you like to book?`);
        return true;
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
                return 'GENERAL_QUERY';
            case 'IDLE':
                return 'RESET';
            case 'BACK':
            case 'BACK_REQUESTED':
                return 'BACK_REQUESTED';
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
            case 'COMPARE_ROOMS':
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
        if (upper.includes('BACK') || upper.includes('PREVIOUS')) return 'BACK_REQUESTED';
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
                    this.transitionTo("IDLE", "RESET", { transcript });
                    return;
                }
                if (this.isNegative(transcript)) {
                    this.pendingCancelConfirmation = false;
                    this.speak("Okay, continuing.");
                    return;
                }
                this.speak("Please say yes to confirm cancellation, or no to continue.");
                return;
            }

            if (this.maybeHandleRoomInfoQuery(transcript)) {
                return;
            }

            const fastPathIntent = this.getFastPathIntent(transcript);
            if (fastPathIntent) {
                if (fastPathIntent === "CANCEL_REQUESTED" || fastPathIntent === "CANCEL_BOOKING") {
                    this.pendingCancelConfirmation = true;
                    this.speak("Are you sure you want to cancel? Please say yes or no.");
                    return;
                }
                const inferredRoom = this.state === "ROOM_SELECT" ? this.inferRoomFromTranscript(transcript) : null;
                this.dispatch(fastPathIntent, {
                    transcript,
                    room: inferredRoom
                });
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
                    sessionId: sessionId || this.getSessionId(),
                    activeSlot: this.slotContext.activeSlot,
                    expectedType: this.slotContext.expectedType,
                    lastSystemPrompt: this.slotContext.promptAsked || undefined,
                    filledSlots: this.viewData.bookingSlots || {},
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
            strictEvent = this.applyBookingCollectIntentGuardrail(rawIntent, strictEvent);
            const slotRoomHint = decision?.accumulatedSlots?.roomType || decision?.extractedSlots?.roomType;
            let inferredRoom = this.state === "ROOM_SELECT"
                ? this.inferRoomFromTranscript(transcript)
                    || this.resolveRoomFromHint(slotRoomHint)
                    || this.viewData.selectedRoom
                    || null
                : null;

            if (
                this.state === "ROOM_SELECT" &&
                inferredRoom &&
                (strictEvent === "ROOM_SELECTED" || strictEvent === "BOOK_ROOM_SELECTED" || strictEvent === "GENERAL_QUERY")
            ) {
                strictEvent = "ROOM_SELECTED";
            }
            if (
                this.state === "BOOKING_COLLECT" &&
                decision?.isComplete === true &&
                strictEvent !== "CANCEL_BOOKING" &&
                strictEvent !== "CANCEL_REQUESTED"
            ) {
                strictEvent = "CONFIRM_BOOKING";
            }
            if (strictEvent === "CANCEL_BOOKING" || strictEvent === "CANCEL_REQUESTED") {
                this.pendingCancelConfirmation = true;
                this.speak("Are you sure you want to cancel? Please say yes or no.");
                return;
            }
            if (this.state === "ROOM_SELECT" && strictEvent === "ROOM_SELECTED" && !inferredRoom) {
                // Prevent false-positive jumps when no actual room was identified.
                strictEvent = "GENERAL_QUERY";
            }

            console.log(`[Agent] Mapping Intent: ${rawIntent} -> ${strictEvent}`);

            const willTransition =
                strictEvent !== "GENERAL_QUERY" &&
                this.resolveNextStateFromIntent(this.state, strictEvent) !== this.state;

            // 3. Handle "Talking" (TTS)
            // Avoid speaking text that will be immediately cancelled by a state transition.
            if (decision.speech && !willTransition) {
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
        this.clearActiveSlot();
        console.log("[AgentAdapter] Session cleared for privacy");
    }

    /**
     * Returns the current state synchronously.
     */
    public getState(): UiState {
        return this.state;
    }

    public getSlotContext(): SlotContext {
        return { ...this.slotContext };
    }

    public getBookingSlots(): Record<string, unknown> {
        return { ...(this.viewData.bookingSlots || {}) };
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
            slotContext: this.slotContext,
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
            this.maybeClearFilledActiveSlot(payload.slots);

            if (!merged.selectedRoom && payload.slots.roomType && Array.isArray(merged.rooms)) {
                merged.selectedRoom =
                    this.resolveRoomFromHint(payload.slots.roomType) ||
                    merged.rooms.find((room: any) =>
                        String(room?.name || "").toLowerCase().includes(String(payload.slots.roomType).toLowerCase())
                    ) ||
                    null;
            }
        }

        if (payload?.missingSlots) {
            merged.missingSlots = payload.missingSlots;
        }

        if (payload?.nextSlotToAsk !== undefined) {
            merged.nextSlotToAsk = payload.nextSlotToAsk;
            const hintedSlot = payload.nextSlotToAsk as BookingSlotKey | null;
            if (hintedSlot && SLOT_EXPECTED_TYPE_MAP[hintedSlot]) {
                this.slotContext = {
                    ...this.slotContext,
                    activeSlot: hintedSlot,
                    expectedType: SLOT_EXPECTED_TYPE_MAP[hintedSlot],
                };
            }
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

        if (/\b(first|1st)\b/.test(t) && rooms[0]) return rooms[0];
        if (/\b(second|2nd)\b/.test(t) && rooms[1]) return rooms[1];
        if (/\b(third|3rd)\b/.test(t) && rooms[2]) return rooms[2];

        if ((/\b(this room|that room|this one|that one)\b/.test(t)) && this.viewData.selectedRoom) {
            return this.viewData.selectedRoom;
        }

        return this.resolveRoomFromHint(t);
    }
    private isAffirmative(text: string): boolean {
        const t = (text || "").toLowerCase();
        return /\b(yes|yeah|yep|confirm|sure|ok|okay|proceed|cancel it|do it|haan|han|ji|correct)\b/.test(t);
    }

    private isNegative(text: string): boolean {
        const t = (text || "").toLowerCase();
        return /\b(no|nope|dont|don't|not now|continue|resume|go on|nah|nahi|mat)\b/.test(t);
    }

    private resolveNextStateFromIntent(currentState: UiState, intent: string): UiState {
        // ROOM_SELECT must not auto-advance on generic queries/amenity questions.
        if (currentState === "ROOM_SELECT") {
            if (intent === "ASK_ROOM_DETAIL" || intent === "ASK_PRICE" || intent === "COMPARE_ROOMS" || intent === "GENERAL_QUERY" || intent === "HELP_SELECTED") {
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
            "COMPARE_ROOMS",
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
        console.log(`[AgentAdapter] ðŸ‘† Handle Intent (Touch Authority): ${intent}`, payload || '');
        this.resetInactivityTimer();

        // 1. TOUCH AUTHORITY CHECK ðŸ›¡ï¸
        const INTERRUPT_INTENTS = [
            "CHECK_IN_SELECTED", "BOOK_ROOM_SELECTED",
            "HELP_SELECTED", "SCAN_COMPLETED",
            "ROOM_SELECTED", "CONFIRM_PAYMENT",
            "BACK_REQUESTED", "RESET", "TOUCH_SELECTED",
            "CANCEL_REQUESTED", "PROXIMITY_DETECTED",
            "SCAN_ID_SELECTED", "PAYMENT_SELECTED"
        ];

        if (INTERRUPT_INTENTS.includes(intent)) {
            console.log("[AgentAdapter] ðŸ‘† Touch Interrupt detected. Killing Audio.");
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
            if (
                this.state === "ROOM_SELECT" &&
                intent === "GENERAL_QUERY" &&
                Array.isArray(payload?.rooms) &&
                payload.rooms.length > 0 &&
                !this.hasAnnouncedRoomOptions
            ) {
                this.hasAnnouncedRoomOptions = true;
                this.speak(this.buildRoomSelectionPrompt(payload.rooms));
            }
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
            console.log(`[Mediator] ðŸ—£ï¸ Conversational Turn (Staying on ${this.state})`);
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
        if (nextState !== "BOOKING_COLLECT") {
            this.clearActiveSlot();
        }
        this.applyPayloadData(intent || 'UNKNOWN', payload, nextState);
        this.resetInactivityTimer();
        this.hasAnnouncedRoomOptions = false;

        console.log(`[AgentAdapter] State Transition: ${previousState} -> ${this.state}`);

        // Phase 9.4.1: On state change, stop any active TTS and listening
        VoiceRuntime.stopSpeaking();
        VoiceRuntime.stopListening();

        // Notify Listeners
        this.notifyListeners();

        // Speak Agent response (lookup from legacy map)
        let speech = STATE_SPEECH_MAP[nextState];
        if (nextState === "ROOM_SELECT") {
            speech = "Sure. I am fetching available rooms for this hotel.";
        }
        if (nextState === "BOOKING_COLLECT") {
            speech = this.buildBookingCollectPrompt();
        }
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

        // Demo-complete flow: advance key dispensing to completion.
        if (nextState === "KEY_DISPENSING") {
            setTimeout(() => {
                if (this.state === "KEY_DISPENSING") {
                    this.dispatch("DISPENSE_COMPLETE" as Intent);
                }
            }, 2000);
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
        this.maybeTrackSlotFromPrompt(text);
        this.emitTranscript(text, true, 'ai');
        VoiceRuntime.speak(text);
    }

    private withTenantName(text: string): string {
        const resolvedName = getTenant()?.name?.trim();
        const slugName = getTenantSlug()
            .split("-")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
        const tenantName = resolvedName || slugName || "our hotel";

        return text.replace(
            /\{\{TENANT_NAME\}\}|\{TENANT_NAME\}|\{\{HOTEL_NAME\}\}|\{HOTEL_NAME\}|\{Hotel name\}|\{hotel name\}/g,
            tenantName
        );
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
            slotContext: this.slotContext,
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
        this.clearActiveSlot();
        this.notifyListeners();
    }

}

export const AgentAdapter = new AgentAdapterService();

