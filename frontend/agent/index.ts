import { Intent } from "@contracts/intents";

// Minimal State Definition to satisfy the agent's need to know state
export type UiState =
    | "IDLE"
    | "WELCOME"
    | "AI_CHAT"
    | "MANUAL_MENU"
    | "SCAN_ID"
    | "ROOM_SELECT"
    | "BOOKING_COLLECT"
    | "BOOKING_SUMMARY"
    | "PAYMENT"
    | "KEY_DISPENSING"
    | "COMPLETE"
    | "ERROR";

// Phase 9.3: AgentResponse now includes optional speech
export type AgentResponse = {
    ui_state: UiState;
    speech?: string;  // Optional TTS output
};

// Phase 9.3: State-based speech responses (deterministic, no LLM)
// Maps state transitions to spoken responses
export const STATE_SPEECH_MAP: Partial<Record<UiState, string>> = {
    WELCOME: "Welcome to Grand Hotel. How may I assist you today?",
    AI_CHAT: "I'm listening. You can say check in, book a room, or ask for help.",
    MANUAL_MENU: "Please select an option from the menu.",
    SCAN_ID: "Please scan your ID or passport.",
    ROOM_SELECT: "Please select your preferred room.",
    BOOKING_COLLECT: "Let me help you book a room. I'll need a few details.",
    BOOKING_SUMMARY: "Let me confirm your booking details.",
    PAYMENT: "Please complete your payment.",
    KEY_DISPENSING: "Please wait while I prepare your key.",
    COMPLETE: "Thank you for choosing Grand Hotel. Enjoy your stay.",
    ERROR: "I'm sorry, something went wrong. Please tap to try again.",
};

// Phase 3: Input Modes & Voice Mapping (Design Only)
export type InputMode = "VOICE" | "TOUCH";

// 1. Allowed Input Modes per State
// Defines strictly where Voice is allowed.
// If a state is not listed or does not include "VOICE", voice input is IGNORED.
export const STATE_INPUT_MODES: Record<UiState, InputMode[]> = {
    IDLE: [], // Proximity only
    WELCOME: ["VOICE", "TOUCH"],
    AI_CHAT: ["VOICE", "TOUCH"],
    MANUAL_MENU: ["VOICE", "TOUCH"],
    SCAN_ID: ["TOUCH"], // Security/Hardware focus - Voice ignored
    ROOM_SELECT: ["VOICE", "TOUCH"], // Voice allowed for nav commands
    BOOKING_COLLECT: ["VOICE", "TOUCH"], // Conversational booking - Voice primary
    BOOKING_SUMMARY: ["VOICE", "TOUCH"], // Confirmation - Both allowed
    PAYMENT: ["TOUCH"], // Security/Privacy - Voice ignored
    KEY_DISPENSING: [], // Hardware lock - No input
    COMPLETE: ["TOUCH"], // Tap to finish/restart
    ERROR: ["TOUCH"], // Tap to dismiss
};

// 2. Voice -> Intent Mapping
// Defines valid NLU-derived commands per state.
// This serves as the Source of Truth for the NLU layer.
export const VOICE_COMMAND_MAP: Record<UiState, Partial<Record<string, Intent>>> = {
    IDLE: {},
    WELCOME: {
        "check in": "CHECK_IN_SELECTED",
        "book room": "BOOK_ROOM_SELECTED",
        "i need a room": "BOOK_ROOM_SELECTED",
    },
    AI_CHAT: {
        "check in": "CHECK_IN_SELECTED",
        "book room": "BOOK_ROOM_SELECTED",
        "go back": "BACK_REQUESTED",
        "cancel": "CANCEL_REQUESTED",
    },
    MANUAL_MENU: {
        "check in": "CHECK_IN_SELECTED",
        "book room": "BOOK_ROOM_SELECTED",
        "go back": "BACK_REQUESTED",
        "cancel": "CANCEL_REQUESTED",
    },
    ROOM_SELECT: {
        "go back": "BACK_REQUESTED",
        "cancel": "CANCEL_REQUESTED",
    },
    BOOKING_COLLECT: {
        "go back": "BACK_REQUESTED",
        "cancel": "CANCEL_BOOKING",
    },
    BOOKING_SUMMARY: {
        "confirm": "CONFIRM_PAYMENT",
        "go back": "BACK_REQUESTED",
        "cancel": "CANCEL_BOOKING",
    },
    // States where Voice is ignored (Redundant but explicit)
    SCAN_ID: {},
    PAYMENT: {},
    KEY_DISPENSING: {},
    COMPLETE: {},
    ERROR: {},
};

