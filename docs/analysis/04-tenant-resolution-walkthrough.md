# 4) Tenant Resolution (URL-based) Walkthrough

## Current tenant selection flow

### 1) Where slug is read
- Frontend path router reads slug from URL params (`frontend/app/App.tsx:44`).
- Supported URL pattern: `/:tenantSlug/<state-route>` (`frontend/app/App.tsx:235-237`).

### 2) How slug is passed to backend
- Path-param style endpoint calls: `/api/:tenantSlug/...` via `buildTenantApiUrl()` (`frontend/services/tenantContext.ts:33-35`).
- Header style also included on requests: `x-tenant-slug` (`frontend/services/tenantContext.ts:37-40`).

### 3) Backend slug -> tenant resolution
- Middleware: `resolveTenant` (`backend/src/middleware/tenantResolver.ts:18-47`).
- Slug extraction order:
  1. `req.params.tenantSlug` (`backend/src/middleware/tenantResolver.ts:5-7`)
  2. Header `x-tenant-slug` or `x-kiosk-tenant` (`backend/src/middleware/tenantResolver.ts:9-13`)
- DB lookup:
  - `prisma.tenant.findUnique({ where: { slug }, include: { hotelConfig: true } })` (`backend/src/middleware/tenantResolver.ts:28-33`)
- Attachments for downstream:
  - `req.tenant`, `req.tenantSlug` (`backend/src/middleware/tenantResolver.ts:40-41`)

### 4) Isolation enforcement status
- Middleware runs before kiosk-facing endpoints in `backend/server.ts:44-108`.
- True tenant DB filtering present for room list route:
  - `where: { tenantId: tenant.id }` (`backend/server.ts:60,85`)
- Incomplete isolation in LLM business context:
  - Chat/booking routes resolve tenant but still inject static hotel/room context (`backend/src/routes/chat.ts`, `backend/src/routes/bookingChat.ts`).

## Endpoint-by-endpoint tenant filter matrix

| Endpoint | Middleware resolves tenant? | Business data filtered by tenantId? | Notes |
|---|---|---|---|
| `GET /api/:tenantSlug/tenant` | Yes | Yes (lookup by slug) | Returns resolved tenant object (`backend/server.ts:48-50`) |
| `GET /api/tenant` | Yes (header required) | Yes (lookup by slug) | Header-only fallback route (`backend/server.ts:44-46`) |
| `GET /api/:tenantSlug/rooms` | Yes | Yes | Prisma `roomType.findMany` with `tenantId` (`backend/server.ts:84-87`) |
| `GET /api/rooms` | Yes (header required) | Yes | Same tenant filter (`backend/server.ts:59-62`) |
| `POST /api/:tenantSlug/chat` | Yes | **Partially** | Tenant resolved, but prompt uses static `HOTEL_CONFIG` (`backend/src/routes/chat.ts:5,119`) |
| `POST /api/chat` | Yes (header required) | **Partially** | Same static context behavior |
| `POST /api/:tenantSlug/chat/booking` | Yes | **Partially** | Tenant resolved, but room inventory from static `ROOM_INVENTORY` (`backend/src/routes/bookingChat.ts:6,138`) |
| `POST /api/chat/booking` | Yes (header required) | **Partially** | Same static context behavior |

## Security findings
1. **High**: Tenant-aware routes use static hotel metadata in chat prompt.
   - Risk: wrong-tenant policy/details in voice responses.
   - Files: `backend/src/routes/chat.ts:5,119`; `backend/src/context/hotelData.ts:8-16`.
2. **High**: Booking prompt injects static room inventory.
   - Risk: cross-tenant room suggestions/prices even with tenant middleware.
   - Files: `backend/src/routes/bookingChat.ts:6,138`; `backend/src/context/roomInventory.ts:18-62`.
3. **Medium**: Header and path are both accepted; precedence is path (`tenantResolver.ts:5-13`).
   - Recommendation: document and enforce precedence explicitly, reject mismatches for defense-in-depth.
