import { Intent } from "../contracts/intents";

// Minimal State Definition to satisfy the agent's need to know state
export type UiState =
    | "IDLE"
    | "WELCOME"
    | "AI_CHAT"
    | "MANUAL_MENU"
    | "SCAN_ID"
    | "ROOM_SELECT"
    | "PAYMENT"
    | "KEY_DISPENSING"
    | "COMPLETE"
    | "ERROR";

export type AgentResponse = {
    ui_state: UiState;
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
    // States where Voice is ignored (Redundant but explicit)
    SCAN_ID: {},
    PAYMENT: {},
    KEY_DISPENSING: {},
    COMPLETE: {},
    ERROR: {},
};

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
        BACK_REQUESTED: "MANUAL_MENU", // Logical previous for both flows (or effectively restart)
        CANCEL_REQUESTED: "WELCOME",
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
        TOUCH_SELECTED: "WELCOME", // Dismiss
    }
};

export const processIntent = (intent: Intent, currentState: UiState): AgentResponse => {
    const allowedTransitions = TRANSITION_TABLE[currentState];

    if (allowedTransitions && allowedTransitions[intent]) {
        const nextState = allowedTransitions[intent]!;
        console.log(`[Agent] Transition Allowed: ${currentState} + ${intent} -> ${nextState}`);
        return { ui_state: nextState };
    }

    // Explicit rejection (No-Op)
    // console.warn(`[Agent] Transition REJECTED: ${currentState} + ${intent} -> (staying in ${currentState})`);
    return { ui_state: currentState };
};
