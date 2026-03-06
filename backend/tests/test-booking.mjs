/**
 * Booking Integration Tests
 * 
 * Tests the POST /api/chat/booking endpoint with a simulated
 * multi-turn booking conversation.
 * 
 * Run with: node test-booking.mjs
 * Requires: Backend running on localhost:3002
 */

const API_URL = "http://localhost:3002/api/chat/booking";
const SESSION_ID = `test-booking-${Date.now()}`;

let testsPassed = 0;
let testsFailed = 0;

async function sendMessage(transcript, currentState = "BOOKING_COLLECT") {
    const start = Date.now();
    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, currentState, sessionId: SESSION_ID }),
    });
    const data = await response.json();
    const latency = Date.now() - start;
    return { ...data, latency };
}

function assert(condition, testName, details = "") {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        testsPassed++;
    } else {
        console.log(`  ❌ ${testName} ${details}`);
        testsFailed++;
    }
}

async function testHappyPath() {
    console.log("\n═══════════════════════════════════════");
    console.log("TEST 1: Happy Path — Full Booking Flow");
    console.log("═══════════════════════════════════════\n");

    // Turn 1: Select room
    console.log('Turn 1: "I want the deluxe suite"');
    let r = await sendMessage("I want the deluxe suite");
    console.log(`  Speech: "${r.speech}" (${r.latency}ms)`);
    assert(r.accumulatedSlots?.roomType === "DELUXE", "Room type extracted as DELUXE", `Got: ${r.accumulatedSlots?.roomType}`);
    assert(r.confidence > 0.5, "Confidence above threshold", `Got: ${r.confidence}`);

    // Turn 2: Provide guests
    console.log('\nTurn 2: "Two adults"');
    r = await sendMessage("Two adults");
    console.log(`  Speech: "${r.speech}" (${r.latency}ms)`);
    assert(r.accumulatedSlots?.adults === 2, "Adults extracted as 2", `Got: ${r.accumulatedSlots?.adults}`);
    assert(r.accumulatedSlots?.roomType === "DELUXE", "Room type still retained", `Got: ${r.accumulatedSlots?.roomType}`);

    // Turn 3: Provide dates
    console.log('\nTurn 3: "Checking in tomorrow, checking out on the 16th"');
    r = await sendMessage("Checking in tomorrow, checking out on the 16th");
    console.log(`  Speech: "${r.speech}" (${r.latency}ms)`);
    assert(r.accumulatedSlots?.checkInDate !== null, "Check-in date extracted", `Got: ${r.accumulatedSlots?.checkInDate}`);
    assert(r.accumulatedSlots?.checkOutDate !== null, "Check-out date extracted", `Got: ${r.accumulatedSlots?.checkOutDate}`);

    // Turn 4: Provide name
    console.log('\nTurn 4: "John Smith"');
    r = await sendMessage("John Smith");
    console.log(`  Speech: "${r.speech}" (${r.latency}ms)`);
    assert(r.accumulatedSlots?.guestName === "John Smith", "Guest name extracted", `Got: ${r.accumulatedSlots?.guestName}`);
    assert(r.missingSlots?.length === 0, "No missing slots", `Missing: ${r.missingSlots}`);
}

async function testCompoundStatement() {
    console.log("\n═══════════════════════════════════════════");
    console.log("TEST 2: Compound Statement — Single Utterance");
    console.log("═══════════════════════════════════════════\n");

    // New session
    const sid = `test-compound-${Date.now()}`;

    console.log('"Book the standard room for 2 adults, 3 nights starting tomorrow, name is Jane Doe"');
    const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "Book the standard room for 2 adults, 3 nights starting tomorrow, name is Jane Doe",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());

    console.log(`  Speech: "${r.speech}"`);
    console.log(`  Slots:`, r.accumulatedSlots);
    assert(r.accumulatedSlots?.roomType === "STANDARD", "Room extracted", `Got: ${r.accumulatedSlots?.roomType}`);
    assert(r.accumulatedSlots?.adults === 2, "Adults extracted", `Got: ${r.accumulatedSlots?.adults}`);
    assert(r.accumulatedSlots?.guestName === "Jane Doe", "Name extracted", `Got: ${r.accumulatedSlots?.guestName}`);
}

async function testCorrection() {
    console.log("\n═══════════════════════════════════════");
    console.log("TEST 3: Correction — Changing a Slot");
    console.log("═══════════════════════════════════════\n");

    const sid = `test-correction-${Date.now()}`;

    // Set initial value
    console.log('Turn 1: "Deluxe suite for 2 adults"');
    let r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "Deluxe suite for 2 adults",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());
    assert(r.accumulatedSlots?.adults === 2, "Initially 2 adults", `Got: ${r.accumulatedSlots?.adults}`);

    // Correct it
    console.log('\nTurn 2: "Actually make that 3 adults"');
    r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "Actually make that 3 adults",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());
    console.log(`  Speech: "${r.speech}"`);
    assert(r.accumulatedSlots?.adults === 3, "Corrected to 3 adults", `Got: ${r.accumulatedSlots?.adults}`);
    assert(r.accumulatedSlots?.roomType === "DELUXE", "Room still retained after correction", `Got: ${r.accumulatedSlots?.roomType}`);
}

async function testContextQuestion() {
    console.log("\n═══════════════════════════════════════════════");
    console.log("TEST 4: Context Question — Mid-Booking Inquiry");
    console.log("═══════════════════════════════════════════════\n");

    const sid = `test-context-${Date.now()}`;

    // Start booking
    await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "Book the presidential suite",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());

    // Ask unrelated question
    console.log('"What time is breakfast?"');
    const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "What time is breakfast?",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());

    console.log(`  Speech: "${r.speech}"`);
    assert(r.speech.toLowerCase().includes("7") || r.speech.toLowerCase().includes("breakfast"), "Answered breakfast question", `Got: "${r.speech}"`);
    assert(r.accumulatedSlots?.roomType === "PRESIDENTIAL", "Room slot preserved during Q&A", `Got: ${r.accumulatedSlots?.roomType}`);
}

async function testCancellation() {
    console.log("\n════════════════════════════════════");
    console.log("TEST 5: Cancellation — Cancel Booking");
    console.log("════════════════════════════════════\n");

    const sid = `test-cancel-${Date.now()}`;

    await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "Book the standard room",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());

    console.log('"Cancel" / "I changed my mind"');
    const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "I changed my mind, cancel the booking",
            currentState: "BOOKING_COLLECT",
            sessionId: sid,
        }),
    }).then(res => res.json());

    console.log(`  Speech: "${r.speech}"`);
    console.log(`  Intent: ${r.intent}`);
    assert(r.intent === "CANCEL_BOOKING", "Intent is CANCEL_BOOKING", `Got: ${r.intent}`);
}

// =============================
// RUN ALL TESTS
// =============================
async function runAll() {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║   Voice-First Booking Integration Tests  ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log(`Backend: ${API_URL}`);
    console.log(`Time: ${new Date().toLocaleString()}\n`);

    try {
        await testHappyPath();
        await testCompoundStatement();
        await testCorrection();
        await testContextQuestion();
        await testCancellation();
    } catch (error) {
        console.error("\n💥 Test runner error:", error.message);
        testsFailed++;
    }

    console.log("\n╔══════════════════════════════════════════╗");
    console.log(`║  Results: ${testsPassed} passed, ${testsFailed} failed${" ".repeat(Math.max(0, 18 - String(testsPassed).length - String(testsFailed).length))}║`);
    console.log("╚══════════════════════════════════════════╝");

    process.exit(testsFailed > 0 ? 1 : 0);
}

runAll();
