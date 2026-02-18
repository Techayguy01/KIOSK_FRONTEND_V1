const API_URL = 'http://localhost:3002/api/chat';

async function testBooking(transcript, currentState = 'ROOM_SELECTION', sessionId = 'test-booking') {
    console.log(`\n=== Testing Booking: "${transcript}" ===`);
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, currentState, sessionId })
        });

        const data = await response.json();
        console.log(`Response:`);
        console.log(`  speech: "${data.speech}"`);
        console.log(`  intent: ${data.intent}`);
        if (data.bookingIntent) {
            console.log(`  bookingIntent:`, data.bookingIntent);
        }
        if (data.paymentUrl) {
            console.log(`  ✅ paymentUrl: ${data.paymentUrl}`);
        } else {
            console.log(`  ❌ No paymentUrl found.`);
        }
        return data;

    } catch (error) {
        console.error('Error:', error.message);
    }
}

testBooking('I want to book room 101');
