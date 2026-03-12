import { Intent } from "@contracts/intents";
import { UiState, VOICE_COMMAND_MAP, STATE_INPUT_MODES, STATE_SPEECH_MAP } from "./index";
import { VoiceRuntime } from "../voice/VoiceRuntime";
import { VoiceEvent } from "../voice/voice.types";
import { SpeechOutputController } from "../voice/SpeechOutputController";
import { TTSController } from "../voice/TTSController";
import { StateMachine } from "../state/uiState.machine";
import { UIState } from "@contracts/backend.contract";
import { buildTenantApiUrl, getCurrentTenantLanguage, getTenantHeaders, getTenant, getTenantSlug } from "../services/tenantContext";
import { normalizeBackendStateFromResponse, normalizeStateForBackendChat } from "../services/uiStateInterop";
import { buildCacheKey, getCachedFaqAnswer, putCachedFaqAnswer } from "../services/faqCache.service";
import { RoomService } from "../services/room.service";

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
    ID_VERIFY: false,
    CHECK_IN_SUMMARY: false,
    ROOM_SELECT: true,
    BOOKING_COLLECT: true,
    BOOKING_SUMMARY: true,
    PAYMENT: true,
    KEY_DISPENSING: false,
    COMPLETE: false,
    ERROR: false,       // No voice during error states
};

const FAQ_CACHE_BLOCKED_STATES = new Set<UiState>([
    "SCAN_ID",
    "ID_VERIFY",
    "CHECK_IN_SUMMARY",
    "ROOM_SELECT",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "KEY_DISPENSING",
    "COMPLETE",
]);

const TRANSACTIONAL_CHECK_IN_PATTERN = /\b(i want to check[\s-]?in|check me in|start check[\s-]?in|begin check[\s-]?in)\b/i;
const TRANSACTIONAL_BOOKING_PATTERN = /\b(confirm booking|cancel booking|modify booking|book a room|make a booking|start booking|reserve a room)\b/i;
const FAQ_INFO_PATTERN = /\b(what|when|where|which|how|time|timing|hours?|breakfast|wifi|parking|pool|check[\s-]?(in|out)|check and|second time|checking time)\b/i;

function shouldUseFaqCache(transcript: string, currentState: UiState): boolean {
    const cleaned = (transcript || "").trim();
    if (!cleaned) return false;
    if (FAQ_CACHE_BLOCKED_STATES.has(currentState)) return false;
    if (TRANSACTIONAL_CHECK_IN_PATTERN.test(cleaned)) return false;
    if (TRANSACTIONAL_BOOKING_PATTERN.test(cleaned)) return false;
    if (!FAQ_INFO_PATTERN.test(cleaned)) return false;
    return true;
}

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
type InteractionMode = "manual" | "voice";

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

const BOOKING_SLOT_PRIORITY: BookingSlotKey[] = [
    "roomType",
    "adults",
    "checkInDate",
    "checkOutDate",
    "guestName",
];

