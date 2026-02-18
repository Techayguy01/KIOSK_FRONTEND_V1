# Phase 2 and Phase 3 Manual Test Pack

## Scope
This checklist validates:
- Phase 2: durable booking persistence + idempotency + tenant isolation.
- Phase 3: strict removal of runtime room mocks and API-first room rendering.

## Preconditions
1. PostgreSQL container is running on `localhost:5432`.
2. Backend is running on `http://localhost:3002`.
3. Frontend is running on `http://localhost:3000`.
4. Seed data exists for `grand-hotel` and `budget-inn`.

---

## Phase 2 Tests

### P2-1 Booking persists to DB
1. Open kiosk on `http://localhost:3000/grand-hotel/welcome`.
2. Start booking flow and complete required slots (`roomType`, guest count, dates, name).
3. Confirm response includes `persistedBookingId` in booking API response (`POST /api/grand-hotel/chat/booking`).
4. In DB, query `bookings` and verify row exists with:
   - `tenant_id` = grand-hotel tenant id
   - `guest_name`, `check_in_date`, `check_out_date`, `room_type_id`, `status`

Expected:
- Booking row exists and survives page refresh.

### P2-2 Idempotency duplicate prevention
1. Repeat the same booking confirmation twice with same session/details.
2. Query DB for matching `idempotency_key`.

Expected:
- Only one logical booking row for that key.
- No duplicate insert for retry/double submit.

### P2-3 Tenant isolation for booking write
1. Create booking under `grand-hotel`.
2. Query bookings scoped to `budget-inn` tenant id.

Expected:
- Grand-hotel booking is not returned for budget-inn.

### P2-4 Restart durability
1. Complete booking and capture `persistedBookingId`.
2. Restart backend.
3. Query DB by booking id.

Expected:
- Booking still exists (not memory-only).

### P2-5 Incomplete booking should not persist
1. Send booking chat with missing required slot(s), for example no dates or no guest name.
2. Check backend logs and DB.

Expected:
- No invalid booking row inserted.
- Warning log emitted for incomplete/invalid persistence payload.

---

## Phase 3 Tests

### P3-1 Live rooms only (happy path)
1. Open `http://localhost:3000/grand-hotel/room-select`.
2. Wait for room load.

Expected:
- Rooms match DB values for grand-hotel.
- No mock/fallback room appears.

### P3-2 Unknown tenant slug
1. Open `http://localhost:3000/nonexistent/room-select`.

Expected:
- Error state displayed (`Tenant not found` style message).
- No rooms rendered from mocks.

### P3-3 API failure behavior
1. Stop backend.
2. Open tenant room select page.

Expected:
- Error state with retry action is shown.
- No fallback rooms rendered.

### P3-4 Empty tenant catalog
1. Create a tenant with no `room_types`.
2. Open `/:tenantSlug/room-select`.

Expected:
- Empty state (`No rooms are configured for this hotel yet`).
- Confirm button disabled.

### P3-5 Cross-tenant room separation
1. Open `grand-hotel/room-select` and note room list.
2. Open `budget-inn/room-select` and note room list.

Expected:
- Different room catalogs are shown correctly per tenant.

### P3-6 Route/state continuity
1. Navigate Welcome -> Room Select -> Back.
2. Observe URL tenant prefix and page data.

Expected:
- URL keeps `/:tenantSlug/...` prefix.
- Data remains tenant-scoped after navigation.

---

## Quick DB Queries (optional)

```sql
-- Last 20 bookings
SELECT id, tenant_id, guest_name, check_in_date, check_out_date, status, idempotency_key, created_at
FROM bookings
ORDER BY created_at DESC
LIMIT 20;

-- Detect duplicate idempotency keys
SELECT tenant_id, idempotency_key, COUNT(*)
FROM bookings
WHERE idempotency_key IS NOT NULL
GROUP BY tenant_id, idempotency_key
HAVING COUNT(*) > 1;
```
