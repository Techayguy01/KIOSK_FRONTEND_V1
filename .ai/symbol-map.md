# Symbol Map

Purpose: fast code retrieval for AI agents.
Format: `file -> symbols -> relationships`.

## Frontend Orchestration

`frontend/app/App.tsx`
- symbols:
  - `STATE_TO_ROUTE: Record<UiState, string>`
  - `TenantKioskApp()`
  - `emit(type, payload?)`
  - `renderPage()`
  - `TenantRootRedirect()`
  - `App()`
- relationships:
  - subscribes to `AgentAdapter.subscribe(...)`
  - emits intents via `AgentAdapter.handleIntent(...)`
  - sets tenant context via `setTenantContext(...)`
  - maps UI states to pages in `frontend/pages/*`

`frontend/state/uiState.machine.ts`
- symbols:
  - `MACHINE_CONFIG`
  - `StateMachine.transition(currentState, event)`
  - `StateMachine.getMetadata(state)`
  - `StateMachine.getPreviousState(current)`
- relationships:
  - consumes `UIState` from `@contracts/backend.contract`
  - used by agent logic for strict state transitions

`frontend/agent/adapter.ts`
- symbols:
  - `AgentAdapter` (singleton export)
  - `dispatch(intent, payload?)`
  - `handleIntent(intent, payload?)`
  - `resolveNextStateFromIntent(currentState, intent)`
  - `transitionTo(nextState, intent?, payload?)`
  - `getSlotContext()`
  - `getBookingSlots()`
- relationships:
  - central frontend state/intent authority
  - integrates with `StateMachine`
  - integrates with `sendToBrain(...)` flow in `frontend/services/brain.service.ts`

`frontend/services/brain.service.ts`
- symbols:
  - `BOOKING_STATES`
  - `onBrainResponse(listener)`
  - `resetSession()`
  - `sendToBrain(transcript, currentState, options?)`
- relationships:
  - selects endpoint: `chat` vs `chat/booking`
  - dispatches intents back through `AgentAdapter.dispatch(...)`
  - uses tenant-aware URLs/headers from `frontend/services/tenantContext.ts`

`frontend/services/tenantContext.ts`
- symbols:
  - `setTenantContext(tenantSlug, tenant)`
  - `getTenantSlug()`
  - `getTenant()`
  - `buildTenantApiUrl(route)`
  - `getTenantHeaders()`
- relationships:
  - used by frontend services to maintain tenant-scoped API calls

`frontend/services/room.service.ts`
- symbols:
  - `RoomServiceError`
  - `RoomService` (service object)
- relationships:
  - fetches tenant room inventory from backend room endpoints

## Frontend Pages (Screen Symbols)

`frontend/pages/IdlePage.tsx`
- symbols: `IdlePage()`

`frontend/pages/WelcomePage.tsx`
- symbols: `WelcomePage(props)`

`frontend/pages/ScanIdPage.tsx`
- symbols: `ScanIdPage()`

`frontend/pages/RoomSelectPage.tsx`
- symbols: `RoomSelectPage()`

`frontend/pages/BookingCollectPage.tsx`
- symbols: `BookingCollectPage()`

`frontend/pages/BookingSummaryPage.tsx`
- symbols: `BookingSummaryPage()`

`frontend/pages/PaymentPage.tsx`
- symbols: `PaymentPage()`

`frontend/pages/CompletePage.tsx`
- symbols: `CompletePage()`

## Voice Runtime Symbols

`frontend/voice/VoiceRuntime.ts`
- symbols:
  - `VoiceMode`
  - `VoiceTurnState`
  - `VoiceRuntime` (singleton export)

`frontend/voice/deepgramClient.ts`
- symbols:
  - `DeepgramClient` (singleton export)

`frontend/voice/TTSController.ts`
- symbols:
  - `TTSController` (singleton export)

`frontend/voice/TtsRuntime.ts`
- symbols:
  - `TtsRuntime` (singleton export)

`frontend/voice/SpeechOutputController.ts`
- symbols:
  - `SpeechOutputController` (singleton export)

## Backend Entry + Route Symbols

`backend/server.ts`
- symbols:
  - `app.get('/health', ...)`
  - `app.get('/api/tenant', resolveTenant, ...)`
  - `app.get('/api/:tenantSlug/tenant', resolveTenant, ...)`
  - `app.get('/api/rooms', resolveTenant, ...)`
  - `app.get('/api/:tenantSlug/rooms', resolveTenant, ...)`
  - `app.use('/api/chat', resolveTenant, chatRouter)`
  - `app.use('/api/chat/booking', resolveTenant, bookingChatRouter)`
  - `app.use('/api/:tenantSlug/chat', resolveTenant, chatRouter)`
  - `app.use('/api/:tenantSlug/chat/booking', resolveTenant, bookingChatRouter)`
- relationships:
  - mounts chat routes
  - resolves tenant before chat/rooms handlers
  - uses Prisma `roomType` queries for room list APIs

`backend/src/routes/chat.ts`
- symbols:
  - `ChatRequestSchema`
  - `SYSTEM_PROMPT_TEMPLATE`
  - `sessionMemory: Map<sessionId, ChatMessage[]>`
  - `router.post('/', validateBody(ChatRequestSchema), ...)`
  - default export: `router`
