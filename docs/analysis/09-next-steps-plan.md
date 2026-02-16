# 9) Next Steps Plan (Minimal Risk)

## Phase 0: Stabilize observability and safety rails
### Goal
Improve confidence before behavior-changing migrations.
### Tasks
- Add request IDs and include tenant slug in every backend log line.
- Normalize API error payload format and status codes.
- Add route-level request validation (Zod) for chat and booking endpoints.
### Test
- Verify error code matrix for malformed payloads and unknown tenants.
### Rollback
- Feature-flag new validation in soft mode first (warn-only then enforce).

## Phase 1: Complete tenant data isolation in LLM flows
### Goal
Remove static hotel/room context from chat and booking prompts.
### Tasks
- Replace `HOTEL_CONFIG` and `ROOM_INVENTORY` usage with Prisma reads scoped by `req.tenant.id`.
- Update context builder to accept tenant config object instead of static module imports.
### Test
- Regression test: same transcript across two tenants yields tenant-specific details.
- Add leakage test for `/api/:tenantSlug/chat` and `/api/:tenantSlug/chat/booking`.
### Rollback
- Keep fallback to static context behind temporary feature flag if DB read fails.

## Phase 2: Persist booking transactions
### Goal
Move from conversational memory-only to durable booking records.
### Tasks
- On booking completion, create `Booking` row with `tenantId`, room, guest, date, status.
- Optionally add draft/session table for multi-turn booking state.
### Test
- End-to-end: booking survives backend restart.
- Duplicate confirmation does not create duplicates (idempotency test).
### Rollback
- Keep existing Map memory path as temporary fallback while rollout is monitored.

## Phase 3: Remove runtime dependency on frontend mocks
### Goal
Ensure UI is API-first and deterministic.
### Tasks
- Remove `roomsMock` injection from `AgentAdapter`.
- Make `RoomSelectPage` live-data only with explicit error empty-state and retry.
### Test
- Network-off test shows proper degraded UI, no hidden mock substitution.
### Rollback
- Keep one release cycle feature flag for mock fallback in non-production environments only.

## Phase 4: API contract hardening and integration tests
### Goal
Prevent drift between FE expectations and BE responses.
### Tasks
- Define canonical DTOs for tenant, room list, chat, booking in shared contracts.
- Add integration tests for each endpoint including tenant isolation assertions.
### Test
- Contract tests run in CI against seeded DB.
### Rollback
- Version API responses if schema transitions are needed.

## Phase 5: Production readiness
### Goal
Operational maturity.
### Tasks
- Introduce centralized logs/metrics dashboards.
- Add rate limits and abuse protections per tenant/session.
- Add accessibility checklist and kiosk UX fallback SOP.
### Test
- Load tests, chaos restart tests, accessibility smoke tests.
### Rollback
- Gradual rollout by tenant segment with canary monitoring.

## Immediate first milestones
1. Replace chat/booking static prompt context with tenant-scoped Prisma reads.
2. Persist confirmed bookings into `Booking` table.
3. Remove primary-path mock fallback for rooms.
4. Add tenant leakage contract tests.
5. Add structured logging + error boundary hardening.
