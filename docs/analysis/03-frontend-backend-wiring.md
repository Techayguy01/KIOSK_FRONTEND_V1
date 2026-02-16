# 3) Frontend ? Backend Wiring

## Scope
This file focuses on runtime wiring only; planned/missing APIs are called out explicitly.

| Frontend screen/page | Components involved | API function called | Method + endpoint URL | Request payload shape | Response payload shape | Where stored | Success/failure behavior |
|---|---|---|---|---|---|---|---|
| App bootstrap on tenant route | `App` | inline `fetch` in `App` | `GET /api/:tenantSlug/tenant` | Header `{ "x-tenant-slug": "grand-hotel" }` | `{ "tenant": { id,name,slug,plan,hotelConfig } }` | React state `tenant` + singleton `setTenantContext` | success: tenant branding; failure: tenant null + console error |
| Welcome voice interaction | `WelcomePage`, `AgentAdapter` | `processWithLLMBrain` | `POST /api/:tenantSlug/chat` | `{ transcript,currentState,sessionId }` + header | `{ speech,intent,confidence }` | Agent internal `state`/`viewData` | success: speech + transition; failure: fallback speech |
| Booking conversation | `BookingCollectPage`, `AgentAdapter` | `processWithLLMBrain` | `POST /api/:tenantSlug/chat/booking` | `{ transcript,currentState,sessionId }` + header | `{ speech,intent,confidence,extractedSlots,accumulatedSlots,missingSlots,nextSlotToAsk,isComplete }` | Agent `viewData.bookingSlots` etc. | success: slot accumulation and step changes; failure: booking fallback speech |
| Room selection data load | `RoomSelectPage`, `RoomService` | `RoomService.getAvailableRooms` | `GET /api/:tenantSlug/rooms` | header-only tenant context | `{ rooms: RoomDTO[] }` | local `liveRooms` state | success: DB rooms rendered; failure: warning + fallback room mocks |

## Missing APIs
- Guest check-in reservation APIs: not implemented.
- Table booking APIs: not implemented.
- Payment processing API: not implemented (`frontend/services/payment.service.ts`).
