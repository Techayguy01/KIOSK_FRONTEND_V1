# 2) Full Codebase Map

## Grouped tree (important parts)

```text
frontend/
  app/App.tsx
  pages/
  components/
  services/
  state/
  agent/
  voice/
  mocks/

backend/
  server.ts
  src/
    routes/
    middleware/
    db/
    context/
    llm/
    types/
  prisma/
    schema.prisma
    migrations/
    seed.ts
    verifyIsolation.ts

shared/
  contracts/

docs/
  analysis/
```

## Frontend pages/routes
- `frontend/app/App.tsx`: central route shell; maps UI state to pages and enforces tenant-prefixed URLs.
- `frontend/pages/*`: screen-level components (`IdlePage`, `WelcomePage`, `ScanIdPage`, `RoomSelectPage`, booking/payment/complete).
- Purpose: present kiosk UI and emit intents to Agent layer.

## Frontend components
- `frontend/components/*`: reusable UI widgets (`RoomCard`, `ProgressBar`, `CaptionsOverlay`, etc.).
- `frontend/components/ui/*`: design primitives and animated visuals.
- Purpose: visual composition, no backend ownership.

## API/client layer
- Active:
  - `frontend/services/tenantContext.ts`: tenant slug/object global context and API URL/header helpers.
  - `frontend/services/room.service.ts`: fetches `/api/:tenantSlug/rooms`.
  - `frontend/services/brain.service.ts` and `frontend/agent/adapter.ts`: calls chat/booking APIs.
- Inactive placeholders:
  - `frontend/api/index.ts`, `frontend/services/session.service.ts`, `frontend/services/payment.service.ts`, `frontend/services/voice.service.ts`.

## Backend routes/controllers
- `backend/server.ts`: route registration + WS relay + lightweight handlers for tenant/rooms.
- `backend/src/routes/chat.ts`: general LLM chat route.
- `backend/src/routes/bookingChat.ts`: booking LLM route.
- Purpose: request handling, prompt composition, response shaping.

## Services/business logic layer
- `frontend/agent/adapter.ts`: core client-side orchestrator, FSM routing, voice event handling.
- `backend/src/context/*`: static prompt context builders (`hotelData`, `roomInventory`, `contextBuilder`).
- `backend/src/llm/*`: Zod contracts and LLM client wrappers.

## Database/ORM layer
- `backend/src/db/prisma.ts`: singleton Prisma client.
- `backend/prisma/schema.prisma`: Tenant, HotelConfig, RoomType, Booking, User.
- `backend/prisma/migrations/*`: SQL migration history.
- `backend/prisma/seed.ts`: seeded tenant/room data.

## Shared types/schemas/validators
- `shared/contracts/*`: intents, events, backend DTOs, booking contracts used across FE/BE.
- `backend/src/llm/contracts.ts` + `backend/src/llm/bookingContracts.ts`: runtime validation for LLM output.

## Critical file callouts
- Tenant gatekeeper: `backend/src/middleware/tenantResolver.ts`
- Tenant-scoped room query: `backend/server.ts:59-62,84-87`
- Tenant propagation from browser URL: `frontend/app/App.tsx:44,110-144`
- Remaining static hotel/room prompt context: `backend/src/context/hotelData.ts`, `backend/src/context/roomInventory.ts`
