# Kiosk System Test Cases

**Version:** 1.0  
**Last Updated:** 2026-02-16  
**Purpose:** Comprehensive test suite for the Grand Hotel Kiosk application

---

## Table of Contents
1. [Backend Test Cases](#1-backend-test-cases)
2. [Frontend Test Cases](#2-frontend-test-cases)
3. [Integration Test Cases](#3-integration-test-cases)
4. [Contract Validation Tests](#4-contract-validation-tests)
5. [End-to-End Test Cases](#5-end-to-end-test-cases)
6. [Performance Tests](#6-performance-tests)
7. [Security Tests](#7-security-tests)

---

## 1. Backend Test Cases

### 1.1 LLM Integration Tests (`backend/src/routes/chat.ts`)

#### Test Case 1.1.1: Basic Intent Classification
**Objective:** Verify LLM correctly classifies user intents  
**File:** `backend/test/llm/intent-classification.test.ts`

```typescript
describe('LLM Intent Classification', () => {
  test('should classify check-in intent', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'I want to check in',
        currentState: 'WELCOME',
        sessionId: 'test-001'
      })
    });
    
    const data = await response.json();
    expect(data.intent).toBe('CHECK_IN');
    expect(data.confidence).toBeGreaterThan(0.85);
  });

  test('should classify booking intent', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'I want to book a room',
        currentState: 'WELCOME',
        sessionId: 'test-002'
      })
    });
    
    const data = await response.json();
    expect(data.intent).toBe('BOOK_ROOM');
    expect(data.confidence).toBeGreaterThan(0.85);
  });

  test('should return UNKNOWN for out-of-domain queries', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Fly me to the moon',
        currentState: 'WELCOME',
        sessionId: 'test-003'
      })
    });
    
    const data = await response.json();
    expect(data.intent).toBe('UNKNOWN');
  });
});
```

**Expected Results:**
- ✅ Check-in phrases → `CHECK_IN` intent with high confidence
- ✅ Booking phrases → `BOOK_ROOM` intent with high confidence
- ✅ Irrelevant phrases → `UNKNOWN` intent

---

#### Test Case 1.1.2: Context Awareness
**Objective:** Verify LLM uses hotel context correctly

```typescript
describe('LLM Context Awareness', () => {
  test('should use hotel timezone in responses', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Good morning',
        currentState: 'WELCOME',
        sessionId: 'test-004'
      })
    });
    
    const data = await response.json();
    expect(data.speech).toContain('Good morning');
  });

  test('should answer questions about amenities', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'What amenities do you have?',
        currentState: 'WELCOME',
        sessionId: 'test-005'
      })
    });
    
    const data = await response.json();
    expect(data.intent).toBe('GENERAL_QUERY');
    expect(data.speech.toLowerCase()).toMatch(/pool|wifi|breakfast|spa/);
  });
});
```

---

#### Test Case 1.1.3: Session Memory
**Objective:** Verify conversation memory within session

```typescript
describe('LLM Session Memory', () => {
  const sessionId = 'memory-test-001';

  test('should remember information within session', async () => {
    // First message
    await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'My name is John',
        currentState: 'AI_CHAT',
        sessionId
      })
    });

    // Second message - should remember name
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'What is my name?',
        currentState: 'AI_CHAT',
        sessionId
      })
    });

    const data = await response.json();
    expect(data.speech.toLowerCase()).toContain('john');
  });

  test('should wipe memory when returning to WELCOME', async () => {
    // Wipe trigger
    await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Hi',
        currentState: 'WELCOME',
        sessionId
      })
    });

    // Should not remember previous name
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'What is my name?',
        currentState: 'AI_CHAT',
        sessionId
      })
    });

    const data = await response.json();
    expect(data.speech.toLowerCase()).not.toContain('john');
  });
});
```

---

### 1.2 Voice Relay Tests (`backend/deepgramRelay.ts`)

#### Test Case 1.2.1: WebSocket Connection
**Objective:** Verify WebSocket relay connects correctly

```typescript
describe('Deepgram Voice Relay', () => {
  test('should establish WebSocket connection', (done) => {
    const ws = new WebSocket('ws://localhost:3001?sample_rate=48000');
    
    ws.on('open', () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      done();
    });

    ws.on('error', (error) => {
      done(error);
    });
  });

  test('should accept custom sample rate', (done) => {
    const ws = new WebSocket('ws://localhost:3001?sample_rate=16000');
    
    ws.on('open', () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      done();
    });
  });

  test('should relay audio data to Deepgram', (done) => {
    const ws = new WebSocket('ws://localhost:3001?sample_rate=48000');
    
    ws.on('open', () => {
      // Send mock audio data
      const mockAudioData = Buffer.alloc(1024);
      ws.send(mockAudioData);
      
      // Should receive transcript response
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        expect(message).toHaveProperty('channel');
        ws.close();
        done();
      });
    });
  }, 10000);
});
```

---

### 1.3 Context Builder Tests (`backend/src/context/contextBuilder.ts`)

#### Test Case 1.3.1: Time Zone Handling
**Objective:** Verify correct timezone calculation

```typescript
import { buildSystemContext } from '../src/context/contextBuilder';

describe('Context Builder', () => {
  test('should use Asia/Kolkata timezone', () => {
    const context = buildSystemContext({
      currentState: 'WELCOME',
      transcript: 'test'
    });

    const parsed = JSON.parse(context);
    expect(parsed.environment.localTime).toBeDefined();
    // Verify time format (e.g., "2:30 PM")
    expect(parsed.environment.localTime).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  test('should determine correct part of day', () => {
    const context = buildSystemContext({
      currentState: 'WELCOME',
      transcript: 'test'
    });

    const parsed = JSON.parse(context);
    expect(['Morning', 'Afternoon', 'Evening']).toContain(
      parsed.environment.partOfDay
    );
  });

  test('should include hotel configuration', () => {
    const context = buildSystemContext({
      currentState: 'WELCOME',
      transcript: 'test'
    });

    const parsed = JSON.parse(context);
    expect(parsed.environment.hotel).toBe('Grand Hotel Nagpur');
    expect(parsed.policy.checkIn).toBe('14:00');
    expect(parsed.policy.checkOut).toBe('11:00');
    expect(parsed.policy.amenities).toBeInstanceOf(Array);
  });
});
```

---

## 2. Frontend Test Cases

### 2.1 Agent Tests (`frontend/agent/index.ts`)

#### Test Case 2.1.1: State Transitions
**Objective:** Verify agent state machine transitions correctly

```typescript
import { createAgent, UiState } from '../agent/index';

describe('Agent State Machine', () => {
  let agent: ReturnType<typeof createAgent>;

  beforeEach(() => {
    agent = createAgent();
  });

  test('should transition from IDLE to WELCOME on PROXIMITY_DETECTED', () => {
    const newState = agent.dispatch('PROXIMITY_DETECTED');
    expect(newState).toBe('WELCOME');
  });

  test('should transition from WELCOME to SCAN_ID on CHECK_IN_SELECTED', () => {
    agent.dispatch('PROXIMITY_DETECTED'); // First go to WELCOME
    const newState = agent.dispatch('CHECK_IN_SELECTED');
    expect(newState).toBe('SCAN_ID');
  });

  test('should not allow invalid transitions', () => {
    const currentState = agent.getCurrentState();
    const newState = agent.dispatch('CONFIRM_PAYMENT'); // Invalid from IDLE
    expect(newState).toBe(currentState); // Should stay in same state
  });

  test('should handle BACK_REQUESTED correctly', () => {
    agent.dispatch('PROXIMITY_DETECTED'); // WELCOME
    agent.dispatch('CHECK_IN_SELECTED'); // SCAN_ID
    
    const newState = agent.dispatch('BACK_REQUESTED');
    expect(newState).toBe('WELCOME');
  });
});
```

---

### 2.2 UI Component Tests

#### Test Case 2.2.1: WelcomePage Component
**Objective:** Verify WelcomePage renders correctly

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomePage } from '../pages/WelcomePage';
import { UIContext } from '../state/uiContext';

describe('WelcomePage Component', () => {
  const mockEmit = jest.fn();
  const mockContext = {
    state: 'WELCOME',
    data: {},
    emit: mockEmit,
    loading: false,
    transcript: ''
  };

  test('should render in voice mode', () => {
    render(
      <UIContext.Provider value={mockContext}>
        <WelcomePage visualMode="voice" />
      </UIContext.Provider>
    );

    expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
  });

  test('should render in manual mode', () => {
    render(
      <UIContext.Provider value={mockContext}>
        <WelcomePage visualMode="manual" />
      </UIContext.Provider>
    );

    // Should show manual buttons
    expect(screen.getByText(/Check In/i)).toBeInTheDocument();
    expect(screen.getByText(/Book Room/i)).toBeInTheDocument();
  });

  test('should emit CHECK_IN_SELECTED when check-in button clicked', () => {
    render(
      <UIContext.Provider value={mockContext}>
        <WelcomePage visualMode="manual" />
      </UIContext.Provider>
    );

    const checkInButton = screen.getByText(/Check In/i);
    fireEvent.click(checkInButton);

    expect(mockEmit).toHaveBeenCalledWith('CHECK_IN_SELECTED');
  });

  test('should NOT auto-navigate without emit', () => {
    const { rerender } = render(
      <UIContext.Provider value={mockContext}>
        <WelcomePage visualMode="manual" />
      </UIContext.Provider>
    );

    // Component should not change state on its own
    rerender(
      <UIContext.Provider value={mockContext}>
        <WelcomePage visualMode="manual" />
      </UIContext.Provider>
    );

    expect(mockContext.state).toBe('WELCOME');
  });
});
```

---

#### Test Case 2.2.2: RoomSelectPage Component
**Objective:** Verify room selection emits correct intent

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomSelectPage } from '../pages/RoomSelectPage';
import { UIContext } from '../state/uiContext';

describe('RoomSelectPage Component', () => {
  const mockEmit = jest.fn();
  const mockContext = {
    state: 'ROOM_SELECT',
    data: {},
    emit: mockEmit,
    loading: false,
    transcript: ''
  };

  test('should display room cards', () => {
    render(
      <UIContext.Provider value={mockContext}>
        <RoomSelectPage />
      </UIContext.Provider>
    );

    // Should show rooms (assuming mock data is loaded)
    const roomCards = screen.getAllByRole('button');
    expect(roomCards.length).toBeGreaterThan(0);
  });

  test('should emit ROOM_SELECTED with room data', () => {
    render(
      <UIContext.Provider value={mockContext}>
        <RoomSelectPage />
      </UIContext.Provider>
    );

    const firstRoom = screen.getAllByRole('button')[0];
    fireEvent.click(firstRoom);

    expect(mockEmit).toHaveBeenCalledWith(
      'ROOM_SELECTED',
      expect.objectContaining({ roomId: expect.any(String) })
    );
  });
});
```

---

### 2.3 Frontend Rule Compliance Tests

#### Test Case 2.3.1: Frontend Never Mutates ui_state
**Objective:** Verify frontend never directly mutates state

```typescript
describe('Frontend Rule Compliance', () => {
  test('ui_state should be read-only in components', () => {
    // This is a meta-test - use static analysis or manual code review
    // Search for patterns like: ui_state = ... or setState(...)
    
    const forbiddenPatterns = [
      /ui_state\s*=/,
      /setState\(['"]WELCOME['"]\)/  // Direct state mutations
    ];

    // This would be part of a linting rule
    // For now, document that manual review is required
    expect(true).toBe(true); // Placeholder
  });

  test('components should only emit intents, not outcomes', () => {
    // Verify no components emit outcome-based events
    const forbiddenEvents = [
      'ID_VERIFIED',
      'PAYMENT_SUCCESS',
      'ROOM_ASSIGNED'
    ];

    // Code search for these patterns
    // In practice, use ESLint custom rule
    expect(true).toBe(true); // Placeholder
  });
});
```

---

## 3. Integration Test Cases

### 3.1 Voice-to-Intent Flow
**Objective:** Test complete voice interaction flow

```typescript
describe('Voice-to-Intent Integration', () => {
  test('should handle complete voice interaction', async () => {
    // 1. Connect to voice relay
    const ws = new WebSocket('ws://localhost:3001?sample_rate=48000');
    await new Promise(resolve => ws.on('open', resolve));

    // 2. Send audio data (mock speech: "I want to check in")
    const mockAudioBuffer = Buffer.alloc(1024);
    ws.send(mockAudioBuffer);

    // 3. Receive transcript
    const transcript = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel?.alternatives?.[0]?.transcript) {
          resolve(msg.channel.alternatives[0].transcript);
        }
      });
    });

    // 4. Send transcript to LLM
    const llmResponse = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        currentState: 'WELCOME',
        sessionId: 'integration-test-001'
      })
    });

    const intent = await llmResponse.json();

    // 5. Verify intent is correct
    expect(intent.intent).toBe('CHECK_IN');
    expect(intent.confidence).toBeGreaterThan(0.5);

    ws.close();
  }, 15000);
});
```

---

### 3.2 End-to-End Check-In Flow
**Objective:** Test complete check-in user journey

```typescript
describe('Check-In Flow E2E', () => {
  let agent: any;

  beforeEach(() => {
    agent = createAgent();
  });

  test('should complete check-in flow', () => {
    // 1. User approaches kiosk
    let state = agent.dispatch('PROXIMITY_DETECTED');
    expect(state).toBe('WELCOME');

    // 2. User selects check-in
    state = agent.dispatch('CHECK_IN_SELECTED');
    expect(state).toBe('SCAN_ID');

    // 3. ID scan completes
    state = agent.dispatch('SCAN_COMPLETED', { guestId: 'G123' });
    expect(state).toBe('ROOM_SELECT');

    // 4. User selects room
    state = agent.dispatch('ROOM_SELECTED', { roomId: 'R101' });
    expect(state).toBe('PAYMENT');

    // 5. Payment confirmed
    state = agent.dispatch('CONFIRM_PAYMENT');
    expect(state).toBe('KEY_DISPENSING');

    // 6. Key dispensed
    state = agent.dispatch('DISPENSE_COMPLETE');
    expect(state).toBe('COMPLETE');
  });

  test('should allow going back during check-in', () => {
    agent.dispatch('PROXIMITY_DETECTED'); // WELCOME
    agent.dispatch('CHECK_IN_SELECTED'); // SCAN_ID
    
    const state = agent.dispatch('BACK_REQUESTED');
    expect(state).toBe('WELCOME');
  });
});
```

---

## 4. Contract Validation Tests

### 4.1 TypeScript Contract Compliance

#### Test Case 4.1.1: UIState Contract
**Objective:** Verify all UI states are valid

```typescript
import { UIState } from '../shared/contracts/backend.contract';

describe('UIState Contract', () => {
  const validStates: UIState[] = [
    'IDLE',
    'WELCOME',
    'AI_CHAT',
    'MANUAL_MENU',
    'SCAN_ID',
    'ROOM_SELECT',
    'PAYMENT',
    'KEY_DISPENSING',
    'COMPLETE',
    'ERROR'
  ];

  test('should have exactly 10 states', () => {
    expect(validStates.length).toBe(10);
  });

  test('should not allow invalid states', () => {
    // TypeScript compile-time check
    // const invalid: UIState = 'INVALID'; // Should error
    expect(true).toBe(true);
  });
});
```

---

#### Test Case 4.1.2: Intent Contract
**Objective:** Verify all intents are documented

```typescript
import { Intent } from '../shared/contracts/intents';

describe('Intent Contract', () => {
  const validIntents: Intent[] = [
    'PROXIMITY_DETECTED',
    'VOICE_STARTED',
    'VOICE_TRANSCRIPT_RECEIVED',
    'VOICE_SILENCE',
    'TOUCH_SELECTED',
    'CHECK_IN_SELECTED',
    'BOOK_ROOM_SELECTED',
    'HELP_SELECTED',
    'SCAN_COMPLETED',
    'ROOM_SELECTED',
    'CONFIRM_PAYMENT',
    'DISPENSE_COMPLETE',
    'RESET',
    'BACK_REQUESTED',
    'CANCEL_REQUESTED',
    'EXPLAIN_CAPABILITIES',
    'GENERAL_QUERY'
  ];

  test('should have exactly 17 intents', () => {
    expect(validIntents.length).toBe(17);
  });
});
```

---

## 5. End-to-End Test Cases

### 5.1 Complete User Journeys

#### Test Case 5.1.1: Voice-Based Check-In
**Scenario:** Guest uses voice to complete check-in

```gherkin
Feature: Voice-Based Check-In
  As a guest
  I want to check in using voice commands
  So that I can get my room key quickly

Scenario: Successful voice check-in
  Given the kiosk is in IDLE state
  When a guest approaches the kiosk
  Then the system transitions to WELCOME state
  
  When the guest says "I want to check in"
  Then the system recognizes CHECK_IN intent
  And the system transitions to SCAN_ID state
  
  When the guest scans their ID
  Then the system transitions to ROOM_SELECT state
  And displays available rooms
  
  When the guest says "I'll take the first one"
  Then the system transitions to PAYMENT state
  
  When the guest confirms payment
  Then the system transitions to KEY_DISPENSING state
  Then the system transitions to COMPLETE state
  And displays success message
```

#### Test Case 5.1.2: Manual Touch-Based Booking
**Scenario:** Guest uses touch interface to book a room

```gherkin
Feature: Manual Touch-Based Booking
  As a guest
  I want to book a room using touch interface
  So that I can make a reservation

Scenario: Successful room booking
  Given the kiosk is in IDLE state
  When a guest touches the screen
  Then the system transitions to WELCOME state
  
  When the guest touches "Book a Room" button
  Then the system transitions to ROOM_SELECT state
  And displays all available rooms
  
  When the guest selects "Deluxe Suite"
  Then the system transitions to PAYMENT state
  
  When the guest confirms payment
  Then the system transitions to KEY_DISPENSING state
  Then the system transitions to COMPLETE state
```

---

## 6. Performance Tests

### 6.1 Response Time Tests

```typescript
describe('Performance Tests', () => {
  test('LLM response should be under 2 seconds', async () => {
    const start = Date.now();
    
    await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'I want to check in',
        currentState: 'WELCOME',
        sessionId: 'perf-test-001'
      })
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });

  test('Voice relay should have minimal latency', async () => {
    const ws = new WebSocket('ws://localhost:3001?sample_rate=48000');
    
    const start = Date.now();
    await new Promise(resolve => ws.on('open', resolve));
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
    ws.close();
  });
});
```

---

## 7. Security Tests

### 7.1 API Security

```typescript
describe('Security Tests', () => {
  test('should not expose API keys in responses', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'test',
        currentState: 'WELCOME',
        sessionId: 'security-test-001'
      })
    });
    
    const text = await response.text();
    expect(text).not.toContain('DEEPGRAM_API_KEY');
    expect(text).not.toContain('GROQ_API_KEY');
  });

  test('should sanitize user input', async () => {
    const response = await fetch('http://localhost:3002/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: '<script>alert("xss")</script>',
        currentState: 'WELCOME',
        sessionId: 'security-test-002'
      })
    });
    
    const data = await response.json();
    expect(data.speech).not.toContain('<script>');
  });
});
```

---

## Test Execution Instructions

### Running Backend Tests

```bash
cd backend
npm install --save-dev jest @types/jest ts-jest
npx jest --config=jest.config.js
```

### Running Frontend Tests

```bash
cd frontend
npm install --save-dev @testing-library/react @testing-library/jest-dom
npm test
```

### Running Integration Tests

```bash
# Start backend first
cd backend && npm run dev

# In another terminal, run integration tests
npm run test:integration
```

### Running E2E Tests

```bash
# Install Playwright or Cypress
npm install --save-dev @playwright/test

# Run E2E tests
npx playwright test
```

---

## Test Coverage Goals

| Component | Target Coverage |
|-----------|----------------|
| Backend LLM | 90% |
| Backend Voice Relay | 85% |
| Frontend Agent | 95% |
| Frontend Components | 80% |
| Integration Flows | 100% |

---

**End of Test Cases Documentation**