// Phase 4: Error Taxonomy & Recovery Rules (Design Only)
// Taxonomy:
// - USER_ERROR: Invalid input, timeouts, unreadable ID.
// - SYSTEM_ERROR: Network failure, backend outage.
// - HARDWARE_ERROR: Scanner jam, dispenser empty, printer failure.
//
// Entry Rules:
// - Allowed from OPERATIONAL states only (SCAN_ID, ROOM_SELECT, PAYMENT, KEY_DISPENSING).
// - NOT allowed from PASSIVE states (IDLE, WELCOME).
//
// Exit Rules:
// - TOUCH_SELECTED -> WELCOME (Semantic: ACKNOWLEDGE_ERROR -> Re-engage)
// - CANCEL_REQUESTED -> WELCOME (Reset)
// - BACK_REQUESTED -> WELCOME (Dismiss)

// Phase 5: Timeout & Silence Semantics (Design Only)
// Taxonomy:
// - TIMEOUT (Generic): User walked away or is unresponsive.
//
// Mapping Strategy:
// - contracts/intents.ts restriction prevents adding "TIMEOUT" intent.
// - DECISION: Timeout events must generate a `CANCEL_REQUESTED` intent.
// - CRITICAL DISTINCTION: User-initiated CANCEL and System-initiated TIMEOUT share the 
//   same recovery path (WELCOME) but differ in ORIGIN. Future logging must preserve this.
//
// Semantics per State:
// - WELCOME, IDLE: No-Op (Passive).
// - MANUAL_MENU, SCAN_ID, ROOM_SELECT, PAYMENT: Soft Reset -> WELCOME.
// - AI_CHAT: Soft Reset -> WELCOME (Silence = Disengagement, not Error).
// - ERROR: Soft Reset -> WELCOME.
// - COMPLETE: Exempt (Has independent internal lifecycle/timer).
// - KEY_DISPENSING: Ignored (Hardware critical).

// Phase 6: State Persistence & Session Semantics (Design Only)
// Session Model:
// - "STATELESS KIOSK MODEL": All user interaction state is ephemeral and DISCARDED on restart.
//
// Lifecycle:
// - Start: Interaction from IDLE.
// - End: TIMEOUT, CANCEL, or COMPLETE.
//
// Persistence Rules:
// - Persistent State: NONE.
// - Rationale: Privacy & Security. We literally cannot afford to persist PII (ID scans, Credit Cards)
//   across a hard crash. The safest default is a hard wipe.
//
// Restart Behavior:
// - ALL STATES -> WELCOME.
// - Rationale: `ERROR` is a runtime semantic; RESTART is a system boundary.
//   Meaning: If we crash, we don't restore to "Error Screen" (which implies a runtime context).
//   We restore to "Welcome Screen" (System Ready).

