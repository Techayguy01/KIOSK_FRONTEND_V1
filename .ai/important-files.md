# Important Files

Use this as the first-stop index when making changes.

## Core Flow Control
`frontend/app/App.tsx`  
Top-level UI orchestration and page flow behavior.

`frontend/state/uiState.machine.ts`  
Main transition logic for kiosk states.

`frontend/agent/adapter.ts`  
Intent handling + bridge between frontend state and backend responses.

## Primary User Screens
`frontend/pages/WelcomePage.tsx`  
Main entry experience.

`frontend/pages/RoomSelectPage.tsx`  
Critical booking decision point.

`frontend/pages/PaymentPage.tsx`  
Payment flow behavior and success/failure handling.

## Tenant + API Integration
`frontend/services/tenantContext.ts`  
Tenant-aware request context.

`backend/src/middleware/tenantResolver.ts`  
Server-side tenant resolution.

`backend/server.ts`  
Primary backend bootstrap and route mounting.

## LLM + Contracts
`backend/src/routes/chat.ts`  
General AI chat endpoint.

`backend/src/routes/bookingChat.ts`  
Booking AI endpoint.

`backend/src/llm/contracts.ts`  
Structured output validation for AI responses.

`backend/src/llm/bookingContracts.ts`  
Booking response validation contracts.

## Database
`backend/prisma/schema.prisma`  
Authoritative DB schema.

`backend/src/db/prisma.ts`  
Prisma client entry.

## Cross-Layer Shared Types
`shared/contracts/intents.ts`  
Intent names used by UI and backend logic.

`shared/contracts/events.contract.ts`  
Event type system for state/agent flow.

`shared/contracts/api.contract.ts`  
HTTP DTO shapes shared by frontend services and backend routes.

`shared/types/common.ts`  
Pure TypeScript types (TenantId, RoomId, BookingId, GuestInfo, ApiResponse<T>) — no Zod.

## Manual Test Scripts
`backend/tests/README.md`  
How to run ad-hoc test scripts.

`backend/tests/test-booking.mjs`  
End-to-end booking endpoint test.

`backend/tests/test-llm.mjs`  
Raw LLM chat endpoint test.

`backend/tests/check-db.ts`  
Database connection verification.

