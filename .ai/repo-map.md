# Repository Map

This file is the fast navigation layer for AI/code assistants.

## Frontend App Shell
`frontend/index.tsx`  
Bootstraps React app.

`frontend/app/App.tsx`  
Main kiosk flow orchestration, route/state wiring, tenant-aware URL behavior.

## Frontend Pages (Flow Screens)
`frontend/pages/IdlePage.tsx`  
Attractor / idle experience.

`frontend/pages/WelcomePage.tsx`  
Entry interaction page for voice/manual choices.

`frontend/pages/ScanIdPage.tsx`  
ID scan simulation and progress UI.

`frontend/pages/RoomSelectPage.tsx`  
Room listing/selection.

`frontend/pages/BookingCollectPage.tsx`  
Guest details collection.

`frontend/pages/BookingSummaryPage.tsx`  
Booking review before payment.

`frontend/pages/PaymentPage.tsx`  
Payment interaction flow.

`frontend/pages/CompletePage.tsx`  
Success/completion screen.

## Frontend State + Agent
`frontend/state/uiState.machine.ts`  
Primary finite-state-machine transitions.

`frontend/state/uiState.types.ts`  
Shared UI state typing.

`frontend/agent/adapter.ts`  
Client orchestration bridge between UI, intents, and backend.

## Frontend Services
`frontend/services/tenantContext.ts`  
Tenant resolution/context helpers for frontend API calls.

`frontend/services/room.service.ts`  
Room inventory fetching.

`frontend/services/brain.service.ts`  
Chat/agent API integration.

`frontend/services/mockBackend.ts`  
Mock backend logic used in local flows.

## Voice Stack
`frontend/voice/VoiceRuntime.ts`  
Voice runtime lifecycle.

`frontend/voice/deepgramClient.ts`  
Speech-to-text socket client.

`frontend/voice/TTSController.ts`  
Speech output control and interruption handling.

## Backend Entry + Routes
`backend/server.ts`  
Express entrypoint, route registration, lightweight API handlers.

`backend/src/routes/chat.ts`  
General chat endpoint behavior.

`backend/src/routes/bookingChat.ts`  
Booking-specific chat endpoint behavior.

## Backend Middleware
`backend/src/middleware/tenantResolver.ts`  
Tenant scope enforcement from request context.

`backend/src/middleware/validateRequest.ts`  
Request validation middleware.

`backend/src/middleware/requestContext.ts`  
Request context creation and propagation.

## Backend LLM + Context
`backend/src/llm/groqClient.ts`  
LLM client integration.

`backend/src/llm/contracts.ts`  
Structured output contracts for chat responses.

`backend/src/llm/bookingContracts.ts`  
Booking response schema/contracts.

`backend/src/context/contextBuilder.ts`  
Assembles prompt/context payloads.

`backend/src/context/hotelData.ts`  
Hotel-specific prompt context seed data.

`backend/src/context/roomInventory.ts`  
Room inventory context providers.

## Data Layer
`backend/src/db/prisma.ts`  
Prisma client singleton.

`backend/prisma/schema.prisma`  
Database schema and relations.

`backend/prisma/seed.ts`  
Seed data for tenant/hotel/room setup.

`backend/prisma/migrations/*`  
Migration history.

## Shared Contracts
`shared/contracts/intents.ts`  
User/agent intent definitions.

`shared/contracts/events.contract.ts`  
Event contracts shared across layers.

`shared/contracts/backend.contract.ts`  
Frontend-backend response/state contracts.

`shared/contracts/booking.contract.ts`  
Booking flow data contracts.

