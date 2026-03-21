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

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Delays (ms) — all magic numbers named in one place */
const DELAY = {
    TTS_ENDED_RESTART:        600,
    TTS_ERROR_RESTART:        900,
    WELCOME_GREETING_LISTEN:  500,
    STATE_TRANSITION_LISTEN:  500,
    VOICE_MODE_LISTEN:        120,
    BOOKING_FIELDS_LISTEN:    300,
    CANCEL_SPEAK_DELAY:       3000,
    CONFIRM_TIMEOUT:          2200,
    POST_BRAIN_IDLE:          500,
    KEY_DISPENSE_SIM:         3500,
    SILENCE_REENGAGE_COOLDOWN: 12000,
} as const;

const TIMEOUT = {
    INACTIVITY:               2 * 60 * 1000,
    SCAN_ID_INACTIVITY:       60 * 1000,
    COMPLEX_SCREEN_NO_SPEECH: 10000,
    COMPLEX_SCREEN_NO_RESULT: 15000,
    DEFAULT_NO_SPEECH:        8000,
    DEFAULT_NO_RESULT:        12000,
} as const;

const RATE_LIMIT = {
    COOLDOWN_MS:       600,
    BURST_MAX:         6,
    BURST_WINDOW_MS:   12000,
} as const;

const DEDUP = {
    INTENT_WINDOW_MS:         800,
    REALTIME_INTENT_MS:       1500,
    BOOKING_PROMPT_MS:        3500,
} as const;

