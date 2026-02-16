# 8) Quality / Tech Debt Report (Prioritized)

## Priority list

| Severity | Impact | Finding | Recommended fix |
|---|---|---|---|
| Critical | Security / data isolation | Chat/booking routes resolve tenant but still use static hotel/room prompt data (`backend/src/routes/chat.ts`, `backend/src/routes/bookingChat.ts`) | Replace prompt context with tenant-scoped Prisma queries (`HotelConfig`, `RoomType`) |
| High | Data integrity | Booking flow not persisted; sessions stored in process memory Maps | Persist booking/session state in DB or Redis with tenant and session keys |
| High | API consistency | Mixed endpoint styles (`/api/chat` header-based and `/api/:tenantSlug/chat` path-based) | Standardize one canonical style (prefer path-based) and keep one compatibility layer |
| High | Reliability | In-memory state lost on restart (chat and booking) | Introduce durable store and TTL cleanup |
| Medium | DX / correctness | Agent still injects `roomsMock` in adapter (`frontend/agent/adapter.ts:609-611`) | Remove mock injection; always source from room API + loading fallback |
| Medium | Config hygiene | Hardcoded API base URL and tenant defaults in frontend singleton | Move to env vars and route-derived slug only |
| Medium | Observability | Mostly `console.log`, no request correlation IDs or structured logs | Add request IDs, tenant tags, structured logger |
| Medium | API semantics | Error responses are generic in some handlers (`res.json(FALLBACK_RESPONSE)` even on failures) | Return explicit status codes + typed error payloads |
| Medium | Validation | Request payload validation is inconsistent (LLM outputs validated, incoming payload mostly not) | Add request schema validation (Zod) at route boundaries |
| Medium | Concurrency / idempotency | Payment and booking confirmation idempotency not implemented | Add idempotency keys and optimistic locking |
| Low | Accessibility | Kiosk UI has rich visuals but no explicit accessibility audit baseline | Add touch-target checks, contrast checks, kiosk timeout messaging standards |

## Required commentary areas

### Error handling
- Backend chat routes swallow many failures into fallback JSON without status differentiation.
- Frontend room fetch has visible fallback messaging; chat fallback is speech-only.

### Loading states
- Room page has loading dimming and fallback message.
- App-level `loading` handling is present but not consistently wired across all async operations.

### Input validation
- LLM outputs are validated with Zod (`LLMResponseSchema`, `BookingLLMResponseSchema`).
- Incoming request body for chat routes lacks strict schema validation.

### Logging / observability
- Logging is console-based, no trace IDs, no tenant-tagged centralized logging.
- Prisma can log queries in dev (`backend/src/db/prisma.ts:10-12`) but no production telemetry pipeline.

### API consistency and status codes
- Mixed success/error conventions across endpoints.
- Some route failures still return 200 with fallback payload instead of explicit error status.

### Type safety
- Shared contracts exist (`shared/contracts`), but some `any` usage remains in FE (`App.tsx`, adapter viewData).
- Runtime DTO transforms are not fully centralized.

### Concurrency and duplicate actions
- No idempotency layer for payment/check-in/booking confirmation.
- Session memory in Map can race in horizontally scaled setups.

### Accessibility (kiosk)
- Positive: large controls in welcome flow.
- Gaps: no explicit WCAG checks, no keyboard/screen-reader strategy documented, limited fallback UX spec for voice failure paths.
