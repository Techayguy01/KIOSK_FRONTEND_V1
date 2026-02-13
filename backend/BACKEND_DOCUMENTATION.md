# Backend Code Documentation

## 1. Folder Structure

```
KIOSK_FRONTEND_V1/backend/
├── .env                          # Environment variables (API keys)
├── package.json                  # Project dependencies and scripts
├── package-lock.json             # Locked dependency versions
├── server.ts                     # Main server entry point (WebSocket + HTTP)
├── deepgramRelay.ts              # Deepgram WebSocket relay module
├── test-llm.mjs                  # LLM integration test script
├── node_modules/                 # Dependencies (excluded from documentation)
└── src/
    ├── context/
    │   ├── contextBuilder.ts     # Builds situational context for LLM
    │   └── hotelData.ts          # Static hotel configuration data
    ├── llm/
    │   ├── contracts.ts          # LLM response schemas and validation
    │   └── groqClient.ts         # Groq LLM client initialization
    └── routes/
        └── chat.ts               # HTTP endpoint for LLM chat requests
```

---

## 2. Code Files

### a) Location: `KIOSK_FRONTEND_V1/backend/package.json`

```json
{
    "name": "kiosk-voice-relay",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
        "dev": "tsx watch server.ts",
        "start": "tsx server.ts"
    },
    "dependencies": {
        "@langchain/core": "^1.1.19",
        "@langchain/groq": "^1.0.4",
        "cors": "^2.8.6",
        "dotenv": "^16.4.1",
        "express": "^5.2.1",
        "ws": "^8.16.0",
        "zod": "^4.3.6"
    },
    "devDependencies": {
        "@types/cors": "^2.8.19",
        "@types/express": "^5.0.6",
        "@types/ws": "^8.5.10",
        "tsx": "^4.7.0",
        "typescript": "^5.3.3"
    }
}
```

---

### b) Location: `KIOSK_FRONTEND_V1/backend/server.ts`

```typescript
/**
 * Voice Relay + LLM Brain Server
 * 
 * Two responsibilities:
 * 1. WebSocket server for real-time STT relay (voice → Deepgram → text)
 * 2. HTTP server for LLM chat endpoint (text → Groq → intent)
 * 
 * Architecture:
 *   Browser (AudioWorklet) → Backend Relay → Deepgram Nova-2
 *   Deepgram Transcripts → Backend Relay → Browser VoiceRuntime
 *   Transcript → /api/chat → Groq LLM → Intent + Speech
 * 
 * RULE: Voice Relay is a PIPE, not a BRAIN.
 * RULE: LLM endpoint is an ADVISOR, not a CONTROLLER.
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
const DEFAULT_SAMPLE_RATE = 48000;

// ============================================
// 1. HTTP Server (Express) for LLM Endpoints
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'kiosk-brain' });
});

// LLM Chat endpoint
app.use('/api/chat', chatRouter);

const httpServer = createServer(app);
httpServer.listen(HTTP_PORT, () => {
    console.log(`[Brain] HTTP server listening on http://localhost:${HTTP_PORT}`);
    console.log(`[Brain] Chat endpoint: POST http://localhost:${HTTP_PORT}/api/chat`);
});

// ============================================
// 2. WebSocket Server for Voice Relay (STT)
// ============================================
const wss = new WebSocketServer({ port: PORT });

console.log(`[VoiceRelay] WebSocket server starting on ws://localhost:${PORT}`);

wss.on('connection', (clientWs: WebSocket, req) => {
    console.log(`[VoiceRelay] Browser connected from ${req.socket.remoteAddress}`);

    // Extract sample_rate from query params (forwarded from frontend)
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const sampleRate = parseInt(url.searchParams.get('sample_rate') || String(DEFAULT_SAMPLE_RATE), 10);

    console.log(`[VoiceRelay] Client requested sample_rate=${sampleRate}Hz`);

    // Create Deepgram relay for this session with forwarded sample_rate
    const deepgram = new DeepgramRelay({
        sampleRate,  // Forward to Deepgram
        onTranscript: (data) => {
            // Forward Deepgram response to browser (no modification)
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        },
        onError: (error) => {
            console.error('[VoiceRelay] Deepgram error:', error.message);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ error: error.message }));
            }
        },
        onClose: () => {
            console.log('[VoiceRelay] Deepgram connection closed');
        }
    });

    // Connect to Deepgram
    deepgram.connect();

    // Handle binary audio from browser
    clientWs.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
            // Forward audio to Deepgram
            deepgram.sendAudio(data);
        } else {
            // Handle control messages if needed
            const message = data.toString();
            console.log('[VoiceRelay] Control message:', message);
        }
    });

    // Cleanup on browser disconnect
    clientWs.on('close', (code, reason) => {
        console.log(`[VoiceRelay] Browser disconnected: ${code} ${reason}`);
        deepgram.close();
    });

    clientWs.on('error', (error) => {
        console.error('[VoiceRelay] Client error:', error);
        deepgram.close();
    });
});

