# API Overview

This document is a lightweight index for key backend endpoints and ownership.

## Backend Entry
- `backend/server.ts`
  - Bootstraps Express app.
  - Applies middleware.
  - Mounts/handles API routes.

## Chat Endpoints
- `backend/src/routes/chat.ts`
  - General conversational/assistant endpoint behavior.

- `backend/src/routes/bookingChat.ts`
  - Booking-focused conversational endpoint behavior.

## Supporting Middleware
- `backend/src/middleware/tenantResolver.ts`
  - Resolves tenant scope for tenant-aware requests.

- `backend/src/middleware/validateRequest.ts`
  - Request payload validation guard.

- `backend/src/middleware/requestContext.ts`
  - Request context hydration/utilities.

## Contracts
- `shared/contracts/backend.contract.ts`
- `shared/contracts/booking.contract.ts`
- `shared/contracts/events.contract.ts`
- `shared/contracts/intents.ts`

Use these contracts when changing request/response payloads.

## AI/LLM Response Validation
- `backend/src/llm/contracts.ts`
- `backend/src/llm/bookingContracts.ts`

All structured model output should be validated through these schemas before returning to clients.