// Strict State Transition Table
// Phase 2: Includes Back/Cancel Semantics & Booking Flow
const TRANSITION_TABLE: Record<UiState, Partial<Record<Intent, UiState>>> = {
    IDLE: {
        PROXIMITY_DETECTED: "WELCOME",
    },
    WELCOME: {
        TOUCH_SELECTED: "MANUAL_MENU",
        VOICE_STARTED: "AI_CHAT",
        BOOK_ROOM_SELECTED: "ROOM_SELECT",
    },
    AI_CHAT: {
        CHECK_IN_SELECTED: "SCAN_ID",
        BOOK_ROOM_SELECTED: "ROOM_SELECT",
        BACK_REQUESTED: "WELCOME",
        CANCEL_REQUESTED: "WELCOME",
    },
    MANUAL_MENU: {
        CHECK_IN_SELECTED: "SCAN_ID",
        BOOK_ROOM_SELECTED: "ROOM_SELECT",
        BACK_REQUESTED: "WELCOME",
        CANCEL_REQUESTED: "WELCOME",
    },
    SCAN_ID: {
        BACK_REQUESTED: "MANUAL_MENU",
        CANCEL_REQUESTED: "WELCOME",
    },
    ROOM_SELECT: {
        ROOM_SELECTED: "BOOKING_COLLECT",
        BACK_REQUESTED: "MANUAL_MENU", // Logical previous for both flows (or effectively restart)
        CANCEL_REQUESTED: "WELCOME",
    },
    BOOKING_COLLECT: {
        // Booking intents (keep user in BOOKING_COLLECT while collecting)
        PROVIDE_GUESTS: "BOOKING_COLLECT",
        PROVIDE_DATES: "BOOKING_COLLECT",
        PROVIDE_NAME: "BOOKING_COLLECT",
        SELECT_ROOM: "BOOKING_COLLECT",
        ASK_ROOM_DETAIL: "BOOKING_COLLECT",
        ASK_PRICE: "BOOKING_COLLECT",
        GENERAL_QUERY: "BOOKING_COLLECT",
        MODIFY_BOOKING: "BOOKING_COLLECT",
        // Completion: all slots filled → summary
        CONFIRM_BOOKING: "BOOKING_SUMMARY",
        // Escape hatches
        CANCEL_BOOKING: "ROOM_SELECT",
        BACK_REQUESTED: "ROOM_SELECT",
        HELP_SELECTED: "BOOKING_COLLECT",
        RESET: "IDLE",
    },
    BOOKING_SUMMARY: {
        // User confirms → proceed to payment
        CONFIRM_PAYMENT: "PAYMENT",
        // User wants to change something → back to collection
        MODIFY_BOOKING: "BOOKING_COLLECT",
        BACK_REQUESTED: "BOOKING_COLLECT",
        CANCEL_BOOKING: "WELCOME",
        RESET: "IDLE",
    },
    PAYMENT: {
        BACK_REQUESTED: "ROOM_SELECT",
        CANCEL_REQUESTED: "WELCOME",
    },
    KEY_DISPENSING: {
        // No interruptions allowed
    },
    COMPLETE: {
        PROXIMITY_DETECTED: "WELCOME", // New session
    },
    ERROR: {
        CANCEL_REQUESTED: "WELCOME",
        TOUCH_SELECTED: "WELCOME", // Semantic: Acknowledge Error
        BACK_REQUESTED: "WELCOME", // Dismiss
    }
};

// Pure Function Implementation
// - `injectLog` is optional to keep the function pure during testing or quiet updates.
export const processIntent = (intent: Intent, currentState: UiState, injectLog?: (msg: string) => void): AgentResponse => {
    const allowedTransitions = TRANSITION_TABLE[currentState];

    if (allowedTransitions && allowedTransitions[intent]) {
        const nextState = allowedTransitions[intent]!;
        if (injectLog) {
            injectLog(`[Agent] Transition Allowed: ${currentState} + ${intent} -> ${nextState}`);
        } else {
            console.log(`[Agent] Transition Allowed: ${currentState} + ${intent} -> ${nextState}`);
        }
        // Phase 9.3: Include speech for this state transition
        const speech = STATE_SPEECH_MAP[nextState];
        return { ui_state: nextState, speech };
    }

    // Explicit rejection (No-Op)
    return { ui_state: currentState };
};
