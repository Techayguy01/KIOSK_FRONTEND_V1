# 6) Mock Data / Hardcoding Audit (Exhaustive)

## Inventory Table

| File + line(s) | Represents | Production blocking? | Recommended replacement |
|---|---|---|---|
| `backend/src/context/hotelData.ts:8-16` | Static hotel config (`Grand Hotel Nagpur`) | **Yes** for strict tenant isolation in chat responses | Query `HotelConfig` by `tenantId` in chat/booking handlers |
| `backend/src/context/roomInventory.ts:18-62` | Static room inventory for prompt injection | **Yes** for strict tenant-specific booking prompts | Query `RoomType` by `tenantId`; generate prompt from DB rows |
| `backend/src/routes/chat.ts:22` | In-memory session memory `Map` | Medium | Persist session history in Redis or DB table with TTL |
| `backend/src/routes/bookingChat.ts:21` | In-memory booking sessions + slots | High | Persist draft booking/session in DB (`Booking` + session table) |
| `frontend/agent/adapter.ts:609-611` | Injecting mock rooms when state enters room select | Medium | Remove fallback injection after stable room API handling |
| `frontend/agent/adapter.ts:661-673` | Room inference against `roomsMock` | Medium | Infer against live `data.rooms` fetched from API |
| `frontend/pages/RoomSelectPage.tsx:17-20` | Fallback to `roomsMock.available_rooms` | Medium | Replace with deterministic empty-state + retry UI |
| `frontend/mocks/rooms.mock.ts:1-31` | Hardcoded room card data | Medium | Keep only as test fixture; isolate from runtime path |
| `frontend/mocks/session.mock.ts` | Mock reservation/session object | Medium | Replace with API-driven session state |
| `frontend/mocks/voice.mock.ts` | Mock voice strings/events | Low | Keep for tests only |
| `frontend/services/mockBackend.ts:1-213` | Full mock backend simulator | Low/Medium | Move to test-only harness folder |
| `frontend/api/index.ts:1-5` | Placeholder API adapter | Low | Implement typed API client or delete if unused |
| `frontend/services/payment.service.ts:1-4` | Placeholder payment service | High for real payment | Implement gateway integration with idempotency |
| `frontend/services/session.service.ts:1-5` | Placeholder session service | Medium | Implement server-backed session lifecycle |
| `frontend/services/voice.service.ts:1-6` | Placeholder voice service | Low | Remove or wire to `VoiceRuntime` abstraction |
| `frontend/services/tenantContext.ts:15` | Hardcoded API base URL `http://localhost:3002` | Medium | Environment config (`VITE_API_BASE_URL`) |
| `frontend/services/tenantContext.ts:17` | Default slug `grand-hotel` in singleton | Low/Medium | Derive from router only; no static default in global module |
| `frontend/state/uiContext.ts:11` | Default tenant slug in initial context | Low | Keep nullable until resolved |
| `backend/server.ts:69,94` | Placeholder room images via `picsum.photos` | Low/Medium | DB-backed media URLs or CDN assets |
| `frontend/mocks/rooms.mock.ts:8,17,26` | Placeholder images in frontend mock | Low | test-only fixture |

## Stub API responses / JSON-as-DB
- JSON fixtures in `frontend/mocks/*.json` are present and still used by mock service paths.
- They are not the canonical runtime DB but are loaded by `frontend/services/mockBackend.ts`.

## Fake IDs / static tokens
- Mock room IDs (`101`, `204`, `105`) in `frontend/mocks/rooms.mock.ts`.
- Session IDs generated client-side (non-cryptographic) in:
  - `frontend/services/brain.service.ts:55`
  - `frontend/agent/adapter.ts:552`

## In-memory storage summary
- Backend chat memory in Map: `backend/src/routes/chat.ts:22`
- Backend booking memory in Map: `backend/src/routes/bookingChat.ts:21`

## Hardcoded tenant defaults
- Frontend route fallback default slug: `frontend/app/App.tsx:26`
- Tenant singleton default slug: `frontend/services/tenantContext.ts:17`
- UIContext default slug: `frontend/state/uiContext.ts:11`
