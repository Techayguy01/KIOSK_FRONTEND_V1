# Shared Code Documentation

## 1. Folder Structure

```
KIOSK_FRONTEND_V1/shared/
└── contracts/
    ├── backend.contract.ts    # Backend response types and UI state definitions
    ├── events.contract.ts     # UI event types and handlers
    └── intents.ts             # Intent type definitions for user actions
```

---

## 2. Code Files

### a) Location: `KIOSK_FRONTEND_V1/shared/contracts/backend.contract.ts`

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

### b) Location: `KIOSK_FRONTEND_V1/shared/contracts/events.contract.ts`

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

### c) Location: `KIOSK_FRONTEND_V1/shared/contracts/intents.ts`

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

## 3. Contract Definitions Overview

### UI State Contract (`backend.contract.ts`)

The **UI State** represents the current screen/state of the kiosk application. This is the **single source of truth** for what the user sees.

#### UI States:

| State | Description |
|-------|-------------|
| `IDLE` | Kiosk is waiting for user interaction (screensaver/attract mode) |
| `WELCOME` | Initial greeting screen when user approaches |
| `AI_CHAT` | Voice/AI conversation mode is active |
| `MANUAL_MENU` | User selected manual/touch interaction mode |
| `SCAN_ID` | Waiting for ID card scan or manual input |
| `ROOM_SELECT` | Displaying available rooms for selection |
| `PAYMENT` | Payment processing screen |
| `KEY_DISPENSING` | Physical key card is being dispensed |
| `COMPLETE` | Transaction completed successfully |
| `ERROR` | Error state requiring user attention or assistance |

#### Chat Message Interface:

```typescript
interface ChatMessage {
  id: string;           // Unique message identifier
  role: 'assistant' | 'user';  // Who sent the message
  text: string;         // Message content
  timestamp: number;    // Unix timestamp
}
```

#### Backend Response Interface:

```typescript
interface BackendResponse {
  ui_state: UIState;              // Required: Next UI state
  messages?: ChatMessage[];       // Optional: Chat history for AI mode
  text_response?: string;         // Optional: Simple text response
  audio_url?: string;             // Optional: TTS audio URL
  metadata?: Record<string, any>; // Optional: Additional data
}
```

---

### UI Event Contract (`events.contract.ts`)

**UI Events** are actions emitted by the frontend when users interact with the kiosk. These are **intents**, not outcomes.

#### Event Types:

| Event Type | Description | Trigger |
|------------|-------------|---------|
| `START_SESSION` | User has approached the kiosk | Proximity sensor or touch |
| `CHECK_IN_SELECTED` | User wants to check in | Button press or voice command |
| `BOOK_ROOM_SELECTED` | User wants to book a new room | Button press or voice command |
| `HELP_SELECTED` | User requests assistance | Help button pressed |
| `SCAN_COMPLETED` | ID card scan finished | Scanner hardware event |
| `ROOM_SELECTED` | User chose a specific room | Room card clicked |
| `CONFIRM_PAYMENT` | User confirmed payment | Payment button pressed |
| `DISPENSE_COMPLETE` | Key card dispensed successfully | Hardware confirmation |
| `RESET` | Return to idle state | Timeout or explicit reset |
| `VOICE_INPUT_START` | User started speaking | Voice activity detected |
| `VOICE_INPUT_END` | User stopped speaking | Silence detected |
| `ERROR` | An error occurred | System error |
| `ERROR_DISMISSED` | User acknowledged error | Error dialog dismissed |
| `BACK_REQUESTED` | User wants to go back | Back button pressed |

#### UI Event Interface:

```typescript
interface UIEvent {
  type: UIEventType;    // The event type
  payload?: any;        // Optional event-specific data
}
```

#### UI Event Handler Type:

```typescript
type UIEventHandler = (event: UIEvent) => void;
```

---

### Intent Contract (`intents.ts`)

**Intents** represent user actions and system events that drive the application flow.

#### Intent Categories:

**System Events:**
- `PROXIMITY_DETECTED` - User approached the kiosk
- `RESET` - Return to initial state

**Voice Events:**
- `VOICE_STARTED` - Voice input began
- `VOICE_TRANSCRIPT_RECEIVED` - Speech-to-text completed
- `VOICE_SILENCE` - No speech detected

