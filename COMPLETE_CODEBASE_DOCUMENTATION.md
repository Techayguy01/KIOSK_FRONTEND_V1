# KIOSK Frontend V1 - Complete Codebase Documentation

> **Last Updated**: February 17, 2026  
> **Project**: Grand Hotel Kiosk Self-Service System  
> **Tech Stack**: React + TypeScript + Node.js + Groq LLM + Deepgram STT

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Shared Contracts](#shared-contracts)
4. [Backend Documentation](#backend-documentation)
5. [Infrastructure Documentation](#infrastructure-documentation)
6. [Frontend Documentation](#frontend-documentation)
7. [Development Guidelines](#development-guidelines)

---

## 🎯 Project Overview

This is a voice-enabled, AI-powered hotel check-in kiosk system with three main components:

- **Shared**: TypeScript contract definitions ensuring type safety across the entire system
- **Backend**: Node.js server providing voice relay (Deepgram STT) and LLM brain (Groq)
- **Frontend**: React application with agent-based state management and voice UI

### Core Philosophy

```
Frontend makes things beautiful.
Backend makes things correct.
Agent makes things deterministic.
```

**Golden Rules:**
1. **Frontend is a Renderer, Not a Brain** - UI never decides flow
2. **Agent Has Authority** - All navigation logic lives in the agent
3. **Voice is Input** - Speech is data, not intelligence
4. **State Machine is Law** - Transitions are explicit, never inferred

---

# 📦 Part 1: Shared Contracts

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

## 📄 Contract Files

### 1. `shared/contracts/backend.contract.ts`

**Description:**  
Defines the core UI state enumeration and backend response interface. This is the authoritative definition of all possible UI states in the kiosk application.

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
Exhaustive enumeration of all user intents that can trigger state transitions.

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
Defines UI event types and event handler interface for the event-driven architecture.

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

# 🖥️ Part 2: Backend Documentation

## 📁 Backend Folder Structure

```
backend/
├── server.ts
├── deepgramRelay.ts
├── test-llm.mjs
├── package.json
└── src/
    ├── routes/
    │   └── chat.ts
    ├── context/
    │   ├── contextBuilder.ts
    │   └── hotelData.ts
    └── llm/
        ├── contracts.ts
        └── groqClient.ts
```

---

## 📄 Backend Files

### 1. `backend/server.ts`

**Description:**  
Main server entry point initializing WebSocket server for Deepgram voice relay and HTTP server for LLM chat endpoints.

**Key Features:**
- WebSocket on port 3001 for real-time STT relay
- HTTP server on port 3002 for LLM chat API
- Forwards audio from browser to Deepgram
- Routes chat requests to Groq LLM

```typescript
/**
 * Voice Relay + LLM Brain Server
 * 
 * Two responsibilities:
 * 1. WebSocket server for real-time STT relay (voice → Deepgram → text)
 * 2. HTTP server for LLM chat endpoint (text → Groq → intent)
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DeepgramRelay } from './deepgramRelay.js';
import chatRouter from './src/routes/chat.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3002', 10);

// HTTP Server (Express) for LLM Endpoints
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'kiosk-brain' });
});

app.use('/api/chat', chatRouter);

const httpServer = createServer(app);
httpServer.listen(HTTP_PORT, () => {
    console.log(`[Brain] HTTP server listening on http://localhost:${HTTP_PORT}`);
});

// WebSocket Server for Voice Relay (STT)
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (clientWs: WebSocket, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const sampleRate = parseInt(url.searchParams.get('sample_rate') || '48000', 10);

    const deepgram = new DeepgramRelay({
        sampleRate,
        onTranscript: (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        },
        onError: (error) => {
            console.error('[VoiceRelay] Deepgram error:', error.message);
        },
        onClose: () => {
            console.log('[VoiceRelay] Deepgram connection closed');
        }
    });

    deepgram.connect();

    clientWs.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
            deepgram.sendAudio(data);
        }
    });

    clientWs.on('close', () => {
        deepgram.close();
    });
});
```

---

### 2. `backend/deepgramRelay.ts`

**Description:**  
WebSocket relay managing connection to Deepgram Nova-2 STT service. Keeps API keys server-side for security.

```typescript
import WebSocket from 'ws';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

