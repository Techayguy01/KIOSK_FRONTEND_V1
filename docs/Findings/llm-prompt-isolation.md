# LLM Prompt Isolation (Multi-Tenant Kiosk)

## 1) What this means
LLM prompt isolation means the AI only sees tenant-specific business context for the current request.  
If request comes from `/grand-hotel/...`, the prompt must contain Grand Hotel context only.  
It must never include Budget Inn context.

---

## 2) Why this is important
Without prompt isolation:
- AI can answer with wrong hotel name, wrong room catalog, wrong policies.
- You risk cross-tenant data leakage in responses.
- Voice/booking UX becomes inconsistent and unsafe.

With prompt isolation:
- Same AI code serves many tenants safely.
- Prompt content is dynamically scoped per tenant.

---

## 3) Current request flow (implemented)

1. Frontend calls tenant URL:
- `POST /api/:tenantSlug/chat`
- `POST /api/:tenantSlug/chat/booking`

2. Backend middleware resolves tenant:
- File: `backend/src/middleware/tenantResolver.ts`
- Reads slug from path/header.
- Prisma lookup: `tenant.findUnique({ where: { slug } })`.
- Attaches tenant object to `req.tenant`.

3. Route builds tenant-scoped context:
- Files:
  - `backend/src/routes/chat.ts`
  - `backend/src/routes/bookingChat.ts`
- Context builder:
  - `backend/src/context/contextBuilder.ts`

4. Booking room inventory is tenant-scoped:
- Prisma query in booking route:
  - `prisma.roomType.findMany({ where: { tenantId: tenant.id } })`

5. Prompt template placeholders are filled from current tenant:
- `{{HOTEL_NAME}}`, policy/timezone data, room inventory.

Result: AI response is grounded in current tenant data.

---

## 4) What “tenant overrides” means
`buildSystemContext()` was upgraded to accept an optional overrides object.

Meaning:
- Base context format stays fixed.
- Tenant-specific values are injected per request.

Examples of override fields:
- `hotelName`
- `timezone`
- `checkIn`
- `checkOut`
- `amenities`
- `location`

So the function does not import a single static hotel config anymore; it receives values for the active tenant.

---

## 5) Optional fallback feature flag
Feature flag used: `ENABLE_STATIC_CONTEXT_FALLBACK=1`

Behavior:
- Default (off): strict DB-driven tenant context only.
- If enabled (on): if DB read fails in specific paths, app can temporarily fall back to static context/inventory.

Why it exists:
- Safer rollout / temporary rollback path.
- Helps avoid complete outage during migration.

Production recommendation:
- Keep this OFF once DB path is stable.

---

## 6) Endpoints covered by prompt isolation
- `POST /api/:tenantSlug/chat`
- `POST /api/:tenantSlug/chat/booking`
- Also alias routes using header-based slug resolution where configured.

---

## 7) Validation checklist
1. Send same transcript to two tenants.
2. Verify speech references correct tenant name.
3. Verify booking route reads tenant room types only.
4. Verify nonexistent slug returns `404 TENANT_NOT_FOUND`.
5. Verify no cross-tenant room names appear in responses.

---

## 8) Known limitation to track
Booking extraction schema still has legacy fixed room enum in `backend/src/llm/bookingContracts.ts` (`STANDARD`, `DELUXE`, `PRESIDENTIAL`).  
Tenant-specific codes (for example `BUNK_DORM`) may require mapping or schema update for full alignment.

---

## 9) Summary
Prompt isolation is now tenant-aware in runtime:
- tenant resolved per request,
- context injected per tenant,
- inventory queried with tenant filter,
- responses grounded to current tenant.

This is the core guardrail that makes shared LLM logic safe in a multi-tenant SaaS kiosk.
