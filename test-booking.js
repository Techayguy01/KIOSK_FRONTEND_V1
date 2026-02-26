const payload = {
    transcript: "five",
    currentState: "BOOKING_COLLECT",
    sessionId: "test-session-1",
    activeSlot: "adults",
    expectedType: "number",
    lastSystemPrompt: "How many adults will be staying?",
    filledSlots: { roomType: "PRESIDENTIAL" }
};

fetch('http://localhost:3002/api/budget-inn/chat/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
})
    .then(r => r.json())
    .then(console.log)
    .catch(console.error);
