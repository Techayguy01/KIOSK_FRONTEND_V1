# 5) Data Flow Walkthrough (Step-by-Step)

## A) Welcome page load

### Step 1: Browser URL parsed
- URL: `http://localhost:3000/grand-hotel/welcome`
- Frontend route handler: `frontend/app/App.tsx:233-237`
- Slug extraction: `useParams` in `frontend/app/App.tsx:44`

### Step 2: Tenant bootstrap request
- Trigger: `useEffect` in `frontend/app/App.tsx:110-144`
- API call:
  - `GET http://localhost:3002/api/grand-hotel/tenant`
  - Header: `{ "x-tenant-slug": "grand-hotel" }`
- Expected response shape:
```json
{
  "tenant": {
    "id": "uuid",
    "name": "Grand Hotel",
    "slug": "grand-hotel",
    "plan": "ENTERPRISE",
    "hotelConfig": {
      "timezone": "America/New_York",
      "supportPhone": "999-999",
      "checkInTime": "14:00:00"
    }
  }
}
```

### Step 3: Backend middleware resolution
- Route: `backend/server.ts:48-50`
- Middleware: `backend/src/middleware/tenantResolver.ts:18-47`
- DB query: `prisma.tenant.findUnique` by slug (`tenantResolver.ts:28-33`)

### Step 4: Frontend state + context hydration
- React state set: `setTenant` (`frontend/app/App.tsx:131`)
- Singleton update: `setTenantContext` (`frontend/app/App.tsx:132`)
- Context provision: `UIContext.Provider` includes `tenant`, `tenantSlug` (`frontend/app/App.tsx:190`)

### Step 5: UI render
- Welcome screen uses context tenant name:
  - `frontend/pages/WelcomePage.tsx:25-27,131,196-198`

## B) Guest Check-in flow (current reality)

### What exists today
- FSM transitions include check-in states (`SCAN_ID`) in `frontend/agent/index.ts`.
- Voice/intent routing can move to check-in path (`CHECK_IN_SELECTED`) via adapter.
- Scan UI exists (`frontend/pages/ScanIdPage.tsx`).

### What does NOT exist
- No reservation lookup endpoint.
- No reservation/check-in DB model currently used in runtime.
- No API call for confirmation code / last-name match.

### Actual path currently
1. User intent causes state transition to `SCAN_ID`.
2. UI renders scan page.
3. Subsequent transitions are UI/FSM-driven, not backed by reservation records.

### Missing to satisfy true check-in
- Endpoint: `POST /api/:tenantSlug/checkin/lookup`
- Endpoint: `POST /api/:tenantSlug/checkin/confirm`
- Reservation + check-in persistence tables and idempotent updates.

## C) Table booking flow (current reality)

### What exists today
- “Booking” in this repo means **room booking conversation**, not restaurant table booking.
- Booking chat endpoint exists: `POST /api/:tenantSlug/chat/booking` (`backend/server.ts:108`).

### What does NOT exist
- No table inventory model.
- No table availability query endpoint.
- No table booking create endpoint.

### Nearest implemented analog
- Room booking conversational slot filling (`backend/src/routes/bookingChat.ts`).
- In-memory session slot accumulation (`bookingChat.ts:21,161-177`).

### Required data model and APIs for real table booking
- Tables: `Table`, `TableSlot`, `TableReservation` scoped by `tenantId`.
- APIs:
  - `GET /api/:tenantSlug/tables/availability`
  - `POST /api/:tenantSlug/tables/reservations`
  - `POST /api/:tenantSlug/tables/reservations/:id/confirm`

## Key object shapes at boundaries

### Tenant context object (frontend)
File: `frontend/services/tenantContext.ts:7-13`
```ts
{
  id: string,
  name: string,
  slug: string,
  plan: string,
  hotelConfig?: { timezone: string, supportPhone: string, checkInTime: string } | null
}
```

### Room list DTO (frontend)
File: `frontend/services/room.service.ts:3-11`
```ts
{
  id: string,
  name: string,
  price: number,
  currency: string,
  image: string,
  features: string[],
  code?: string
}
```

### Booking chat request/response (current)
Request payload created in adapter (`frontend/agent/adapter.ts:485-490`):
```json
{ "transcript":"...", "currentState":"BOOKING_COLLECT", "sessionId":"session_..." }
```
Response validated in backend (`backend/src/routes/bookingChat.ts:158-160`) with fields like:
```json
{ "speech":"...", "intent":"PROVIDE_DATES", "confidence":0.91, "extractedSlots":{}, "isComplete": false }
```