**User Actions:**
- `TOUCH_SELECTED` - User chose manual touch mode
- `CHECK_IN_SELECTED` - User wants to check in
- `BOOK_ROOM_SELECTED` - User wants to book a room
- `HELP_SELECTED` - User needs assistance
- `SCAN_COMPLETED` - ID scan finished
- `ROOM_SELECTED` - Room choice made
- `CONFIRM_PAYMENT` - Payment confirmed
- `DISPENSE_COMPLETE` - Key dispensed

**Navigation:**
- `BACK_REQUESTED` - Navigate backward
- `CANCEL_REQUESTED` - Cancel current operation

**AI/Chat:**
- `EXPLAIN_CAPABILITIES` - User asks what the system can do
- `GENERAL_QUERY` - General question or conversation

---

## 4. Architecture Principles

### Frontend-Backend Contract

The shared contracts enforce a **strict separation of concerns**:

1. **Frontend Responsibilities:**
   - Render UI based on `ui_state`
   - Emit `UIEvent` when user interacts
   - Display chat messages
   - Never decide flow or outcomes

2. **Backend Responsibilities:**
   - Receive `UIEvent` from frontend
   - Process business logic
   - Return `BackendResponse` with next `ui_state`
   - Determine flow and outcomes

### Key Rules

> **Frontend is a Renderer, Not a Brain**

- Frontend **reads** `ui_state` and renders accordingly
- Frontend **emits** events (intents), never outcomes
- Frontend **never** mutates or derives state
- Frontend **never** decides what comes next

> **Backend is the Authority**

- Backend receives intents from frontend
- Backend validates and processes requests
- Backend determines next state
- Backend controls all flow logic

### Data Flow

```
User Action → Frontend emits UIEvent → Backend processes → Backend returns BackendResponse → Frontend renders new ui_state
```

---

## 5. Type Safety

All contracts use **TypeScript** for compile-time type safety:

- **Union Types**: `UIState`, `UIEventType`, `Intent` are strict enums
- **Interfaces**: `ChatMessage`, `BackendResponse`, `UIEvent` define data shapes
- **Type Handlers**: `UIEventHandler` ensures consistent event handling

This prevents:
- Invalid state transitions
- Typos in event names
- Missing required fields
- Runtime type errors

---

## 6. Usage Examples

### Frontend: Emitting an Event

```typescript
import { UIEvent } from '@/shared/contracts/events.contract';

// User clicks "Check In" button
const event: UIEvent = {
  type: 'CHECK_IN_SELECTED',
  payload: null
};

// Send to backend
sendEventToBackend(event);
```

### Backend: Returning a Response

```typescript
import { BackendResponse, UIState } from '@/shared/contracts/backend.contract';

// Process check-in request
const response: BackendResponse = {
  ui_state: 'SCAN_ID',
  text_response: 'Please scan your ID card',
  metadata: {
    step: 'identity_verification'
  }
};

return response;
```

### Frontend: Rendering Based on State

```typescript
import { UIState } from '@/shared/contracts/backend.contract';

function renderScreen(uiState: UIState) {
  switch (uiState) {
    case 'WELCOME':
      return <WelcomeScreen />;
    case 'SCAN_ID':
      return <ScanIDScreen />;
    case 'PAYMENT':
      return <PaymentScreen />;
    // ... other states
  }
}
```

---

## 7. Contract Versioning

These contracts are **shared** between frontend and backend:

- Both must use the **same version** of contracts
- Changes to contracts require **coordinated deployment**
- Breaking changes need **migration strategy**

### Import Pattern

```typescript
// Frontend
import { UIState, BackendResponse } from '@/shared/contracts/backend.contract';
import { UIEvent, UIEventType } from '@/shared/contracts/events.contract';
import { Intent } from '@/shared/contracts/intents';

// Backend
import { UIState, BackendResponse } from '../shared/contracts/backend.contract';
import { UIEvent, UIEventType } from '../shared/contracts/events.contract';
import { Intent } from '../shared/contracts/intents';
```

---

## 8. Design Philosophy

### Merge-Safe Architecture

The contracts enable **independent development**:

- Frontend team can build UI without backend
- Backend team can build logic without frontend
- Integration happens through **well-defined contracts**
- No tight coupling between layers

### Event-Driven Design

- **Declarative**: Frontend declares what happened
- **Reactive**: Backend reacts to events
- **Unidirectional**: Data flows one way
- **Predictable**: Same event + state = same outcome

### Type-Safe Communication

- **Compile-time checks**: Catch errors before runtime
- **Auto-completion**: IDE support for all types
- **Documentation**: Types serve as inline docs
- **Refactoring**: Safe renames and changes

---

**End of Shared Documentation**