const CONFIDENCE = {
    HIGH_THRESHOLD: 0.85,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// STATE CONFIGURATION (single source of truth — replaces two separate maps)
// ─────────────────────────────────────────────────────────────────────────────

interface StateConfig {
    voiceAllowed: boolean;
    faqCacheAllowed: boolean;
}

const STATE_CONFIG: Record<UiState, StateConfig> = {
    IDLE:              { voiceAllowed: false, faqCacheAllowed: true  },
    WELCOME:           { voiceAllowed: true,  faqCacheAllowed: true  },
    AI_CHAT:           { voiceAllowed: true,  faqCacheAllowed: true  },
    MANUAL_MENU:       { voiceAllowed: true,  faqCacheAllowed: true  },
    SCAN_ID:           { voiceAllowed: false, faqCacheAllowed: false },
    ID_VERIFY:         { voiceAllowed: false, faqCacheAllowed: false },
    CHECK_IN_SUMMARY:  { voiceAllowed: false, faqCacheAllowed: false },
    ROOM_SELECT:       { voiceAllowed: true,  faqCacheAllowed: false },
    ROOM_PREVIEW:      { voiceAllowed: true,  faqCacheAllowed: false },
    BOOKING_COLLECT:   { voiceAllowed: true,  faqCacheAllowed: false },
    BOOKING_SUMMARY:   { voiceAllowed: true,  faqCacheAllowed: false },
    PAYMENT:           { voiceAllowed: true,  faqCacheAllowed: false },
    KEY_DISPENSING:    { voiceAllowed: false, faqCacheAllowed: false },
    COMPLETE:          { voiceAllowed: false, faqCacheAllowed: false },
    ERROR:             { voiceAllowed: false, faqCacheAllowed: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const PATTERN = {
    TRANSACTIONAL_CHECK_IN: /\b(i want to check[\s-]?in|check me in|start check[\s-]?in|begin check[\s-]?in)\b/i,
    TRANSACTIONAL_BOOKING:  /\b(confirm booking|cancel booking|modify booking|book a room|make a booking|start booking|reserve a room)\b/i,
    FAQ_INFO:               /\b(what|when|where|which|how|time|timing|hours?|breakfast|wifi|parking|pool|check[\s-]?(in|out)|check and|second time|checking time)\b/i,
    ROOM_COMPARISON:        /(compare|comparison|difference|versus|vs\.?|which\s+(?:room|one)\s+is\s+better|which\s+is\s+better|better\s+for)/,
    ROOM_AMENITIES:         /(amenit|facility|feature|include|what.*have|what.*get|suvidha)/,
    ROOM_PRICE:             /(price|cost|rate|tariff|how much|per night|kimat)/,
    ALL_ROOMS_QUERY:        /(each room|every room|all rooms|which room)/,
    ROOM_SELECTION_VERB:    /\b(book|choose|select|want|would like|take|prefer|change)\b/,
    EXPLICIT_ROOM_CHANGE:   /\b(another|different|other|change|switch|instead)\b/,
    ROOM_CHANGE_OBJECT:     /\b(room|one|option|preview|show)\b/,
    BOOK_ANOTHER:           /\bi want to book another room\b/,
    SHOW_ANOTHER:           /\bshow me another room\b/,
    AFFIRMATIVE:            /\b(yes|yeah|yep|confirm|sure|ok|okay|proceed|cancel it|do it|haan|han|ji|correct)\b/,
    NEGATIVE:               /\b(no|nope|dont|don't|not now|continue|resume|go on|nah|nahi|mat)\b/,
    CONFIRM_PREVIEW:        /^\s*(yes|yeah|yep|sure|ok|okay|haan|han|ji|correct|looks good|sounds good|that works|go ahead|proceed)(?:\s+please)?\s*[.!?]*\s*$/,
    CONFIRM_PREVIEW_VERB:   /\b(book (?:this|it)|book this room|i(?: would|'d)? like (?:this|it)|i want (?:this|it)(?: room)?|take (?:this|it)|confirm(?: the)? booking|proceed with (?:this|it)|continue with (?:this|it))\b/,
    GENERIC_FALLBACK_SPEECH: /i'?m not sure how to help with that|please use the touch screen|system issue|i could not confirm/i,
    ESCALATION_URGENT:      /manager|human|supervisor|emergency|shutup|shut up/,
    ESCALATION_FRUSTRATED:  /stupid|hate|broken|doesn't work|confused|ridiculous|slow|shit|damn|useless|wrong/,
    POSITIVE_SENTIMENT:     /thanks|good|great|cool|perfect/,
} as const;

const OPEN_FULLSCREEN_PATTERN  = /\b(open|show|see|view)\b.{0,20}\b(full\s*(?:screen|view|photo|image|size)|fullscreen)\b/i;
const CLOSE_FULLSCREEN_PATTERN = /\b(close|exit|dismiss|go\s+back|hide)\b.{0,20}\b(full\s*(?:screen|view|photo|image|preview|size)|fullscreen|preview)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
    | "roomType" | "adults" | "children"
    | "checkInDate" | "checkOutDate" | "guestName";

export type BookingSlotExpectedType = "number" | "date" | "string";

export interface SlotContext {
    activeSlot: BookingSlotKey | null;
    expectedType: BookingSlotExpectedType | null;
    promptAsked: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING SLOT METADATA
// ─────────────────────────────────────────────────────────────────────────────

const SLOT_EXPECTED_TYPE_MAP: Record<BookingSlotKey, BookingSlotExpectedType> = {
    roomType:    "string",
    adults:      "number",
    children:    "number",
    checkInDate: "date",
    checkOutDate:"date",
    guestName:   "string",
};

const BOOKING_SLOT_PRIORITY: BookingSlotKey[] = [
    "roomType", "adults", "children", "checkInDate", "checkOutDate", "guestName",
];

const SLOT_KEY_ALIAS_MAP: Record<string, BookingSlotKey> = {
    roomtype:      "roomType",
    room_type:     "roomType",
    adults:        "adults",
    children:      "children",
    checkindate:   "checkInDate",
    check_in_date: "checkInDate",
    checkoutdate:  "checkOutDate",
    check_out_date:"checkOutDate",
    guestname:     "guestName",
    guest_name:    "guestName",
};

const SLOT_TO_INTENT_MAP: Record<BookingSlotKey, string> = {
    roomType:    "SELECT_ROOM",
    adults:      "PROVIDE_GUESTS",
    children:    "PROVIDE_GUESTS",
    checkInDate: "PROVIDE_DATES",
    checkOutDate:"PROVIDE_DATES",
    guestName:   "PROVIDE_NAME",
};

const SLOT_PROMPT_LOOKUP: Array<{
    slot: BookingSlotKey;
    expectedType: BookingSlotExpectedType;
    prompts: string[];
}> = [
    {
        slot: "roomType", expectedType: "string",
        prompts: [
            "which room would you like to book",
            "please tell me which room you would like to book",
            "would you like to book it",
        ],
    },
    { slot: "adults",      expectedType: "number", prompts: ["how many adults will be staying"] },
    { slot: "children",    expectedType: "number", prompts: ["how many children will be staying"] },
    {
        slot: "checkInDate", expectedType: "date",
        prompts: [
            "please tell me your check in and check out dates",
            "what is your check in date",
        ],
    },
    { slot: "checkOutDate", expectedType: "date",   prompts: ["what is your check out date"] },
    {
        slot: "guestName",  expectedType: "string",
        prompts: [
            "what name should i use for this booking",
            "what name should i use for the booking",
        ],
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPER FUNCTIONS (stateless — moved out of the class)
// ─────────────────────────────────────────────────────────────────────────────

function shouldUseFaqCache(transcript: string, currentState: UiState): boolean {
    const cleaned = (transcript || "").trim();
    if (!cleaned) return false;
    if (!STATE_CONFIG[currentState]?.faqCacheAllowed) return false;
    if (PATTERN.TRANSACTIONAL_CHECK_IN.test(cleaned)) return false;
    if (PATTERN.TRANSACTIONAL_BOOKING.test(cleaned)) return false;
    if (!PATTERN.FAQ_INFO.test(cleaned)) return false;
    return true;
}

function getBookingProgressRank(state: UiState): number {
    const ranks: Partial<Record<UiState, number>> = {
        ROOM_SELECT:     1,
        ROOM_PREVIEW:    2,
        BOOKING_COLLECT: 3,
        BOOKING_SUMMARY: 4,
        PAYMENT:         5,
        KEY_DISPENSING:  6,
        COMPLETE:        7,
    };
    return ranks[state] ?? 0;
}

function formatSpokenList(items: string[]): string {
    const clean = items.map(s => String(s || "").trim()).filter(Boolean);
    if (clean.length === 0) return "";
    if (clean.length === 1) return clean[0];
    if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
    return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function formatRoomFeatureLabel(featureLike: unknown): string {
    const feature = String(featureLike || "").trim();
    if (!feature) return "";
    const normalized = feature.toLowerCase();
    if (normalized === "wifi") return "Wi-Fi";
    if (normalized === "tv") return "TV";
    return feature;
}

function normalizeCaptionFragment(textLike: unknown): string {
    const raw = String(textLike || "").trim().replace(/[.]+$/g, "");
    if (!raw) return "";
    return raw.charAt(0).toLowerCase() + raw.slice(1);
}

function humanizeVisualLabel(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

function formatSpeechDate(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" });
}

function hasFilledValue(value: unknown): boolean {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT ADAPTER SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class AgentAdapterService {
    // ── Core state ────────────────────────────────────────────────────────────
    private state: UiState = "IDLE";
    private viewData: Record<string, any> = {};
    private language: string = "en";

    // ── Listeners ─────────────────────────────────────────────────────────────
    /** Use Set for O(1) add/delete; prevents double-registration leaks */
    private listeners = new Set<(state: UiState, data?: any) => void>();
    private transcriptListeners = new Set<(text: string, isFinal: boolean, source: 'user' | 'ai') => void>();
    private disposers: (() => void)[] = [];

    // ── Intent dedup & rate limiting ─────────────────────────────────────────
    private lastIntent: string | null = null;
    private lastIntentTime  = 0;
    private intentTimestamps: number[] = [];

    // ── Emotion engine ────────────────────────────────────────────────────────
    private frustrationScore     = 0;
    private frustrationThreshold = 2;

    // ── Voice lifecycle ───────────────────────────────────────────────────────
    private voiceLifecycleEpoch    = 0;
    private reengageCooldownUntil  = 0;
    private suppressFinalTranscriptUntil = 0;
    private hasProcessedTranscript = false;
    private hasAnnouncedRoomOptions = false;

    // ── Interaction mode ──────────────────────────────────────────────────────
    private interactionMode: InteractionMode = "voice";
    private pendingVoiceConfirm  = false;
    private manualEditModeActive = false;

    // ── Slot context ──────────────────────────────────────────────────────────
    private slotContext: SlotContext = { activeSlot: null, expectedType: null, promptAsked: "" };

    // ── Pending / in-flight flags ─────────────────────────────────────────────
    private pendingCancelConfirmation = false;
    private pendingVoiceConfirmPending = false; // alias clarity
    private lastRealtimeIntent: Intent | null = null;
    private lastRealtimeIntentAt = 0;
    private pendingAiSpeechText: string | null = null;
    private lastBookingPromptFingerprint: string | null = null;
    private lastBookingPromptAt = 0;
    private lastVisualPreviewCategory: string | null = null;

    // ── Request counters (stale-response guards) ──────────────────────────────
    private llmRequestCounter     = 0;
    private confirmRequestCounter = 0;
    private pendingConfirmToken: number | null = null;
    /** AbortController for the in-flight LLM fetch — cancels the network request */
    private currentLLMAbort: AbortController | null = null;

    // ── Timers ────────────────────────────────────────────────────────────────
    private inactivityTimer:          ReturnType<typeof setTimeout> | null = null;
    private listeningRestartTimer:    ReturnType<typeof setTimeout> | null = null;
    private silenceReengageTimer:     ReturnType<typeof setTimeout> | null = null;
    private keyDispenseCompleteTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Session ───────────────────────────────────────────────────────────────
    private sessionId: string | null = null;

    // ─────────────────────────────────────────────────────────────────────────
    constructor() {
        console.log("[AgentAdapter] Initialized (Optimized)");
        VoiceRuntime.setCurrentScreen(this.state);

        const unsubVoice = VoiceRuntime.subscribe(this.handleVoiceEvent.bind(this));
        this.disposers.push(unsubVoice);

        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === "TTS_STARTED") {
                this.clearListeningRestartTimer("tts_started");
                this.clearSilenceReengageTimer("tts_started");
                if (event.text?.trim()) this.emitTranscript(event.text, true, 'ai');
                this.pendingAiSpeechText = null;
            }
            if (event.type === "TTS_ENDED") {
                this.pendingAiSpeechText = null;
                this.handleTTSEnded("ended");
            }
            if (event.type === "TTS_ERROR") {
                const fallback = (event.text || this.pendingAiSpeechText || "").trim();
                if (fallback) this.emitTranscript(fallback, true, 'ai');
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

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE HELPERS — listener data builder (single source of truth)
    // ─────────────────────────────────────────────────────────────────────────

    private buildFullData(): Record<string, any> {
        const metadata = StateMachine.getMetadata(this.state as UIState);
        return {
            ...this.viewData,
            slotContext: this.slotContext,
            metadata: {
                ...metadata,
                listening:           this.hasVoiceAuthority(),
                interactionMode:     this.interactionMode,
                pendingVoiceConfirm: this.pendingVoiceConfirm,
                voiceLocked:         this.getVoiceLocked(),
            },
        };
    }

    private notifyListeners(): void {
        const data = this.buildFullData();
        this.listeners.forEach(l => l(this.state, data));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SENTIMENT ENGINE
    // ─────────────────────────────────────────────────────────────────────────

    private analyzeSentiment(text: string): Sentiment {
        const lower = text.toLowerCase();
        if (PATTERN.ESCALATION_URGENT.test(lower))    return 'URGENT';
        if (PATTERN.ESCALATION_FRUSTRATED.test(lower)) return 'FRUSTRATED';
        if (PATTERN.POSITIVE_SENTIMENT.test(lower))    return 'POSITIVE';
        return 'NEUTRAL';
    }

    private async escalateToHuman(message: string): Promise<void> {
        console.warn("[Agent] 🚨 AUTO-ESCALATION TRIGGERED");
        this.speak(message);
        setTimeout(() => {
            this.handleIntent('HELP_SELECTED');
            this.frustrationScore = 0;
        }, DELAY.CANCEL_SPEAK_DELAY);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE AUTHORITY & INTERACTION MODE
    // ─────────────────────────────────────────────────────────────────────────

    private getVoiceLocked(): boolean {
        return this.interactionMode !== "voice" || this.pendingVoiceConfirm || this.manualEditModeActive;
    }

    private hasVoiceAuthority(): boolean {
        return !this.getVoiceLocked() && (STATE_CONFIG[this.state]?.voiceAllowed ?? false);
    }

    private isVoiceAllowed(): boolean {
        const modes = STATE_INPUT_MODES[this.state] || [];
        return modes.includes("VOICE");
    }

    private setInteractionMode(
        mode: InteractionMode,
        options?: { pendingVoiceConfirm?: boolean; reason?: string }
    ): void {
        const nextPending = options?.pendingVoiceConfirm ?? false;
        const changed = this.interactionMode !== mode || this.pendingVoiceConfirm !== nextPending;
        this.interactionMode  = mode;
        this.pendingVoiceConfirm = nextPending;
        if (changed) {
            console.log(
                `[AgentAdapter] Interaction mode -> ${mode} (pendingVoiceConfirm=${nextPending})` +
                (options?.reason ? ` [${options.reason}]` : "")
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    private clearTimer(
        key: 'listeningRestartTimer' | 'silenceReengageTimer' | 'keyDispenseCompleteTimer',
        reason: string
    ): void {
        if (!this[key]) return;
        clearTimeout(this[key]!);
        this[key] = null;
        console.debug(`[AgentAdapter] Cleared ${key} (${reason})`);
    }

    private clearListeningRestartTimer(reason: string): void {
        this.clearTimer('listeningRestartTimer', reason);
    }

    private clearSilenceReengageTimer(reason: string): void {
        this.clearTimer('silenceReengageTimer', reason);
    }

    private clearKeyDispenseTimer(reason: string): void {
        this.clearTimer('keyDispenseCompleteTimer', reason);
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
            if (this.manualEditModeActive) return;
            VoiceRuntime.startListening(getCurrentTenantLanguage(this.language)).catch(err => {
                console.warn("[AgentAdapter] Failed to restart listening:", err);
            });
        }, delayMs);
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
            console.log("[AgentAdapter] Simulated key dispensing complete -> DISPENSE_COMPLETE");
            this.handleIntent("DISPENSE_COMPLETE");
        }, DELAY.KEY_DISPENSE_SIM);
    }

    private resetInactivityTimer(): void {
        if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
        if (this.state === "IDLE") return;
        const ms = this.state === "SCAN_ID"
            ? Math.max(TIMEOUT.INACTIVITY, TIMEOUT.SCAN_ID_INACTIVITY)
            : TIMEOUT.INACTIVITY;
        this.inactivityTimer = setTimeout(() => {
            console.warn("[AgentAdapter] Inactivity timeout. Returning to IDLE.");
            this.hardStopAll();
            this.state = "IDLE";
            VoiceRuntime.setCurrentScreen("IDLE");
            this.notifyListeners();
        }, ms);
    }

    private handleTTSEnded(cause: "ended" | "error"): void {
        if (!this.hasVoiceAuthority()) {
            console.log("[AgentAdapter] TTS ended, but state doesn't allow voice");
            return;
        }
        const delay = cause === "error" ? DELAY.TTS_ERROR_RESTART : DELAY.TTS_ENDED_RESTART;
        console.log(`[AgentAdapter] TTS ${cause}; scheduling listening restart (${delay}ms).`);
        this.scheduleListeningRestart(delay, "tts_lifecycle");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TELEMETRY
    // ─────────────────────────────────────────────────────────────────────────

    private emitTelemetry(event: VoiceTelemetryEvent, data: Record<string, unknown> = {}): void {
        console.info(`[VOICE_TELEMETRY] ${event}`, { event, state: this.state, timestamp: Date.now(), ...data });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RATE LIMITING
    // ─────────────────────────────────────────────────────────────────────────

    private isRateLimited(): boolean {
        const now = Date.now();
        this.intentTimestamps = this.intentTimestamps.filter(
            ts => now - ts < RATE_LIMIT.BURST_WINDOW_MS
        );
        const last = this.intentTimestamps[this.intentTimestamps.length - 1];
        if (last && now - last < RATE_LIMIT.COOLDOWN_MS) {
            this.emitTelemetry("VOICE_RATE_LIMITED", { reason: "COOLDOWN", timeSinceLastMs: now - last });
            return true;
        }
        if (this.intentTimestamps.length >= RATE_LIMIT.BURST_MAX) {
            this.emitTelemetry("VOICE_RATE_LIMITED", { reason: "BURST_LIMIT", intentsInWindow: this.intentTimestamps.length });
            return true;
        }
        return false;
    }

    private recordIntent(): void { this.intentTimestamps.push(Date.now()); }

    // ─────────────────────────────────────────────────────────────────────────
    // INTENT DEDUP
    // ─────────────────────────────────────────────────────────────────────────

    private isDuplicateIntent(intent: Intent): boolean {
        const now = Date.now();
        if (this.lastIntent === intent && now - this.lastIntentTime < DEDUP.INTENT_WINDOW_MS) return true;
        this.lastIntent     = intent;
        this.lastIntentTime = now;
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LANGUAGE
    // ─────────────────────────────────────────────────────────────────────────

    private getPromptLanguage(): string {
        return getCurrentTenantLanguage(this.language);
    }

    private pickLocalizedText(options: { en: string; hi: string; mr: string }): string {
        switch (this.getPromptLanguage()) {
            case "hi": return options.hi;
            case "mr": return options.mr;
            default:   return options.en;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SLOT CONTEXT
    // ─────────────────────────────────────────────────────────────────────────

    private setActiveSlot(slot: BookingSlotKey, expectedType: BookingSlotExpectedType, promptAsked: string): void {
        this.slotContext = { activeSlot: slot, expectedType, promptAsked };
        console.log(`[AgentAdapter] Active Slot: ${slot} (expecting: ${expectedType})`);
    }

    private clearActiveSlot(): void {
        this.slotContext = { activeSlot: null, expectedType: null, promptAsked: "" };
    }

    private normalizeBookingSlotKey(raw: unknown): BookingSlotKey | null {
        if (raw == null) return null;
        const asText = String(raw).trim();
        if (!asText) return null;
        const snake   = asText.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
        const compact = snake.replace(/_/g, "");
        return SLOT_KEY_ALIAS_MAP[snake] || SLOT_KEY_ALIAS_MAP[compact] || null;
    }

    private getMissingBookingSlots(slots: Record<string, unknown>): BookingSlotKey[] {
        return BOOKING_SLOT_PRIORITY.filter(slot => !hasFilledValue(slots[slot]));
    }

    private getMissingBookingSlotsFromState(): BookingSlotKey[] {
        return this.getMissingBookingSlots((this.viewData.bookingSlots || {}) as Record<string, unknown>);
    }

    private maybeClearFilledActiveSlot(payloadSlots: Record<string, unknown>): void {
        const active = this.slotContext.activeSlot;
        if (!active || !Object.prototype.hasOwnProperty.call(payloadSlots, active)) return;
        if (hasFilledValue(payloadSlots[active])) {
            console.log(`[AgentAdapter] Slot filled: ${active}=${String(payloadSlots[active])}`);
            this.clearActiveSlot();
        }
    }

    private normalizePromptText(text: string): string {
        return String(text || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    }

    private maybeTrackSlotFromPrompt(text: string): void {
        if (!text || !["BOOKING_COLLECT", "BOOKING_SUMMARY", "PAYMENT"].includes(this.state)) return;
        const normalized = this.normalizePromptText(text);
        for (const rule of SLOT_PROMPT_LOOKUP) {
            if (rule.prompts.some(p => normalized.includes(p))) {
                this.setActiveSlot(rule.slot, rule.expectedType, text);
                return;
            }
        }
    }

    private resolveNextBookingSlot(payload?: any): BookingSlotKey | null {
        if (!["BOOKING_COLLECT", "BOOKING_SUMMARY", "PAYMENT"].includes(this.state)) return null;
        const hinted = this.normalizeBookingSlotKey(
            payload?.nextSlotToAsk ?? this.viewData.nextSlotToAsk ?? this.slotContext.activeSlot
        );
        if (hinted) return hinted;
        const backendMissing = payload?.missingSlots ?? this.viewData.missingSlots;
        if (Array.isArray(backendMissing)) {
            for (const slot of BOOKING_SLOT_PRIORITY) {
                if (backendMissing.some((item: unknown) => this.normalizeBookingSlotKey(item) === slot)) return slot;
            }
        }
        const local = this.getMissingBookingSlotsFromState();
        return local.length > 0 ? local[0] : null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ROOM RESOLUTION HELPERS
    // ─────────────────────────────────────────────────────────────────────────

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

    private isSameResolvedRoom(roomLike: any): boolean {
        const currentId  = String(this.viewData?.selectedRoom?.id || "").trim();
        const candidateId = String(roomLike?.id || "").trim();
        if (currentId && candidateId) return currentId === candidateId;
        const currentLabel = this.getCanonicalSelectedRoomLabel();
        const nextLabel    = this.getCanonicalSelectedRoomLabel(roomLike);
        return Boolean(currentLabel && nextLabel && currentLabel === nextLabel);
    }

    private resolveRoomFromHint(hint: unknown): any | null {
        if (!hint) return null;
        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) return null;
        const normalized = this.normalizeRoomHintText(hint);
        if (!normalized) return null;

        const roomText = (room: any) =>
            this.normalizeRoomHintText(`${String(room?.name || "")} ${String(room?.code || "")}`);

        // Exact code match
        const byCode = rooms.find((r: any) => String(r?.code || "").toLowerCase() === normalized);
        if (byCode) return byCode;

        // Code contains match
        const byCodeContains = rooms.find((r: any) => {
            const code = String(r?.code || "").toLowerCase();
            return code && (code.includes(normalized) || normalized.includes(code));
        });
        if (byCodeContains) return byCodeContains;

        // Name match
        const byName = rooms.find((r: any) => {
            const name = this.normalizeRoomHintText(r?.name || "");
            return name && (name.includes(normalized) || normalized.includes(name));
        });
        if (byName) return byName;

        // Token scoring
        const IGNORED_TOKENS = new Set([
            "room", "rooms", "suite", "type", "please", "book", "booking",
            "want", "need", "for", "the", "and", "with", "a", "an", "would", "like",
            "select", "choose", "change",
        ]);
        const tokens = normalized
            .split(/[^a-z0-9]+/g)
            .map(t => t.trim())
            .filter(t => t.length >= 3 && !IGNORED_TOKENS.has(t));

        if (tokens.length > 0) {
            let bestRoom: any = null;
            let bestScore = 0;
            for (const room of rooms) {
                const text  = roomText(room);
                const score = tokens.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0);
                if (score > bestScore) { bestScore = score; bestRoom = room; }
            }
            if (bestRoom && bestScore >= Math.max(1, Math.ceil(tokens.length / 2))) return bestRoom;
        }

        // Keyword fallback
        const keywordChecks: Array<{ pattern: RegExp; pick: (t: string) => boolean }> = [
            { pattern: /(deluxe|ocean)/,              pick: t => t.includes("deluxe") || t.includes("ocean") },
            { pattern: /(presidential|premium|luxury)/, pick: t => t.includes("presidential") || t.includes("premium") || t.includes("luxury") },
            { pattern: /(standard|single|queen|classic)/, pick: t => t.includes("standard") || t.includes("single") || t.includes("queen") || t.includes("classic") },
            { pattern: /(bunk|dorm|shared)/,           pick: t => t.includes("bunk") || t.includes("dorm") || t.includes("shared") },
            { pattern: /(executive|business)/,         pick: t => t.includes("executive") || t.includes("business") },
            { pattern: /(suite|sweet)/,                pick: t => t.includes("suite") },
        ];
        for (const rule of keywordChecks) {
            if (rule.pattern.test(normalized)) {
                const match = rooms.find((r: any) => rule.pick(roomText(r)));
                if (match) return match;
            }
        }
        return null;
    }

    private hydrateRoomDetails(roomLike: any): any | null {
        if (!roomLike) return null;
        const rooms   = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        const roomId  = String(roomLike?.id || "").trim();
        const label   = this.getCanonicalSelectedRoomLabel(roomLike);

        const matched = rooms.find((r: any) => Boolean(roomId) && String(r?.id || "").trim() === roomId)
            || (label ? this.resolveRoomFromHint(label) : null);

        if (!matched) return roomLike;

        return {
            ...matched,
            ...roomLike,
            image:     roomLike?.image     || matched?.image,
            imageUrl:  roomLike?.imageUrl  || matched?.imageUrl,
            imageUrls: Array.isArray(roomLike?.imageUrls) && roomLike.imageUrls.length > 0 ? roomLike.imageUrls : matched?.imageUrls,
            images:    Array.isArray(roomLike?.images)    && roomLike.images.length    > 0 ? roomLike.images    : matched?.images,
            features:  Array.isArray(roomLike?.features)  && roomLike.features.length  > 0 ? roomLike.features  : matched?.features,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ROOM QUERY CLASSIFICATION
    // ─────────────────────────────────────────────────────────────────────────

    private isRoomComparisonQuery(raw: string): boolean {
        return PATTERN.ROOM_COMPARISON.test((raw || "").toLowerCase().trim());
    }

    private isRoomInfoQuery(raw: string): boolean {
        const t = (raw || "").toLowerCase().trim();
        if (!t) return false;
        return (
            PATTERN.ROOM_AMENITIES.test(t) ||
            PATTERN.ROOM_PRICE.test(t) ||
            this.isRoomComparisonQuery(t) ||
            PATTERN.ALL_ROOMS_QUERY.test(t)
        );
    }

    private looksLikeRoomSelectionAttempt(raw: string): boolean {
        const normalized = this.normalizeRoomHintText(raw);
        if (!normalized || this.isRoomInfoQuery(raw)) return false;
        if (PATTERN.ROOM_SELECTION_VERB.test(normalized)) return true;
        const rooms = Array.isArray(this.viewData.rooms) ? this.viewData.rooms : [];
        if (rooms.length === 0) return false;
        const IGNORED = new Set(["room","rooms","suite","type","please","book","booking","want","need","for","the","and","with","a","an","would","like","select","choose","change"]);
        const tokens  = normalized.split(/[^a-z0-9]+/g).map(t => t.trim()).filter(t => t.length >= 3 && !IGNORED.has(t));
        if (tokens.length === 0) return false;
        return rooms.some((r: any) => {
            const text = this.normalizeRoomHintText(`${String(r?.name || "")} ${String(r?.code || "")}`);
            return tokens.some(t => text.includes(t));
        });
    }

    private isExplicitRoomChangeRequest(raw: string): boolean {
        const t = this.normalizeRoomHintText(raw);
        if (!t) return false;
        return (
            (PATTERN.EXPLICIT_ROOM_CHANGE.test(t) && PATTERN.ROOM_CHANGE_OBJECT.test(t)) ||
            PATTERN.BOOK_ANOTHER.test(t) ||
            PATTERN.SHOW_ANOTHER.test(t)
        );
    }

    private shouldConfirmPreviewBooking(raw: string): boolean {
        const t = this.normalizeRoomHintText(raw);
        if (!t) return false;
        if (this.isExplicitRoomChangeRequest(t) || this.isRoomComparisonQuery(t) || this.isRoomInfoQuery(t)) return false;
        return PATTERN.CONFIRM_PREVIEW.test(t) || PATTERN.CONFIRM_PREVIEW_VERB.test(t);
    }

    private isAffirmative(text: string): boolean { return PATTERN.AFFIRMATIVE.test((text || "").toLowerCase()); }
    private isNegative(text: string): boolean    { return PATTERN.NEGATIVE.test((text || "").toLowerCase()); }

    private isGenericVisualFallbackSpeech(raw: string): boolean {
        const s = String(raw || "").toLowerCase().trim();
        return !s || PATTERN.GENERIC_FALLBACK_SPEECH.test(s);
    }

    private getFastPathIntent(_transcript: string): Intent | null {
        // [V2 DUMB FRONTEND] Hardcoded regex triggers removed.
        return null;
    }

    private maybeHandleRealtimeCommand(_transcript: string, _source: "partial" | "final" = "partial"): boolean {
        // [V2 DUMB FRONTEND] Disabled.
        return false;
    }

    private maybeHandleRoomInfoQuery(_raw: string): boolean {
        // TODO: Keep room Q&A backend-owned.
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORMATTING HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    private formatRoomPrice(roomLike: any): string | null {
        const rawPrice = roomLike?.price;
        if (rawPrice == null || rawPrice === "") return null;
        const n = Number(rawPrice);
        if (!Number.isFinite(n)) return null;
        const currency = String(roomLike?.currency || "INR").trim().toUpperCase();
        const rounded  = Number.isInteger(n) ? Math.trunc(n) : Number(n.toFixed(2));
        return `${currency} ${rounded.toLocaleString("en-IN")}`;
    }

    private withTenantName(text: string): string {
        const resolvedName = getTenant()?.name?.trim();
        const slugName = getTenantSlug()
            .split("-").filter(Boolean)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
        const tenantName = resolvedName || slugName || "our hotel";
        return text.replace(
            /\{\{TENANT_NAME\}\}|\{TENANT_NAME\}|\{\{HOTEL_NAME\}\}|\{HOTEL_NAME\}|\{Hotel name\}|\{hotel name\}/g,
            tenantName
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ROOM DESCRIPTION / NARRATION
    // ─────────────────────────────────────────────────────────────────────────

    private describeRoomImage(imageLike: any): string | null {
        const category = String(imageLike?.category || "").trim().toLowerCase();
        const caption  = normalizeCaptionFragment(imageLike?.caption);
        const tags     = Array.isArray(imageLike?.tags)
            ? imageLike.tags.map((t: unknown) => String(t || "").trim().toLowerCase()).filter(Boolean) : [];
        const searchable = [category, caption, ...tags].join(" ");
        if (caption) return caption;
        if (searchable.includes("living") || searchable.includes("lounge") || searchable.includes("sofa")) return "a living area for relaxing";
        if (searchable.includes("balcony") || searchable.includes("terrace")) return "a private balcony with seating";
        if (searchable.includes("bathroom") || searchable.includes("bathtub") || searchable.includes("shower")) {
            return searchable.includes("bathtub") ? "a private bathroom with a bathtub" : "a private bathroom";
        }
        if (searchable.includes("bedroom") || searchable.includes("bed")) return "a comfortable bedroom";
        if (searchable.includes("view") || searchable.includes("ocean")) return "a lovely view";
        if (searchable.includes("fireplace")) return "a fireplace";
        return null;
    }

    private buildRoomImageNarration(roomLike: any): string[] {
        const room = roomLike || {};
        const categoryPriority: Record<string, number> = {
            bedroom: 1, living: 2, lounge: 2, balcony: 3, terrace: 3,
            bathroom: 4, fireplace: 5, view: 6,
        };
        const images = [...(Array.isArray(room?.images) ? room.images : [])].sort((a: any, b: any) => {
            const aP = categoryPriority[String(a?.category || "").trim().toLowerCase()] ?? 99;
            const bP = categoryPriority[String(b?.category || "").trim().toLowerCase()] ?? 99;
            if (aP !== bP) return aP - bP;
            return (Number.isFinite(Number(a?.displayOrder)) ? Number(a.displayOrder) : 999)
                 - (Number.isFinite(Number(b?.displayOrder)) ? Number(b.displayOrder) : 999);
        });
        const phrases: string[] = [];
        const seen = new Set<string>();
        for (const img of images) {
            const phrase = this.describeRoomImage(img);
            if (!phrase) continue;
            const key = phrase.toLowerCase();
            if (!seen.has(key)) { seen.add(key); phrases.push(phrase); }
        }
        return phrases;
    }

    private buildRemainingFeatureList(roomLike: any, usedNarration: string[]): string[] {
        const room         = roomLike || {};
        const narrationText = usedNarration.join(" ").toLowerCase();
        const remaining: string[] = [];
        const seen = new Set<string>();
        for (const feature of (Array.isArray(room?.features) ? room.features : [])) {
            const label      = formatRoomFeatureLabel(feature);
            if (!label) continue;
            const normalized = label.toLowerCase();
            if (seen.has(normalized)) continue;
            if ((normalized === "bathtub"   && narrationText.includes("bathtub"))   ||
                (normalized === "fireplace" && narrationText.includes("fireplace")) ||
                (normalized === "wi-fi"     && narrationText.includes("wi-fi"))     ||
                (normalized === "tv"        && narrationText.includes("tv"))) continue;
            seen.add(normalized);
            remaining.push(label);
        }
        return remaining;
    }

    private buildRoomHighlightPhrases(roomLike: any, limit = 3): string[] {
        const room    = roomLike || {};
        const phrases: string[] = [];
        const seen    = new Set<string>();
        const add = (phrase: string) => {
            const clean = String(phrase || "").trim();
            if (!clean || seen.has(clean.toLowerCase())) return;
            seen.add(clean.toLowerCase());
            phrases.push(clean);
        };
        for (const img of (Array.isArray(room?.images) ? room.images : [])) {
            const text = [
                String(img?.category || ""), String(img?.caption || ""),
                ...(Array.isArray(img?.tags) ? img.tags.map((t: unknown) => String(t || "")) : []),
            ].join(" ").toLowerCase();
            if      (text.includes("balcony")  || text.includes("terrace"))   add("a private balcony");
            else if (text.includes("bathtub"))                                 add("a bathroom with a bathtub");
            else if (text.includes("bathroom") || text.includes("shower"))     add("a private bathroom");
            else if (text.includes("bedroom")  || text.includes("bed"))        add("a comfortable bedroom");
            else if (text.includes("view")     || text.includes("ocean"))      add("a lovely view");
            if (phrases.length >= limit) return phrases.slice(0, limit);
        }
        for (const feature of (Array.isArray(room?.features) ? room.features : [])) {
            const label = formatRoomFeatureLabel(feature);
            if (!label) continue;
            if (label.toLowerCase() === "bathtub" && phrases.some(p => p.toLowerCase().includes("bathtub"))) continue;
            add(label);
            if (phrases.length >= limit) break;
        }
        return phrases.slice(0, limit);
    }

    private buildRoomDetailsLine(roomLike: any): string {
        const room             = roomLike || {};
        const imageNarration   = this.buildRoomImageNarration(room);
        const remainingFeatures = this.buildRemainingFeatureList(room, imageNarration);
        const segments: string[] = [];
        if (imageNarration.length   > 0) segments.push(`It includes ${formatSpokenList(imageNarration)}.`);
        if (remainingFeatures.length > 0) segments.push(`It also comes with ${formatSpokenList(remainingFeatures)}.`);
        if (segments.length > 0) return segments.join(" ");
        const fallback = this.buildRoomHighlightPhrases(room, 4);
        if (fallback.length > 0) return `It includes ${formatSpokenList(fallback)}.`;
        return "I can describe the room once more as soon as the room details finish loading.";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPEECH PROMPTS
    // ─────────────────────────────────────────────────────────────────────────

    private buildRoomSelectionPrompt(rooms: any[]): string {
        const hydrated = rooms.map(r => this.hydrateRoomDetails(r) || r).filter(Boolean);
        const names    = hydrated.map((r: any) => String(r?.name || "").trim()).filter(Boolean).slice(0, 4);

        if (hydrated.length > 0) {
            const count   = hydrated.length;
            const described = hydrated.slice(0, 2).map((r: any) => {
                const name   = this.getCanonicalSelectedRoomLabel(r) || "This room";
                const price  = this.formatRoomPrice(r);
                const occ    = typeof r?.maxAdults === "number"
                    ? `for up to ${r.maxAdults} adult${r.maxAdults === 1 ? "" : "s"}` : "for a comfortable stay";
                const hl     = this.buildRoomHighlightPhrases(r, 3);
                const hlText = hl.length > 0 ? `with ${formatSpokenList(hl)}` : "with its own thoughtful comforts";
                return price
                    ? `${name} is available for ${price}, ${occ}, and comes ${hlText}.`
                    : `${name} is available ${occ} and comes ${hlText}.`;
            });
            const extra = count - described.length;
            const closing = extra > 0
                ? `I also have ${extra} more option${extra === 1 ? "" : "s"} available if you'd like to compare further.`
                : "If you'd like, I can show you any of these rooms in more detail.";
            return [
                `Certainly. We currently have ${count} room option${count === 1 ? "" : "s"} available, each with different amenities and room details.`,
                ...described, closing,
            ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        }
        if (names.length === 0) {
            return this.pickLocalizedText({
                en: "Certainly. I can help you find a comfortable room. If you already have one in mind, say the room name, and I can guide you from there.",
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

    private buildRoomPreviewPrompt(roomLike?: any, backendSpeech?: string): string {
        const room   = this.hydrateRoomDetails(roomLike || this.viewData.selectedRoom);
        const spoken = String(backendSpeech || "").trim();
        if (!room) return spoken;
        const name       = this.getCanonicalSelectedRoomLabel(room) || "this room";
        const detailLine = this.buildRoomDetailsLine(room);
        const capLine    = typeof room?.maxAdults === "number"
            ? `It is well suited for up to ${room.maxAdults} adult${room.maxAdults === 1 ? "" : "s"}.` : "";
        const priceLine  = (() => { const p = this.formatRoomPrice(room); return p ? `It is priced at ${p}.` : ""; })();
        return [`This is our ${name}.`, detailLine, capLine, priceLine,
            "Would you like to continue with this room, or shall I show you another option?",
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    private buildBookingCollectPrompt(): string {
        const slots = (this.viewData.bookingSlots || {}) as Record<string, any>;
        const room  = this.getCanonicalSelectedRoomLabel();
        if (slots.adults == null) {
            return room
                ? this.pickLocalizedText({ en: `Certainly. ${room} is a lovely choice. How many adults will be staying?`, hi: `बहुत बढ़िया। ${room} select हो गया है। कितने adults stay करेंगे?`, mr: `छान निवड. ${room} select झाले आहे. किती adults stay करणार आहेत?` })
                : this.pickLocalizedText({ en: "Certainly. How many adults will be staying?", hi: "ठीक है। कितने adults stay करेंगे?", mr: "छान. किती adults stay करणार आहेत?" });
        }
        if (!slots.checkInDate || !slots.checkOutDate) {
            return this.pickLocalizedText({ en: "Certainly. Please tell me your check in and check out dates.", hi: "कृपया अपनी check in और check out dates बताइए।", mr: "कृपया तुमच्या check in आणि check out dates सांगा." });
        }
        if (!slots.guestName) {
            return this.pickLocalizedText({ en: "May I have the name for this booking?", hi: "इस booking के लिए मैं कौन सा नाम उपयोग करूँ?", mr: "या booking साठी मी कोणते नाव वापरू?" });
        }
        return this.pickLocalizedText({ en: "Please review the details, and when you're ready, say confirm booking.", hi: "कृपया details देख लीजिए। तैयार होने पर confirm booking कहिए।", mr: "कृपया details पाहा. तयार झाल्यावर confirm booking म्हणा." });
    }

    private buildPromptForBookingSlot(slot: BookingSlotKey | null): string {
        const room = this.getCanonicalSelectedRoomLabel();
        switch (slot) {
            case "roomType":    return this.pickLocalizedText({ en: "Certainly. I can help you find a comfortable room. If you already have one in mind, say the room name, and I can guide you from there.", hi: "कृपया बताइए, आप कौन सा room book करना चाहेंगे?", mr: "कृपया सांगा, तुम्हाला कोणता room book करायचा आहे?" });
            case "adults":      return room
                ? this.pickLocalizedText({ en: `Certainly. ${room} is a lovely choice. How many adults will be staying?`, hi: `बहुत बढ़िया। ${room} select हो गया है। कितने adults stay करेंगे?`, mr: `छान निवड. ${room} select झाले आहे. किती adults stay करणार आहेत?` })
                : this.pickLocalizedText({ en: "Certainly. How many adults will be staying?", hi: "कितने adults stay करेंगे?", mr: "किती adults stay करणार आहेत?" });
            case "checkInDate":  return this.pickLocalizedText({ en: "Certainly. What is your check in date?", hi: "आपकी check in date क्या है?", mr: "तुमची check in date काय आहे?" });
            case "checkOutDate": return this.pickLocalizedText({ en: "And what is your check out date?", hi: "आपकी check out date क्या है?", mr: "तुमची check out date काय आहे?" });
            case "guestName":    return this.pickLocalizedText({ en: "May I have the name for this booking?", hi: "इस booking के लिए मैं कौन सा नाम उपयोग करूँ?", mr: "या booking साठी मी कोणते नाव वापरू?" });
            case "children":     return this.pickLocalizedText({ en: "How many children will be staying?", hi: "कितने children stay करेंगे?", mr: "किती children stay करणार आहेत?" });
            default:             return this.buildBookingCollectPrompt();
        }
    }

    private buildManualEditPrompt(): string {
        return this.pickLocalizedText({
            en: "You can manually enter or correct the room, guest name, and stay dates now. Tap save changes when you are ready.",
            hi: "अब आप room, guest name और stay dates को manually enter या correct कर सकते हैं। तैयार होने पर save changes पर tap कीजिए।",
            mr: "आता तुम्ही room, guest name आणि stay dates manually भरू किंवा दुरुस्त करू शकता. तयार झाल्यावर save changes वर tap करा.",
        });
    }

    private buildManualReviewPrompt(slots: Record<string, unknown>, roomLike?: any): string {
        const name     = this.getCanonicalSelectedRoomLabel(roomLike) || String(slots.roomType || "").trim() || "your selected room";
        const adults   = hasFilledValue(slots.adults) ? `${slots.adults} adult${Number(slots.adults) === 1 ? "" : "s"}` : "the guest count";
        const checkIn  = formatSpeechDate(slots.checkInDate)  || "the check in date";
        const checkOut = formatSpeechDate(slots.checkOutDate) || "the check out date";
        const guest    = hasFilledValue(slots.guestName) ? String(slots.guestName).trim() : "the guest name";
        return this.pickLocalizedText({
            en: `I updated the booking details. Room: ${name}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guest}. Please review everything once more and continue when ready.`,
            hi: `मैंने booking details update कर दी हैं। Room: ${name}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guest}. कृपया details एक बार फिर देख लीजिए और तैयार होने पर आगे बढ़िए।`,
            mr: `मी booking details update केल्या आहेत. Room: ${name}. Guests: ${adults}. Check in: ${checkIn}. Check out: ${checkOut}. Guest name: ${guest}. कृपया details पुन्हा एकदा पाहा आणि तयार झाल्यावर पुढे जा.`,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SILENCE RE-ENGAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    private getSilenceReengagementPlan(): { delayMs: number; prompt: string } | null {
        switch (this.state) {
            case "WELCOME":
                return { delayMs: 2200, prompt: this.pickLocalizedText({ en: "I'm Siya, your hotel assistant. I can help you check in, explore rooms, answer questions about the stay, or call for help.", hi: "मैं check in, room booking, या मदद में आपकी सहायता कर सकती हूँ।", mr: "मी check in, room booking किंवा मदत यासाठी तुमची मदत करू शकते." }) };
            case "AI_CHAT":
                return { delayMs: 2400, prompt: this.pickLocalizedText({ en: "I'm listening. You can say check in, book room, or help.", hi: "मैं सुन रही हूँ। आप check in, room book, या help कह सकते हैं।", mr: "मी ऐकत आहे. तुम्ही check in, room book किंवा help म्हणू शकता." }) };
            case "MANUAL_MENU":
                return { delayMs: 3200, prompt: this.pickLocalizedText({ en: "You can continue by voice or tap an option on screen.", hi: "आप voice से जारी रख सकते हैं या screen पर कोई option चुन सकते हैं।", mr: "तुम्ही voice ने पुढे जाऊ शकता किंवा screen वरचा option निवडू शकता." }) };
            case "ROOM_SELECT": {
                const rooms  = Array.isArray(this.viewData?.rooms) ? this.viewData.rooms : [];
                const prompt = rooms.length > 0 ? this.buildRoomSelectionPrompt(rooms) : "";
                return { delayMs: 6500, prompt: this.pickLocalizedText({ en: prompt, hi: "आराम से चुनिए। तैयार होने पर room का नाम बोलिए।", mr: "निवांत निवडा. तयार झाल्यावर room चे नाव सांगा." }) };
            }
            case "ROOM_PREVIEW":
                return { delayMs: 7000, prompt: this.pickLocalizedText({ en: this.buildRoomPreviewPrompt(this.viewData?.selectedRoom), hi: "Aap features ke baare mein pooch sakte hain, ya yes bolkar is room ke saath aage badh sakte hain.", mr: "Tumhi features babat vicharu shakta, kiwa yes mhunun ya room sobat pudhe jau shakta." }) };
            case "BOOKING_COLLECT":
                return { delayMs: 8000, prompt: this.pickLocalizedText({ en: "When you're ready, tell me the next booking detail.", hi: "जब आप तैयार हों, booking की अगली detail बताइए।", mr: "तयार झाल्यावर booking ची पुढची detail सांगा." }) };
            case "BOOKING_SUMMARY":
                return { delayMs: 9000, prompt: this.pickLocalizedText({ en: "Review the summary and say confirm booking when ready.", hi: "Summary देख लीजिए और तैयार होने पर confirm booking कहिए।", mr: "Summary पाहा आणि तयार झाल्यावर confirm booking म्हणा." }) };
            default:
                return null;
        }
    }

    private scheduleSilenceReengagement(sourceReason: string): void {
        if (!this.hasVoiceAuthority()) return;
        const plan = this.getSilenceReengagementPlan();
        if (!plan) return;
        if (Date.now() < this.reengageCooldownUntil) {
            console.debug("[AgentAdapter] Silence re-engagement skipped (cooldown active)");
            return;
        }
        this.clearSilenceReengageTimer("reschedule:silence");
        const expectedEpoch = this.voiceLifecycleEpoch;
        const expectedState = this.state;
        this.silenceReengageTimer = setTimeout(() => {
            this.silenceReengageTimer = null;
            if (expectedEpoch !== this.voiceLifecycleEpoch || expectedState !== this.state) {
                console.debug("[AgentAdapter] Ignored stale silence re-engagement timer");
                return;
            }
            if (!this.hasVoiceAuthority() || TTSController.isSpeaking()) return;
            this.reengageCooldownUntil = Date.now() + DELAY.SILENCE_REENGAGE_COOLDOWN;
            console.log(`[AgentAdapter] Silence re-engagement (${sourceReason}) state=${this.state}`);
            if (this.state === "ROOM_SELECT") this.setActiveSlot("roomType", "string", plan.prompt);
            this.speak(plan.prompt);
        }, plan.delayMs);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GUIDANCE SPEAKERS (speak + set slot in one call)
    // ─────────────────────────────────────────────────────────────────────────

    private maybeSpeakRoomSelectionGuidance(payload?: any): boolean {
        if (this.state !== "ROOM_SELECT" || !this.hasVoiceAuthority() || TTSController.isSpeaking() || payload?.suppressSpeech) return false;
        const speech  = String(payload?.speech || "").trim();
        const rooms   = Array.isArray(payload?.rooms) ? payload.rooms : [];
        const prompt  = rooms.length > 0 ? this.buildRoomSelectionPrompt(rooms) : speech;
        if (!prompt) return false;
        this.hasAnnouncedRoomOptions = true;
        this.setActiveSlot("roomType", "string", prompt);
        this.speak(prompt);
        return true;
    }

    private maybeSpeakRoomPreviewGuidance(payload?: any): boolean {
        if (this.state !== "ROOM_PREVIEW" || !this.hasVoiceAuthority() || TTSController.isSpeaking() || payload?.suppressSpeech) return false;
        const prompt = this.buildRoomPreviewPrompt(payload?.selectedRoom || payload?.room, payload?.speech);
        if (!prompt) return false;
        this.clearActiveSlot();
        this.speak(prompt);
        return true;
    }

    private maybeSpeakBookingCollectGuidance(payload?: any, options?: { preferBackendSpeech?: boolean }): boolean {
        if (this.state !== "BOOKING_COLLECT" || !this.hasVoiceAuthority() || TTSController.isSpeaking()) return false;
        const backendSpeech = String(payload?.speech || "").trim();
        const slot          = this.resolveNextBookingSlot(payload);
        const fallback      = this.buildPromptForBookingSlot(slot);
        const prompt        = options?.preferBackendSpeech && backendSpeech ? backendSpeech : fallback;
        if (!prompt) return false;
        const fingerprint = `${slot || "none"}|${prompt.toLowerCase()}`;
        const now         = Date.now();
        if (this.lastBookingPromptFingerprint === fingerprint && now - this.lastBookingPromptAt < DEDUP.BOOKING_PROMPT_MS) return false;
        if (slot && SLOT_EXPECTED_TYPE_MAP[slot]) {
            this.slotContext = { ...this.slotContext, activeSlot: slot, expectedType: SLOT_EXPECTED_TYPE_MAP[slot], promptAsked: prompt };
        }
        this.lastBookingPromptFingerprint = fingerprint;
        this.lastBookingPromptAt          = now;
        this.speak(prompt);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VISUAL CONCIERGE
    // ─────────────────────────────────────────────────────────────────────────

    private inferVisualFocusFromTranscript(rawTranscript: string, roomLike?: any): any | null {
        const transcript = String(rawTranscript || "").toLowerCase().trim();
        if (!transcript) return null;
        const room   = this.hydrateRoomDetails(roomLike || this.viewData?.selectedRoom);
        const images = Array.isArray(room?.images) ? room.images : [];
        if (images.length === 0) return null;
        const keywordGroups: string[][] = [
            ["bedroom","bed","king bed","queen bed","sleeping area"],
            ["balcony","terrace","view","outdoor","sea view","ocean view"],
            ["bathroom","bathtub","washroom","toilet","shower"],
            ["living","lounge","sofa","sitting area"],
            ["fireplace"],
            ["wifi","tv"],
        ];
        const matchWord = (text: string, kw: string) =>
            new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`).test(text);
        const matchedGroup = keywordGroups.find(g => g.some(kw => matchWord(transcript, kw)));
        if (!matchedGroup) return null;
        const sorted = [...images].sort((a: any, b: any) => {
            const aPrimary = a?.isPrimary === true ? -1 : 0;
            const bPrimary = b?.isPrimary === true ? -1 : 0;
            const aOrder = typeof a?.displayOrder === "number" ? a.displayOrder : 999;
            const bOrder = typeof b?.displayOrder === "number" ? b.displayOrder : 999;
            return (aPrimary - bPrimary) || (aOrder - bOrder);
        });
        const categoryMatch = sorted.find((img: any) =>
            matchedGroup.some(kw => matchWord(String(img?.category || "").toLowerCase(), kw))
        );
        const tagMatch = sorted.find((img: any) => {
            const hay = [String(img?.caption || ""),
                ...(Array.isArray(img?.tags) ? img.tags.map((t: unknown) => String(t || "")) : []),
            ].join(" ").toLowerCase();
            return matchedGroup.some(kw => matchWord(hay, kw));
        });
        const best = categoryMatch || tagMatch;
        if (!best) {
            return {
                imageId: null,
                noImageAvailable: true,
                category: humanizeVisualLabel(matchedGroup[0]),
                topic: humanizeVisualLabel(matchedGroup[0]),
                caption: null,
                tags: [],
            };
        }
        const imageId = String(best?.id || "").trim();
        if (!imageId) return null;
        return {
            imageId,
            mode: "expand",
            topic:   humanizeVisualLabel(best?.category || matchedGroup[0]),
            category: humanizeVisualLabel(best?.category || matchedGroup[0]),
            caption: String(best?.caption || "").trim() || null,
            tags:    Array.isArray(best?.tags) ? best.tags.map((t: unknown) => humanizeVisualLabel(t)).filter(Boolean) : [],
        };
    }

    private buildLocalVisualConciergeReply(visualFocus: any, roomLike?: any): string | null {
        const room     = this.hydrateRoomDetails(roomLike || this.viewData?.selectedRoom);
        const roomName = this.getCanonicalSelectedRoomLabel(room);
        const category = humanizeVisualLabel(visualFocus?.category || visualFocus?.topic || "room detail");
        if (!category) return null;
        const caption  = String(visualFocus?.caption || "").trim();
        const tags     = Array.isArray(visualFocus?.tags)
            ? visualFocus.tags.map((t: unknown) => humanizeVisualLabel(t)).filter(Boolean) : [];
        const normCat  = category.toLowerCase();
        const roomPhrase = roomName ? ` in ${roomName}` : "";
        let detailSentence = "";
        if (normCat === "bathroom") {
            const hasBathtub = tags.some((t: string) => /bathtub|soaking tub|jacuzzi|hot tub/i.test(t));
            detailSentence = hasBathtub ? "It is a private bathroom, and it also includes a bathtub." : "It is a private bathroom.";
        } else if (normCat === "balcony") {
            const hasView = tags.some((t: string) => /view/i.test(t));
            const hasSeat = tags.some((t: string) => /seating/i.test(t));
            if (hasView && hasSeat) detailSentence = "It includes a private balcony with seating and a view.";
            else if (hasView)       detailSentence = "It includes a private balcony with a view.";
        }
        const visual = detailSentence || caption || (tags.length > 0 ? `You can spot details like ${tags.slice(0, 3).join(", ")}.` : "");
        if (!visual) return null;
        return `Absolutely. Let me show you the ${category.toLowerCase()}${roomPhrase} on screen. ${visual} If you'd like, I can continue with your booking whenever you're ready.`;
    }

    private tryHandleLocalVisualPreviewQuery(rawTranscript: string): boolean {
        if (!["ROOM_PREVIEW", "BOOKING_COLLECT"].includes(this.state)) return false;

        if (CLOSE_FULLSCREEN_PATTERN.test(rawTranscript)) {
            console.log("[AgentAdapter] Voice: close fullscreen");
            window.dispatchEvent(new CustomEvent("voice-close-fullscreen"));
            this.speak("Closed. You can continue browsing or say yes to book this room.");
            this.dispatch("GENERAL_QUERY", { transcript: rawTranscript });
            return true;
        }

        if (OPEN_FULLSCREEN_PATTERN.test(rawTranscript)) {
            console.log("[AgentAdapter] Voice: open fullscreen");
            window.dispatchEvent(new CustomEvent("voice-open-fullscreen"));
            this.speak("Here you go. Say close full screen whenever you're done.");
            this.dispatch("GENERAL_QUERY", { transcript: rawTranscript });
            return true;
        }

        const room = this.hydrateRoomDetails(this.viewData?.selectedRoom);
        if (!room) return false;

        const visualFocus = this.inferVisualFocusFromTranscript(rawTranscript, room);
        if (!visualFocus) return false;

        if (visualFocus.noImageAvailable) {
            const category = String(visualFocus.category || "that area").toLowerCase();
            const speech = `I'm sorry, we don't have a photo of the ${category} for this room. You can ask about another area or continue with your booking.`;
            console.log("[AgentAdapter] No image for category:", category);
            this.speak(speech);
            this.dispatch("GENERAL_QUERY", { transcript: rawTranscript, speech });
            return true;
        }

        const requestedCategory = String(visualFocus.category || "").toLowerCase();
        if (requestedCategory && requestedCategory === this.lastVisualPreviewCategory) {
            const speech = `You're already viewing the ${requestedCategory}. Say open full screen to get a closer look, or ask about another area.`;
            this.speak(speech);
            this.dispatch("GENERAL_QUERY", { transcript: rawTranscript, speech });
            return true;
        }

        const speech = this.buildLocalVisualConciergeReply(visualFocus, room);
        if (!speech) return false;

        this.lastVisualPreviewCategory = requestedCategory || null;
        console.log("[AgentAdapter] Handling visual preview request locally:", requestedCategory);
        this.speak(speech);
        this.dispatch("GENERAL_QUERY", { transcript: rawTranscript, selectedRoom: room, room, visualFocus, speech });
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTENT MAPPING
    // ─────────────────────────────────────────────────────────────────────────

    private mapTranscriptToIntent(transcript: string): Intent | null {
        const cmds = VOICE_COMMAND_MAP[this.state];
        return cmds ? (cmds[transcript] || null) : null;
    }

    private mapIntentToEvent(llmIntent: string): string {
        const upper = (llmIntent || "").toUpperCase().trim();
        switch (upper) {
            case "CHECK_IN":        return "CHECK_IN_SELECTED";
            case "BOOK_ROOM":       return "BOOK_ROOM_SELECTED";
            case "RECOMMEND_ROOM":  return "ROOM_SELECTED";
            case "HELP":            return "HELP_SELECTED";
            case "SCAN_ID":         return "SCAN_COMPLETED";
            case "PAYMENT":         return "CONFIRM_PAYMENT";
            case "WELCOME":         return "GENERAL_QUERY";
            case "IDLE":            return "GENERAL_QUERY";
            case "BACK":
            case "BACK_REQUESTED":  return "BACK_REQUESTED";
            case "SELECT_ROOM":
                return (this.state === "ROOM_SELECT" || this.state === "ROOM_PREVIEW") ? "ROOM_SELECTED" : "SELECT_ROOM";
            case "PROVIDE_GUESTS":
            case "PROVIDE_DATES":
            case "PROVIDE_NAME":
            case "CONFIRM_BOOKING":
            case "MODIFY_BOOKING":
            case "CANCEL_BOOKING":
            case "ASK_ROOM_DETAIL":
            case "ASK_PRICE":
            case "COMPARE_ROOMS":   return upper;
            case "REPEAT":
            case "GENERAL_QUERY":
            case "UNKNOWN":         return "GENERAL_QUERY";
        }
        if (upper.includes("CHECK_IN") || upper.includes("RESERVATION"))    return "CHECK_IN_SELECTED";
        if (upper.includes("BOOK")     || upper.includes("NEW_RESERVATION")) return "BOOK_ROOM_SELECTED";
        if (upper.includes("HELP")     || upper.includes("SUPPORT"))         return "HELP_SELECTED";
        if (upper.includes("SCAN"))                                           return "SCAN_COMPLETED";
        if (upper.includes("PAYMENT")  || upper.includes("PAY"))             return "CONFIRM_PAYMENT";
        if (upper.includes("BACK")     || upper.includes("PREVIOUS"))        return "BACK_REQUESTED";
        if (upper.includes("CANCEL"))                                         return "CANCEL_BOOKING";
        if (upper.includes("MODIFY")   || upper.includes("CHANGE"))          return "MODIFY_BOOKING";
        if (upper.includes("DATE"))                                           return "PROVIDE_DATES";
        if (upper.includes("GUEST"))                                          return "PROVIDE_GUESTS";
        if (upper.includes("NAME"))                                           return "PROVIDE_NAME";
        return "GENERAL_QUERY";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING DATA — split from the old god method applyPayloadData
    // ─────────────────────────────────────────────────────────────────────────

    private calculateBookingNights(checkIn: unknown, checkOut: unknown): number | null {
        const ci = new Date(String(checkIn  || ""));
        const co = new Date(String(checkOut || ""));
        if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime())) return null;
        const diff = co.getTime() - ci.getTime();
        return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : null;
    }

    private pickFilledManualOverrides(slots: Record<string, unknown> | undefined): Record<string, unknown> {
        if (!slots) return {};
        return Object.fromEntries(Object.entries(slots).filter(([, v]) => hasFilledValue(v)));
    }

    private applyStoredManualBookingOverrides(merged: Record<string, any>): void {
        if (merged.manualSelectedRoomOverride) merged.selectedRoom = merged.manualSelectedRoomOverride;
        if (merged.manualBookingOverrides) {
            merged.bookingSlots = { ...(merged.bookingSlots || {}), ...merged.manualBookingOverrides };
        }
    }

    private syncDerivedBookingData(merged: Record<string, any>): void {
        const slots   = { ...(merged.bookingSlots || {}) } as Record<string, unknown>;
        const nights  = this.calculateBookingNights(slots.checkInDate, slots.checkOutDate);
        if (nights !== null) slots.nights = nights; else delete slots.nights;

        const roomPrice = Number(merged?.selectedRoom?.price);
        const existing  = merged?.bill || {};
        const prevSub   = Number(existing?.subtotal);
        const prevTax   = Number(existing?.taxes);
        const taxRate   = prevSub > 0 && Number.isFinite(prevTax) ? prevTax / prevSub : 0;

        const shouldRecalc = Boolean(merged.manualBookingOverrides)
            || !hasFilledValue(slots.totalPrice)
            || !existing || !hasFilledValue(existing.total);

        if (nights !== null && Number.isFinite(roomPrice) && roomPrice > 0 && shouldRecalc) {
            const subtotal = roomPrice * nights;
            const taxes    = subtotal * taxRate;
            const total    = subtotal + taxes;
            slots.totalPrice = Number(total.toFixed(2));
            merged.bill = {
                nights,
                subtotal: subtotal.toFixed(2),
                taxes:    taxes.toFixed(2),
                total:    total.toFixed(2),
                currencySymbol: merged?.selectedRoom?.currency === "USD" ? "$" : (merged?.selectedRoom?.currency || "INR"),
            };
        } else if (nights !== null && existing) {
            merged.bill = { ...existing, nights };
        }
        merged.bookingSlots = slots;
    }

    private syncBookingFlowHints(merged: Record<string, any>, resolvedState: UiState): void {
        if (!["BOOKING_COLLECT", "BOOKING_SUMMARY", "PAYMENT"].includes(resolvedState)) {
            merged.missingSlots = [];
            merged.nextSlotToAsk = null;
            return;
        }
        const slots = (merged.bookingSlots || {}) as Record<string, unknown>;
        if (!merged.selectedRoom && Object.keys(slots).length === 0) return;
        const missing = this.getMissingBookingSlots(slots);
        merged.missingSlots = missing;
        const active = this.slotContext.activeSlot;
        if (active && hasFilledValue(slots[active])) this.clearActiveSlot();
        const hinted = this.normalizeBookingSlotKey(merged.nextSlotToAsk);
        if (hinted && !hasFilledValue(slots[hinted])) { merged.nextSlotToAsk = hinted; return; }
        merged.nextSlotToAsk = missing.length > 0 ? missing[0] : null;
    }

    /**
     * applyPayloadData — refactored into focused sub-steps (same logic, cleaner structure)
     */
    private applyPayloadData(intent: string, payload?: any, nextState?: UiState): void {
        const merged        = { ...this.viewData } as Record<string, any>;
        const resolvedState = nextState || this.state;

        // ── 1. Non-booking state cleanup ──────────────────────────────────────
        if (!["ROOM_SELECT","ROOM_PREVIEW","BOOKING_COLLECT","BOOKING_SUMMARY","PAYMENT"].includes(resolvedState)) {
            delete merged.manualBookingOverrides;
            delete merged.manualSelectedRoomOverride;
            delete merged.visualFocus;
            this.manualEditModeActive = false;
        }
        if (nextState === "SCAN_ID" && (intent === "RESCAN" || intent === "CHECK_IN_SELECTED")) {
            merged.ocr = null; merged.matchedBooking = null; merged.multiplePossibleMatches = false;
        }

        // ── 2. Room resolution ─────────────────────────────────────────────────
        const incomingRoom   = payload?.selectedRoom ?? payload?.room;
        const resetRoom      = (resolvedState === "ROOM_SELECT" || resolvedState === "ROOM_PREVIEW")
            && payload && Object.prototype.hasOwnProperty.call(payload, "selectedRoom") && payload.selectedRoom === null;
        const currentLabel   = this.getCanonicalSelectedRoomLabel(merged.selectedRoom);
        const incomingLabel  = incomingRoom ? this.getCanonicalSelectedRoomLabel(incomingRoom) : null;
        const currentRoomId  = String(merged?.selectedRoom?.id || "").trim();
        const incomingRoomId = String(incomingRoom?.id || "").trim();
        const roomChanged    = Boolean(incomingRoom && (
            (incomingRoomId && incomingRoomId !== currentRoomId) ||
            (!incomingRoomId && incomingLabel && incomingLabel !== currentLabel)
        ));

        if (payload?.room)         merged.selectedRoom = this.hydrateRoomDetails(payload.room);
        if (payload?.selectedRoom) merged.selectedRoom = this.hydrateRoomDetails(payload.selectedRoom);
        if (Object.prototype.hasOwnProperty.call(payload || {}, "selectedRoom") && payload.selectedRoom === null) merged.selectedRoom = null;

        if (roomChanged) {
            delete merged.manualSelectedRoomOverride; delete merged.visualFocus;
            if (merged.manualBookingOverrides) {
                const o = { ...merged.manualBookingOverrides };
                delete o.roomType; delete o.totalPrice;
                merged.manualBookingOverrides = o;
            }
            merged.selectedRoom  = this.hydrateRoomDetails(incomingRoom);
            merged.bookingSlots  = { ...(merged.bookingSlots || {}), roomType: incomingLabel || null, totalPrice: null };
            delete merged.bill;
        }
        if (resetRoom) {
            delete merged.manualSelectedRoomOverride; delete merged.visualFocus;
            if (merged.manualBookingOverrides) {
                const o = { ...merged.manualBookingOverrides };
                delete o.roomType; delete o.totalPrice;
                merged.manualBookingOverrides = o;
            }
            merged.bookingSlots = { ...(merged.bookingSlots || {}), roomType: null, totalPrice: null };
            delete merged.bill;
        }

        // ── 3. Room list ───────────────────────────────────────────────────────
        if (Array.isArray(payload?.rooms)) merged.rooms = payload.rooms;

        // ── 4. Slot data ───────────────────────────────────────────────────────
        if (payload?.slots) {
            const next = { ...payload.slots };
            if (resetRoom) { delete next.roomType; delete next.totalPrice; }
            merged.bookingSlots = { ...(merged.bookingSlots || {}), ...next };
            this.maybeClearFilledActiveSlot(next);
        }
        if (payload?.manualOverride) {
            merged.manualBookingOverrides = {
                ...(merged.manualBookingOverrides || {}),
                ...this.pickFilledManualOverrides(payload.slots),
            };
            if (payload?.selectedRoom || payload?.room) merged.manualSelectedRoomOverride = payload.selectedRoom || payload.room;
        }
        this.applyStoredManualBookingOverrides(merged);

        // ── 5. Room ↔ slot consistency ─────────────────────────────────────────
        const labelBeforeSync = this.getCanonicalSelectedRoomLabel(merged.selectedRoom);
        if (merged?.bookingSlots?.roomType == null && labelBeforeSync) {
            merged.bookingSlots = { ...(merged.bookingSlots || {}), roomType: labelBeforeSync };
        }
        // Only null-out selectedRoom when an explicit reset was requested via payload.
        // Do NOT derive reset from slot/label absence — that can clear a valid room mid-flow.
        if (merged?.bookingSlots?.roomType == null && !labelBeforeSync && resetRoom) merged.selectedRoom = null;
        const finalDisplay = this.getCanonicalSelectedRoomLabel(merged.selectedRoom);
        if (finalDisplay) {
            merged.selectedRoom = { ...(this.hydrateRoomDetails(merged.selectedRoom) || merged.selectedRoom || {}), name: finalDisplay, displayName: finalDisplay };
            merged.bookingSlots = { ...(merged.bookingSlots || {}), roomType: finalDisplay };
        } else if (!resetRoom && merged?.bookingSlots?.roomType) {
            const resolved = this.resolveRoomFromHint(merged.bookingSlots.roomType);
            if (resolved?.name) {
                const canon = String(resolved.name).trim();
                merged.selectedRoom = { ...(merged.selectedRoom || {}), ...resolved, name: canon, displayName: canon };
                merged.bookingSlots = { ...(merged.bookingSlots || {}), roomType: canon };
            }
        }

        // ── 6. Missing slots / next slot hint ────────────────────────────────
        if (payload?.missingSlots !== undefined && ["BOOKING_COLLECT","BOOKING_SUMMARY","PAYMENT"].includes(resolvedState)) {
            merged.missingSlots = Array.isArray(payload.missingSlots)
                ? payload.missingSlots.map((s: unknown) => this.normalizeBookingSlotKey(s) || s)
                : payload.missingSlots;
        }
        if (payload?.nextSlotToAsk !== undefined && ["BOOKING_COLLECT","BOOKING_SUMMARY","PAYMENT"].includes(resolvedState)) {
            const hinted = this.normalizeBookingSlotKey(payload.nextSlotToAsk);
            merged.nextSlotToAsk = hinted || payload.nextSlotToAsk;
            if (hinted && SLOT_EXPECTED_TYPE_MAP[hinted]) {
                this.slotContext = { ...this.slotContext, activeSlot: hinted, expectedType: SLOT_EXPECTED_TYPE_MAP[hinted] };
            }
        }
        if (resolvedState === "ROOM_PREVIEW") { merged.missingSlots = []; merged.nextSlotToAsk = null; this.clearActiveSlot(); }

        // ── 7. OCR / matching ─────────────────────────────────────────────────
        if (payload?.ocr !== undefined)                    merged.ocr = payload.ocr || null;
        if (payload?.matchedBooking !== undefined)         merged.matchedBooking = payload.matchedBooking || null;
        if (payload?.multiplePossibleMatches !== undefined) merged.multiplePossibleMatches = Boolean(payload.multiplePossibleMatches);
        if (payload?.ocrDemo !== undefined)                merged.ocrDemo = Boolean(payload.ocrDemo);

        // ── 8. Error state ────────────────────────────────────────────────────
        if (payload?.error !== undefined)     merged.bookingError = payload.error || null;
        else if (payload?.backendDecision)    merged.bookingError = null;

        // ── 9. Visual focus ───────────────────────────────────────────────────
        if (payload && Object.prototype.hasOwnProperty.call(payload, "visualFocus")) {
            if (payload.visualFocus) merged.visualFocus = payload.visualFocus;
            else                     delete merged.visualFocus;
        }

        // ── 10. Booking IDs ───────────────────────────────────────────────────
        if (payload && Object.prototype.hasOwnProperty.call(payload, "persistedBookingId")) merged.persistedBookingId = payload.persistedBookingId || null;
        if (payload && Object.prototype.hasOwnProperty.call(payload, "assignedRoomId"))     merged.assignedRoomId     = payload.assignedRoomId     || null;
        if (payload && Object.prototype.hasOwnProperty.call(payload, "assignedRoomNumber")) merged.assignedRoomNumber = payload.assignedRoomNumber || null;

        // ── 11. Derived data + flow hints + progress ──────────────────────────
        this.syncDerivedBookingData(merged);
        this.syncBookingFlowHints(merged, resolvedState);
        merged.progress = this.getProgress(resolvedState);
        this.viewData   = merged;
    }

    private getProgress(state: UiState) {
        const steps = ['ID Scan', 'Room', 'Payment', 'Key'];
        switch (state) {
            case 'SCAN_ID':          return { currentStep: 1, totalSteps: 4, steps };
            case 'ID_VERIFY':        return { currentStep: 2, totalSteps: 4, steps: ['ID Scan','Verify','Summary','Key'] };
            case 'CHECK_IN_SUMMARY': return { currentStep: 3, totalSteps: 4, steps: ['ID Scan','Verify','Summary','Key'] };
            case 'ROOM_SELECT':      return { currentStep: 2, totalSteps: 4, steps };
            case 'ROOM_PREVIEW':     return { currentStep: 2, totalSteps: 4, steps };
            case 'PAYMENT':          return { currentStep: 3, totalSteps: 4, steps };
            case 'COMPLETE':         return { currentStep: 4, totalSteps: 4, steps };
            default:                 return this.viewData.progress ?? null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE RESOLUTION
    // ─────────────────────────────────────────────────────────────────────────

    private resolveNextStateFromIntent(currentState: UiState, intent: string): UiState {
        if (currentState === "ROOM_SELECT") {
            const STAY_INTENTS = new Set([
                "ASK_ROOM_DETAIL","ASK_PRICE","COMPARE_ROOMS","GENERAL_QUERY","HELP_SELECTED",
                "PROVIDE_GUESTS","PROVIDE_DATES","PROVIDE_NAME","CONFIRM_BOOKING","MODIFY_BOOKING",
            ]);
            if (STAY_INTENTS.has(intent)) return "ROOM_SELECT";
        }
        if (currentState === "ROOM_PREVIEW") {
            const STAY_INTENTS = new Set([
                "ROOM_SELECTED","ASK_ROOM_DETAIL","ASK_PRICE","COMPARE_ROOMS",
                "GENERAL_QUERY","HELP_SELECTED","MODIFY_BOOKING","SELECT_ROOM",
            ]);
            if (STAY_INTENTS.has(intent)) return "ROOM_PREVIEW";
        }
        if (intent === "BACK_REQUESTED" || intent === "CANCEL_REQUESTED") {
            const resolved = StateMachine.transition(currentState as UIState, intent as any) as UiState;
            return resolved !== currentState ? resolved : StateMachine.getPreviousState(currentState as UIState) as UiState;
        }
        if (intent === "RESET") return "IDLE";
        return StateMachine.transition(currentState as UIState, intent as any) as UiState;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE EVENT HANDLER
    // ─────────────────────────────────────────────────────────────────────────

    private handleVoiceEvent(event: VoiceEvent): void {
        console.log(`[AgentAdapter] Voice Event: ${event.type}`);

        if (this.interactionMode !== "voice" || this.pendingVoiceConfirm) {
            if (event.type === "VOICE_SESSION_STARTED") {
                this.emitTelemetry("VOICE_COMMAND_BLOCKED", {
                    reason: this.pendingVoiceConfirm ? "PENDING_CONFIRMATION" : "MANUAL_MODE",
                    state: this.state,
                });
                VoiceRuntime.cancelSession();
            }
            if (event.type === "VOICE_SESSION_ENDED") this.hasProcessedTranscript = false;
            return;
        }

        switch (event.type) {
            case "VOICE_SESSION_STARTED":
                this.clearSilenceReengageTimer("session_started");
                this.hasProcessedTranscript = false;
                if (!this.hasVoiceAuthority()) {
                    this.emitTelemetry("VOICE_COMMAND_BLOCKED", { reason: "NO_AUTHORITY", state: this.state });
                    VoiceRuntime.cancelSession();
                    return;
                }
                if (this.isVoiceAllowed()) {
                    this.emitTelemetry("VOICE_SESSION_STARTED");
                    this.dispatch("VOICE_STARTED");
                } else {
                    this.emitTelemetry("VOICE_COMMAND_BLOCKED", { reason: "STATE_INPUT_MODE", state: this.state });
                    VoiceRuntime.cancelSession();
                }
                break;

            case "VOICE_TRANSCRIPT_READY":
                this.clearSilenceReengageTimer("transcript_ready");
                if (Date.now() < this.suppressFinalTranscriptUntil) {
                    console.debug("[AgentAdapter] Final transcript suppressed (realtime already handled)");
                    return;
                }
                this.hasProcessedTranscript = true;
                if (!this.hasVoiceAuthority()) {
                    this.emitTelemetry("VOICE_TRANSCRIPT_REJECTED", { reason: "NO_AUTHORITY", transcript: event.transcript });
                    VoiceRuntime.setTurnState("IDLE");
                    return;
                }
                this.emitTranscript(event.transcript, true, 'user');
                if (this.maybeHandleRealtimeCommand(event.transcript, "final")) return;
                if (this.isRateLimited()) {
                    this.emitTelemetry("VOICE_TRANSCRIPT_REJECTED", { reason: "RATE_LIMITED", transcript: event.transcript });
                    VoiceRuntime.setTurnState("USER_SPEAKING");
                    return;
                }
                this.handleTranscriptWithSentiment(event.transcript);
                break;

            case "VOICE_SESSION_ENDED":
                console.log(`[AgentAdapter] Session Ended. reason=${event.reason || "unknown"}`);
                VoiceRuntime.setTurnState("IDLE");
                if (["user","pause","hard_stop","permission_denied"].includes(event.reason || "")) {
                    this.resetVoiceLifecycle(`session_ended:${event.reason}`);
                    this.hasProcessedTranscript = false;
                    break;
                }
                if (event.hadTranscript === false || !this.hasProcessedTranscript) {
                    this.scheduleSilenceReengagement(event.reason || "unknown");
                }
                this.hasProcessedTranscript = false;
                break;

            case "VOICE_SESSION_ABORTED": {
                console.log("[AgentAdapter] Session ABORTED — current state:", this.state);
                VoiceRuntime.setTurnState("IDLE");
                this.resetVoiceLifecycle("session_aborted");
                VoiceRuntime.clearSessionData();

                const bookingScreens = new Set(["ROOM_SELECT", "ROOM_PREVIEW", "BOOKING_COLLECT", "BOOKING_SUMMARY"]);

                if (bookingScreens.has(this.state)) {
                    console.log("[AgentAdapter] Silence abort during booking — preserving state, surfacing touch UI");
                    const abortSpeech = this.state === "BOOKING_COLLECT" || this.state === "BOOKING_SUMMARY"
                        ? "No worries — you can tap the fields on screen to complete your booking."
                        : "Feel free to tap the screen to continue when you're ready.";
                    this.speak(abortSpeech);
                    window.dispatchEvent(new CustomEvent("voice-fallback-to-touch", { detail: { reason: "silence_abort", screen: this.state } }));
                } else if (!["WELCOME", "ERROR", "IDLE"].includes(this.state)) {
                    this.transitionTo("WELCOME", "CANCEL_REQUESTED", { voiceRecovery: true });
                }
                break;
            }

            case "VOICE_SESSION_ERROR":
                console.warn(`[AgentAdapter] Session ERROR (${event.reason || "unknown"})`);
                VoiceRuntime.setTurnState("IDLE");
                if (event.reason === "stt_permission_denied" || event.fatal) {
                    this.resetVoiceLifecycle(`session_error:${event.reason || "fatal"}`);
                }
                break;

            case "VOICE_TRANSCRIPT_PARTIAL":
                this.clearSilenceReengageTimer("transcript_partial");
                this.resetInactivityTimer();
                this.emitTranscript(event.transcript, false, 'user');
                break;
        }
    }

    /** Extracted from VOICE_TRANSCRIPT_READY handler — sentiment + LLM handoff */
    private handleTranscriptWithSentiment(transcript: string): void {
        const emotion = this.analyzeSentiment(transcript.toLowerCase().trim());
        console.log(`[Agent] Sentiment: ${emotion} | Score: ${this.frustrationScore}`);

        if (emotion === 'URGENT') { this.escalateToHuman("I am connecting you to a supervisor immediately."); return; }
        if (emotion === 'FRUSTRATED') {
            this.frustrationScore++;
            if (this.frustrationScore >= this.frustrationThreshold) {
                this.escalateToHuman("I sense you are having trouble. Let me get a human to help.");
                return;
            }
            this.speak("I apologize. Let's try that again.");
        } else if (emotion === 'POSITIVE') {
            this.frustrationScore = 0;
        }

        console.log(`[AgentAdapter] Handing off to Brain: "${transcript}"`);
        VoiceRuntime.setTurnState("SYSTEM_RESPONDING");
        this.processWithLLMBrain(transcript)
            .then(() => setTimeout(() => VoiceRuntime.setTurnState("IDLE"), DELAY.POST_BRAIN_IDLE))
            .catch(err => { console.error("[AgentAdapter] Brain failed:", err); VoiceRuntime.setTurnState("IDLE"); });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LLM BRAIN
    // ─────────────────────────────────────────────────────────────────────────

    private async normalizeTranscriptWithBrain(transcript: string): Promise<string> {
        try {
            const res = await fetch(buildTenantApiUrl("utility/normalize"), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getTenantHeaders() },
                body: JSON.stringify({ text: transcript }),
            });
            if (!res.ok) return transcript;
            const data = await res.json();
            return data.normalizedText || transcript;
        } catch { return transcript; }
    }

    public async processWithLLMBrain(transcript: string, sessionId?: string): Promise<void> {
        if (!transcript || transcript.trim().length < 2) return;
        VoiceRuntime.pauseWatchdog();
        try {
            if (this.state === "ROOM_PREVIEW" && this.slotContext.activeSlot) this.clearActiveSlot();

            // ── Cancel confirmation gate ──────────────────────────────────────
            if (this.pendingCancelConfirmation) {
                if (this.isAffirmative(transcript)) { this.pendingCancelConfirmation = false; this.transitionTo("IDLE","RESET",{ transcript }); return; }
                if (this.isNegative(transcript))    { this.pendingCancelConfirmation = false; this.speak("Okay, continuing."); return; }
                this.speak("Please say yes to confirm cancellation, or no to continue.");
                return;
            }

            // ── Room preview early-exit shortcuts ─────────────────────────────
            if (this.state === "ROOM_PREVIEW") {
                const req = this.resolveRoomFromHint(transcript);
                if (req && !this.isSameResolvedRoom(req)) {
                    this.transitionTo("ROOM_PREVIEW","ROOM_SELECTED",{
                        transcript, room: req, selectedRoom: req, visualFocus: null,
                        speech: this.buildRoomPreviewPrompt(req),
                    }); return;
                }
                if (this.isExplicitRoomChangeRequest(transcript)) {
                    this.transitionTo("ROOM_SELECT","BACK_REQUESTED",{
                        transcript, selectedRoom: null,
                        speech: "Certainly. Let me show you the other room options so we can find a better fit.",
                    }); return;
                }
                if (this.viewData?.selectedRoom && this.shouldConfirmPreviewBooking(transcript)) {
                    this.dispatch("CONFIRM_BOOKING",{ transcript, selectedRoom: this.viewData.selectedRoom }); return;
                }
            }

            if (this.tryHandleLocalVisualPreviewQuery(transcript)) return;
            const fast = this.getFastPathIntent(transcript);
            if (fast) {
                if (fast === "CANCEL_REQUESTED" || fast === "CANCEL_BOOKING") {
                    this.pendingCancelConfirmation = true;
                    this.speak("Are you sure you want to cancel? Please say yes or no.");
                    return;
                }
                this.dispatch(fast, { transcript, room: this.viewData.selectedRoom || null }); return;
            }

            // ── LLM fetch ─────────────────────────────────────────────────────
            const requestId    = ++this.llmRequestCounter;
            const requestState = this.state;
            const BOOKING_STATES: UiState[] = ['ROOM_SELECT','ROOM_PREVIEW','BOOKING_COLLECT','BOOKING_SUMMARY'];
            const targetUrl    = BOOKING_STATES.includes(this.state)
                ? buildTenantApiUrl("chat/booking") : buildTenantApiUrl("chat");
            const backendState        = normalizeStateForBackendChat(this.state);
            const normalizedTranscript = await this.normalizeTranscriptWithBrain(transcript);
            const tenantSlug          = getTenantSlug();
            const lang                = getCurrentTenantLanguage(this.language);
            const faqEligible         = shouldUseFaqCache(normalizedTranscript, this.state);
            console.log(`[AgentAdapter][FAQCache] eligible=${faqEligible}`);

            let decision: any;

            // ── FAQ cache hit? ────────────────────────────────────────────────
            if (faqEligible) {
                const cached = await getCachedFaqAnswer(tenantSlug, normalizedTranscript, lang);
                if (cached) {
                    decision = {
                        speech: cached.answer, intent: "GENERAL_QUERY",
                        confidence: Math.max(cached.confidence, 0.92),
                        nextUiScreen: backendState,
                        accumulatedSlots: {}, extractedSlots: {}, missingSlots: [],
                        nextSlotToAsk: null, selectedRoom: null, isComplete: false,
                        answerSource: "FAQ_CACHE", faqId: cached.faqId ?? null, language: lang,
                    };
                    console.log(`[AgentAdapter][FAQCache] HIT faqId=${decision.faqId || "none"}`);
                }
            }

            // ── Network fetch (abort previous in-flight request) ──────────────
            if (!decision) {
                this.currentLLMAbort?.abort();
                this.currentLLMAbort = new AbortController();
                const res = await fetch(targetUrl, {
                    method: 'POST',
                    signal: this.currentLLMAbort.signal,
                    headers: { 'Content-Type': 'application/json', ...getTenantHeaders() },
                    body: JSON.stringify({
                        transcript, currentState: backendState,
                        sessionId: sessionId || this.getSessionId(),
                        tenantId:  getTenant()?.id ? String(getTenant()?.id) : undefined,
                        tenantSlug, language: lang,
                        activeSlot:       this.slotContext.activeSlot,
                        expectedType:     this.slotContext.expectedType,
                        lastSystemPrompt: this.slotContext.promptAsked || undefined,
                        filledSlots:      this.viewData.bookingSlots || {},
                        selectedRoom:     this.viewData.selectedRoom || undefined,
                        roomCatalog:      Array.isArray(this.viewData.rooms) ? this.viewData.rooms : undefined,
                    }),
                });
                if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
                decision = await res.json();
                console.log("[AgentAdapter] /api/chat response:", decision);

                if (decision.answerSource === "FAQ_DB") {
                    await putCachedFaqAnswer({
                        tenantSlug, langCode: lang,
                        transcript: decision.normalizedQuery || normalizedTranscript,
                        answer: decision.speech, faqId: decision.faqId ?? null,
                        confidence: decision.confidence,
                    });
                }
            }

            // ── Stale response guard ──────────────────────────────────────────
            if (requestId !== this.llmRequestCounter || this.state !== requestState) {
                console.warn(`[AgentAdapter] Ignoring stale LLM response (req=${requestId}, state=${requestState})`);
                return;
            }
            if (decision.language) this.language = decision.language;

            // ── Intent + room resolution ──────────────────────────────────────
            const rawIntent          = decision.intent;
            let strictEvent          = this.mapIntentToEvent(rawIntent);
            const backendRoom        = decision?.selectedRoom || null;
            const slotRoomHint       = decision?.accumulatedSlots?.roomType || decision?.extractedSlots?.roomType;
            const resolvedRoomHint   = this.resolveRoomFromHint(slotRoomHint);
            const isComparisonQuery  = requestState === "ROOM_SELECT" && this.isRoomComparisonQuery(transcript);
            const transcriptResolved = (this.state === "ROOM_SELECT" || this.state === "ROOM_PREVIEW")
                && !isComparisonQuery
                && (this.slotContext.activeSlot === "roomType" || this.looksLikeRoomSelectionAttempt(transcript))
                ? this.resolveRoomFromHint(transcript) : null;
            let inferredRoom = (this.state === "ROOM_SELECT" || this.state === "ROOM_PREVIEW")
                ? backendRoom || resolvedRoomHint || transcriptResolved || null : null;
            const roomChangedInPreview = requestState === "ROOM_PREVIEW" && inferredRoom && !this.isSameResolvedRoom(inferredRoom);
            const resolvedVisualFocus  = decision.visualFocus
                || ((requestState === "ROOM_PREVIEW" || requestState === "BOOKING_COLLECT")
                    ? this.inferVisualFocusFromTranscript(transcript, inferredRoom || backendRoom || this.viewData?.selectedRoom)
                    : null);

            // Replace generic visual speech with local concierge reply
            if ((requestState === "ROOM_PREVIEW" || requestState === "BOOKING_COLLECT")
                && resolvedVisualFocus && strictEvent === "GENERAL_QUERY"
                && this.isGenericVisualFallbackSpeech(decision?.speech)) {
                const local = this.buildLocalVisualConciergeReply(resolvedVisualFocus, inferredRoom || backendRoom || this.viewData?.selectedRoom);
                if (local) { decision.speech = local; if (!decision.visualFocus) decision.visualFocus = resolvedVisualFocus; }
            }

            // Upgrade intent for room selection
            if (this.state === "ROOM_SELECT" && inferredRoom && !isComparisonQuery
                && ["ROOM_SELECTED","BOOK_ROOM_SELECTED","GENERAL_QUERY"].includes(strictEvent)) strictEvent = "ROOM_SELECTED";
            if (this.state === "ROOM_PREVIEW" && roomChangedInPreview
                && ["ROOM_SELECTED","BOOK_ROOM_SELECTED","GENERAL_QUERY"].includes(strictEvent)) strictEvent = "ROOM_SELECTED";

            if (strictEvent === "CANCEL_BOOKING" || strictEvent === "CANCEL_REQUESTED") {
                this.pendingCancelConfirmation = true;
                this.speak("Are you sure you want to cancel? Please say yes or no.");
                return;
            }

            // Prevent false positives
            if ((this.state === "ROOM_SELECT" || this.state === "ROOM_PREVIEW") && strictEvent === "ROOM_SELECTED" && !inferredRoom) strictEvent = "GENERAL_QUERY";
            if (this.state === "ROOM_PREVIEW" && strictEvent === "ROOM_SELECTED" && !roomChangedInPreview) strictEvent = "GENERAL_QUERY";

            // ── Next state resolution ─────────────────────────────────────────
            let serverState = normalizeBackendStateFromResponse(decision.nextUiScreen);
            if (decision.nextUiScreen && !serverState) console.warn(`[AgentAdapter] Unknown nextUiScreen: ${decision.nextUiScreen}`);
            if (isComparisonQuery && (serverState === "ROOM_PREVIEW" || serverState === "BOOKING_COLLECT")) {
                inferredRoom = null; serverState = "ROOM_SELECT";
            }

            const previewStaysExploratory =
                requestState === "ROOM_PREVIEW" && !roomChangedInPreview &&
                !["CONFIRM_BOOKING","BOOK_ROOM_SELECTED","PROVIDE_GUESTS","PROVIDE_DATES","PROVIDE_NAME"].includes(strictEvent);
            const explicitRoomValidFail =
                requestState === "ROOM_SELECT" && serverState === "ROOM_SELECT" &&
                /could not validate that room|pick a room shown on screen|we don't have/i.test(String(decision?.speech || ""));

            if (requestState === "ROOM_SELECT" && inferredRoom && serverState === "BOOKING_COLLECT"
                && ["ROOM_SELECTED","BOOK_ROOM_SELECTED","GENERAL_QUERY"].includes(strictEvent)) serverState = "ROOM_PREVIEW";
            if (previewStaysExploratory && serverState === "BOOKING_COLLECT") serverState = "ROOM_PREVIEW";
            if (previewStaysExploratory && (serverState === "WELCOME" || serverState === "IDLE" || serverState === null)) {
                console.warn(`[AgentAdapter] Blocking regressive preview: ${requestState} -> ${serverState}`);
                serverState = "ROOM_PREVIEW";
            }

            const normSlots     = previewStaysExploratory ? {} : (decision.accumulatedSlots || decision.extractedSlots);
            const normMissing   = previewStaysExploratory ? [] : decision.missingSlots;
            const normNextSlot  = previewStaysExploratory ? null : decision.nextSlotToAsk;
            const missingSlots  = Array.isArray(decision?.missingSlots) ? decision.missingSlots : [];
            const hasError      = Boolean(decision?.error);
            const isIncomplete  = decision?.isComplete === false || missingSlots.length > 0;

            // ROOM_SELECT -> BOOKING_COLLECT without room: block
            if (requestState === "ROOM_SELECT" && serverState === "BOOKING_COLLECT"
                && !backendRoom && !resolvedRoomHint && !transcriptResolved) {
                console.warn("[AgentAdapter] Blocking ROOM_SELECT -> BOOKING_COLLECT: no resolved room");
                this.applyPayloadData("GENERAL_QUERY", { ...decision, nextUiScreen: "ROOM_SELECT", speech: "I could not confirm which room you selected. Please choose a room shown on screen.", backendDecision: true }, "ROOM_SELECT");
                this.notifyListeners(); return;
            }

            // ROOM_SELECT without inferred room — trust backend speech if it stayed
            if (requestState === "ROOM_SELECT" && (!inferredRoom || explicitRoomValidFail)
                && !this.isRoomInfoQuery(transcript)
                && ["GENERAL_QUERY","BOOK_ROOM_SELECTED","ROOM_SELECTED"].includes(strictEvent)) {
                const stayed   = !serverState || serverState === requestState;
                const hasSpeech = Boolean(decision?.speech);
                if (stayed && hasSpeech) {
                    this.speak(decision.speech);
                    this.applyPayloadData("GENERAL_QUERY", { ...decision, nextUiScreen: "ROOM_SELECT", backendDecision: true, selectedRoom: null }, "ROOM_SELECT");
                    this.notifyListeners(); return;
                }
                this.applyPayloadData("GENERAL_QUERY", { ...decision, nextUiScreen: "ROOM_SELECT", speech: "I could not confirm which room you selected. Please choose a room shown on screen.", backendDecision: true, selectedRoom: null }, "ROOM_SELECT");
                this.notifyListeners(); return;
            }

            // CONFIRM_BOOKING on BOOKING_SUMMARY
            if (strictEvent === "CONFIRM_BOOKING" && requestState === "BOOKING_SUMMARY") {
                this.pendingConfirmToken = null;
                if (serverState === "BOOKING_COLLECT" && (isIncomplete || hasError)) {
                    this.applyPayloadData(strictEvent, { ...decision, error: decision?.error || "Booking details are incomplete.", backendDecision: true }, requestState);
                    this.notifyListeners(); return;
                }
            }
            const isRegressiveConfirm =
                strictEvent === "CONFIRM_BOOKING" && serverState === "BOOKING_COLLECT" &&
                getBookingProgressRank(requestState) >= getBookingProgressRank("BOOKING_SUMMARY") &&
                !isIncomplete && !hasError;
            if (isRegressiveConfirm) console.warn(`[AgentAdapter] Ignoring regressive confirm: ${requestState} -> ${serverState}`);

            const willTransition = Boolean(serverState && serverState !== this.state && !isRegressiveConfirm);
            const basePayload = {
                transcript, ...decision, nextUiScreen: serverState,
                selectedRoom: backendRoom, room: inferredRoom,
                slots: normSlots, missingSlots: normMissing, nextSlotToAsk: normNextSlot,
                error: decision.error, visualFocus: resolvedVisualFocus,
                backendDecision: true, backendSpeechSpoken: false,
            };

            if (willTransition && serverState) {
                this.transitionTo(serverState, strictEvent, basePayload);
            } else {
                const spoken = Boolean(decision.speech);
                if (decision.speech) this.speak(decision.speech);
                const hasDelta = Boolean(backendRoom || inferredRoom || normSlots || normMissing || normNextSlot !== undefined || resolvedVisualFocus);
                if (strictEvent !== 'GENERAL_QUERY' || hasDelta) {
                    this.dispatch(strictEvent as Intent, { ...basePayload, backendSpeechSpoken: spoken });
                }
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') { console.debug("[AgentAdapter] LLM fetch aborted"); return; }
            console.error("[AgentAdapter] LLM Error:", err);
            this.speak("Please use the touch screen.");
        } finally {
            VoiceRuntime.resumeWatchdog();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SESSION
    // ─────────────────────────────────────────────────────────────────────────

    private getSessionId(): string {
        if (!this.sessionId) this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return this.sessionId;
    }

    public getCurrentSessionId(): string { return this.getSessionId(); }

    private releaseBackendChatSession(sessionId: string, reason: string, keepalive = false): void {
        fetch(`${buildTenantApiUrl("chat")}/${encodeURIComponent(sessionId)}`, {
            method: "DELETE", headers: getTenantHeaders(), keepalive,
        }).then(() => console.log(`[AgentAdapter] Session cleared (${reason}): ${sessionId}`))
          .catch(err => console.warn(`[AgentAdapter] Failed to clear session (${reason}):`, err));
    }

    public clearSession(reason = "manual_reset", options?: { keepalive?: boolean }): void {
        const prev = this.sessionId;
        this.sessionId = null;
        this.clearActiveSlot();
        if (prev) this.releaseBackendChatSession(prev, reason, Boolean(options?.keepalive));
        console.log(`[AgentAdapter] Session cleared (${reason})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSITION
    // ─────────────────────────────────────────────────────────────────────────

    private transitionTo(nextState: UiState, intent?: string, payload?: any): void {
        console.log(`[Mediator] Requesting: ${this.state} -> ${nextState}`);

        if (nextState === "ROOM_SELECT" || nextState === "ROOM_PREVIEW") {
            if (typeof RoomService.prefetchAvailableRooms === "function") {
                void RoomService.prefetchAvailableRooms();
            } else {
                void RoomService.getAvailableRooms().catch(err => console.warn("[AgentAdapter] Room prefetch failed:", err));
            }
        }

        if (nextState === this.state) {
            console.log(`[Mediator] Conversational turn (staying on ${this.state})`);
            return;
        }

        const prev = this.state;
        this.clearKeyDispenseTimer(`transition:${prev}->${nextState}`);
        this.state = nextState;
        VoiceRuntime.setCurrentScreen(nextState);

        if (this.pendingVoiceConfirm) this.setInteractionMode(this.interactionMode, { pendingVoiceConfirm: false, reason: `transition:${prev}->${nextState}` });

        // Interaction mode adjustments per target state
        if      (nextState === "MANUAL_MENU")                { this.setInteractionMode("manual", { pendingVoiceConfirm: false, reason: `transition:${prev}->${nextState}` }); }
        else if (nextState === "AI_CHAT" || nextState === "IDLE") { this.setInteractionMode("voice",  { pendingVoiceConfirm: false, reason: `transition:${prev}->${nextState}` }); }
        else if (prev === "IDLE" && nextState === "WELCOME")  { this.setInteractionMode("voice",  { pendingVoiceConfirm: false, reason: `transition:${prev}->${nextState}` }); }

        if (nextState === "WELCOME" || nextState === "IDLE") this.clearSession(`transition:${prev}->${nextState}`);
        if (nextState !== "BOOKING_COLLECT") { this.clearActiveSlot(); this.lastBookingPromptFingerprint = null; this.lastBookingPromptAt = 0; }
        if (nextState !== "ROOM_PREVIEW" && nextState !== "BOOKING_COLLECT") { this.lastVisualPreviewCategory = null; }

        this.applyPayloadData(intent || 'UNKNOWN', payload, nextState);
        this.resetInactivityTimer();
        this.hasAnnouncedRoomOptions = false;

        VoiceRuntime.updateTimeouts(
            ["ROOM_SELECT","ROOM_PREVIEW","BOOKING_COLLECT","PAYMENT"].includes(nextState)
                ? TIMEOUT.COMPLEX_SCREEN_NO_SPEECH : TIMEOUT.DEFAULT_NO_SPEECH,
            ["ROOM_SELECT","ROOM_PREVIEW","BOOKING_COLLECT","PAYMENT"].includes(nextState)
                ? TIMEOUT.COMPLEX_SCREEN_NO_RESULT : TIMEOUT.DEFAULT_NO_RESULT,
        );

        this.resetVoiceLifecycle(`transition:${prev}->${nextState}`);
        VoiceRuntime.stopSpeaking();
        VoiceRuntime.stopListening();
        this.notifyListeners();

        const spokeRoom    = this.state === "ROOM_SELECT"    ? this.maybeSpeakRoomSelectionGuidance(payload)  : false;
        const spokePreview = this.state === "ROOM_PREVIEW"   ? this.maybeSpeakRoomPreviewGuidance(payload)    : false;
        const spokeBooking = this.state === "BOOKING_COLLECT" ? this.maybeSpeakBookingCollectGuidance(payload, { preferBackendSpeech: true }) : false;

        if (this.hasVoiceAuthority()) {
            if (nextState === 'WELCOME' && prev === 'IDLE') {
                const tenantName = getTenant()?.name || "our hotel";
                this.speak(this.pickLocalizedText({
                    en: `Welcome to ${tenantName}. I'm Siya, your hotel assistant. I can help you check in, explore rooms, or guide you through a booking. How may I help you today?`,
                    hi: `${tenantName} में आपका स्वागत है। मैं आज आपकी कैसे सहायता कर सकती हूँ?`,
                    mr: `${tenantName} मध्ये तुमचे स्वागत आहे. आज मी तुमची कशी मदत करू शकते?`,
                }));
            } else if (!spokeRoom && !spokePreview && !spokeBooking) {
                this.scheduleListeningRestart(DELAY.WELCOME_GREETING_LISTEN, "state_transition");
            }
        }

        if (nextState === "KEY_DISPENSING") this.scheduleKeyDispenseCompletion();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    public handleIntent(intent: string, payload?: any): void {
        console.log(`[AgentAdapter] 👆 Handle Intent (Touch): ${intent}`, payload || '');
        this.resetInactivityTimer();

        // ── Voice mode management ─────────────────────────────────────────────
        if (intent === "VOICE_MODE_REQUESTED") {
            if (this.interactionMode === "voice") {
                this.setInteractionMode("voice", { pendingVoiceConfirm: false, reason: intent });
                if (this.hasVoiceAuthority()) this.scheduleListeningRestart(DELAY.VOICE_MODE_LISTEN, "state_transition");
                this.notifyListeners(); return;
            }
            this.setInteractionMode("manual", { pendingVoiceConfirm: true, reason: intent });
            this.notifyListeners(); return;
        }
        if (intent === "VOICE_MODE_CONFIRMED") {
            this.setInteractionMode("voice", { pendingVoiceConfirm: false, reason: intent });
            if (this.hasVoiceAuthority()) this.scheduleListeningRestart(DELAY.VOICE_MODE_LISTEN, "state_transition");
            this.notifyListeners(); return;
        }
        if (intent === "VOICE_MODE_CANCELLED") {
            this.setInteractionMode("manual", { pendingVoiceConfirm: false, reason: intent });
            this.notifyListeners(); return;
        }
        if (intent === "MANUAL_MODE_REQUESTED") {
            this.setInteractionMode("manual", { pendingVoiceConfirm: false, reason: intent });
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop(); VoiceRuntime.hardStopAll();
            this.notifyListeners(); return;
        }

        // ── Booking field edits ───────────────────────────────────────────────
        if (intent === "BOOKING_FIELDS_EDIT_STARTED" && this.state === "BOOKING_COLLECT") {
            this.manualEditModeActive = true;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop(); VoiceRuntime.stopListening();
            if (this.interactionMode === "voice") this.speak(this.buildManualEditPrompt());
            return;
        }
        if (intent === "BOOKING_FIELDS_EDIT_CANCELLED" && this.state === "BOOKING_COLLECT") {
            this.manualEditModeActive = false;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            this.notifyListeners();
            if (this.hasVoiceAuthority()) this.scheduleListeningRestart(DELAY.BOOKING_FIELDS_LISTEN, "state_transition");
            return;
        }
        if (intent === "BOOKING_FIELDS_UPDATED" && this.state === "BOOKING_COLLECT") {
            this.manualEditModeActive = false;
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop(); VoiceRuntime.stopListening();
            this.applyPayloadData(intent, payload, this.state);
            this.notifyListeners();
            if (this.interactionMode === "voice") this.speak(this.buildManualReviewPrompt(this.getBookingSlots(), this.viewData.selectedRoom));
            return;
        }

        // ── Booking confirmation shortcuts ────────────────────────────────────
        if (intent === "CONFIRM_PAYMENT" && this.state === "BOOKING_SUMMARY") {
            const expectedState = this.state;
            const token = ++this.confirmRequestCounter;
            this.pendingConfirmToken = token;
            void this.processWithLLMBrain("confirm booking", this.getSessionId());
            setTimeout(() => {
                if (this.pendingConfirmToken !== token) return;
                if (this.state === expectedState && !this.viewData?.bookingError) {
                    console.warn("[AgentAdapter] Backend confirm timeout");
                    this.applyPayloadData("CONFIRM_PAYMENT", { backendDecision: true, error: "Booking confirmation timed out. Please confirm again." }, this.state);
                    this.notifyListeners();
                }
            }, DELAY.CONFIRM_TIMEOUT);
            return;
        }
        if (intent === "CONFIRM_PAYMENT" && this.state === "PAYMENT" && !this.viewData?.persistedBookingId) {
            console.warn("[AgentAdapter] Blocking PAYMENT: missing persistedBookingId");
            this.applyPayloadData("CONFIRM_PAYMENT", { backendDecision: true, error: "Booking is not confirmed in backend yet." }, "BOOKING_SUMMARY");
            this.transitionTo("BOOKING_SUMMARY","BACK_REQUESTED",{ error: "Booking is not confirmed in backend yet." });
            return;
        }

        // ── Touch authority interrupts ────────────────────────────────────────
        const INTERRUPT_INTENTS = new Set([
            "CHECK_IN_SELECTED","BOOK_ROOM_SELECTED","HELP_SELECTED","SCAN_COMPLETED",
            "ROOM_SELECTED","CONFIRM_PAYMENT","BACK_REQUESTED","RESET","TOUCH_SELECTED",
            "CANCEL_REQUESTED","PROXIMITY_DETECTED","SCAN_ID_SELECTED","PAYMENT_SELECTED",
        ]);

        if (intent === "PROXIMITY_DETECTED" && this.state === "IDLE") {
            this.setInteractionMode("voice", { pendingVoiceConfirm: false, reason: intent });
        }
        if (intent === "TOUCH_SELECTED" && this.state === "WELCOME") {
            this.setInteractionMode("manual", { pendingVoiceConfirm: false, reason: intent });
        }

        if (INTERRUPT_INTENTS.has(intent)) {
            console.log("[AgentAdapter] 👆 Touch Interrupt. Killing Audio.");
            this.resetVoiceLifecycle(`interrupt:${intent}`);
            TTSController.hardStop(); VoiceRuntime.stopListening();
            if (intent === "TOUCH_SELECTED" && this.state === "AI_CHAT") {
                console.log("[AgentAdapter] User touched to stop listening."); return;
            }
        }

        const nextState = this.resolveNextStateFromIntent(this.state, intent);
        if (nextState !== this.state) {
            this.transitionTo(nextState, intent, payload);
        } else {
            this.applyPayloadData(intent, payload, nextState);
            this.notifyListeners();
            if (this.state === "ROOM_SELECT" && intent === "GENERAL_QUERY"
                && Array.isArray(payload?.rooms) && payload.rooms.length > 0
                && !payload?.suppressSpeech && !this.hasAnnouncedRoomOptions) {
                this.maybeSpeakRoomSelectionGuidance(payload);
            }
        }
    }

    public dispatch(intent: Intent, payload?: any): void {
        this.resetInactivityTimer();
        let effective = intent;
        if (payload?.isComplete === true && !payload?.backendDecision
            && this.state === "BOOKING_COLLECT"
            && intent !== "CANCEL_BOOKING" && intent !== "BACK_REQUESTED") {
            effective = "CONFIRM_BOOKING";
        }
        const next = this.resolveNextStateFromIntent(this.state, effective);
        if (next !== this.state) {
            this.transitionTo(next, effective, payload);
        } else {
            this.applyPayloadData(effective, payload, next);
            this.notifyListeners();
            if (this.state === "BOOKING_COLLECT" && payload?.backendDecision && payload?.backendSpeechSpoken !== true) {
                this.maybeSpeakBookingCollectGuidance(payload, { preferBackendSpeech: true });
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CAPTIONS
    // ─────────────────────────────────────────────────────────────────────────

    public onTranscript(listener: (text: string, isFinal: boolean, source: 'user' | 'ai') => void): () => void {
        this.transcriptListeners.add(listener);
        return () => this.transcriptListeners.delete(listener);
    }

    private emitTranscript(text: string, isFinal: boolean, source: 'user' | 'ai'): void {
        this.transcriptListeners.forEach(l => l(text, isFinal, source));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPEECH
    // ─────────────────────────────────────────────────────────────────────────

    /** Returns false when speech is suppressed (manual mode), true when dispatched */
    public speak(text: string): boolean {
        if (this.interactionMode !== "voice") {
            console.debug("[AgentAdapter] speak() suppressed: manual mode");
            return false;
        }
        this.maybeTrackSlotFromPrompt(text);
        this.pendingAiSpeechText = text;
        void VoiceRuntime.speak(text, getCurrentTenantLanguage(this.language));
        return true;
    }

    public stopSpeech(): void  { VoiceRuntime.stopSpeaking(); }
    public isSpeaking(): boolean { return VoiceRuntime.getMode() === 'speaking'; }

    public hardStopAll(): void {
        this.resetVoiceLifecycle("hard_stop_all");
        this.clearKeyDispenseTimer("hard_stop_all");
        this.clearSession("hard_stop_all");
        VoiceRuntime.hardStopAll();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GETTERS
    // ─────────────────────────────────────────────────────────────────────────

    public getState(): UiState { return this.state; }
    public getSlotContext(): SlotContext { return { ...this.slotContext }; }
    public getBookingSlots(): Record<string, unknown> { return { ...(this.viewData.bookingSlots || {}) }; }

    public subscribe(listener: (state: UiState, data?: any) => void): () => void {
        this.listeners.add(listener);
        listener(this.state, this.buildFullData());
        return () => this.listeners.delete(listener);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEBUG / HMR
    // ─────────────────────────────────────────────────────────────────────────

    public _reset(): void {
        this.state = "IDLE";
        VoiceRuntime.setCurrentScreen("IDLE");
        this.setInteractionMode("voice", { pendingVoiceConfirm: false, reason: "reset" });
        this.manualEditModeActive = false;
        this.lastIntent           = null;
        this.lastIntentTime       = 0;
        this.intentTimestamps     = [];
        this.clearActiveSlot();
        this.notifyListeners();
    }

    public destroy(): void {
        this.disposers.forEach(u => u());
        this.disposers = [];
        this.listeners.clear();
        this.transcriptListeners.clear();
        [this.inactivityTimer, this.listeningRestartTimer, this.silenceReengageTimer, this.keyDispenseCompleteTimer].forEach(t => {
            if (t) clearTimeout(t);
        });
        this.inactivityTimer = this.listeningRestartTimer = this.silenceReengageTimer = this.keyDispenseCompleteTimer = null;
        console.log("[AgentAdapter] Destroyed (HMR cleanup)");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON + HMR
// ─────────────────────────────────────────────────────────────────────────────

export const AgentAdapter = new AgentAdapterService();

if (import.meta.hot) {
    import.meta.hot.dispose(() => { AgentAdapter.destroy(); });
}
