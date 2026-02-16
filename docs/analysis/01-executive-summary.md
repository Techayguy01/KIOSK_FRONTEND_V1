# 1) Executive Summary

## What the app currently does end-to-end
The current kiosk supports a state-driven hospitality flow with voice and touch interactions:
- URL-based tenant entry (`/:tenantSlug/...`) in frontend routing (`frontend/app/App.tsx:233-237`).
- Tenant bootstrap on app mount (`frontend/app/App.tsx:110-144`) via `GET /api/:tenantSlug/tenant`.
- Welcome and mode handling (voice/manual) through `WelcomePage` (`frontend/pages/WelcomePage.tsx`).
- Voice conversations routed through Agent Adapter -> backend LLM endpoints (`frontend/agent/adapter.ts:456-543`).
- Room selection UI with live room fetch from tenant rooms endpoint and fallback mocks (`frontend/pages/RoomSelectPage.tsx:11-45`).
- Booking conversation uses backend booking chat route (`backend/src/routes/bookingChat.ts:92-193`).

## What is “real” vs “mocked/hardcoded”

### Real / implemented
- Express backend process with HTTP + WS in one server file (`backend/server.ts`).
- Tenant resolution middleware using Prisma (`backend/src/middleware/tenantResolver.ts:18-47`).
- Prisma connection singleton (`backend/src/db/prisma.ts`).
- PostgreSQL schema via Prisma models (`backend/prisma/schema.prisma`).
- Seeded tenants and rooms (`backend/prisma/seed.ts`).
- Tenant-scoped room endpoint querying DB (`backend/server.ts:52-100`).
- Frontend tenant context singleton and tenant propagation (`frontend/services/tenantContext.ts`).

### Still mocked or hardcoded
- Chat and booking prompt context still uses static `HOTEL_CONFIG` and static `ROOM_INVENTORY`:
  - `backend/src/routes/chat.ts:5,118-122`
  - `backend/src/routes/bookingChat.ts:5-6,135-141`
  - `backend/src/context/hotelData.ts:8-16`
  - `backend/src/context/roomInventory.ts:18-62`
- Session memory for chat/booking is in-memory `Map` (not DB persisted):
  - `backend/src/routes/chat.ts:22`
  - `backend/src/routes/bookingChat.ts:21`
- Agent still injects mock rooms into UI data in some branches:
  - `frontend/agent/adapter.ts:609-611,661-673`
- Mock backend service and placeholder services exist (not runtime-critical but technical debt):
  - `frontend/services/mockBackend.ts`
  - `frontend/api/index.ts`
  - `frontend/services/session.service.ts`
  - `frontend/services/payment.service.ts`
  - `frontend/services/voice.service.ts`
- Placeholder image URLs (`picsum.photos`) are still used for room cards:
  - `backend/server.ts:69,94`
  - `frontend/mocks/rooms.mock.ts:8,17,26`

## Current architecture style
- Frontend: React + Vite SPA (`frontend/index.tsx`) with React Router and local state/context.
- Backend: Express monolithic service (`backend/server.ts`) hosting REST APIs and WS relay.
- DB layer: Prisma ORM + PostgreSQL (`backend/prisma/schema.prisma`, `backend/src/db/prisma.ts`).
- Shared contracts: TypeScript shared types under `shared/contracts`.
- Not used: Next.js API routes (none present).

## Current maturity snapshot
- Multi-tenancy foundation is partially integrated:
  - Tenant resolution is active and enforced before kiosk routes.
  - Room list endpoint is tenant-filtered by DB tenant id.
  - Frontend sends tenant slug in URL and header.
- Core conversational booking/check-in still relies on static context and in-memory session state, so tenant isolation is not complete in all business data paths.
