# Architecture

## System Overview
- Frontend: React/Vite kiosk UI in `frontend/`
- Backend: Express API + LLM integration in `backend/`
- Database: PostgreSQL via Prisma schema in `backend/prisma/schema.prisma`
- Shared contracts: Type definitions and DTO contracts in `shared/contracts/`

## High-Level Flow
1. User interacts with kiosk UI (`frontend/pages/*`).
2. UI state transitions are controlled by `frontend/state/uiState.machine.ts`.
3. Agent/service layer (`frontend/agent/adapter.ts`, `frontend/services/*`) sends API requests.
4. Backend resolves tenant and validates input through middleware.
5. Backend routes (`backend/src/routes/*`) call context + LLM + DB layers as needed.
6. Typed responses return to frontend and drive next state/screen.

## Frontend Layering
- App shell/orchestration: `frontend/app/App.tsx`
- State machine: `frontend/state/*`
- Screen components: `frontend/pages/*`
- Reusable UI components: `frontend/components/*`
- Voice stack: `frontend/voice/*`
- API/services: `frontend/services/*`

## Backend Layering
- Entry/route mount: `backend/server.ts`
- HTTP routes: `backend/src/routes/*`
- Middleware: `backend/src/middleware/*`
- LLM adapters/contracts: `backend/src/llm/*`
- Context assembly: `backend/src/context/*`
- Persistence: `backend/src/db/prisma.ts` + `backend/prisma/*`

## Multi-Tenant Model
- Tenant context is resolved on requests via middleware.
- Tenant-aware room/hotel responses are enforced in backend handlers.
- Frontend carries tenant context with API calls using `frontend/services/tenantContext.ts`.

## Design Intent
- Keep flow logic explicit and typed.
- Keep domain contracts centralized and shared.
- Keep route-level behavior small and delegate to focused modules.