- relationships:
  - calls `llm.invoke(...)` via `groqClient`
  - validates output with `LLMResponseSchema`
  - builds context via `buildSystemContext(...)`
  - uses tenant from `resolveTenant`

`backend/src/routes/bookingChat.ts`
- symbols:
  - `BookingSession`
  - `bookingSessions: Map<sessionId, BookingSession>`
  - `BOOKING_SYSTEM_PROMPT`
  - `REQUIRED_SLOTS`
  - `SLOT_FILLING_INTENTS`
  - helper functions:
    - `formatInventoryForPrompt(...)`
    - `resolveRoomType(...)`
    - `mergeIncomingSlots(...)`
    - `coerceSlotFillingIntent(...)`
    - `applyActiveSlotExtractionFallback(...)`
  - `router.post('/', validateBody(BookingChatRequestSchema), ...)`
  - default export: `router`
- relationships:
  - validates LLM output with `BookingLLMResponseSchema`
  - persists bookings with Prisma transaction
  - uses `extractNormalizedNumber` / `normalizeForSlot`
  - integrates tenant-scoped `roomType` and `booking` records

## Backend Middleware + Utilities Symbols

`backend/src/middleware/tenantResolver.ts`
- symbols:
  - `resolveTenant(req, res, next)`
- relationships:
  - sets `req.tenant`; required by tenant-aware handlers

`backend/src/middleware/validateRequest.ts`
- symbols:
  - `validateBody(schema)`

`backend/src/middleware/requestContext.ts`
- symbols:
  - `attachRequestContext(req, res, next)`
  - `requestAccessLogger(req, res, next)`

`backend/src/db/prisma.ts`
- symbols:
  - `prisma` (singleton Prisma client)

`backend/src/utils/normalize.ts`
- symbols:
  - `extractNormalizedNumber(transcript, activeSlot?)`
  - `normalizeForSlot(transcript, expectedType?, activeSlot?)`

`backend/src/utils/http.ts`
- symbols:
  - `ApiErrorPayload`
  - `sendApiError(res, status, code, message, requestId?)`

## LLM Contract Symbols

`backend/src/llm/contracts.ts`
- symbols:
  - `IntentSchema`
  - `CONFIDENCE_THRESHOLDS`
  - `LLMResponseSchema`
  - `LLMResponse` (type)
  - `ValidIntent` (type)
  - `FALLBACK_RESPONSE`

`backend/src/llm/bookingContracts.ts`
- symbols:
  - `BookingSlotsSchema`
  - `BookingSlotNameSchema`
  - `BookingSlotExpectedTypeSchema`
  - `BookingChatRequestSchema`
  - `BookingIntentSchema`
  - `BookingLLMResponseSchema`
  - `BookingLLMResponse` (type)
  - `BOOKING_FALLBACK`

## Shared Cross-Layer Contract Symbols

`shared/contracts/intents.ts`
- symbols:
  - `Intent` (union type for kiosk intents)

`shared/contracts/backend.contract.ts`
- symbols:
  - `UIState`
  - `ChatMessage`
  - `BackendResponse`

`shared/contracts/events.contract.ts`
- symbols:
  - `UIEventType`
  - `UIEvent`
  - `UIEventHandler`

`shared/contracts/booking.contract.ts`
- symbols:
  - `RoomType`
  - `RoomInfo`
  - `BookingSlots`
  - `createEmptyBooking()`
  - `getMissingSlots(slots)`
  - `isBookingComplete(slots)`
  - `BookingIntent`
  - `BookingResponse`

`shared/contracts/api.contract.ts`
- symbols:
  - DTOs: `TenantConfigDTO`, `TenantDTO`, `TenantResponseDTO`
  - DTOs: `RoomDTO`, `RoomsResponseDTO`
  - DTOs: `ChatRequestDTO`, `ChatResponseDTO`, `BookingChatResponseDTO`
  - types: `BookingSlotName`, `BookingSlotExpectedType`
  - `ChatTurnDTO`

## Prisma Data Model Symbols

`backend/prisma/schema.prisma`
- enums:
  - `Plan`
  - `BookingStatus`
  - `UserRole`
- models:
  - `Tenant`
  - `HotelConfig`
  - `RoomType`
  - `Booking`
  - `User`

## Retrieval Hints

- For flow bugs:
  - open `frontend/agent/adapter.ts`
  - open `frontend/state/uiState.machine.ts`
  - open `frontend/app/App.tsx`

- For tenant/API issues:
  - open `frontend/services/tenantContext.ts`
  - open `backend/src/middleware/tenantResolver.ts`
  - open `backend/server.ts`

- For booking extraction or slot filling issues:
  - open `backend/src/routes/bookingChat.ts`
  - open `backend/src/llm/bookingContracts.ts`
  - open `backend/src/utils/normalize.ts`

- For data model issues:
  - open `backend/prisma/schema.prisma`
  - open `backend/src/db/prisma.ts`
  - open `shared/contracts/api.contract.ts`

