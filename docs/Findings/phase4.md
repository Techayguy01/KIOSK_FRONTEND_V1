# Phase 4 Implementation Report: DTO Contracts + Isolation Verification Gate

## Objective
Harden FE/BE data contracts and create repeatable checks that detect tenant leakage or payload drift before deployment.

---

## What was implemented

## 1) Canonical shared DTO contract file
Created:
- `shared/contracts/api.contract.ts`

This file now defines shared request/response contract types for:
- API error payload (`ApiErrorBody`)
- Tenant payloads (`TenantConfigDTO`, `TenantDTO`, `TenantResponseDTO`)
- Rooms payloads (`RoomDTO`, `RoomsResponseDTO`)
- Chat payloads (`ChatRequestDTO`, `ChatResponseDTO`)
- Booking chat payloads (`BookingChatResponseDTO`)

Why:
- Frontend and backend now align on common payload shapes.
- Reduces contract drift and naming/type mismatch risk.

---

## 2) Frontend wiring to shared DTOs
Updated files:
- `frontend/services/tenantContext.ts`
- `frontend/services/room.service.ts`
- `frontend/services/brain.service.ts`

Changes:
- `TenantPayload` now aliases `TenantDTO` from shared contract.
- Room service now uses shared `RoomDTO` and `RoomsResponseDTO`.
- Brain response typing now reuses shared chat/booking response DTOs.

Why:
- Runtime payload consumption is tied to shared contract definitions.

---

## 3) Integration verification script (Phase 4)
Created:
- `backend/prisma/verifyPhase4Contracts.ts`

Added npm script:
- `backend/package.json` -> `"verify:phase4": "tsx prisma/verifyPhase4Contracts.ts"`

What this script checks:
1. Tenant endpoints:
   - `/api/grand-hotel/tenant`
   - `/api/budget-inn/tenant`
   - verifies DTO shape and slug correctness.
2. Rooms endpoints:
   - `/api/grand-hotel/rooms`
   - `/api/budget-inn/rooms`
   - verifies DTO shape.
   - verifies no room code overlap between seeded tenants (leakage guard).
3. Chat endpoint contract shape:
   - `/api/:tenantSlug/chat` with empty transcript (no LLM dependency).
4. Booking chat endpoint contract shape:
   - `/api/:tenantSlug/chat/booking` with empty transcript.
5. Unknown tenant behavior:
   - `/api/nonexistent/rooms` must return `404` + `TENANT_NOT_FOUND`.

---

## 4) CI gate workflow
Created:
- `.github/workflows/phase4-contract-gate.yml`

Workflow behavior:
- Spins up Postgres service.
- Installs frontend/backend dependencies.
- Applies schema + phase2 + db hardening migrations.
- Seeds data.
- Starts backend.
- Runs `npm run verify:phase4`.
- Runs frontend build gate (`npm run build`).

Why:
- Prevents PR/merge if tenant isolation or contract shape regresses.

---

## Local verification status
- Frontend build: ? passed.
- `verify:phase4`: requires backend HTTP server running on `localhost:3002`; failed in this run because server was not up.

How to run locally:
1. Start backend (`cd backend && npm run start`).
2. Run verifier (`cd backend && npm run verify:phase4`).

Expected success output:
- `Phase 4 contract/isolation checks passed`

---

## Files changed in this phase
- `shared/contracts/api.contract.ts` (new)
- `frontend/services/tenantContext.ts`
- `frontend/services/room.service.ts`
- `frontend/services/brain.service.ts`
- `backend/prisma/verifyPhase4Contracts.ts` (new)
- `backend/package.json`
- `.github/workflows/phase4-contract-gate.yml` (new)

---

## Notes
- This phase focuses on contract alignment + automated leakage checks.
- It does not change product flow behavior directly; it hardens reliability and prevents regression.
