# Kiosk AI Backend V2 Architecture

## Overview
This document outlines the architecture for the V2 Backend of the AI Kiosk project. The original V1 backend (Node.js/TypeScript) served as a proof-of-concept for hardware integration and basic LLM conversational flows. V2 transitions the core intelligence to Python to leverage advanced AI orchestration tools, specifically **LangGraph**, while utilizing **FastAPI** for high-performance WebSocket streaming.

## Core Objectives of V2
1. **Deterministic State Management:** Move state management (e.g., tracking missing booking slots) out of the frontend and into a robust, deterministic graph on the backend.
2. **Simplified Frontend:** The React frontend becomes a "dumb" renderer that simply updates its UI based on the exact state broadcasted by the backend.
3. **Conversational Resilience:** The AI must seamlessly handle context switching (e.g., stopping a booking to answer a question about the pool, then returning to the exact booking slot).
4. **Maintainability:** Clear separation between API routing, database access, and LLM reasoning logic.

## Technology Stack (Production Grade)
*   **Language & API:** Python 3.11+ / FastAPI (Async, high concurrency)
*   **Voice Pipeline (Audio-to-Audio):**
    *   **Primary:** Sarvam AI (Optimized for Indian languages and accents).
    *   **Fallback:** Deepgram (STT) & ElevenLabs/Google (TTS) automatically engaged via circuit breakers upon Sarvam latency/failure.
*   **AI Routing & Orchestration (The Brain):**
    *   **Orchestrator:** LangGraph (Stateful, cyclical graphs for perfect slot-filling without prompt leakage).
    *   **LLM Gateway:** LiteLLM or RouteLLM (Automatic fallback: Groq Llama 3 70B [Primary] -> Together AI -> OpenAI gpt-4o-mini).
*   **Persistent & Semantic Memory:** 
    *   **Short-term:** Redis (Session state mapping).
    *   **Long-term:** Mem0 or Zep (Extracts and stores facts about the user—e.g., "Guest loves ocean views"—saving these as vector embeddings linked to their phone number/ID for future visits).
*   **Database:** PostgreSQL (Neon) with SQLModel ORM.

---

## High-Availability Architecture

```mermaid
graph TD
    subgraph Kiosk Hardware
        Mic[Microphone] -->|Audio Stream| V2_WS[FastAPI WebSocket]
        V2_WS -->|TTS Stream| Speaker[Speaker]
    end

    subgraph Audio Pipeline (Circuit Breaker)
        V2_WS <--> Sarvam[Sarvam AI STT/TTS]
        Sarvam -.->|Fallback on timeout| AlternativeAudio[Deepgram/Google]
    end

    subgraph LLM Gateway Layer
        LiteLLM[LiteLLM Gateway]
        LiteLLM -->|Primary| Groq[Groq: Llama 3 70B]
        LiteLLM -.->|Fallback| OpenAI[OpenAI / Gemini]
    end

    subgraph LangGraph Orchestrator
        StateStore[(Redis State)]
        MemoryDB[(Mem0 / Vector DB)]
        
        Router[Intent Router]
        MemoryExtractor[Memory Summarization Node]
        BookingNode[Booking Logic Node]
        
        Router --> BookingNode
        BookingNode --> StateStore
        BookingNode --> MemoryExtractor
        MemoryExtractor --> MemoryDB
    end

    Sarvam -->|Text| Router
    Router <--> LiteLLM
    
    DB[(PostgreSQL Neon)]
    BookingNode <--> DB
```

---

## 1. The Voice Pipeline (Sarvam AI + Circuit Breakers)
Production means zero downtime. We will implement **Circuit Breakers** using libraries like `tenacity` or `resilience4j` (Python ports).
*   **Primary Route:** Stream raw microphone audio via WebSockets to Sarvam AI.
*   **Health Check:** If Sarvam AI's STT takes longer than 800ms to return an interim transcript, the circuit breaker opens, and the WebSocket instantly reroutes the stream to Deepgram.

## 2. LLM Fallbacks (LiteLLM)
Relying entirely on Groq is risky for production (rate limits, API outages).
*   We will adopt an **LLM Gateway** pattern using `LiteLLM`.
*   Our LangGraph nodes will call a single local endpoint (`litellm.completion()`), and LiteLLM handles the routing.
*   **Rule:** Try Groq Llama 3 -> Try Together AI Llama 3 -> Try OpenAI GPT-4o-mini.

## 3. Persistent Semantic Memory (Mem0 / Zep)
Current V1 wipes privacy on `IDLE`. Production systems *remember* guests securely.
*   Instead of holding the entire conversation text in a giant prompt (which crashes and burns tokens), we use a **Memory Node**.
*   After the conversation ends or transitions, a background worker feeds the transcript to an LLM to extract facts: * { "fact": "Guest's name is Tanu", "context": "Booking" } *.
*   These facts are stored in a specialized memory layer (like **Mem0** or **Zep**) and associated with their Kiosk Session ID or Scanned ID.
*   Next time they check in, the system retrieves only the relevant vectors: "Welcome back Tanu, do you want a Deluxe room like last time?"

---

## Key Components

### 1. The FastAPI Web Server (`main.py`)
Handles incoming HTTP requests from the React kiosk, and handles the WebSocket connections for voice interactions. It acts as the primary traffic controller.

### 2. The LangGraph Agent (`agent/graph.py`)
This is the "Brain" of V2. LangGraph models the conversation as a state machine. 
*   **The State object:** A Pydantic class holding `conversation_history`, `current_intent`, `booking_slots`, and `missing_slots`.
*   **Nodes:** Functions that perform work. For example, the `BookingNode` looks at the state, determines what slot is missing, asks the LLM to formulate a question for that slot, and updates the state.

### 3. The Database Layer (`db/models.py`)
Uses SQLModel to map exactly to the existing Prisma schema tables (`Tenant`, `RoomType`, `Booking`). 

## The "Dumb" Frontend Paradigm
In V1, the frontend React code tried to map LLM behaviors (`PROVIDE_NAME`) to UI screens (`BOOKING_COLLECT`). 

In V2, the backend LangGraph state includes a `next_ui_screen` field. The API payload returned to React simply looks like this:

```json
{
  "speech": "Great, what name should I use?",
  "next_ui_screen": "BOOKING_COLLECT",
  "slots": { "adults": 2, "roomType": "DELUXE" }
}
```
React will instantly switch to the `BOOKING_COLLECT` screen without doing any logic tests.

## Migration Strategy
1. **Phase 1: Foundation.** Build FastAPI server, define SQLModel classes that match the existing DB, and create the basic LangGraph routing node.
2. **Phase 2: Booking Flow.** Recreate the complex `bookingChat.ts` logic entirely within LangGraph. Test thoroughly via CLI or HTTP.
3. **Phase 3: Integration.** Point the existing React frontend to the Python API instead of the Node API.
4. **Phase 4: Optimization.** Refactor React code to remove obsolete logic, and integrate the Deepgram WebSocket relay into Python.
