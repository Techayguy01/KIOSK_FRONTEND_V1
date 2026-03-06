# Backend Code Documentation

## 1. Overview

The Kiosk Backend is a hybrid server providing two primary services:
1.  **Voice Relay (WebSocket)**: A secure, low-latency pipe for real-time Speech-to-Text (STT) via Deepgram Nova-2.
2.  **LLM Brain (HTTP/REST)**: A multi-tenant intelligence layer using Groq (Llama 3.3 70B) to process transcripts, extract intents, and manage booking flows.

The architecture is designed to be **stateless** for voice packets but **context-aware** for chat sessions, with a strong focus on **multi-tenant isolation** and **privacy**.

---

## 2. Folder Structure

```
KIOSK_FRONTEND_V1/backend/
├── .env                          # Environment variables (API keys, ports)
├── package.json                  # Dependencies and Prisma scripts
├── server.ts                     # Main entry point (WS + HTTP)
├── deepgramRelay.ts              # WebSocket relay for Deepgram STT
├── prisma/                       # Database schema and migrations
│   ├── schema.prisma             # Multi-tenant data model
│   └── seed.ts                   # Initial tenant and room data
├── src/
│   ├── context/
│   │   ├── contextBuilder.ts     # Builds situational context for LLM
│   │   ├── hotelData.ts          # Static fallback configuration
│   │   └── roomInventory.ts      # Static fallback room data
│   ├── db/
│   │   └── prisma.ts             # Prisma client singleton
│   ├── llm/
│   │   ├── contracts.ts          # General chat schemas
│   │   ├── bookingContracts.ts   # Booking flow schemas
│   │   └── groqClient.ts         # Groq LLM initialization
│   ├── middleware/
│   │   ├── requestContext.ts     # Request ID and logging
│   │   ├── tenantResolver.ts     # Resolves tenant from URL or Headers
│   │   └── validateRequest.ts    # Zod validation middleware
│   ├── routes/
│   │   ├── chat.ts               # General AI concierge endpoint
│   │   └── bookingChat.ts        # Agentic booking flow endpoint
│   ├── types/
│   │   └── express.d.ts          # Custom Express request types
│   └── utils/
│       ├── http.ts               # Standard API error responses
│       └── logger.ts             # Context-aware logging
└── test-llm.mjs                  # Integration test script
```

---

## 3. Core Components

### A. Voice Relay (WebSocket)
**Location**: `backend/server.ts` & `backend/deepgramRelay.ts`

-   **Purpose**: Securely relays binary audio from the browser to Deepgram.
-   **Security**: API keys are never exposed to the client.
-   **Hard Termination**: Implements a "Zombie Killer" pattern to instantly destroy connections and prevent memory leaks.
-   **Parameters**: Supports dynamic `sample_rate` and `language` forwarding.

### B. Multi-Tenant Brain (HTTP)
**Location**: `backend/src/middleware/tenantResolver.ts`

The backend resolves tenants using:
1.  **URL Parameter**: `/api/:tenantSlug/...`
2.  **Custom Header**: `x-tenant-slug` or `x-kiosk-tenant`

Every request is scoped to a specific `tenant` in the database, ensuring isolation of configuration, room inventory, and bookings.

### C. LLM Integration (Groq)
**Location**: `backend/src/llm/`

-   **Model**: Llama 3.3 70B Versatile (via Groq LPU).
-   **Roles**:
    -   **Siya (Concierge)**: Handles general queries and intent detection.
    -   **Booking Agent**: A specialized agent that fills "slots" (roomType, dates, guests) through conversation.
-   **Validation**: All LLM outputs are strictly validated using **Zod** schemas before being returned to the frontend.

### D. Persistence (Prisma)
**Location**: `backend/prisma/schema.prisma`

Stores:
-   **Tenants**: Slug, name, and hotel configuration.
-   **RoomTypes**: Pricing, amenities, and codes.
-   **Bookings**: Draft and confirmed reservations with idempotency keys.

---

## 4. Key Endpoints

### 1. General Chat
`POST /api/chat` or `POST /api/:tenantSlug/chat`
-   **Body**: `{ transcript, currentState, sessionId }`
-   **Response**: `{ speech, intent, confidence }`
-   **Privacy**: Session memory is wiped when returning to `WELCOME` or `IDLE` states.

### 2. Booking Chat
`POST /api/chat/booking` or `POST /api/:tenantSlug/chat/booking`
-   **Body**: `{ transcript, currentState, sessionId }`
-   **Response**: `{ speech, intent, extractedSlots, isComplete, persistedBookingId }`
-   **Behavior**: Automatically persists draft bookings to the database as slots are filled.

### 3. Room Inventory
`GET /api/:tenantSlug/rooms`
-   **Returns**: List of room types for the specified tenant.

---

## 5. Environment Variables

Create a `.env` file in `backend/`:

```env
# API Keys
DEEPGRAM_API_KEY=your_key
GROQ_API_KEY=your_key

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/kiosk"

# Config
PORT=3001
HTTP_PORT=3002
DEEPGRAM_MODEL=nova-2
DEEPGRAM_LANGUAGE=hi # Default language
```

---

## 6. Development Commands

```bash
# Install dependencies
npm install

# Database setup
npx prisma migrate dev
npm run prisma:seed

# Start development server
npm run dev

# Run LLM tests
node test-llm.mjs
```

---

**End of Backend Documentation**