const SLOT_KEY_ALIAS_MAP: Record<string, BookingSlotKey> = {
    roomtype: "roomType",
    room_type: "roomType",
    adults: "adults",
    children: "children",
    checkindate: "checkInDate",
    check_in_date: "checkInDate",
    checkoutdate: "checkOutDate",
    check_out_date: "checkOutDate",
    guestname: "guestName",
    guest_name: "guestName",
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

function getBookingProgressRank(state: UiState): number {
    switch (state) {
        case "ROOM_SELECT":
            return 1;
        case "BOOKING_COLLECT":
            return 2;
        case "BOOKING_SUMMARY":
            return 3;
        case "PAYMENT":
            return 4;
        case "KEY_DISPENSING":
            return 5;
        case "COMPLETE":
            return 6;
        default:
            return 0;
    }
}

class AgentAdapterService {
    private state: UiState = "IDLE";
    private viewData: Record<string, any> = {};
    private listeners: ((state: UiState, data?: any) => void)[] = [];
    private language: string = "en";

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
    private interactionMode: InteractionMode = "voice";
    private pendingVoiceConfirm = false;
    private manualEditModeActive = false;
    private listeningRestartTimer: ReturnType<typeof setTimeout> | null = null;
    private silenceReengageTimer: ReturnType<typeof setTimeout> | null = null;
    private keyDispenseCompleteTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SILENCE_REENGAGE_COOLDOWN_MS = 12000;
    private readonly KEY_DISPENSE_SIM_MS = 3500;
    private reengageCooldownUntil = 0;
    private voiceLifecycleEpoch = 0;
    private llmRequestCounter = 0;
    private confirmRequestCounter = 0;
    private pendingConfirmToken: number | null = null;
    private pendingAiSpeechText: string | null = null;
    private lastBookingPromptFingerprint: string | null = null;
    private lastBookingPromptAt = 0;
    private readonly BOOKING_PROMPT_DEDUP_MS = 3500;

    // HMR cleanup: store unsubscribe functions so destroy() can remove ghost callbacks
    private disposers: (() => void)[] = [];

    constructor() {
        console.log("[AgentAdapter] Initialized (Phase 9.4 - LLM Confidence Gating)");

        // Subscribe to Voice Runtime (Input Source) — store unsubscribe for HMR cleanup
        const unsubVoice = VoiceRuntime.subscribe(this.handleVoiceEvent.bind(this));
        this.disposers.push(unsubVoice);

        // Phase 9.4.1: Subscribe to TTS events for polite turn-taking
        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === "TTS_STARTED") {
                this.clearListeningRestartTimer("tts_started");
                this.clearSilenceReengageTimer("tts_started");
                if (event.text?.trim()) {
                    this.emitTranscript(event.text, true, 'ai');
                }
                this.pendingAiSpeechText = null;
            }

            if (event.type === "TTS_ENDED") {
                this.pendingAiSpeechText = null;
                this.handleTTSEnded("ended");
            }

            if (event.type === "TTS_ERROR") {
                const fallbackText = (event.text || this.pendingAiSpeechText || "").trim();
                if (fallbackText) {
                    this.emitTranscript(fallbackText, true, 'ai');
                }
                this.pendingAiSpeechText = null;
                this.handleTTSEnded("error");
            }

            if (event.type === "TTS_CANCELLED") {
                this.pendingAiSpeechText = null;
                this.clearListeningRestartTimer("tts_cancelled");
            }
        });
        this.disposers.push(unsubTTS);
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
     * After TTS lifecycle finishes, start listening if state allows voice.
     */
    private handleTTSEnded(cause: "ended" | "error"): void {
        // Check if current state allows voice input
        const allowsVoice = this.hasVoiceAuthority();

        if (allowsVoice) {
            // Ownership rule: TTS completion is the single owner for post-TTS mic resume.
            const restartDelayMs = cause === "error" ? 900 : 600;
            console.log(`[AgentAdapter] TTS ${cause}; scheduling listening restart (${restartDelayMs}ms).`);
            this.scheduleListeningRestart(restartDelayMs, "tts_lifecycle");
        } else {
            console.log("[AgentAdapter] TTS ended, but state doesn't allow voice");
        }
    }

    private clearListeningRestartTimer(reason: string): void {
        if (!this.listeningRestartTimer) return;
        clearTimeout(this.listeningRestartTimer);
        this.listeningRestartTimer = null;
        console.debug(`[AgentAdapter] Cleared listening restart timer (${reason})`);
    }

    private clearSilenceReengageTimer(reason: string): void {
        if (!this.silenceReengageTimer) return;
        clearTimeout(this.silenceReengageTimer);
        this.silenceReengageTimer = null;
        console.debug(`[AgentAdapter] Cleared silence re-engagement timer (${reason})`);
    }

    private clearKeyDispenseTimer(reason: string): void {
        if (!this.keyDispenseCompleteTimer) return;
        clearTimeout(this.keyDispenseCompleteTimer);
        this.keyDispenseCompleteTimer = null;
        console.debug(`[AgentAdapter] Cleared key-dispense timer (${reason})`);
    }

    private resetVoiceLifecycle(reason: string): void {
        this.voiceLifecycleEpoch += 1;
        this.clearListeningRestartTimer(reason);
        this.clearSilenceReengageTimer(reason);
    }

    private scheduleListeningRestart(delayMs: number, source: "tts_lifecycle" | "state_transition"): void {
        this.clearListeningRestartTimer(`reschedule:${source}`);
        const expectedEpoch = this.voiceLifecycleEpoch;
        const expectedState = this.state;
        this.listeningRestartTimer = setTimeout(() => {
            this.listeningRestartTimer = null;

            if (expectedEpoch !== this.voiceLifecycleEpoch) {
                console.debug("[AgentAdapter] Ignored stale listening restart timer");
                return;
            }
            if (expectedState !== this.state) {
                console.debug(`[AgentAdapter] Ignored restart from stale state ${expectedState} -> ${this.state}`);
                return;
            }
            if (!this.hasVoiceAuthority()) return;
            if (VoiceRuntime.getMode() !== "idle") return;
            if (TTSController.isSpeaking()) return;

            VoiceRuntime.startListening(getCurrentTenantLanguage(this.language)).catch((error) => {
                console.warn("[AgentAdapter] Failed to restart listening:", error);
            });
        }, delayMs);
    }

    private getPromptLanguage(): string {
        return getCurrentTenantLanguage(this.language);
    }

    private pickLocalizedText(options: { en: string; hi: string; mr: string }): string {
        switch (this.getPromptLanguage()) {
            case "hi":
                return options.hi;
            case "mr":
                return options.mr;
            default:
                return options.en;
        }
    }

    private getSilenceReengagementPlan(): { delayMs: number; prompt: string } | null {
        switch (this.state) {
            case "WELCOME":
                return {
                    delayMs: 2200,
                    prompt: this.pickLocalizedText({
                        en: "I can help you check in, book a room, or call for help.",
                        hi: "मैं check in, room booking, या मदद में आपकी सहायता कर सकती हूँ।",
                        mr: "मी check in, room booking किंवा मदत यासाठी तुमची मदत करू शकते.",
                    }),
                };
            case "AI_CHAT":
                return {
                    delayMs: 2400,
                    prompt: this.pickLocalizedText({
                        en: "I'm listening. You can say check in, book room, or help.",
                        hi: "मैं सुन रही हूँ। आप check in, room book, या help कह सकते हैं।",
                        mr: "मी ऐकत आहे. तुम्ही check in, room book किंवा help म्हणू शकता.",
                    }),
                };
            case "MANUAL_MENU":
                return {
                    delayMs: 3200,
                    prompt: this.pickLocalizedText({
                        en: "You can continue by voice or tap an option on screen.",
                        hi: "आप voice से जारी रख सकते हैं या screen पर कोई option चुन सकते हैं।",
                        mr: "तुम्ही voice ने पुढे जाऊ शकता किंवा screen वरचा option निवडू शकता.",
                    }),
                };
            case "ROOM_SELECT":
                return {
                    delayMs: 6500,
                    prompt: this.pickLocalizedText({
                        en: "Take your time. Say the room name when you're ready.",
                        hi: "आराम से चुनिए। तैयार होने पर room का नाम बोलिए।",
                        mr: "निवांत निवडा. तयार झाल्यावर room चे नाव सांगा.",
                    }),
                };
            case "BOOKING_COLLECT":
                return {
                    delayMs: 8000,
                    prompt: this.pickLocalizedText({
                        en: "When you're ready, tell me the next booking detail.",
                        hi: "जब आप तैयार हों, booking की अगली detail बताइए।",
                        mr: "तयार झाल्यावर booking ची पुढची detail सांगा.",
                    }),
                };
            case "BOOKING_SUMMARY":
                return {
                    delayMs: 9000,
                    prompt: this.pickLocalizedText({
                        en: "Review the summary and say confirm booking when ready.",
                        hi: "Summary देख लीजिए और तैयार होने पर confirm booking कहिए।",
                        mr: "Summary पाहा आणि तयार झाल्यावर confirm booking म्हणा.",
                    }),
                };
            default:
                return null;
        }
    }

    private scheduleSilenceReengagement(sourceReason: string): void {
        if (!this.hasVoiceAuthority()) return;
        const plan = this.getSilenceReengagementPlan();
        if (!plan) return;

        const now = Date.now();
        if (now < this.reengageCooldownUntil) {
            console.debug("[AgentAdapter] Silence re-engagement skipped (cooldown active)");
            return;
        }

        this.clearSilenceReengageTimer("reschedule:silence");
        const expectedEpoch = this.voiceLifecycleEpoch;
        const expectedState = this.state;
        const finalDelay = plan.delayMs;

        this.silenceReengageTimer = setTimeout(() => {
            this.silenceReengageTimer = null;

            if (expectedEpoch !== this.voiceLifecycleEpoch) {
                console.debug("[AgentAdapter] Ignored stale silence re-engagement timer");
                return;
            }
            if (expectedState !== this.state) {
                console.debug(`[AgentAdapter] Ignored stale silence prompt for ${expectedState}; current=${this.state}`);
                return;
            }
            if (!this.hasVoiceAuthority()) return;
            if (TTSController.isSpeaking()) return;

            this.reengageCooldownUntil = Date.now() + this.SILENCE_REENGAGE_COOLDOWN_MS;
            console.log(`[AgentAdapter] Silence re-engagement prompt (${sourceReason}) for state=${this.state}`);
            if (this.state === "ROOM_SELECT") {
                this.setActiveSlot("roomType", "string", plan.prompt);
            }
            this.speak(plan.prompt);
        }, finalDelay);
    }

    private scheduleKeyDispenseCompletion(): void {
        this.clearKeyDispenseTimer("reschedule:key_dispense");
        const expectedState = this.state;
        this.keyDispenseCompleteTimer = setTimeout(() => {
            this.keyDispenseCompleteTimer = null;
            if (expectedState !== "KEY_DISPENSING" || this.state !== "KEY_DISPENSING") {
                console.debug("[AgentAdapter] Ignored stale key-dispense completion timer");
                return;
            }
            // TODO: Replace with real hardware completion event when dispenser integration is available.
            console.log("[AgentAdapter] Simulated key dispensing complete -> DISPENSE_COMPLETE");
            this.handleIntent("DISPENSE_COMPLETE");
        }, this.KEY_DISPENSE_SIM_MS);
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

    private getVoiceLocked(): boolean {
        return this.interactionMode !== "voice" || this.pendingVoiceConfirm || this.manualEditModeActive;
    }

    private setInteractionMode(
        mode: InteractionMode,
        options?: { pendingVoiceConfirm?: boolean; reason?: string }
    ): void {
        const nextPendingVoiceConfirm = options?.pendingVoiceConfirm ?? false;
        const changed =
            this.interactionMode !== mode ||
            this.pendingVoiceConfirm !== nextPendingVoiceConfirm;

        this.interactionMode = mode;
        this.pendingVoiceConfirm = nextPendingVoiceConfirm;

        if (changed) {
            console.log(
                `[AgentAdapter] Interaction mode -> ${mode} (pendingVoiceConfirm=${nextPendingVoiceConfirm})` +
                (options?.reason ? ` [${options.reason}]` : "")
            );
        }
    }

    private hasVoiceAuthority(): boolean {
        return !this.getVoiceLocked() && (VOICE_AUTHORITY_MATRIX[this.state] ?? false);
    }

    /**
     * Handle incoming Voice Events (Router Logic)
     * strictly maps Input -> Intent based on Agent Rules.
     * Does NOT interpret language or decide navigation.
     */
    private handleVoiceEvent(event: VoiceEvent) {
        console.log(`[AgentAdapter] Received Voice Event: ${event.type}`);

        if (this.interactionMode !== "voice" || this.pendingVoiceConfirm) {
            if (event.type === "VOICE_SESSION_STARTED") {
                this.emitTelemetry("VOICE_COMMAND_BLOCKED", {
                    reason: this.pendingVoiceConfirm ? "PENDING_CONFIRMATION" : "MANUAL_MODE",
                    state: this.state
                });
                VoiceRuntime.cancelSession();
            }
            if (event.type === "VOICE_SESSION_ENDED") {
                this.hasProcessedTranscript = false;
            }
            return;
        }

        switch (event.type) {
            case "VOICE_SESSION_STARTED":
                this.clearSilenceReengageTimer("session_started");
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
                this.clearSilenceReengageTimer("transcript_ready");
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
                console.log(`[AgentAdapter] Voice Session Ended. reason=${event.reason || "unknown"}`);
                VoiceRuntime.setTurnState("IDLE");

                if (event.reason === "user" || event.reason === "pause" || event.reason === "hard_stop" || event.reason === "permission_denied") {
                    this.resetVoiceLifecycle(`session_ended:${event.reason}`);
                    this.hasProcessedTranscript = false;
                    break;
                }

                // Silence recovery is only for no-input timeout style endings.
                const endedWithoutTranscript = event.hadTranscript === false || !this.hasProcessedTranscript;
                if (endedWithoutTranscript) {
                    this.scheduleSilenceReengagement(event.reason || "unknown");
                }
                this.hasProcessedTranscript = false;
                break;

            // Phase 10: Production Hardening - Recovery Events
            case "VOICE_SESSION_ABORTED":
                console.log("[AgentAdapter] Voice Session ABORTED (watchdog/silence)");
                VoiceRuntime.setTurnState("IDLE");
                this.resetVoiceLifecycle("session_aborted");
                VoiceRuntime.clearSessionData();  // Privacy
                // Recovery should always reset the guest-facing flow back to WELCOME,
                // not reuse generic back-navigation across mixed check-in/booking journeys.
                if (this.state !== "WELCOME" && this.state !== "ERROR" && this.state !== "IDLE") {
                    this.transitionTo("WELCOME", "CANCEL_REQUESTED", { voiceRecovery: true });
                }
                break;

            case "VOICE_SESSION_ERROR":
                console.warn(`[AgentAdapter] Voice Session ERROR (${event.reason || "unknown"})`);
                VoiceRuntime.setTurnState("IDLE");
                if (event.reason === "stt_permission_denied" || event.fatal) {
                    this.resetVoiceLifecycle(`session_error:${event.reason || "fatal"}`);
                }
                // Don't block navigation - just log and continue
                // UI can show text fallback if needed
                break;

            case "VOICE_TRANSCRIPT_PARTIAL":
                // Just for live display, no action needed
                this.clearSilenceReengageTimer("transcript_partial");
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

    /**
     * Deterministic high-priority routing for critical commands.
     * Used as a fallback when STT text is noisy or LLM confidence is unstable.
     */
    private getFastPathIntent(_transcript: string): Intent | null {
        // [V2 DUMB FRONTEND] Hardcoded regex triggers removed.
        // All intent classification must happen in the backend.
        return null;
    }

    private buildRoomSelectionPrompt(rooms: any[]): string {
        const names = rooms
            .map((room: any) => String(room?.name || "").trim())
            .filter(Boolean)
            .slice(0, 4);
        if (names.length === 0) {
            return this.pickLocalizedText({
                en: "Please tell me which room you would like to book.",
                hi: "कृपया बताइए, आप कौन सा room book करना चाहेंगे?",
                mr: "कृपया सांगा, तुम्हाला कोणता room book करायचा आहे?",
            });
        }
        if (names.length === 1) {
            return this.pickLocalizedText({
                en: `I found ${names[0]}. Would you like to book it?`,
                hi: `मेरे पास ${names[0]} उपलब्ध है। क्या आप इसे book करना चाहेंगे?`,
                mr: `माझ्याकडे ${names[0]} उपलब्ध आहे. तुम्हाला ते book करायचे आहे का?`,
            });
        }
        const readable = `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
        return this.pickLocalizedText({
            en: `Available rooms are ${readable}. Which room would you like to book?`,
            hi: `Available rooms हैं ${readable}. आप कौन सा room book करना चाहेंगे?`,
            mr: `Available rooms आहेत ${readable}. तुम्हाला कोणता room book करायचा आहे?`,
        });
    }

    private buildBookingCollectPrompt(): string {
        const slots = (this.viewData.bookingSlots || {}) as Record<string, any>;
        const selectedRoomName = this.getCanonicalSelectedRoomLabel();

        if (slots.adults == null) {
            return selectedRoomName
                ? this.pickLocalizedText({
                    en: `Great choice. ${selectedRoomName} is selected. How many adults will be staying?`,
                    hi: `बहुत बढ़िया। ${selectedRoomName} select हो गया है। कितने adults stay करेंगे?`,
                    mr: `छान निवड. ${selectedRoomName} select झाले आहे. किती adults stay करणार आहेत?`,
                })
                : this.pickLocalizedText({
                    en: "Great. How many adults will be staying?",
                    hi: "ठीक है। कितने adults stay करेंगे?",
                    mr: "छान. किती adults stay करणार आहेत?",
                });
        }

        if (!slots.checkInDate || !slots.checkOutDate) {
            return this.pickLocalizedText({
                en: "Please tell me your check in and check out dates.",
                hi: "कृपया अपनी check in और check out dates बताइए।",
                mr: "कृपया तुमच्या check in आणि check out dates सांगा.",
            });
        }

        if (!slots.guestName) {
            return this.pickLocalizedText({
                en: "What name should I use for this booking?",
                hi: "इस booking के लिए मैं कौन सा नाम उपयोग करूँ?",
                mr: "या booking साठी मी कोणते नाव वापरू?",
            });
        }

        return this.pickLocalizedText({
            en: "Please review the details. Say confirm booking when you are ready.",
            hi: "कृपया details देख लीजिए। तैयार होने पर confirm booking कहिए।",
            mr: "कृपया details पाहा. तयार झाल्यावर confirm booking म्हणा.",
        });
    }

    private normalizeBookingSlotKey(raw: unknown): BookingSlotKey | null {
        if (raw == null) return null;
        const asText = String(raw).trim();
        if (!asText) return null;
        const snake = asText
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/[\s-]+/g, "_")
            .toLowerCase();
        const compact = snake.replace(/_/g, "");
        return SLOT_KEY_ALIAS_MAP[snake] || SLOT_KEY_ALIAS_MAP[compact] || null;
    }

    private normalizeRoomHintText(value: unknown): string {
        return String(value || "")
            .toLowerCase()
            .replace(/\bsweet\b/g, "suite")
            .replace(/\bsweets\b/g, "suites")
            .replace(/\bluxary\b/g, "luxury")
            .replace(/\blux\b/g, "luxury")
            .replace(/\s+/g, " ")
            .trim();
    }

    private getCanonicalSelectedRoomLabel(roomLike?: any): string | null {
        const room = roomLike || this.viewData.selectedRoom;
        const display = String(room?.displayName || room?.name || room?.roomType || "").trim();
        return display || null;
    }

    private getMissingBookingSlotsFromState(): BookingSlotKey[] {
        const slots = (this.viewData.bookingSlots || {}) as Record<string, unknown>;
        return BOOKING_SLOT_PRIORITY.filter((slot) => {
            const value = slots[slot];
            return value === null || value === undefined || String(value).trim() === "";
        });
    }

    private formatSpeechDate(value: unknown): string | null {
        const raw = String(value || "").trim();
        if (!raw) return null;

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
            return raw;
        }

        return parsed.toLocaleDateString("en-IN", {
            month: "long",
            day: "numeric",
            year: "numeric",
        });
    }

    private hasFilledBookingSlotValue(value: unknown): boolean {
        return value !== null && value !== undefined && String(value).trim() !== "";
    }

    private getMissingBookingSlots(slots: Record<string, unknown>): BookingSlotKey[] {
        return BOOKING_SLOT_PRIORITY.filter((slot) => !this.hasFilledBookingSlotValue(slots[slot]));
    }

    private pickFilledManualOverrides(slots: Record<string, unknown> | undefined): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        if (!slots) return result;

        for (const [key, value] of Object.entries(slots)) {
            if (this.hasFilledBookingSlotValue(value)) {
                result[key] = value;
            }
        }

        return result;
    }

    private applyStoredManualBookingOverrides(merged: Record<string, any>): void {
        if (merged.manualSelectedRoomOverride) {
            merged.selectedRoom = merged.manualSelectedRoomOverride;
        }

        if (merged.manualBookingOverrides) {
            merged.bookingSlots = {
                ...(merged.bookingSlots || {}),
                ...merged.manualBookingOverrides,
            };
        }
    }

    private calculateBookingNights(checkInDate: unknown, checkOutDate: unknown): number | null {
        const checkIn = new Date(String(checkInDate || ""));
        const checkOut = new Date(String(checkOutDate || ""));
        if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
            return null;
        }

        const diffMs = checkOut.getTime() - checkIn.getTime();
        if (diffMs <= 0) {
            return null;
        }

        return Math.round(diffMs / (1000 * 60 * 60 * 24));
    }

    private syncDerivedBookingData(merged: Record<string, any>): void {
        const slots = { ...(merged.bookingSlots || {}) } as Record<string, unknown>;
        const nights = this.calculateBookingNights(slots.checkInDate, slots.checkOutDate);
        if (nights !== null) {
            slots.nights = nights;
        } else {
            delete slots.nights;
        }

        const roomPrice = Number(merged?.selectedRoom?.price);
        const existingBill = merged?.bill || {};
        const previousSubtotal = Number(existingBill?.subtotal);
        const previousTaxes = Number(existingBill?.taxes);
        const taxRate = Number.isFinite(previousSubtotal) && previousSubtotal > 0 && Number.isFinite(previousTaxes)
            ? previousTaxes / previousSubtotal
            : 0;

        const shouldRecalculateFinancials = Boolean(merged.manualBookingOverrides)
            || !this.hasFilledBookingSlotValue(slots.totalPrice)
            || !existingBill
            || !this.hasFilledBookingSlotValue(existingBill.total);

        if (nights !== null && Number.isFinite(roomPrice) && roomPrice > 0 && shouldRecalculateFinancials) {
            const subtotal = roomPrice * nights;
            const taxes = subtotal * taxRate;
            const total = subtotal + taxes;

            slots.totalPrice = Number(total.toFixed(2));
            merged.bill = {
                nights,
                subtotal: subtotal.toFixed(2),
                taxes: taxes.toFixed(2),
                total: total.toFixed(2),
                currencySymbol: merged?.selectedRoom?.currency === "USD" ? "$" : (merged?.selectedRoom?.currency || "INR"),
            };
        } else if (nights !== null && existingBill) {
            merged.bill = {
                ...existingBill,
                nights,
            };
        }

        merged.bookingSlots = slots;
    }

    private buildManualEditPrompt(): string {
        return this.pickLocalizedText({
            en: "You can manually enter or correct the room, guest name, and stay dates now. Tap save changes when you are ready.",
            hi: "अब आप room, guest name और stay dates को manually enter या correct कर सकते हैं। तैयार होने पर save changes पर tap कीजिए।",
            mr: "आता तुम्ही room, guest name आणि stay dates manually भरू किंवा दुरुस्त करू शकता. तयार झाल्यावर save changes वर tap करा.",
        });
    }

    private buildManualReviewPrompt(slots: Record<string, unknown>, roomLike?: any): string {
        const roomName = this.getCanonicalSelectedRoomLabel(roomLike) || String(slots.roomType || "").trim() || "your selected room";
        const adults = this.hasFilledBookingSlotValue(slots.adults) ? `${slots.adults} adult${Number(slots.adults) === 1 ? "" : "s"}` : "the guest count";
        const checkIn = this.formatSpeechDate(slots.checkInDate) || "the check in date";
        const checkOut = this.formatSpeechDate(slots.checkOutDate) || "the check out date";
        const guestName = this.hasFilledBookingSlotValue(slots.guestName) ? String(slots.guestName).trim() : "the guest name";

        return this.pickLocalizedText({
            en: `I updated the booking details. Room: ${roomName}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guestName}. Please review everything once more and continue when ready.`,
            hi: `मैंने booking details update कर दी हैं। Room: ${roomName}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guestName}. कृपया details एक बार फिर देख लीजिए और तैयार होने पर आगे बढ़िए।`,
            mr: `मी booking details update केल्या आहेत. Room: ${roomName}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guestName}. कृपया details पुन्हा एकदा पाहा आणि तयार झाल्यावर पुढे जा.`,
        });
    }

    private syncBookingFlowHints(merged: Record<string, any>): void {
        const slots = (merged.bookingSlots || {}) as Record<string, unknown>;
        const hasBookingContext = Boolean(merged.selectedRoom) || Object.keys(slots).length > 0;
        if (!hasBookingContext) {
            return;
        }

        const missingSlots = this.getMissingBookingSlots(slots);
        merged.missingSlots = missingSlots;

        const activeSlot = this.slotContext.activeSlot;
        if (activeSlot && this.hasFilledBookingSlotValue(slots[activeSlot])) {
            this.clearActiveSlot();
        }

        const hintedSlot = this.normalizeBookingSlotKey(merged.nextSlotToAsk);
        if (hintedSlot && !this.hasFilledBookingSlotValue(slots[hintedSlot])) {
            merged.nextSlotToAsk = hintedSlot;
            return;
        }

        merged.nextSlotToAsk = missingSlots.length > 0 ? missingSlots[0] : null;
    }

    private resolveNextBookingSlot(payload?: any): BookingSlotKey | null {
        const hinted = this.normalizeBookingSlotKey(payload?.nextSlotToAsk ?? this.viewData.nextSlotToAsk ?? this.slotContext.activeSlot);
        if (hinted) return hinted;

        const backendMissing = (payload?.missingSlots ?? this.viewData.missingSlots) as unknown;
        if (Array.isArray(backendMissing)) {
            for (const slot of BOOKING_SLOT_PRIORITY) {
                if (backendMissing.some((item) => this.normalizeBookingSlotKey(item) === slot)) {
                    return slot;
                }
            }
        }

        const localMissing = this.getMissingBookingSlotsFromState();
        return localMissing.length > 0 ? localMissing[0] : null;
    }

    private buildPromptForBookingSlot(slot: BookingSlotKey | null): string {
        const selectedRoomName = this.getCanonicalSelectedRoomLabel();
        switch (slot) {
            case "roomType":
                return this.pickLocalizedText({
                    en: "Please tell me which room you would like to book.",
                    hi: "कृपया बताइए, आप कौन सा room book करना चाहेंगे?",
                    mr: "कृपया सांगा, तुम्हाला कोणता room book करायचा आहे?",
                });
            case "adults":
                return selectedRoomName
                    ? this.pickLocalizedText({
                        en: `Great choice. ${selectedRoomName} is selected. How many adults will be staying?`,
                        hi: `बहुत बढ़िया। ${selectedRoomName} select हो गया है। कितने adults stay करेंगे?`,
                        mr: `छान निवड. ${selectedRoomName} select झाले आहे. किती adults stay करणार आहेत?`,
                    })
                    : this.pickLocalizedText({
                        en: "How many adults will be staying?",
                        hi: "कितने adults stay करेंगे?",
                        mr: "किती adults stay करणार आहेत?",
                    });
            case "checkInDate":
                return this.pickLocalizedText({
                    en: "What is your check in date?",
                    hi: "आपकी check in date क्या है?",
                    mr: "तुमची check in date काय आहे?",
                });
            case "checkOutDate":
                return this.pickLocalizedText({
                    en: "What is your check out date?",
                    hi: "आपकी check out date क्या है?",
                    mr: "तुमची check out date काय आहे?",
                });
            case "guestName":
                return this.pickLocalizedText({
                    en: "What name should I use for this booking?",
                    hi: "इस booking के लिए मैं कौन सा नाम उपयोग करूँ?",
                    mr: "या booking साठी मी कोणते नाव वापरू?",
                });
            case "children":
                return this.pickLocalizedText({
                    en: "How many children will be staying?",
                    hi: "कितने children stay करेंगे?",
                    mr: "किती children stay करणार आहेत?",
                });
            default:
                return this.buildBookingCollectPrompt();
        }
    }

    private maybeSpeakRoomSelectionGuidance(payload?: any): boolean {
        if (this.state !== "ROOM_SELECT") return false;
        if (!this.hasVoiceAuthority()) return false;
        if (TTSController.isSpeaking()) return false;
        if (payload?.suppressSpeech) return false;

        const backendSpeech = String(payload?.speech || "").trim();
        const roomList = Array.isArray(payload?.rooms) ? payload.rooms : [];
        const prompt = backendSpeech || (roomList.length > 0 ? this.buildRoomSelectionPrompt(roomList) : "");
        if (!prompt) return false;

        this.hasAnnouncedRoomOptions = true;
        this.setActiveSlot("roomType", "string", prompt);
        this.speak(prompt);
        return true;
    }

    private maybeSpeakBookingCollectGuidance(payload?: any, options?: { preferBackendSpeech?: boolean }): boolean {
        if (this.state !== "BOOKING_COLLECT") return false;
        if (!this.hasVoiceAuthority()) return false;
        if (TTSController.isSpeaking()) return false;

        const backendSpeech = String(payload?.speech || "").trim();
        const slot = this.resolveNextBookingSlot(payload);
        const fallbackPrompt = this.buildPromptForBookingSlot(slot);
        const prompt = options?.preferBackendSpeech && backendSpeech ? backendSpeech : fallbackPrompt;

        if (!prompt) return false;

        const fingerprint = `${slot || "none"}|${prompt.toLowerCase()}`;
        const now = Date.now();
        if (
            this.lastBookingPromptFingerprint === fingerprint &&
            now - this.lastBookingPromptAt < this.BOOKING_PROMPT_DEDUP_MS
        ) {
            return false;
        }

        if (slot && SLOT_EXPECTED_TYPE_MAP[slot]) {
            this.slotContext = {
                ...this.slotContext,
                activeSlot: slot,
                expectedType: SLOT_EXPECTED_TYPE_MAP[slot],
                promptAsked: prompt,
            };
        }

        this.lastBookingPromptFingerprint = fingerprint;
        this.lastBookingPromptAt = now;
        this.speak(prompt);
        return true;
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
        // TODO: If needed, move intent correction logic to backend classifier prompts/nodes.
        // Frontend should not rewrite backend intent decisions.
        return mappedIntent;
    }

    private isRoomInfoQuery(rawTranscript: string): boolean {
        const transcript = (rawTranscript || "").toLowerCase().trim();
        if (!transcript) return false;
        const asksAmenities = /(amenit|facility|feature|include|what.*have|what.*get|suvidha)/.test(transcript);
        const asksPrice = /(price|cost|rate|tariff|how much|per night|kimat)/.test(transcript);
        const asksCompare = /(compare|difference|each room|every room|all rooms|which room)/.test(transcript);
        return asksAmenities || asksPrice || asksCompare;
    }

    private maybeHandleRealtimeCommand(_transcript: string, _source: "partial" | "final" = "partial"): boolean {
        // [V2 DUMB FRONTEND] Realtime command interceptors disabled to prevent jumpy navigation.
        return false;
    }

    private resolveRoomFromHint(hint: unknown): any | null {
        if (!hint) return null;
        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) return null;

        const normalized = this.normalizeRoomHintText(hint);
        if (!normalized) return null;

        const roomText = (room: any) => this.normalizeRoomHintText(`${String(room?.name || "")} ${String(room?.code || "")}`);

        const byExactCode = rooms.find((room: any) => String(room?.code || "").toLowerCase() === normalized);
        if (byExactCode) return byExactCode;

        const byCode = rooms.find((room: any) => {
            const code = String(room?.code || "").toLowerCase();
            return Boolean(code) && (code.includes(normalized) || normalized.includes(code));
        });
        if (byCode) return byCode;

        const byName = rooms.find((room: any) => {
            const name = this.normalizeRoomHintText(room?.name || "");
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
            { pattern: /(suite|sweet)/, pick: (text) => text.includes("suite") },
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
        // TODO: Keep room Q&A backend-owned; frontend should render backend speech only.
        return false;
    }

    // HELPER: Map LLM "fuzzy" intents to Strict Machine Events
    private mapIntentToEvent(llmIntent: string): string {
        // Compatibility layer: backend owns intent meaning, frontend still translates that
        // intent into existing local FSM event names until state/event contracts fully converge.
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
                // [V2 DUMB FRONTEND] Do NOT map to RESET. The backend's nextUiScreen
                // controls screen changes. An IDLE intent just means "no specific action".
                return 'GENERAL_QUERY';
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

            const fastPathIntent = this.getFastPathIntent(transcript);
            if (fastPathIntent) {
                if (fastPathIntent === "CANCEL_REQUESTED" || fastPathIntent === "CANCEL_BOOKING") {
                    this.pendingCancelConfirmation = true;
                    this.speak("Are you sure you want to cancel? Please say yes or no.");
                    return;
                }
                this.dispatch(fastPathIntent, {
                    transcript,
                    room: this.viewData.selectedRoom || null,
                });
                return;
            }

            const requestId = ++this.llmRequestCounter;
            const requestState = this.state;
            const bookingStates: UiState[] = ['ROOM_SELECT', 'BOOKING_COLLECT', 'BOOKING_SUMMARY'];
            const targetUrl = bookingStates.includes(this.state)
                ? buildTenantApiUrl("chat/booking")
                : buildTenantApiUrl("chat");
            const backendCurrentState = normalizeStateForBackendChat(this.state);
            const tenantSlug = getTenantSlug();
            const activeLanguage = getCurrentTenantLanguage(this.language);
            const cacheKey = buildCacheKey(tenantSlug, transcript);
            const faqCacheEligible = shouldUseFaqCache(transcript, this.state);
            console.log(`[AgentAdapter][FAQCache] eligibility=${faqCacheEligible} key=${cacheKey}`);

            let decision: any;

            if (faqCacheEligible) {
                const cachedFaq = await getCachedFaqAnswer(tenantSlug, transcript);
                if (cachedFaq) {
                    decision = {
                        speech: cachedFaq.answer,
                        intent: "GENERAL_QUERY",
                        confidence: Math.max(cachedFaq.confidence, 0.92),
                        nextUiScreen: backendCurrentState,
                        accumulatedSlots: {},
                        extractedSlots: {},
                        missingSlots: [],
                        nextSlotToAsk: null,
                        selectedRoom: null,
                        isComplete: false,
                        answerSource: "FAQ_CACHE",
                        faqId: cachedFaq.faqId ?? null,
                        language: activeLanguage,
                    };
                    console.log(`[AgentAdapter][FAQCache] HIT key=${cacheKey} faqId=${decision.faqId || "none"}`);
                } else {
                    console.log(`[AgentAdapter][FAQCache] MISS key=${cacheKey}`);
                }
            }

            if (!decision) {
                // 1. Call backend brain with session ID for memory
                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getTenantHeaders() },
                    body: JSON.stringify({
                        transcript,
                        // Normalize here so backend never receives drifted/non-canonical state tokens.
                        currentState: backendCurrentState,
                        sessionId: sessionId || this.getSessionId(),
                        tenantSlug,
                        language: activeLanguage,
                        activeSlot: this.slotContext.activeSlot,
                        expectedType: this.slotContext.expectedType,
                        lastSystemPrompt: this.slotContext.promptAsked || undefined,
                        filledSlots: this.viewData.bookingSlots || {},
                    })
                });

                if (!response.ok) {
                    throw new Error(`LLM API error: ${response.status}`);
                }

                decision = await response.json();
                console.log("[AgentAdapter] /api/chat response:", decision);
                console.log(`[AgentAdapter] answerSource=${decision.answerSource || "missing"}`);
                if (decision.answerSource === "FAQ_DB") {
                    console.log(`[AgentAdapter][FAQCache] WRITE_PATH key=${cacheKey}`);
                    await putCachedFaqAnswer({
                        tenantSlug,
                        transcript,
                        answer: decision.speech,
                        faqId: decision.faqId ?? null,
                        confidence: decision.confidence,
                    });
                    console.log(`[AgentAdapter][FAQCache] STORED key=${cacheKey} faqId=${decision.faqId || "none"}`);
                }
            }
            if (requestId !== this.llmRequestCounter) {
                console.warn(
                    `[AgentAdapter] Ignoring stale LLM response (requestId=${requestId}, latest=${this.llmRequestCounter})`
                );
                return;
            }

            if (this.state !== requestState) {
                console.warn(
                    `[AgentAdapter] Ignoring stale LLM response for ${requestState}; current state is ${this.state}`
                );
                return;
            }

            console.log(`[AgentAdapter] LLM Decision:`, decision);

            // Sync language
            if (decision.language) {
                this.language = decision.language;
            }

            // 2. Map Fuzzy Intent -> Strict Event
            const rawIntent = decision.intent;
            let strictEvent = this.mapIntentToEvent(rawIntent);
            const backendSelectedRoom = decision?.selectedRoom || null;
            const slotRoomHint = decision?.accumulatedSlots?.roomType || decision?.extractedSlots?.roomType;
            let inferredRoom = this.state === "ROOM_SELECT"
                ? backendSelectedRoom
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

            // 3. Handle Transitions (Server-Driven)
            const serverState = normalizeBackendStateFromResponse(decision.nextUiScreen);
            if (decision.nextUiScreen && !serverState) {
                console.warn(`[AgentAdapter] Ignoring unknown backend nextUiScreen: ${decision.nextUiScreen}`);
            }
            const missingSlots = Array.isArray(decision?.missingSlots) ? decision.missingSlots : [];
            const hasBackendError = Boolean(decision?.error);
            const isIncomplete = decision?.isComplete === false || missingSlots.length > 0;

            if (strictEvent === "CONFIRM_BOOKING" && requestState === "BOOKING_SUMMARY") {
                // Any backend response for confirm should cancel the timeout guard.
                this.pendingConfirmToken = null;

                if (serverState === "BOOKING_COLLECT" && (isIncomplete || hasBackendError)) {
                    const errorMessage = decision?.error
                        || "Booking details are incomplete. Please modify and confirm again.";
                    this.applyPayloadData(strictEvent, {
                        ...decision,
                        error: errorMessage,
                        backendDecision: true,
                    }, requestState);
                    this.notifyListeners();
                    return;
                }
            }

            const isRegressiveConfirmTransition =
                strictEvent === "CONFIRM_BOOKING" &&
                serverState === "BOOKING_COLLECT" &&
                getBookingProgressRank(requestState) >= getBookingProgressRank("BOOKING_SUMMARY") &&
                !isIncomplete &&
                !hasBackendError;
            if (isRegressiveConfirmTransition) {
                console.warn(
                    `[AgentAdapter] Ignoring regressive confirm transition: ${requestState} -> ${serverState}`
                );
            }

            const willTransition = Boolean(
                serverState &&
                serverState !== this.state &&
                !isRegressiveConfirmTransition
            );

            // Execute Transition or Data Update
            if (willTransition && serverState) {
                // IMPORTANT: Do NOT speak before transitioning.
                // transitionTo() calls stopSpeaking() internally, which would kill the audio.
                console.log(`[AgentAdapter] Server directed transition: ${this.state} -> ${serverState}`);
                this.transitionTo(serverState, strictEvent, {
                    transcript,
                    ...decision,
                    nextUiScreen: serverState,
                    selectedRoom: backendSelectedRoom,
                    room: inferredRoom,
                    slots: decision.accumulatedSlots || decision.extractedSlots,
                    missingSlots: decision.missingSlots,
                    nextSlotToAsk: decision.nextSlotToAsk,
                    error: decision.error,
                    backendDecision: true,
                    backendSpeechSpoken: false,
                });
            } else {
                // No transition — speak the LLM response (conversational turn on same screen)
                const backendSpeechSpoken = Boolean(decision.speech);
                if (decision.speech) {
                    this.speak(decision.speech);
                }

                const hasBookingDelta = Boolean(
                    backendSelectedRoom ||
                    inferredRoom ||
                    decision.accumulatedSlots ||
                    decision.extractedSlots ||
                    decision.missingSlots ||
                    decision.nextSlotToAsk !== undefined
                );
                const shouldDispatch = strictEvent !== 'GENERAL_QUERY' || hasBookingDelta;

                if (shouldDispatch) {
                    this.dispatch(strictEvent as Intent, {
                        transcript,
                        llmIntent: rawIntent,
                        selectedRoom: backendSelectedRoom,
                        room: inferredRoom,
                        slots: decision.accumulatedSlots || decision.extractedSlots,
                        missingSlots: decision.missingSlots,
                        nextSlotToAsk: decision.nextSlotToAsk,
                        isComplete: decision.isComplete,
                        nextUiScreen: serverState || undefined,
                        error: decision.error,
                        backendDecision: true,
                        backendSpeechSpoken,
                        speech: decision.speech,
                    });
                }
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

    private releaseBackendChatSession(sessionId: string, reason: string, keepalive = false): void {
        const url = `${buildTenantApiUrl("chat")}/${encodeURIComponent(sessionId)}`;
        fetch(url, {
            method: "DELETE",
            headers: getTenantHeaders(),
            keepalive,
        }).then(() => {
            console.log(`[AgentAdapter] Backend chat session cleared (${reason}): ${sessionId}`);
        }).catch((error) => {
            console.warn(`[AgentAdapter] Failed to clear backend chat session (${reason}):`, error);
        });
    }

    private getSessionId(): string {
        if (!this.sessionId) {
            this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        return this.sessionId;
    }

    public getCurrentSessionId(): string {
        return this.getSessionId();
    }

    /**
     * Clear session for privacy (called on WELCOME transition).
     */
    public clearSession(reason = "manual_reset", options?: { keepalive?: boolean }): void {
        const sessionToClear = this.sessionId;
        this.sessionId = null;
        this.clearActiveSlot();
        if (sessionToClear) {
            this.releaseBackendChatSession(sessionToClear, reason, Boolean(options?.keepalive));
        }
        console.log(`[AgentAdapter] Session cleared for privacy (${reason})`);
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
        const voiceLocked = this.getVoiceLocked();
        const fullData = {
            ...this.viewData,
            slotContext: this.slotContext,
            metadata: {
                ...metadata,
                listening: this.hasVoiceAuthority(), // Approximate check
                interactionMode: this.interactionMode,
                pendingVoiceConfirm: this.pendingVoiceConfirm,
                voiceLocked
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
            case 'ID_VERIFY': return { currentStep: 2, totalSteps: 4, steps: ['ID Scan', 'Verify', 'Summary', 'Key'] };
            case 'CHECK_IN_SUMMARY': return { currentStep: 3, totalSteps: 4, steps: ['ID Scan', 'Verify', 'Summary', 'Key'] };
            case 'ROOM_SELECT': return { currentStep: 2, totalSteps: 4, steps };
            case 'PAYMENT': return { currentStep: 3, totalSteps: 4, steps };
            case 'COMPLETE': return { currentStep: 4, totalSteps: 4, steps };
            default: return this.viewData.progress ?? null;
        }
    }

    private applyPayloadData(intent: string, payload?: any, nextState?: UiState): void {
        const merged: Record<string, any> = { ...this.viewData };
        const resolvedState = nextState || this.state;

        if (!["ROOM_SELECT", "BOOKING_COLLECT", "BOOKING_SUMMARY", "PAYMENT"].includes(resolvedState)) {
            delete merged.manualBookingOverrides;
            delete merged.manualSelectedRoomOverride;
            this.manualEditModeActive = false;
        }

        if (nextState === "SCAN_ID" && (intent === "RESCAN" || intent === "CHECK_IN_SELECTED")) {
            merged.ocr = null;
            merged.matchedBooking = null;
            merged.multiplePossibleMatches = false;
        }

        if (payload?.room) {
            merged.selectedRoom = payload.room;
        }

        if (payload?.selectedRoom) {
            // Backend-selected room is authoritative for booking semantics.
            merged.selectedRoom = payload.selectedRoom;
        }

        if (payload && Object.prototype.hasOwnProperty.call(payload, "selectedRoom") && payload.selectedRoom === null) {
            merged.selectedRoom = null;
        }

        if (Array.isArray(payload?.rooms)) {
            merged.rooms = payload.rooms;
        }

        if (payload?.slots) {
            // Slot values come from backend extraction/validation, not transcript heuristics.
            merged.bookingSlots = { ...(merged.bookingSlots || {}), ...payload.slots };
            this.maybeClearFilledActiveSlot(payload.slots);
        }

        if (payload?.manualOverride) {
            merged.manualBookingOverrides = {
                ...(merged.manualBookingOverrides || {}),
                ...this.pickFilledManualOverrides(payload.slots),
            };
            if (payload?.selectedRoom || payload?.room) {
                merged.manualSelectedRoomOverride = payload.selectedRoom || payload.room;
            }
        }

        this.applyStoredManualBookingOverrides(merged);

        const selectedRoomLabelBeforeSlotSync = this.getCanonicalSelectedRoomLabel(merged.selectedRoom);
        if (merged?.bookingSlots?.roomType == null && selectedRoomLabelBeforeSlotSync) {
            merged.bookingSlots = {
                ...(merged.bookingSlots || {}),
                roomType: selectedRoomLabelBeforeSlotSync,
            };
        }
        if (merged?.bookingSlots?.roomType == null && !selectedRoomLabelBeforeSlotSync) {
            merged.selectedRoom = null;
        }

        const selectedRoomDisplay = this.getCanonicalSelectedRoomLabel(merged.selectedRoom);
        if (selectedRoomDisplay) {
            merged.selectedRoom = {
                ...(merged.selectedRoom || {}),
                name: selectedRoomDisplay,
                displayName: selectedRoomDisplay,
            };
            merged.bookingSlots = {
                ...(merged.bookingSlots || {}),
                roomType: selectedRoomDisplay,
            };
        } else if (merged?.bookingSlots?.roomType) {
            const resolvedRoom = this.resolveRoomFromHint(merged.bookingSlots.roomType);
            if (resolvedRoom?.name) {
                const canonicalName = String(resolvedRoom.name).trim();
                merged.selectedRoom = {
                    ...(merged.selectedRoom || {}),
                    ...resolvedRoom,
                    name: canonicalName,
                    displayName: canonicalName,
                };
                merged.bookingSlots = {
                    ...(merged.bookingSlots || {}),
                    roomType: canonicalName,
                };
            }
        }

        if (payload?.missingSlots !== undefined) {
            merged.missingSlots = Array.isArray(payload.missingSlots)
                ? payload.missingSlots.map((slot: unknown) => this.normalizeBookingSlotKey(slot) || slot)
                : payload.missingSlots;
        }

        if (payload?.nextSlotToAsk !== undefined) {
            const hintedSlot = this.normalizeBookingSlotKey(payload.nextSlotToAsk);
            merged.nextSlotToAsk = hintedSlot || payload.nextSlotToAsk;
            if (hintedSlot && SLOT_EXPECTED_TYPE_MAP[hintedSlot]) {
                this.slotContext = {
                    ...this.slotContext,
                    activeSlot: hintedSlot,
                    expectedType: SLOT_EXPECTED_TYPE_MAP[hintedSlot],
                };
            }
        }

        if (payload?.ocr !== undefined) {
            merged.ocr = payload.ocr || null;
        }
        if (payload?.matchedBooking !== undefined) {
            merged.matchedBooking = payload.matchedBooking || null;
        }
        if (payload?.multiplePossibleMatches !== undefined) {
            merged.multiplePossibleMatches = Boolean(payload.multiplePossibleMatches);
        }
        if (payload?.ocrDemo !== undefined) {
            merged.ocrDemo = Boolean(payload.ocrDemo);
        }

        if (payload?.error !== undefined) {
            merged.bookingError = payload.error || null;
        } else if (payload?.backendDecision) {
            // Clear stale error when a new backend turn does not carry an error.
            merged.bookingError = null;
        }

        if (payload && Object.prototype.hasOwnProperty.call(payload, "persistedBookingId")) {
            merged.persistedBookingId = payload.persistedBookingId || null;
        }

        if (payload && Object.prototype.hasOwnProperty.call(payload, "assignedRoomId")) {
            merged.assignedRoomId = payload.assignedRoomId || null;
        }

        if (payload && Object.prototype.hasOwnProperty.call(payload, "assignedRoomNumber")) {
            merged.assignedRoomNumber = payload.assignedRoomNumber || null;
        }

        this.syncDerivedBookingData(merged);
        this.syncBookingFlowHints(merged);

        const progressState = resolvedState;
        merged.progress = this.getProgress(progressState);
        this.viewData = merged;
    }

    private resetInactivityTimer(): void {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }

        if (this.state === "IDLE") return;

        // SCAN_ID needs a longer dwell window so users can align and scan their ID.
        const timeoutMs = this.state === "SCAN_ID"
            ? Math.max(this.INACTIVITY_TIMEOUT_MS, 60 * 1000)
            : this.INACTIVITY_TIMEOUT_MS;

        this.inactivityTimer = setTimeout(() => {
            console.warn("[AgentAdapter] Inactivity timeout reached. Returning to IDLE.");
            this.hardStopAll();
            this.state = "IDLE";
            this.notifyListeners();
        }, timeoutMs);
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
            const machineResolved = StateMachine.transition(currentState as UIState, intent as any) as UiState;
            if (machineResolved !== currentState) {
                return machineResolved;
            }
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

        if (intent === "VOICE_MODE_REQUESTED") {
            if (this.interactionMode === "voice") {
                this.setInteractionMode("voice", {
                    pendingVoiceConfirm: false,
                    reason: intent
                });
                if (this.hasVoiceAuthority()) {
                    this.scheduleListeningRestart(120, "state_transition");
                }
                this.notifyListeners();
                return;
            }

            this.setInteractionMode("manual", {
                pendingVoiceConfirm: true,
                reason: intent
            });
            this.notifyListeners();
            return;
        }

        if (intent === "VOICE_MODE_CONFIRMED") {
            this.setInteractionMode("voice", {
                pendingVoiceConfirm: false,
                reason: intent
            });
            if (this.hasVoiceAuthority()) {
                this.scheduleListeningRestart(120, "state_transition");
            }
            this.notifyListeners();
            return;
        }

        if (intent === "VOICE_MODE_CANCELLED") {
            this.setInteractionMode("manual", {
                pendingVoiceConfirm: false,
                reason: intent
            });
            this.notifyListeners();
            return;
        }

        if (intent === "MANUAL_MODE_REQUESTED") {
            this.setInteractionMode("manual", {
                pendingVoiceConfirm: false,
                reason: intent
            });
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop();
            VoiceRuntime.hardStopAll();
            this.notifyListeners();
            return;
        }

        if (intent === "BOOKING_FIELDS_EDIT_STARTED" && this.state === "BOOKING_COLLECT") {
            this.manualEditModeActive = true;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop();
            VoiceRuntime.stopListening();
            if (this.interactionMode === "voice") {
                this.speak(this.buildManualEditPrompt());
            }
            return;
        }

        if (intent === "BOOKING_FIELDS_EDIT_CANCELLED" && this.state === "BOOKING_COLLECT") {
            this.manualEditModeActive = false;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            if (this.hasVoiceAuthority()) {
                this.scheduleListeningRestart(300, "state_transition");
            }
            return;
        }

        if (intent === "BOOKING_FIELDS_UPDATED" && this.state === "BOOKING_COLLECT") {
            console.log("[AgentAdapter] Applying manual booking field overrides.");
            this.manualEditModeActive = false;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop();
            VoiceRuntime.stopListening();
            this.applyPayloadData(intent, payload, this.state);
            this.notifyListeners();
            if (this.interactionMode === "voice") {
                this.speak(this.buildManualReviewPrompt(this.getBookingSlots(), this.viewData.selectedRoom));
            }
            return;
        }

        // BOOKING_SUMMARY touch-confirm should use the same backend confirmation path as voice.
        // This keeps persistence + transition semantics unified while preserving touch fallback.
        if (intent === "CONFIRM_PAYMENT" && this.state === "BOOKING_SUMMARY") {
            console.log("[AgentAdapter] BOOKING_SUMMARY touch confirm -> backend CONFIRM_BOOKING turn");
            const expectedState = this.state;
            const token = ++this.confirmRequestCounter;
            this.pendingConfirmToken = token;
            void this.processWithLLMBrain("confirm booking", this.getSessionId());
            setTimeout(() => {
                if (this.pendingConfirmToken !== token) return;
                if (this.state === expectedState && !this.viewData?.bookingError) {
                    console.warn("[AgentAdapter] Backend confirm timeout; staying on BOOKING_SUMMARY");
                    this.applyPayloadData("CONFIRM_PAYMENT", {
                        backendDecision: true,
                        error: "Booking confirmation timed out. Please confirm again."
                    }, this.state);
                    this.notifyListeners();
                }
            }, 2200);
            return;
        }

        // Never allow payment completion without a confirmed persisted booking id.
        if (intent === "CONFIRM_PAYMENT" && this.state === "PAYMENT" && !this.viewData?.persistedBookingId) {
            console.warn("[AgentAdapter] Blocking PAYMENT confirmation: missing persistedBookingId");
            this.applyPayloadData("CONFIRM_PAYMENT", {
                backendDecision: true,
                error: "Booking is not confirmed in backend yet. Please confirm booking again."
            }, "BOOKING_SUMMARY");
            this.transitionTo("BOOKING_SUMMARY", "BACK_REQUESTED", {
                error: "Booking is not confirmed in backend yet. Please confirm booking again."
            });
            return;
        }

        // 1. TOUCH AUTHORITY CHECK ðŸ›¡ï¸
        const INTERRUPT_INTENTS = [
            "CHECK_IN_SELECTED", "BOOK_ROOM_SELECTED",
            "HELP_SELECTED", "SCAN_COMPLETED",
            "ROOM_SELECTED", "CONFIRM_PAYMENT",
            "BACK_REQUESTED", "RESET", "TOUCH_SELECTED",
            "CANCEL_REQUESTED", "PROXIMITY_DETECTED",
            "SCAN_ID_SELECTED", "PAYMENT_SELECTED"
        ];

        if (intent === "PROXIMITY_DETECTED" && this.state === "IDLE") {
            this.setInteractionMode("voice", {
                pendingVoiceConfirm: false,
                reason: intent
            });
        }

        if (intent === "TOUCH_SELECTED" && this.state === "WELCOME") {
            this.setInteractionMode("manual", {
                pendingVoiceConfirm: false,
                reason: intent
            });
        }

        if (INTERRUPT_INTENTS.includes(intent)) {
            console.log("[AgentAdapter] ðŸ‘† Touch Interrupt detected. Killing Audio.");
            this.resetVoiceLifecycle(`interrupt:${intent}`);
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
                !payload?.suppressSpeech &&
                !this.hasAnnouncedRoomOptions
            ) {
                this.maybeSpeakRoomSelectionGuidance(payload);
            }
            console.log(`[AgentAdapter] No Transition: ${this.state} + ${intent} -> ${nextState}`);
        }
    }

    // === Phase 11.8: Enterprise Hardening ===
    private hasProcessedTranscript = false;

    /**
     * Internal transition helper to handle side-effects
     */
    private transitionTo(nextState: UiState, intent?: string, payload?: any) {
        console.log(`[Mediator] Requesting: ${this.state} -> ${nextState}`);

        if (nextState === "ROOM_SELECT") {
            // Warm room inventory so ROOM_SELECT can render without waiting on a cold request.
            if (typeof RoomService.prefetchAvailableRooms === "function") {
                void RoomService.prefetchAvailableRooms();
            } else {
                void RoomService.getAvailableRooms().catch((error) => {
                    console.warn("[AgentAdapter] Room prefetch fallback failed:", error);
                });
            }
        }

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
        this.clearKeyDispenseTimer(`transition:${previousState}->${nextState}`);
        this.state = nextState;

        if (this.pendingVoiceConfirm) {
            this.setInteractionMode(this.interactionMode, {
                pendingVoiceConfirm: false,
                reason: `transition:${previousState}->${nextState}`
            });
        }

        if (nextState === "MANUAL_MENU") {
            this.setInteractionMode("manual", {
                pendingVoiceConfirm: false,
                reason: `transition:${previousState}->${nextState}`
            });
        } else if (nextState === "AI_CHAT") {
            this.setInteractionMode("voice", {
                pendingVoiceConfirm: false,
                reason: `transition:${previousState}->${nextState}`
            });
        } else if (nextState === "IDLE") {
            this.setInteractionMode("voice", {
                pendingVoiceConfirm: false,
                reason: `transition:${previousState}->${nextState}`
            });
        } else if (previousState === "IDLE" && nextState === "WELCOME") {
            this.setInteractionMode("voice", {
                pendingVoiceConfirm: false,
                reason: `transition:${previousState}->${nextState}`
            });
        }

        if (nextState === "WELCOME" || nextState === "IDLE") {
            this.clearSession(`transition:${previousState}->${nextState}`);
        }
        if (nextState !== "BOOKING_COLLECT") {
            this.clearActiveSlot();
            this.lastBookingPromptFingerprint = null;
            this.lastBookingPromptAt = 0;
        }
        this.applyPayloadData(intent || 'UNKNOWN', payload, nextState);
        this.resetInactivityTimer();
        this.hasAnnouncedRoomOptions = false;

        console.log(`[AgentAdapter] State Transition: ${previousState} -> ${this.state}`);

        // [V2] Adaptive Timeouts (UX Enhancement) - Give more time on complex screens
        if (["ROOM_SELECT", "BOOKING_COLLECT", "PAYMENT"].includes(nextState)) {
            VoiceRuntime.updateTimeouts(10000, 15000); // 10s no-speech, 15s no-result
        } else {
            // Defaults are restored in VoiceRuntime.setMode("idle") when session ends,
            // but for state-to-state transitions we might want to reset explicitly too.
            VoiceRuntime.updateTimeouts(8000, 12000);
        }

        // Phase 9.4.1: On state change, stop any active TTS and listening
        this.resetVoiceLifecycle(`transition:${previousState}->${nextState}`);
        VoiceRuntime.stopSpeaking();
        VoiceRuntime.stopListening();

        // Notify Listeners
        this.notifyListeners();

        const spokeRoomGuidance = this.state === "ROOM_SELECT"
            ? this.maybeSpeakRoomSelectionGuidance(payload)
            : false;
        const spokeBookingGuidance = this.state === "BOOKING_COLLECT"
            ? this.maybeSpeakBookingCollectGuidance(payload, { preferBackendSpeech: true })
            : false;

        // [V2 DUMB FRONTEND] Speech is now primarily handled by the backend response.
        // Exception: The initial WELCOME greeting is a frontend concern (no backend call yet).
        if (this.hasVoiceAuthority()) {
            if (nextState === 'WELCOME' && previousState === 'IDLE') {
                // First contact: Greet the guest, THEN listen.
                const tenantName = getTenant()?.name || "our hotel";
                const greeting = this.pickLocalizedText({
                    en: `Welcome to ${tenantName}. How may I assist you today?`,
                    hi: `${tenantName} में आपका स्वागत है। मैं आज आपकी कैसे सहायता कर सकती हूँ?`,
                    mr: `${tenantName} मध्ये तुमचे स्वागत आहे. आज मी तुमची कशी मदत करू शकते?`,
                });
                this.speak(greeting);
                // VoiceRuntime will start listening automatically after TTS ends (via TTS_ENDED handler)
            } else if (!spokeRoomGuidance && !spokeBookingGuidance) {
                // No guided prompt was spoken on this transition, so bootstrap listening directly.
                // If TTS is in-flight, TTS lifecycle owns the restart path.
                this.scheduleListeningRestart(500, "state_transition");
            } else {
                console.debug("[AgentAdapter] Transition guidance spoken; waiting for TTS lifecycle to restart listening.");
            }
        }

        if (nextState === "KEY_DISPENSING") {
            this.scheduleKeyDispenseCompletion();
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

        // If the booking brain indicates the slots are complete, force the transition
        // to CONFIRM_BOOKING so we don't get stuck on BOOKING_COLLECT if the intent
        // was just a slot-reporting intent (e.g. PROVIDE_NAME).
        let effectiveIntent = intent;
        if (
            payload?.isComplete === true &&
            !payload?.backendDecision &&
            this.state === "BOOKING_COLLECT" &&
            intent !== "CANCEL_BOOKING" &&
            intent !== "BACK_REQUESTED"
        ) {
            effectiveIntent = "CONFIRM_BOOKING";
        }

        // 2. CALCULATE TRANSITION (Centralized State Machine)
        const nextState = this.resolveNextStateFromIntent(this.state, effectiveIntent);

        if (nextState !== this.state) {
            // We can check if we should speak here.
            // But for now, just transition.
            this.transitionTo(nextState, effectiveIntent, payload);
        } else {
            this.applyPayloadData(effectiveIntent, payload, nextState);
            this.notifyListeners();
            if (
                this.state === "BOOKING_COLLECT" &&
                payload?.backendDecision &&
                payload?.backendSpeechSpoken !== true
            ) {
                this.maybeSpeakBookingCollectGuidance(payload, { preferBackendSpeech: true });
            }
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
     * AI captions are emitted from TTS lifecycle events for better sync.
     */
    public speak(text: string): void {
        if (this.interactionMode !== "voice") {
            console.debug("[AgentAdapter] Speech suppressed (manual interaction mode)");
            return;
        }
        this.maybeTrackSlotFromPrompt(text);
        this.pendingAiSpeechText = text;
        void VoiceRuntime.speak(text, getCurrentTenantLanguage(this.language));
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
        this.resetVoiceLifecycle("hard_stop_all");
        this.clearKeyDispenseTimer("hard_stop_all");
        this.clearSession("hard_stop_all");
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
        const voiceLocked = this.getVoiceLocked();
        const fullData = {
            ...this.viewData,
            slotContext: this.slotContext,
            metadata: {
                ...metadata,
                listening: this.hasVoiceAuthority(),
                interactionMode: this.interactionMode,
                pendingVoiceConfirm: this.pendingVoiceConfirm,
                voiceLocked
            }
        };
        this.listeners.forEach(listener => listener(this.state, fullData));
    }

    // debug / testing utility to force reset if needed
    public _reset() {
        this.state = "IDLE";
        this.setInteractionMode("voice", {
            pendingVoiceConfirm: false,
            reason: "reset"
        });
        this.manualEditModeActive = false;
        this.lastIntent = null;
        this.lastIntentTime = 0;
        this.intentTimestamps = [];
        this.clearActiveSlot();
        this.notifyListeners();
    }

    /**
     * Destroy this instance — clear all listeners and timers.
     * Called during HMR to prevent ghost instances.
     */
    public destroy(): void {
        // Unsubscribe from VoiceRuntime and TTSController listener arrays
        this.disposers.forEach(unsub => unsub());
        this.disposers = [];
        // Clear own UI state listeners
        this.listeners = [];
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
        if (this.listeningRestartTimer) {
            clearTimeout(this.listeningRestartTimer);
            this.listeningRestartTimer = null;
        }
        if (this.silenceReengageTimer) {
            clearTimeout(this.silenceReengageTimer);
            this.silenceReengageTimer = null;
        }
        if (this.keyDispenseCompleteTimer) {
            clearTimeout(this.keyDispenseCompleteTimer);
            this.keyDispenseCompleteTimer = null;
        }
        console.log("[AgentAdapter] Destroyed (HMR cleanup)");
    }

}

export const AgentAdapter = new AgentAdapterService();

// Vite HMR: Clean up old instance before replacement
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        AgentAdapter.destroy();
    });
}
