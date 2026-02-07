import { processIntent, UiState } from "./index";
import { Intent } from "../contracts/intents";

console.log("🧪 Starting Agent Loop Verification...");

const runTest = (name: string, intent: Intent, startState: UiState, expectedState: UiState) => {
    const result = processIntent(intent, startState);
    if (result.ui_state === expectedState) {
        console.log(`✅ ${name}: PASSED (${startState} + ${intent} -> ${result.ui_state})`);
    } else {
        console.error(`❌ ${name}: FAILED (Expected ${expectedState}, got ${result.ui_state})`);
        process.exit(1);
    }
};

// 1. Test Proximity
runTest("Proximity Detection", "PROXIMITY_DETECTED", "IDLE", "WELCOME");

// 2. Test Check-In (Correct State)
runTest("Check-In Selection", "CHECK_IN_SELECTED", "MANUAL_MENU", "SCAN_ID");

// 3. Test Invalid Transition (Kill Auto-Progression)
// Verify that emitting CHECK_IN_SELECTED from IDLE (or unexpected state) does NOTHING
runTest("Invalid State Check-In", "CHECK_IN_SELECTED", "IDLE", "IDLE");

// 4. Test Unhandled Intent
runTest("Unhandled Intent", "VOICE_SILENCE", "WELCOME", "WELCOME");

console.log("🎉 All Tests Passed: Frontend -> Agent -> UI Loop Logic Verified.");
