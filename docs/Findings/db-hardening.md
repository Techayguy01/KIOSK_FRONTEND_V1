# DB Hardening Report (Phase: Integrity + Transaction Safety)

## What was implemented

## 1) Transactional booking safety in backend
File updated: `backend/src/routes/bookingChat.ts`

Changes:
- Wrapped booking create/update flow in `prisma.$transaction(...)`.
- Added overlap conflict detection for `CONFIRMED` bookings on same tenant + room type.
- Added tenant ownership validation when updating an existing `session.bookingId`.
- Added conflict response:
  - HTTP `409`
  - error code: `BOOKING_DATE_CONFLICT`
  - message: `Selected room is already booked for the requested dates`

Why this strengthens DB behavior:
- Prevents race-condition style duplicate/conflicting confirms for overlapping date ranges.
- Ensures booking updates cannot cross tenant boundary via stale/foreign booking id.

---

## 2) Database-level integrity constraints
Migration added:
- `backend/prisma/migrations/20260219070000_db_hardening/migration.sql`

Constraints added (idempotent):
- `ck_bookings_adults_positive` -> `adults >= 1`
- `ck_bookings_children_non_negative` -> `children IS NULL OR children >= 0`
- `ck_bookings_nights_positive` -> `nights >= 1`
- `ck_bookings_total_price_non_negative` -> `total_price IS NULL OR total_price >= 0`
- `ck_bookings_date_range` -> `check_out_date > check_in_date`
- `ck_room_types_price_non_negative` -> `price >= 0`

Why this strengthens DB behavior:
- Invalid data is blocked at database level even if app validation regresses.

---

## 3) Performance indexes
Added in same migration:
- `bookings_tenant_id_check_in_date_idx` on `(tenant_id, check_in_date)`
- `bookings_tenant_room_type_status_idx` on `(tenant_id, room_type_id, status)`
- `room_types_tenant_id_price_idx` on `(tenant_id, price)`

Why this helps:
- Faster tenant-scoped date/status queries used in booking conflict checks and room browsing.

---

## Migration execution status
Applied successfully via:
- `npx prisma db execute --file prisma/migrations/20260219070000_db_hardening/migration.sql --schema prisma/schema.prisma`

Verified objects present:
- all 6 constraints found in `pg_constraint`
- all 3 indexes found in `pg_indexes`

---

## Notes
- This hardening does **not** add payment gateway logic; it protects booking integrity regardless of payment integration.
- Overlap check is currently based on same `tenant_id + room_type_id + CONFIRMED` with date intersection.

---

## Suggested next hardening step
- Add integration test that asserts second overlapping confirm returns `409 BOOKING_DATE_CONFLICT`.
- Optionally move overlap logic into a dedicated booking service for reuse by future endpoints.
