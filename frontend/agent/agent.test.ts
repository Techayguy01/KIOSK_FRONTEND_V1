import { processIntent, UiState } from "./index";
import { Intent } from "@contracts/intents";
import { strict as assert } from "assert";

// Mock logger to keep tests clean
const noOpLog = () => { };

console.log("Starting Agent Runtime Verification...");

// 1. Verify Valid Transitions (The Golden Path + Branches)
const validTransitions: { start: UiState; intent: Intent; expected: UiState }[] = [
    // IDLE -> WELCOME
    { start: "IDLE", intent: "PROXIMITY_DETECTED", expected: "WELCOME" },

    // WELCOME -> ...
    { start: "WELCOME", intent: "TOUCH_SELECTED", expected: "MANUAL_MENU" },
    { start: "WELCOME", intent: "VOICE_STARTED", expected: "AI_CHAT" },
    { start: "WELCOME", intent: "BOOK_ROOM_SELECTED", expected: "ROOM_SELECT" },

    // MANUAL_MENU -> ...
    { start: "MANUAL_MENU", intent: "CHECK_IN_SELECTED", expected: "SCAN_ID" },
    { start: "MANUAL_MENU", intent: "BOOK_ROOM_SELECTED", expected: "ROOM_SELECT" },
    { start: "MANUAL_MENU", intent: "BACK_REQUESTED", expected: "WELCOME" },
    { start: "MANUAL_MENU", intent: "CANCEL_REQUESTED", expected: "WELCOME" },

    // AI_CHAT -> ...
    { start: "AI_CHAT", intent: "CHECK_IN_SELECTED", expected: "SCAN_ID" },
    { start: "AI_CHAT", intent: "BOOK_ROOM_SELECTED", expected: "ROOM_SELECT" },
    { start: "AI_CHAT", intent: "BACK_REQUESTED", expected: "WELCOME" },
    { start: "AI_CHAT", intent: "CANCEL_REQUESTED", expected: "WELCOME" }, // Silence/Timeout handled via Cancel

    // SCAN_ID -> ...
    { start: "SCAN_ID", intent: "BACK_REQUESTED", expected: "MANUAL_MENU" },
    { start: "SCAN_ID", intent: "CANCEL_REQUESTED", expected: "WELCOME" }, // Timeout also maps here

    // ROOM_SELECT -> ...
    { start: "ROOM_SELECT", intent: "BACK_REQUESTED", expected: "MANUAL_MENU" },
    { start: "ROOM_SELECT", intent: "CANCEL_REQUESTED", expected: "WELCOME" },

    // PAYMENT -> ...
    { start: "PAYMENT", intent: "BACK_REQUESTED", expected: "ROOM_SELECT" },
    { start: "PAYMENT", intent: "CANCEL_REQUESTED", expected: "WELCOME" },

    // ERROR -> ...
    { start: "ERROR", intent: "TOUCH_SELECTED", expected: "WELCOME" }, // Acknowledge
    { start: "ERROR", intent: "BACK_REQUESTED", expected: "WELCOME" }, // Dismiss
    { start: "ERROR", intent: "CANCEL_REQUESTED", expected: "WELCOME" }, // Reset

    // COMPLETE -> ...
    { start: "COMPLETE", intent: "PROXIMITY_DETECTED", expected: "WELCOME" }, // New Session
];

console.log(`[TEST] Verifying ${validTransitions.length} Valid Transitions...`);
validTransitions.forEach(({ start, intent, expected }) => {
    const response = processIntent(intent, start, noOpLog);
    assert.equal(response.ui_state, expected, `Failed Valid Transition: ${start} + ${intent} should contain ${expected} `);
});
console.log("✅ All Valid Transitions Passed.");

// 2. Verify Invalid Transitions (Should be No-Op)
const invalidTransitions: { start: UiState; intent: Intent }[] = [
    { start: "IDLE", intent: "TOUCH_SELECTED" }, // Must wake up first
    { start: "SCAN_ID", intent: "CHECK_IN_SELECTED" }, // Already there
    { start: "KEY_DISPENSING", intent: "CANCEL_REQUESTED" }, // Hardware Lock
    { start: "KEY_DISPENSING", intent: "BACK_REQUESTED" }, // Hardware Lock
    { start: "PAYMENT", intent: "CHECK_IN_SELECTED" }, // Invalid jump
];

console.log(`[TEST] Verifying ${invalidTransitions.length} Invalid Transitions (No-Op)...`);
invalidTransitions.forEach(({ start, intent }) => {
    const response = processIntent(intent, start, noOpLog);
    assert.equal(response.ui_state, start, `Failed Invalid Transition: ${start} + ${intent} should remain ${start}`);
});
console.log("✅ All Invalid Transitions Passed (No-Op Confirmed).");

// 3. Verify Determinism (Same input = Same output)
console.log("[TEST] Verifying Determinism...");
const startState: UiState = "WELCOME";
const intent: Intent = "TOUCH_SELECTED";
const run1 = processIntent(intent, startState, noOpLog);
const run2 = processIntent(intent, startState, noOpLog);
const run3 = processIntent(intent, startState, noOpLog);

assert.equal(run1.ui_state, "MANUAL_MENU");
assert.equal(run2.ui_state, "MANUAL_MENU");
assert.equal(run3.ui_state, "MANUAL_MENU");
console.log("✅ Determinism Passed.");

console.log("🎉 ALL AGENT RUNTIME TESTS PASSED.");
