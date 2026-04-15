# Kiosk AI Platform - Technical Documentation

**Version:** 2.4.0  
**Stack:** React 18 + Vite + TypeScript, FastAPI (Python 3.11), LangGraph, Neon PostgreSQL, SQLModel  
**Last Updated:** April 15, 2026

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Backend Architecture](#2-backend-architecture)
   - [Directory Structure](#21-directory-structure)
   - [Application Entry Point](#22-application-entry-point)
   - [Configuration and Environment](#23-configuration-and-environment)
   - [Database Layer](#24-database-layer)
   - [Data Models](#25-data-models)
   - [Agent and Intent Orchestration](#26-agent-and-intent-orchestration)
   - [API Routers and Endpoint Reference](#27-api-routers-and-endpoint-reference)
   - [Service Layer](#28-service-layer)
   - [Migrations](#29-migrations)
   - [Backend Test Coverage](#210-backend-test-coverage)
3. [Frontend Architecture](#3-frontend-architecture)
   - [Directory Structure](#31-directory-structure)
   - [Routing Model](#32-routing-model)
   - [Screen State Authority](#33-screen-state-authority)
   - [Voice Runtime](#34-voice-runtime)
   - [Frontend Services](#35-frontend-services)
   - [UI Composition](#36-ui-composition)
4. [Shared Contracts](#4-shared-contracts)
5. [Operational Data Flows](#5-operational-data-flows)
6. [Screenshot Inventory](#6-screenshot-inventory)
7. [Known Issues and Technical Notes](#7-known-issues-and-technical-notes)

---

## 1. System Architecture

This codebase implements a multi-tenant hotel kiosk where the frontend is a rendering shell and the backend is the decision authority.

- Frontend receives tenant slug from URL (`/:tenantSlug/*`), resolves tenant metadata, and renders state-driven pages.
- Backend owns intent routing, booking slot collection, FAQ matching, room recommendation, and booking persistence.
- Shared contracts in `shared/contracts` define DTOs and intent/state vocabulary.
- Voice is full duplex in browser runtime: WebSpeech STT + backend text intelligence + backend/browser TTS.

```text
Browser Kiosk UI (React + Vite)
  -> /api/tenant, /api/rooms, /api/faqs, /api/chat, /api/ocr, /api/checkin/confirm, /api/voice/*
FastAPI Backend (LangGraph + deterministic guards)
  -> SQLModel/asyncpg
Neon PostgreSQL
```

---

## 2. Backend Architecture

### 2.1 Directory Structure

```text
KIOSK_BACKEND_V2_PYTHON/
|-- main.py
|-- api/
|   |-- chat.py
|   |-- rooms.py
|   |-- tenant.py
|   |-- faqs.py
|   |-- ocr.py
|   |-- checkin.py
|   |-- utility.py
|   `-- voice.py
|-- agent/
|   |-- graph.py
|   |-- state.py
|   |-- nodes.py
|   |-- nodes_compare.py
|   |-- semantic_classifier.py
|   |-- intent_config.py
|   |-- stt_normalizer.py
|   `-- misclassification_logger.py
|-- core/
|   |-- database.py
|   |-- llm.py
|   |-- voice.py
|   `-- ocr_service.py
|-- models/
|   |-- tenant.py
|   |-- tenant_config.py
|   |-- room.py
|   |-- room_instance.py
|   |-- booking.py
|   |-- faq.py
|   `-- faq_localization.py
|-- services/
|   |-- booking_guards.py
|   |-- faq_service.py
|   |-- faq_localization_service.py
|   |-- query_classifier.py
|   `-- transcript_understanding.py
|-- migrations/
|   |-- 2026_03_10_add_checkin_columns_to_bookings.sql
|   |-- 2026_03_12_add_room_capacity_columns.sql
|   |-- 2026_03_12_add_room_instances_and_booking_assignment.sql
|   `-- 2026_03_13_add_faq_localizations.sql
|-- tests/
|   |-- test_api_chat.py
|   |-- test_booking_guards.py
|   |-- test_booking_slot_extraction.py
|   |-- test_date_normalization.py
|   |-- test_faq_logic.py
|   |-- test_intent_router.py
|   |-- test_pipeline.py
|   |-- test_query_classifier.py
|   |-- test_room_matching.py
|   |-- test_stt_normalizer.py
|   |-- test_transcript_understanding.py
|   `-- test_voice_cache.py
`-- scripts/
    `-- prewarm_tts_cache.py
```

### 2.2 Application Entry Point

**File:** `main.py`

- Creates FastAPI app titled `Kiosk AI Backend V2`, version `2.0.0`.
- Registers middleware and routers:
  - `/api` -> chat, checkin, rooms, tenant, ocr, faqs
  - `/api/voice` -> stt and tts
  - `/api/utility` -> normalize
- Health endpoint:
  - `GET /health` returns `status`, `version`, `model`.

### 2.3 Configuration and Environment

Observed runtime env keys in backend:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Primary Neon DB URL |
| `DIRECT_URL` | Fallback direct Neon URL |
| `PORT` | Uvicorn listen port |
| `HOST` | Uvicorn host |
| `RELOAD` | Enables/disables auto reload |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `ENABLE_SEMANTIC_PREWARM` | Optional startup semantic classifier prewarm |
| `GROQ_API_KEY` / `OPENAI_API_KEY` | LLM provider credentials |

CORS defaults include localhost and 127.0.0.1 origins for ports `3000`, `3001`, `4173`, `5173`.

### 2.4 Database Layer

**File:** `core/database.py`

- URL normalization converts `postgresql://` to `postgresql+asyncpg://`.
- Query params are stripped from URL string before engine creation.
- Session strategy:
  - primary from `DATABASE_URL`
  - fallback from `DIRECT_URL` when different
- Pool settings:
  - `pool_size=5`
  - `max_overflow=10`
  - `pool_pre_ping=True`
  - `pool_recycle=900`
  - `connect_args={"ssl": True}`

### 2.5 Data Models

Core SQLModel entities:

| Model | Table | Key Purpose |
|---|---|---|
| `Tenant` | `tenants` | Hotel identity, slug, status, plan linkage |
| `TenantConfig` | `tenant_configs` | Timezone, check-in/out times, language/support settings |
| `RoomType` | `room_types` | Room catalog with price, capacities, amenities, image URLs |
| `RoomInstance` | `room_instances` | Physical room inventory for actual assignment |
| `Booking` | `bookings` | Reservation record including assigned room and check-in status |
| `FAQ` | `faqs` | Tenant FAQ source entries |
| `FAQLocalization` | `faq_localizations` | Per-language FAQ materialization |

### 2.6 Agent and Intent Orchestration

Primary files:
- `agent/state.py`
- `agent/graph.py`
- `agent/nodes.py`

`KioskState` is the conversation source of truth and includes:
- session and tenant identity
- `current_ui_screen`
- transcript and conversation history
- resolved intent and confidence
- booking slots and active slot
- selected room + tenant room inventory
- speech response and next UI screen

Graph routing:
- Entry node: `route_intent`
- Conditional branch to:
  - `general_chat`
  - `booking_logic`

Deterministic safeguards implemented in `nodes.py` include:
- room name fuzzy matching
- slot extraction for guests/dates/name
- calendar normalization and year anchoring
- preview/summary guardrails
- booking flow transitions and interruption handling

### 2.7 API Routers and Endpoint Reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Service liveness and version |
| `POST` | `/api/chat` | Main conversation endpoint (intent + next UI + slot state) |
| `DELETE` | `/api/chat/{session_id}` | Clears in-memory session and persistence references |
| `GET` | `/api/tenant?slug=...` | Resolves tenant metadata and kiosk config |
| `GET` | `/api/rooms?slug=...` | Returns normalized room catalog and media |
| `GET` | `/api/faqs?slug=...` | Returns tenant-scoped localized FAQ set |
| `POST` | `/api/ocr` | OCR extraction + booking match lookup |
| `POST` | `/api/checkin/confirm` | Persists check-in confirmation to booking |
| `POST` | `/api/voice/stt` | Speech-to-text via `VoiceProvider` |
| `POST` | `/api/voice/tts` | Text-to-speech WAV generation |
| `POST` | `/api/utility/normalize` | Canonical phrase normalization for query text |

### 2.8 Service Layer

| Service File | Responsibility |
|---|---|
| `services/booking_guards.py` | Capacity/date constraints, overlap checks, sanitization |
| `services/faq_service.py` | FAQ candidate detection and semantic matching |
| `services/faq_localization_service.py` | FAQ translation/localization maintenance |
| `services/query_classifier.py` | FAQ vs room discovery vs transactional query typing |
| `services/transcript_understanding.py` | Transcript repair for noisy STT utterances |

### 2.9 Migrations

Migration scripts in `migrations/` evolve production schema for:
- check-in columns on bookings
- room capacity metadata
- room instance inventory + booking assignment
- FAQ localization table

### 2.10 Backend Test Coverage

Key suites:
- `test_api_chat.py`: endpoint behavior and response contracts
- `test_pipeline.py`: route + booking graph behavior
- `test_booking_guards.py`: capacity/date validation
- `test_faq_logic.py`: FAQ scoring/fallback behavior
- `test_room_matching.py`: room resolution determinism
- `test_voice_cache.py`: TTS cache mechanics

---

## 3. Frontend Architecture

### 3.1 Directory Structure

```text
frontend/
|-- app/App.tsx
|-- pages/
|   |-- IdlePage.tsx
|   |-- WelcomePage.tsx
|   |-- ScanIdPage.tsx
|   |-- IdVerifyPage.tsx
|   |-- CheckInSummaryPage.tsx
|   |-- RoomSelectPage.tsx
|   |-- RoomPreviewPage.tsx
|   |-- BookingCollectPage.tsx
|   |-- BookingSummaryPage.tsx
|   |-- PaymentPage.tsx
|   `-- CompletePage.tsx
|-- components/
|-- agent/
|   |-- index.ts
|   `-- adapter.ts
|-- services/
|   |-- tenantContext.ts
|   |-- room.service.ts
|   |-- brain.service.ts
|   |-- faqBootstrap.service.ts
|   `-- checkin.service.ts
|-- voice/
|   |-- VoiceRuntime.ts
|   |-- webSpeechClient.ts
|   `-- TTSController.ts
`-- public/
```

### 3.2 Routing Model

`App.tsx` uses React Router v6 and tenant-first paths:

- `/` -> missing tenant page
- `/:tenantSlug` -> redirect to `/:tenantSlug/welcome`
- `/:tenantSlug/*` -> active kiosk runtime

State-to-route map is driven by `UiState` from agent authority.

### 3.3 Screen State Authority

- Frontend subscribes to `AgentAdapter` and renders by backend-authoritative state.
- UI emits intents (`CHECK_IN_SELECTED`, `ROOM_SELECTED`, `CONFIRM_PAYMENT`, etc.) to adapter.
- URL sync is derived from effective state, not ad-hoc page logic.

### 3.4 Voice Runtime

Core voice stack:
- `voice/VoiceRuntime.ts`
- `voice/webSpeechClient.ts`
- `voice/TTSController.ts`

Highlights:
- WebSpeech as active STT provider
- turn state model (`IDLE`, `USER_SPEAKING`, `PROCESSING`, `SYSTEM_RESPONDING`)
- watchdog and silence-loop protections
- permission-denied cooldown handling
- barge-in behavior for TTS interruption

### 3.5 Frontend Services

| Service | Responsibility |
|---|---|
| `tenantContext.ts` | API base URLs, tenant slug, language defaults and headers |
| `room.service.ts` | Room fetch, normalization, cache, fallback URL logic |
| `brain.service.ts` | `/api/chat` bridge + confidence-based intent dispatch |
| `faqBootstrap.service.ts` | FAQ prewarm to IndexedDB |
| `checkin.service.ts` | `/api/checkin/confirm` client wrapper |

### 3.6 UI Composition

Primary journey pages:
- `IdlePage`
- `WelcomePage` (voice/manual variants)
- `ScanIdPage`
- `IdVerifyPage`
- `CheckInSummaryPage`
- `RoomSelectPage`
- `RoomPreviewPage`
- `BookingCollectPage`
- `BookingSummaryPage`
- `PaymentPage`
- `CompletePage`

---

## 4. Shared Contracts

Shared boundary in `shared/contracts` includes:

| File | Role |
|---|---|
| `api.contract.ts` | Tenant, room, OCR, and chat DTOs |
| `backend.contract.ts` | UI state enum and backend response structures |
| `intents.ts` | Cross-layer intent vocabulary |
| `events.contract.ts` | UI event contract |
| `booking.contract.ts` | Booking slot canonical model |

These contracts are the compatibility surface across frontend and backend.

---

## 5. Operational Data Flows

### 5.1 Tenant Bootstrap

1. Frontend receives `tenantSlug` from URL.
2. Calls `/api/tenant?slug=...`.
3. Stores context and language defaults.
4. Prewarms `/api/faqs` into IndexedDB.

### 5.2 Room Booking

1. User enters via welcome voice/manual path.
2. Frontend loads rooms from `/api/rooms`.
3. Transcript/intents go to `/api/chat`.
4. Backend resolves next screen and slot updates.
5. On summary confirmation, backend persists booking and room assignment.
6. Frontend proceeds to payment and key flow.

### 5.3 Check-In With OCR

1. `ScanIdPage` captures image and posts to `/api/ocr`.
2. Backend extracts identity fields and finds matching booking.
3. User confirms in `IdVerifyPage` / `CheckInSummaryPage`.
4. Frontend calls `/api/checkin/confirm`.
5. Booking status is updated to `CHECKED_IN`.

### 5.4 Voice I/O

1. STT via `/api/voice/stt` or browser WebSpeech runtime.
2. Intent logic through `/api/chat`.
3. TTS response via `/api/voice/tts` plus in-browser speech control.

---

## 6. Screenshot Inventory

Source folder: `Kiosk Images/`

| # | File | Screen Context |
|---|---|---|
| 1 | `Screenshot 2026-04-15 152358.png` | Idle attract screen |
| 2 | `Screenshot 2026-04-15 152406.png` | Voice welcome with orb |
| 3 | `Screenshot 2026-04-15 152413.png` | Manual menu (Check In / Book Room / Help) |
| 4 | `Screenshot 2026-04-15 155456.png` | Room catalog browse |
| 5 | `Screenshot 2026-04-15 155504.png` | Room preview (voice-first) |
| 6 | `Screenshot 2026-04-15 155612.png` | Booking collect and right rail progress |
| 7 | `Screenshot 2026-04-15 155618.png` | Booking summary confirm screen |
| 8 | `Screenshot 2026-04-15 155628.png` | Payment simulation screen |
| 9 | `Screenshot 2026-04-15 155634.png` | Key dispensing state |
| 10 | `Screenshot 2026-04-15 155638.png` | Completion screen |

---

## 7. Known Issues and Technical Notes

| Topic | Observation | Recommended Action |
|---|---|---|
| Tailwind CDN warning | `index.html` still includes `https://cdn.tailwindcss.com` | Replace with local Tailwind build pipeline for production |
| Backend/Frontend port drift | Runtime has used both `8000` and `8002` in recent iterations | Keep `VITE_API_BASE_URL` and backend `PORT` aligned per environment |
| Neon egress dependency | DB connectivity can fail at network/firewall layer even when app boots | Verify outbound TCP 5432 and process firewall allowances |
| Session storage | Chat sessions are currently in-memory (`_sessions`) | Move to Redis for multi-instance production |
| Legacy contracts | Some contract files still include legacy names and compatibility fields | Consolidate and deprecate unused aliases in a controlled versioning pass |
| Missing UI captures | No screenshot currently included for `ScanIdPage`, `IdVerifyPage`, `CheckInSummaryPage` | Add these to `Kiosk Images` for complete SOP visual coverage |

---

*End of Kiosk AI Platform Technical Documentation*  
*Generated from source analysis across frontend, backend, shared contracts, tests, and provided kiosk screenshots.*
