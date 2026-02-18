# Shared Folder - Complete Code Documentation

## 📁 Shared Folder Structure

```
shared/
└── contracts/
    ├── backend.contract.ts    # UI state types and backend response interface
    ├── intents.ts             # User intent enumeration
    └── events.contract.ts     # UI event types and handlers
```

---

## 🎯 Purpose

The **shared** folder contains **TypeScript contract definitions** that serve as the **single source of truth** for type safety across the entire application. These contracts ensure type consistency between:

- **Frontend** (React UI)
- **Backend** (Node.js server)
- **Agent** (State machine logic)

### Key Principles

1. **Strict Typing**: All state transitions and intents are explicitly typed
2. **Shared Knowledge**: Both frontend and backend reference the same contract files
3. **Compile-Time Safety**: TypeScript catches type mismatches before runtime
4. **Documentation**: Contracts serve as living documentation of the system's API

---

## 📄 Files Documentation

---

### 1. `shared/contracts/backend.contract.ts`

**Description:**  
Defines the core UI state enumeration and backend response interface. This is the authoritative definition of all possible UI states in the kiosk application, used by both the frontend state machine and backend intent processor.

**Key Exports:**
- `UIState`: All possible screens/states in the application
- `ChatMessage`: Structure for AI chat message history
- `BackendResponse`: Expected response format from backend API

```typescript
// contracts/backend.contract.ts

export type UIState =
  | 'IDLE'
  | 'WELCOME'
  | 'AI_CHAT'
  | 'MANUAL_MENU'
  | 'SCAN_ID'
  | 'ROOM_SELECT'
  | 'PAYMENT'
  | 'KEY_DISPENSING'
  | 'COMPLETE'
  | 'ERROR';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
}

export interface BackendResponse {
  ui_state: UIState;
  messages?: ChatMessage[]; // Chat history for Voice/AI mode
  text_response?: string;   // Legacy/Simple response
  audio_url?: string;
  metadata?: Record<string, any>;
}
```

---

### 2. `shared/contracts/intents.ts`

**Description:**  
Exhaustive enumeration of all user intents that can trigger state transitions. These intents are emitted by the frontend UI and processed by the Agent's state machine to determine navigation.

**Design Philosophy:**
- **Semantic Clarity**: Intent names describe user intention, not implementation
- **Strict Enumeration**: Only these intents are valid; prevents ad-hoc string usage
- **Agent Authority**: Agent decides if an intent is valid in the current state

**Intent Categories:**
- **Proximity/Session**: `PROXIMITY_DETECTED`, `RESET`
- **Input Mode**: `VOICE_STARTED`, `TOUCH_SELECTED`
- **Navigation**: `CHECK_IN_SELECTED`, `BOOK_ROOM_SELECTED`, `HELP_SELECTED`
- **Process Steps**: `SCAN_COMPLETED`, `ROOM_SELECTED`, `CONFIRM_PAYMENT`, `DISPENSE_COMPLETE`
- **Control Flow**: `BACK_REQUESTED`, `CANCEL_REQUESTED`
- **Voice Semantics**: `VOICE_TRANSCRIPT_RECEIVED`, `VOICE_SILENCE`, `EXPLAIN_CAPABILITIES`, `GENERAL_QUERY`

```typescript
export type Intent =
    | "PROXIMITY_DETECTED"
    | "VOICE_STARTED"
    | "VOICE_TRANSCRIPT_RECEIVED"
    | "VOICE_SILENCE"
    | "TOUCH_SELECTED"
    | "CHECK_IN_SELECTED"
    | "BOOK_ROOM_SELECTED"
    | "HELP_SELECTED"
    | "SCAN_COMPLETED"
    | "ROOM_SELECTED"
    | "CONFIRM_PAYMENT"
    | "DISPENSE_COMPLETE"
    | "RESET"
    | "BACK_REQUESTED"
    | "CANCEL_REQUESTED"
    | "EXPLAIN_CAPABILITIES"
    | "GENERAL_QUERY";
```

---

### 3. `shared/contracts/events.contract.ts`

**Description:**  
Defines UI event types and event handler interface for the event-driven architecture. While `intents.ts` defines what the user wants to do, `events.contract.ts` defines the event payload structure for communication between components.

**Key Exports:**
- `UIEventType`: Event type enumeration
- `UIEvent`: Event object structure with optional payload
- `UIEventHandler`: Type signature for event handling functions

**Usage:**
- Frontend emits `UIEvent` objects
- Agent adapter consumes events and maps to intents
- Type-safe event handling throughout the application

```typescript
// contracts/events.contract.ts

export type UIEventType = 
  | 'START_SESSION'
  | 'CHECK_IN_SELECTED'
  | 'BOOK_ROOM_SELECTED'
  | 'HELP_SELECTED'
  | 'SCAN_COMPLETED'
  | 'ROOM_SELECTED'
  | 'CONFIRM_PAYMENT'
  | 'DISPENSE_COMPLETE'
  | 'RESET'
  | 'VOICE_INPUT_START'
  | 'VOICE_INPUT_END'
  | 'ERROR'
  | 'ERROR_DISMISSED'
  | 'BACK_REQUESTED';

export interface UIEvent {
  type: UIEventType;
  payload?: any;
}

export type UIEventHandler = (event: UIEvent) => void;
```

