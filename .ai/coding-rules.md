# Coding Rules

## Stack
- Language: TypeScript
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL (Prisma ORM)
- Validation/Contracts: Zod + shared contracts

## Repository Conventions
- Keep frontend code under `frontend/`, backend code under `backend/`, and cross-layer contracts under `shared/contracts/`.
- Prefer explicit imports from concrete files over wildcard/module barrel imports.
- Keep features split by responsibility (pages/components/services/state/voice) instead of large mixed files.

## Frontend Rules
- UI flow changes should align with `frontend/state/uiState.machine.ts`.
- Route and flow orchestration should be centralized in `frontend/app/App.tsx`.
- Service/network calls should go through `frontend/services/*`.
- Reusable visuals go in `frontend/components/*`; screen logic stays in `frontend/pages/*`.

## Backend Rules
- Tenant-aware behavior is required for API handlers that serve hotel data.
- Route handlers belong in `backend/src/routes/*`.
- Middleware concerns belong in `backend/src/middleware/*`.
- Database access should use Prisma via `backend/src/db/prisma.ts`.

## Contract Rules
- Shared message payloads and intent/event types must be defined in `shared/contracts/*`.
- LLM output parsing/validation must use the contracts in `backend/src/llm/*`.
- When changing payload shape, update both contract definitions and all call sites.

## Quality Rules
- Keep files focused and reasonably small; split large multi-purpose modules.
- Preserve existing naming style and folder semantics.
- Avoid introducing parallel duplicate paths for the same responsibility.
- Prefer deterministic, typed data flow over implicit `any`-driven logic.