export interface DeepgramRelayOptions {
    sampleRate: number;
    onTranscript: (data: any) => void;
    onError: (error: Error) => void;
    onClose: () => void;
}

export class DeepgramRelay {
    private ws: WebSocket | null = null;
    private options: DeepgramRelayOptions;

    constructor(options: DeepgramRelayOptions) {
        this.options = options;
    }

    public connect(): void {
        const sampleRate = this.options.sampleRate;
        const url = `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=${sampleRate}&interim_results=true&smart_format=true&endpointing=1000`;

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`
            }
        });

        this.ws.on('open', () => {
            console.log(`[DeepgramRelay] Connected at ${sampleRate}Hz`);
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                const json = JSON.parse(data.toString());
                this.options.onTranscript(json);
            } catch (error) {
                console.error('[DeepgramRelay] Parse error:', error);
            }
        });

        this.ws.on('error', (error) => {
            this.options.onError(error as Error);
        });

        this.ws.on('close', () => {
            this.options.onClose();
        });
    }

    public sendAudio(audioData: Buffer): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(audioData);
        }
    }

    public close(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.on('error', () => { });
            this.ws.terminate();
            this.ws = null;
        }
    }
}
```

---

### 3. `backend/src/routes/chat.ts`

**Description:**  
Express router handling `/api/chat` endpoint with session memory and privacy controls.

**Key Features:**
- Session memory with automatic privacy wipe
- Context-aware LLM prompts
- Zod validation for LLM responses
- Confidence scoring

```typescript
import { Router } from 'express';
import { llm } from '../llm/groqClient';
import { LLMResponseSchema, FALLBACK_RESPONSE } from '../llm/contracts';
import { buildSystemContext } from '../context/contextBuilder';
import { HOTEL_CONFIG } from '../context/hotelData';

const router = Router();

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const sessionMemory = new Map<string, ChatMessage[]>();
const MAX_HISTORY_TURNS = 6;

router.post('/', async (req, res) => {
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default";

        // PRIVACY GUARD: Wipe memory when back at WELCOME/IDLE
        if (currentState === "WELCOME" || currentState === "IDLE") {
            if (sessionMemory.has(sid)) {
                console.log(`[Brain] Privacy wipe: Session ${sid}`);
                sessionMemory.delete(sid);
            }
        }

        let history = sessionMemory.get(sid) || [];

        // Build conversation history
        const recentHistory = history.slice(-MAX_HISTORY_TURNS);
        const historySection = recentHistory.length > 0
            ? `--- PREVIOUS CONVERSATION ---\n${recentHistory.map(m => `${m.role === 'user' ? 'Guest' : 'Concierge'}: ${m.content}`).join('\n')}\n------------------------------`
            : "--- PREVIOUS CONVERSATION ---\n(This is the start of the conversation)\n------------------------------";

        // Build dynamic context
        const contextJson = buildSystemContext({ currentState, transcript });

        // Call LLM
        const response = await llm.invoke([
            { role: "system", content: `You are Siya, the AI Concierge...\n${contextJson}\n${historySection}` },
            { role: "user", content: transcript }
        ]);

        const rawContent = response.content.toString();
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        const validated = LLMResponseSchema.parse(JSON.parse(jsonMatch[0]));

        // Update memory
        history.push({ role: "user", content: transcript });
        if (validated.speech) {
            history.push({ role: "assistant", content: validated.speech });
        }
        sessionMemory.set(sid, history);

        res.json(validated);
    } catch (error) {
        console.error("[Brain] Error:", error);
        res.json(FALLBACK_RESPONSE);
    }
});

export default router;
```

---

### 4. `backend/src/llm/groqClient.ts`

**Description:**  
Initializes Groq LLM client (Llama 3.3 70B) with deterministic settings.

```typescript
import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";

dotenv.config();

export const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0, // Deterministic = Safety
    maxTokens: 1024,
});

console.log("[LLM] Groq (Llama 3.3 70B Versatile) initialized.");
```

---

### 5. `backend/src/llm/contracts.ts`

**Description:**  
Zod schemas for LLM validation and governance.

```typescript
import { z } from "zod";

export const IntentSchema = z.enum([
    "IDLE",
    "WELCOME",
    "CHECK_IN",
    "SCAN_ID",
    "PAYMENT",
    "HELP",
    "REPEAT",
    "UNKNOWN",
    "BOOK_ROOM",
    "RECOMMEND_ROOM",
    "GENERAL_QUERY"
]);

export const LLMResponseSchema = z.object({
    speech: z.string(),
    intent: IntentSchema,
    confidence: z.number().min(0).max(1),
    bookingIntent: z.object({
        roomId: z.string(),
        guestEmail: z.string().email().optional(),
        confirmed: z.boolean()
    }).optional()
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export const FALLBACK_RESPONSE: LLMResponse = {
    speech: "I'm having trouble understanding. Please use the touch screen.",
    intent: "UNKNOWN",
    confidence: 0.0
};
```

---

### 6. `backend/src/context/hotelData.ts`

**Description:**  
Static hotel configuration injected into LLM prompts.

```typescript
export const HOTEL_CONFIG = {
    name: "Grand Hotel Nagpur",
    timezone: "Asia/Kolkata",
    checkInStart: "14:00",
    checkOutEnd: "11:00",
    amenities: ["Free Wi-Fi", "Pool (6AM-10PM)", "Breakfast (7AM-10AM)", "Spa"],
    supportPhone: "999",
    location: "Lobby Kiosk"
};
```

---


---


---

### 7. Backend Services

#### `backend/src/services/sessionService.ts`
**Description:**  
Manages persistent chat history using PostgreSQL (`Session` model). Replaced the in-memory `Map`.
- `addMessage(sessionId, message)`: Appends messages to DB.
- `getHistory(sessionId)`: Retrieves chat history.
- `clearSession(sessionId)`: Wipes history for privacy.

#### `backend/src/services/hotelService.ts`
**Description:**  
Fetches real-time hotel data from PostgreSQL (`Room` model).
- `getAvailableRooms()`: Returns list of rooms with `status: 'AVAILABLE'`.
- `getRoomByNumber(number)`: Look up room details by room number.

#### `backend/src/services/bookingService.ts`
**Description:**  
Handles booking logic and Stripe payment integration.
- `createPendingBooking(roomId, email)`: Creates `Booking` record in DB with `PENDING` status.
- `createPaymentSession(bookingId, amount)`: Generates a Stripe Checkout URL for the booking.

---

# 📦 Part 3: Infrastructure Documentation

## 📁 Infrastructure Files

```
/
├── docker-compose.yml              # Database & Cache container orchestration
└── backend/
    └── prisma/
        └── schema.prisma           # Database schema definition
```

---

## 📄 Infrastructure Files

### 1. `docker-compose.yml`

**Description:**  
Orchestrates the PostgreSQL database (persisted data) and Redis cache (session/ephemeral data).

```yaml
version: '3.8'

services:
  # Primary Database (The "PMS" & Logs)
  postgres:
    image: postgres:15-alpine
    container_name: kiosk_db
    restart: always
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password123
      POSTGRES_DB: kiosk_main
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Session Cache (The "Short-term Memory")
  redis:
    image: redis:7-alpine
    container_name: kiosk_cache
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

### 2. `backend/prisma/schema.prisma`

**Description:**  
Defines the data models for the application.
- **Session**: Stores chat history and metadata for LLM context.
- **Room/Guest/Booking**: Mocks a Hotel PMS (Property Management System) for realistic data interactions.

```prisma
// backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// --- AI MEMORY ---
// Replaces the in-memory Map for chat history
model Session {
  id        String   @id // The sessionId passed from frontend
  messages  Json     // Stores array of { role, content }
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  metadata  Json?    // Store intent confidence, user mood, etc.
}

// --- PMS MIRROR (Mocking the real hotel DB) ---
model Room {
  id          String    @id @default(uuid())
  number      String    @unique
  type        String    // "DELUXE", "SUITE"
  price       Float
  status      String    // "AVAILABLE", "OCCUPIED", "DIRTY"
  description String
  amenities   String[]
  bookings    Booking[]
}

model Guest {
  id        String   @id @default(uuid())
  firstName String
  lastName  String
  email     String   @unique
  bookings  Booking[]
}

model Booking {
  id        String   @id @default(uuid())
  guestId   String
  roomId    String
  checkIn   DateTime
  checkOut  DateTime
  status    String   // "CONFIRMED", "CHECKED_IN", "CANCELLED"
  guest     Guest    @relation(fields: [guestId], references: [id])
  room      Room     @relation(fields: [roomId], references: [id])
}
```

---

# �🎨 Part 4: Frontend Documentation

## 📁 Frontend Folder Structure

```
frontend/
├── index.html                      # Main HTML entry point
├── index.tsx                       # React root renderer
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
├── vite.config.ts                  # Vite build config
│
├── app/
│   └── App.tsx                     # Main app component
│
├── agent/                          # Agent Authority (State Machine)
│   ├── index.ts                    # Pure state machine
│   └── adapter.ts                  # UI-Agent bridge
│
├── state/                          # UI State Management
│   ├── uiState.types.ts
│   ├── uiState.machine.ts
│   └── uiContext.ts
│
├── pages/                          # Page Components
│   ├── IdlePage.tsx
│   ├── WelcomePage.tsx
│   ├── ScanIdPage.tsx
│   ├── RoomSelectPage.tsx
│   ├── PaymentPage.tsx
│   └── CompletePage.tsx
│
├── components/                     # UI Components
│   ├── AiOrbGlobal.tsx
│   ├── BackButton.tsx
│   ├── CaptionsOverlay.tsx
│   ├── MicrophoneButton.tsx
│   └── ui/                         # Design system
│
└── voice/                          # Voice Infrastructure
    ├── VoiceRuntime.ts
    ├── VoiceClient.ts
    ├── TTSController.ts
    └── voice.types.ts
```

---

## 🎯 Frontend Architecture

### Core Principles

1. **Agent Authority**: All navigation logic lives in `agent/`, NEVER in components
2. **Frontend as Renderer**: UI components are "dumb" - they only display and emit intents
3. **Voice as Input**: Voice is treated as just another input method, not intelligence
4. **State Machine**: Strict state transitions defined in agent, not inferred

### Data Flow

```
User Input → Component → emit(Intent) → AgentAdapter → processIntent() → State Change → UI Re-render
```

---

## 📄 Key Frontend Files

### 1. `frontend/index.html`

Main HTML shell with CDN imports for Tailwind CSS and ES module import maps.

### 2. `frontend/app/App.tsx`

**Description:**  
Main application orchestrator connecting AgentAdapter to React UI.

**Key Responsibilities:**
- Subscribe to AgentAdapter state changes
- Route state to appropriate page components
- Manage global UI context
- Handle error boundaries

---

### 3. `frontend/agent/adapter.ts`

**Description:**  
Singleton service acting as bridge between UI and agent logic.

**Key Features:**
- State management and transitions
- Voice event processing
- Intent dispatch and validation
- LLM integration
- Sentiment analysis and escalation
- TTS control

**Critical Methods:**
- `handleVoiceEvent()`: Routes voice events
- `processWithLLMBrain()`: Calls backend LLM API
- `handleIntent()`: Processes UI intents
- `transitionTo()`: Performs state transitions

---

### 4. `frontend/state/uiState.machine.ts`

**Description:**  
State machine configuration defining all valid transitions.

```typescript
const MACHINE_CONFIG = {
    IDLE: {
        on: {
            PROXIMITY_DETECTED: "WELCOME"
        }
    },
    WELCOME: {
        on: {
            CHECK_IN_SELECTED: "SCAN_ID",
            BOOK_ROOM_SELECTED: "ROOM_SELECT"
        }
    },
    SCAN_ID: {
        on: {
            SCAN_COMPLETED: "ROOM_SELECT",
            BACK_REQUESTED: "WELCOME"
        }
    },
    // ... more states
};
```

---

### 5. `frontend/voice/VoiceRuntime.ts`

**Description:**  
Core voice session controller managing microphone capture and STT streaming.

**Key Features:**
- Session lifecycle management
- Audio capture via AudioWorklet
- WebSocket connection to backend relay
- Turn state management (USER_SPEAKING, SYSTEM_RESPONDING)
- Event emission for transcripts

---

## 📊 Architecture Diagrams

### State Machine Flow

```
IDLE → WELCOME → SCAN_ID → ROOM_SELECT → PAYMENT → COMPLETE
         ↓
      AI_CHAT (voice mode)
```

### Voice Processing Pipeline

```
Microphone → AudioWorklet → VoiceClient (WS) → Backend Relay → Deepgram
                                                                    ↓
AgentAdapter ← VoiceRuntime ← Frontend ← Backend ← Transcript
     ↓
State Machine → UI Update
```

---

# 🛠️ Part 5: Development Guidelines

## Environment Setup

### Required Environment Variables

```bash
# Backend (.env)
DEEPGRAM_API_KEY=your_deepgram_key
GROQ_API_KEY=your_groq_key
PORT=3001
HTTP_PORT=3002
```

---

## Running the Project

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Testing

### Backend Tests
```bash
# Test LLM endpoint
node test-llm.mjs
```

### Frontend Tests
```bash
# Run agent tests
npm test
```

---

## Critical Design Rules

### 🚫 Frontend NEVER Does:
- ❌ Decide flow (no `setTimeout` advancing screens)
- ❌ Infer intent (no "smart" auto-navigation)
- ❌ Calculate business logic (prices, discounts)
- ❌ Track history (no previous page assumptions)

### ✅ Frontend ONLY Does:
- ✅ Render UI based on `ui_state`
- ✅ Emit intents when user acts
- ✅ Display data from props/mocks
- ✅ Animations and visual feedback

---

## Adding New Features

### Adding a New State
1. Add to `UIState` in `shared/contracts/backend.contract.ts`
2. Update `frontend/agent/index.ts` transition table
3. Create page component in `frontend/pages/`
4. Add route in `frontend/app/App.tsx`

### Adding a New Intent
1. Add to `Intent` in `shared/contracts/intents.ts`
2. Define transition in `frontend/agent/index.ts`
3. Map voice command in `VOICE_COMMAND_MAP` if needed
4. Update `backend/src/llm/contracts.ts`

---

## 🎯 Summary Statistics

### Codebase Overview

| Component | Files | Lines of Code | Language |
|-----------|-------|---------------|----------|
| Shared | 3 | 71 | TypeScript |
| Backend | 9 | ~800 | TypeScript |
| Frontend | 62+ | ~10,000 | TypeScript/React |
| **Total** | **74+** | **~10,871** | **TypeScript** |

### Technology Stack

**Frontend:**
- React 18.2
- Vite 6.2
- Three.js + React Three Fiber (3D)
- Framer Motion (animations)
- TailwindCSS (styling)

**Backend:**
- Node.js + Express
- WebSocket (ws)
- LangChain + Groq (LLM)
- Deepgram Nova-2 (STT)
- Zod (validation)
- Prisma (ORM)
- PostgreSQL (Database)
- Redis (Cache)

**Shared:**
- TypeScript 5.8
- Pure type definitions

---

## 🔐 Security Considerations

1. **API Keys**: Always server-side, never in frontend
2. **Session Privacy**: Memory wiped on WELCOME/IDLE transitions
3. **Voice Disabling**: Input disabled during SCAN_ID and PAYMENT states
4. **Intent Validation**: Zod schemas prevent malicious LLM outputs
5. **Rate Limiting**: Built into AgentAdapter to prevent spam

---

## 📚 Additional Resources

- [Backend Documentation](./backend/backend-all-code.md)
- [Frontend Documentation](./frontend/frontend-all-code.md)
- [Shared Contracts](./shared/shared-all-code.md)
- [Test Execution Summary](./TEST_EXECUTION_SUMMARY.md)
- [Test Cases](./TEST_CASES.md)

---

**End of Complete Codebase Documentation**

This document serves as the single source of truth for understanding the entire kiosk system architecture, design decisions, and implementation details.