---

## 🔗 Cross-Reference Map

### Contract Usage Across Codebase

| Contract | Used By | Purpose |
|----------|---------|---------|
| **backend.contract.ts** → `UIState` | `frontend/agent/index.ts` | Agent state machine type |
| **backend.contract.ts** → `UIState` | `frontend/state/uiState.machine.ts` | State machine configuration |
| **backend.contract.ts** → `UIState` | `frontend/app/App.tsx` | Component routing logic |
| **backend.contract.ts** → `BackendResponse` | `backend/src/routes/chat.ts` | LLM response validation |
| **intents.ts** → `Intent` | `frontend/agent/index.ts` | Intent processing function |
| **intents.ts** → `Intent` | `frontend/agent/adapter.ts` | Intent dispatch and mediation |
| **intents.ts** → `Intent` | `backend/src/llm/contracts.ts` | LLM output validation |
| **events.contract.ts** → `UIEvent` | `frontend/components/*` | Component event emission |
| **events.contract.ts** → `UIEventHandler` | `frontend/agent/adapter.ts` | Event subscription handlers |

---

## 🛡️ Type Safety Guarantees

### 1. **Compile-Time State Validation**
```typescript
// ✅ Valid - TypeScript allows
const state: UIState = 'WELCOME';

// ❌ Invalid - TypeScript error
const state: UIState = 'CHECKOUT'; // Error: Type '"CHECKOUT"' is not assignable to type 'UIState'
```

### 2. **Exhaustive Intent Handling**
```typescript
// TypeScript ensures all intents are handled
function processIntent(intent: Intent, state: UIState): UIState {
    switch (intent) {
        case "CHECK_IN_SELECTED": return "SCAN_ID";
        case "BOOK_ROOM_SELECTED": return "ROOM_SELECT";
        // ... TypeScript requires all cases or default
    }
}
```

### 3. **Contract-Driven API Design**
```typescript
// Backend MUST return BackendResponse shape
const response: BackendResponse = {
    ui_state: "WELCOME",
    messages: [],
    metadata: { timestamp: Date.now() }
};
```

---

## 📐 Design Patterns

### Separation of Concerns

1. **`backend.contract.ts`**: **What** (States, Data Structures)
   - Defines what states exist
   - Defines what data flows between systems
   - No logic, only types

2. **`intents.ts`**: **Why** (User Intentions)
   - Defines why state changes happen
   - Semantic layer between UI and logic
   - Human-readable intent names

3. **`events.contract.ts`**: **How** (Communication Protocol)
   - Defines how components communicate
   - Event payload structures
   - Handler function signatures

---

## 🔄 Evolution Strategy

### Adding New States
1. Add to `UIState` in `backend.contract.ts`
2. Update `frontend/agent/index.ts` transition table
3. Create corresponding page component
4. Add to router in `frontend/app/App.tsx`

### Adding New Intents
1. Add to `Intent` in `intents.ts`
2. Define transition rules in `frontend/agent/index.ts`
3. Map voice commands if applicable in `frontend/agent/index.ts` → `VOICE_COMMAND_MAP`
4. Update backend LLM contracts in `backend/src/llm/contracts.ts`

### Version Compatibility
All three contracts are coupled:
- Breaking changes require coordinated updates
- Non-breaking additions (new optional fields) are safe
- Deprecated states/intents should be marked with comments before removal

---

## 🎯 Summary

### Contracts Overview

| File | Lines | Purpose | Consumers |
|------|-------|---------|-----------|
| `backend.contract.ts` | 28 | State types and API response format | Frontend (agent, state, UI), Backend (routes) |
| `intents.ts` | 19 | User intent enumeration | Frontend (agent, adapter), Backend (LLM) |
| `events.contract.ts` | 24 | UI event types and handlers | Frontend (components, agent) |

### Total
- **3 files**
- **71 lines of code**
- **100% TypeScript**
- **Zero runtime logic** (pure type definitions)

---

## 🚀 Benefits

1. **Single Source of Truth**: Changes propagate automatically via TypeScript compiler
2. **Refactoring Safety**: Renaming a state/intent updates all references
3. **IntelliSense Support**: IDE autocomplete for all valid states/intents
4. **Documentation**: Types serve as executable documentation
5. **Contract Testing**: Backend can validate against frontend's expectations
6. **Cross-Team Alignment**: Frontend and backend teams use identical contracts

---

## 🔐 Critical Rules

### Rule 1: Never Use String Literals
```typescript
// ❌ BAD - Magic string, no type safety
emit("checkout");

// ✅ GOOD - Type-safe intent
emit("BOOK_ROOM_SELECTED");
```

### Rule 2: Contracts Are Immutable During Runtime
- These are **compile-time** constructs
- No dynamic state generation
- All states/intents must be known at build time

### Rule 3: Backend Must Respect Contracts
```typescript
// Backend MUST return valid UIState
const response = {
    ui_state: "INVALID_STATE" // ❌ TypeScript error
};
```

---

**End of Shared Folder Documentation**

This folder is small but **critical** - it's the glue that keeps the entire system type-safe and self-documenting.
