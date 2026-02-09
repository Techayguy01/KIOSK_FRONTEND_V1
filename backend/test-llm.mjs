// Phase 9 Test Script
// Run with: node test-llm.mjs

const API_URL = 'http://localhost:3002/api/chat';

async function testLLM(transcript, currentState, sessionId = 'test-session') {
    console.log(`\n=== Testing: "${transcript}" (State: ${currentState}) ===`);
    const start = Date.now();

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript, currentState, sessionId })
        });

        const data = await response.json();
        const latency = Date.now() - start;

        console.log(`Response (${latency}ms):`);
        console.log(`  speech: "${data.speech}"`);
        console.log(`  intent: ${data.intent}`);
        console.log(`  confidence: ${data.confidence}`);

        return { ...data, latency };
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    }
}

async function runTests() {
    console.log('Phase 9 LLM Integration Tests\n');
    console.log('='.repeat(50));

    // 9.1: Basic functionality
    console.log('\n[9.1] Basic Functionality');
    await testLLM('I want to check in', 'WELCOME');
    await testLLM('Hello', 'WELCOME');

    // 9.2: Governance - should return valid intents
    console.log('\n[9.2] Governance Tests');
    await testLLM('Fly me to the moon', 'WELCOME');  // Should return UNKNOWN

    // 9.3: Context awareness
    console.log('\n[9.3] Context Tests');
    await testLLM('Good morning', 'WELCOME');  // Should use timezone
    await testLLM('When is breakfast?', 'WELCOME');

    // 9.4: Confidence scoring
    console.log('\n[9.4] Confidence Tests');
    await testLLM('Check in', 'WELCOME');  // High confidence expected
    await testLLM('Maybe I want to... um...', 'WELCOME');  // Low confidence expected

    // 9.5: Mediation (state awareness)
    console.log('\n[9.5] State Awareness');
    await testLLM('I want to pay', 'SCAN_ID');  // Should be blocked at agent level

    // 9.6: Memory tests
    console.log('\n[9.6] Memory Tests');
    await testLLM('My name is John', 'AI_CHAT', 'memory-test');
    await testLLM('What is my name?', 'AI_CHAT', 'memory-test');

    // Privacy wipe test
    await testLLM('Hi', 'WELCOME', 'memory-test');  // Should wipe memory
    await testLLM('What is my name?', 'AI_CHAT', 'memory-test');  // Should not know

    console.log('\n' + '='.repeat(50));
    console.log('Tests complete!');
}

runTests();
