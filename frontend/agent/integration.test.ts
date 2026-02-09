import { AgentAdapter } from "./adapter";
import { strict as assert } from "assert";
import { UiState } from "./index";

console.log("Starting AgentAdapter <-> Frontend Integration Test...");

// Mock the UI Component (e.g. App.tsx) listening to changes
let currentUiState: UiState = "IDLE";
const history: UiState[] = [];

// 1. Subscribe (Simulate App.useEffect)
const unsubscribe = AgentAdapter.subscribe((newState) => {
    currentUiState = newState;
    history.push(newState);
    console.log(`[UI_MOCK] Re-rendered with State: ${newState}`);
});

// Helper to assert current state
const assertState = (expected: UiState, stepName: string) => {
    assert.equal(currentUiState, expected, `[Step: ${stepName}] Expected UI to be ${expected}, but got ${currentUiState}`);
    console.log(`✅ [Step: ${stepName}] UI correctly at ${expected}`);
};

// --- SCENARIO 1: Happy Path ---

// 2. Start Session
console.log("\n--- Scenario 1: Walkthrough ---");
// Initial state check
assertState("IDLE", "Initial");

// Action: Proximity Sensor
AgentAdapter.dispatch("PROXIMITY_DETECTED");
assertState("WELCOME", "Proximity Detected");

// Action: Touch Screen
AgentAdapter.dispatch("TOUCH_SELECTED");
assertState("MANUAL_MENU", "Touch Selected");

// Action: Click Check In
AgentAdapter.dispatch("CHECK_IN_SELECTED");
assertState("SCAN_ID", "Check In Selected");

// --- SCENARIO 2: Authority Check (The "Stuck" Test) ---

console.log("\n--- Scenario 2: Verify Stuck Behavior (Agent Authority) ---");
// Action: Try to "Go Next" (User clicks a phantom 'Next' button or Voice command)
// Note: We use an intent that IS valid in other states but NO-OP here to prove table strictness.
// OR we use the same intent again.
AgentAdapter.dispatch("CHECK_IN_SELECTED");
assertState("SCAN_ID", "Invalid Intent -> Stuck");
assert.equal(history[history.length - 1], "SCAN_ID", "UI should have received update (or stayed same)");

// --- SCENARIO 3: Back Navigation ---

console.log("\n--- Scenario 3: Back Navigation ---");
// Action: Back Button
AgentAdapter.dispatch("BACK_REQUESTED");
assertState("MANUAL_MENU", "Back Requested");

// --- SCENARIO 4: Cancel/Timeout ---

console.log("\n--- Scenario 4: Cancel/Timeout ---");
// Action: Cancel
AgentAdapter.dispatch("CANCEL_REQUESTED");
assertState("WELCOME", "Cancel Requested");

console.log("\n🎉 ALL INTEGRATION TESTS PASSED.");
unsubscribe();