wss.on('error', (error) => {
    console.error('[VoiceRelay] Server error:', error);
});

console.log(`[VoiceRelay] Ready. Waiting for connections on port ${PORT}`);
```

---

### c) Location: `KIOSK_FRONTEND_V1/backend/deepgramRelay.ts`

```typescript
/**
 * Deepgram Relay Module
 * 
 * Creates a WebSocket connection to Deepgram Nova-2 on behalf of the browser.
 * This keeps the API key server-side only.
 * 
 * RULE: This is a PIPE, not a BRAIN. Pass through bytes only.
 * 
 * Parameters (forwarded from frontend):
 * - sample_rate: Passed from frontend AudioContext native rate
 */

import WebSocket from 'ws';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

export interface DeepgramRelayOptions {
    sampleRate: number;  // Forwarded from frontend
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
        if (!DEEPGRAM_API_KEY) {
            console.error('[DeepgramRelay] DEEPGRAM_API_KEY not set in backend .env');
            this.options.onError(new Error('Missing DEEPGRAM_API_KEY'));
            return;
        }

        const sampleRate = this.options.sampleRate;

        // Nova-2 configuration with forwarded sample_rate
        const url = `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=${sampleRate}&interim_results=true&smart_format=true&endpointing=1000`;

        console.log(`[DeepgramRelay] Connecting to Nova-2 at ${sampleRate}Hz (forwarded from client)...`);

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`
            }
        });

        this.ws.on('open', () => {
            console.log(`[DeepgramRelay] Connected to Deepgram Nova-2 at ${sampleRate}Hz`);
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                // Parse Deepgram response and forward to browser
                const json = JSON.parse(data.toString());
                this.options.onTranscript(json);
            } catch (error) {
                console.error('[DeepgramRelay] Failed to parse Deepgram response:', error);
            }
        });

        this.ws.on('error', (error) => {
            console.error('[DeepgramRelay] WebSocket error:', error);
            this.options.onError(error as Error);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`[DeepgramRelay] WebSocket closed: ${code} ${reason}`);
            this.options.onClose();
        });
    }

    /**
     * Forward binary audio from browser to Deepgram.
     * Hardened: Only sends if socket is OPEN, otherwise drops silently.
     */
    public sendAudio(audioData: Buffer): void {
        // Guard: Only send if socket exists and is OPEN
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(audioData);
        }
        // CONNECTING, CLOSING, CLOSED: Drop packet silently (no error)
    }

    /**
     * HARD TERMINATION - "The Zombie Killer" (Phase 8.8)
     * 
     * Destroys the WebSocket connection immediately at OS level.
     * No handshake, no waiting, no zombies.
     * 
     * Protocol:
     * 1. removeAllListeners() - Silence all events
     * 2. terminate() - Destroy socket at OS level (not close())
     * 3. Nullify reference
     */
    public close(): void {
        if (this.ws) {
            console.log('[DeepgramRelay] Killing connection');

            try {
                // 1. Event Silencing: Prevent close/error events during teardown
                this.ws.removeAllListeners();

                // 2. Error Swallower: Attach dummy listener to catch terminate() error
                // Without this, Node.js crashes on unhandled 'error' event
                this.ws.on('error', () => { });

                // 3. Hard Termination: Destroy at OS level, not graceful close
                // .terminate() kills instantly; .close() waits for handshake
                this.ws.terminate();
            } catch {
                // Error Suppression: We don't care if it fails
                // The goal is to ensure the socket is dead
            }

            // 3. Nullification: Prevent any subsequent calls
            this.ws = null;
        }
    }

    public isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
```

---

### d) Location: `KIOSK_FRONTEND_V1/backend/test-llm.mjs`

```javascript
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
```

---

### e) Location: `KIOSK_FRONTEND_V1/backend/src/llm/contracts.ts`

```typescript
import { z } from "zod";

/**
 * LLM Contracts (Phase 9.2 - Prompt Governance)
 * 
 * This is the SINGLE SOURCE OF TRUTH for LLM output validation.
 * The LLM is an ADVISOR - it can only suggest intents from this list.
 * The Agent (FSM) is the AUTHORITY - it decides if the intent is valid.
 */

// 1. Define the Strict List of Allowed Intents
// These MUST match your Agent's FSM capabilities.
export const IntentSchema = z.enum([
    "IDLE",
    "WELCOME",
    "CHECK_IN",     // User wants to check in
    "SCAN_ID",      // User is ready to scan ID / providing name
    "PAYMENT",      // User wants to pay
    "HELP",         // User needs assistance
    "REPEAT",       // User asked to repeat the last thing
    "UNKNOWN",      // LLM is confused / Out of domain
    "BOOK_ROOM",    // Phase 16: Booking Intent
    "RECOMMEND_ROOM", // Phase 16: Agentic Choice
    "GENERAL_QUERY"   // Phase 16: Chat / Policy / Jokes
]);

// Phase 9.4: Confidence Thresholds for Safety Gating
export const CONFIDENCE_THRESHOLDS = {
    HIGH: 0.85,     // Execute immediately
    MEDIUM: 0.50,   // Ask clarifying question
    // Below 0.50 is considered Noise/Silence - reject
};

// 2. Define the strict JSON Output Schema
export const LLMResponseSchema = z.object({
    speech: z.string().describe("A concise, polite response for the TTS (max 2 sentences)."),
    intent: IntentSchema.describe("The classification of the user's request."),
    confidence: z.number().min(0).max(1).describe("Self-evaluated confidence score (0.0 to 1.0).")
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;
export type ValidIntent = z.infer<typeof IntentSchema>;

// 3. Default fallback for validation failures
export const FALLBACK_RESPONSE: LLMResponse = {
    speech: "I'm having trouble understanding. Please use the touch screen.",
    intent: "UNKNOWN",
    confidence: 0.0
};
```

---

### f) Location: `KIOSK_FRONTEND_V1/backend/src/llm/groqClient.ts`

```typescript
import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY is missing. Voice will be dumb.");
}

// Llama 3.3 70B Versatile: High intelligence, extremely low latency (Groq LPU)
// Updated from decommissioned llama3-70b-8192
export const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0, // Deterministic = Safety
    maxTokens: 1024,
});

console.log("[LLM] Groq (Llama 3.3 70B Versatile) initialized.");
```

---

### g) Location: `KIOSK_FRONTEND_V1/backend/src/context/hotelData.ts`

```typescript
/**
 * Hotel Configuration (Phase 9.3 - Context Injection)
 * 
 * Static "Truth" about the hotel.
 * This data is injected into every LLM prompt.
 */

export const HOTEL_CONFIG = {
    name: "Grand Hotel Nagpur",
    timezone: "Asia/Kolkata", // CRITICAL: Force local time, not server time
    checkInStart: "14:00", // THis is Check-in-Time
    checkOutEnd: "11:00", // This is Check-out-Time
    amenities: ["Free Wi-Fi", "Pool (6AM-10PM)", "Breakfast (7AM-10AM)", "Spa"], // This is Amenities
    supportPhone: "999", // This is Support Phone
    location: "Lobby Kiosk" // This is Location
};
```

---

### h) Location: `KIOSK_FRONTEND_V1/backend/src/context/contextBuilder.ts`

```typescript
import { HOTEL_CONFIG } from "./hotelData";

/**
 * Context Builder (Phase 9.3 - Situational Awareness)
 * 
 * Builds the "World View" for the LLM every request.
 * This is STATELESS - we inject reality, not memory.
 */

interface ContextInput {
    currentState: string;
    transcript: string;
}

export function buildSystemContext(input: ContextInput): string {
    // 1. Get Local Hotel Time (Not Server Time!)
    const now = new Date();

    const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: HOTEL_CONFIG.timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    }).format(now);

    const currentHour = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: HOTEL_CONFIG.timezone,
        hour: 'numeric',
        hour12: false
    }).format(now));

    const partOfDay = currentHour < 12 ? "Morning" : currentHour < 18 ? "Afternoon" : "Evening";

    // 2. Build Context Object
    const context = {
        environment: {
            hotel: HOTEL_CONFIG.name,
            location: HOTEL_CONFIG.location,
            localTime: localTime,
            partOfDay: partOfDay,
        },
        kioskState: {
            currentScreen: input.currentState,
            canSpeak: true, // Voice is active
        },
        policy: {
            checkIn: HOTEL_CONFIG.checkInStart,
            checkOut: HOTEL_CONFIG.checkOutEnd,
            amenities: HOTEL_CONFIG.amenities,
        }
    };

    return JSON.stringify(context, null, 2);
}
```

---

### i) Location: `KIOSK_FRONTEND_V1/backend/src/routes/chat.ts`

```typescript
import { Router, Request, Response } from 'express';
import { llm } from '../llm/groqClient';
import { LLMResponseSchema, FALLBACK_RESPONSE } from '../llm/contracts';
import { buildSystemContext } from '../context/contextBuilder';
import { HOTEL_CONFIG } from '../context/hotelData';

const router = Router();

/**
 * Phase 9.6: Session Memory Store
 * 
 * Simple in-memory session store (Map<sessionId, History[]>)
 * In production, use Redis. For Kiosk (single active user), memory is fine.
 * 
 * PRIVACY RULE: Memory is WIPED when user returns to WELCOME/IDLE.
 */
interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const sessionMemory = new Map<string, ChatMessage[]>();
const MAX_HISTORY_TURNS = 6;  // Last 3 exchanges (6 messages)

/**
 * Phase 9.4 - Context-Aware System Prompt with Confidence Scoring
 * Phase 9.6 - Now includes conversation history
 */
const SYSTEM_PROMPT_TEMPLATE = `
You are Siya, the AI Concierge at {{HOTEL_NAME}}.
Your goal is to assist guests with Check-In, Booking, and General Questions.
You must be helpful, concise, and professional.

--- CURRENT SITUATIONAL CONTEXT ---
{{CONTEXT_JSON}}
-----------------------------------

{{CONVERSATION_HISTORY}}

# CRITICAL RULES:
1.  **Identify Intent:** Classify the user's request into one of these strict intents:
    * CHECK_IN (User wants to check in, scan ID, or lookup reservation).
    * BOOK_ROOM (User wants to book a new room).
    * RECOMMEND_ROOM (User asks YOU to choose/recommend a room).
    * HELP (User is confused, angry, or asks for a human).
    * GENERAL_QUERY (General questions about policy, weather, jokes).
    * IDLE (No speech detected or irrelevant).
    * UNKNOWN (Cannot determine intent).

2.  **State Awareness:** You are currently on the "{{CURRENT_STATE}}" screen.

3.  **Handle "Re-Stated" Intents:**
    * If the user says "I want to book" and they are *already* booking, treat it as a "GENERAL_QUERY" confirmation.
    * *Reply:* "Great. Please select a room from the screen to proceed."

4.  **Handle "Agentic Choice":**
    * If the user says "You choose" or "Recommend one", you MUST make a decision.
    * *Reply:* "I have selected the Deluxe Suite for you. It has a great view."
    * *Intent:* RECOMMEND_ROOM

5.  **Format:**
    * Keep 'speech' short (under 2 sentences).
    * Never say "I am an AI".
    * Output strictly in JSON format.

OUTPUT FORMAT (JSON ONLY):
{
  "speech": "string (The spoken response)",
  "intent": "VALID_INTENT_ENUM",
  "confidence": number (0.0 to 1.0)
}
`;

router.post('/', async (req: Request, res: Response) => {
    const start = Date.now();
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default";  // Fallback for testing

        console.log(`[Brain] Input: "${transcript}" | State: ${currentState} | Session: ${sid}`);

        // 1. PRIVACY GUARD 🛡️
        // If we are back at WELCOME or IDLE, the previous user is gone. Wipe memory.
        if (currentState === "WELCOME" || currentState === "IDLE") {
            if (sessionMemory.has(sid)) {
                console.log(`[Brain] Privacy wipe: Session ${sid} memory cleared`);
                sessionMemory.delete(sid);
            }
        }

        // Empty transcript = IDLE
        if (!transcript || transcript.trim().length === 0) {
            res.json({ speech: "", intent: "IDLE", confidence: 1.0 });
            return;
        }

        // 2. Retrieve History
        let history = sessionMemory.get(sid) || [];

        // 3. Build History String for Prompt
        const recentHistory = history.slice(-MAX_HISTORY_TURNS);
        let historySection = "";
        if (recentHistory.length > 0) {
            historySection = `--- PREVIOUS CONVERSATION ---
${recentHistory.map(m => `${m.role === 'user' ? 'Guest' : 'Concierge'}: ${m.content}`).join('\n')}
------------------------------`;
        } else {
            historySection = "--- PREVIOUS CONVERSATION ---\n(This is the start of the conversation)\n------------------------------";
        }

        // 4. Build the Dynamic Context
        const contextJson = buildSystemContext({
            currentState: currentState || "IDLE",
            transcript
        });

        // 5. Inject into Prompt Template
        const filledPrompt = SYSTEM_PROMPT_TEMPLATE
            .replace('{{HOTEL_NAME}}', HOTEL_CONFIG.name)
            .replace('{{CONTEXT_JSON}}', contextJson)
            .replace('{{CURRENT_STATE}}', currentState || "IDLE")
            .replace('{{CONVERSATION_HISTORY}}', historySection);

        // 6. Call LLM with Context + History
        const response = await llm.invoke([
            { role: "system", content: filledPrompt },
            { role: "user", content: transcript }
        ]);

        // 7. Extract JSON from response
        const rawContent = response.content.toString();
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.warn("[Brain] LLM failed to output JSON:", rawContent);
            throw new Error("Malformed LLM Output");
        }

        const parsedJson = JSON.parse(jsonMatch[0]);

        // 8. ZOD VALIDATION
        const validated = LLMResponseSchema.parse(parsedJson);

        // 9. UPDATE MEMORY (Post-Response)
        history.push({ role: "user", content: transcript });
        if (validated.speech) {
            history.push({ role: "assistant", content: validated.speech });
        }
        sessionMemory.set(sid, history);

        console.log(`[Brain] Validated:`, validated, `(${Date.now() - start}ms)`);
        res.json(validated);

    } catch (error) {
        console.error("[Brain] Rejected:", error);
        res.json(FALLBACK_RESPONSE);
    }
});

export default router;
```

---

## 3. Architecture Overview

### System Components

1. **Voice Relay (WebSocket Server)**
   - Port: 3001
   - Purpose: Relay audio between browser and Deepgram STT service
   - Acts as a secure proxy to keep API keys server-side

2. **LLM Brain (HTTP Server)**
   - Port: 3002
   - Purpose: Process transcripts and return intent + speech responses
   - Endpoint: `POST /api/chat`

3. **Deepgram Integration**
   - Model: Nova-2
   - Encoding: Linear16 PCM
   - Features: Interim results, smart formatting, endpointing

4. **LLM Integration**
   - Provider: Groq
   - Model: Llama 3.3 70B Versatile
   - Temperature: 0 (deterministic)
   - Output: Structured JSON with Zod validation

### Key Design Principles

- **Backend is a PIPE, not a BRAIN**: Voice relay passes data without interpretation
- **LLM is an ADVISOR, not a CONTROLLER**: Suggests intents, doesn't control flow
- **Privacy-First**: Session memory wiped when returning to WELCOME/IDLE states
- **Validation-First**: All LLM outputs validated against strict schemas
- **Context-Aware**: Injects hotel data, time, and state into every request

### Data Flow

```
Browser → WebSocket (3001) → Deepgram → Transcripts → Browser
Browser → HTTP POST /api/chat (3002) → LLM → Intent + Speech → Browser
```

---

## 4. Environment Variables Required

Create a `.env` file in the backend directory with:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
GROQ_API_KEY=your_groq_api_key_here
PORT=3001
HTTP_PORT=3002
```

---

## 5. Running the Backend

### Development Mode (with hot reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Testing LLM Integration
```bash
node test-llm.mjs
```

---

**End of Backend Documentation**
