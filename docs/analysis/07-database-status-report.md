# 7) Database Status Report

## Do we have a real DB connection?
Yes.

### Current stack in code
- DB: PostgreSQL configured via `DATABASE_URL` in `backend/.env`.
- ORM: Prisma client singleton at `backend/src/db/prisma.ts:8-12`.
- Schema: `backend/prisma/schema.prisma`.

## Tables/models currently defined
From `backend/prisma/schema.prisma`:
- `Tenant` (`schema.prisma:28-41`)
- `HotelConfig` (`schema.prisma:43-55`)
- `RoomType` (`schema.prisma:57-72`)
- `Booking` (`schema.prisma:74-89`)
- `User` (`schema.prisma:91-103`)

All non-root entities include `tenantId` and relations back to `Tenant`.

## Migrations and seeds

### Migrations
- Active baseline migration: `backend/prisma/migrations/0001_init_multitenant/migration.sql`
- Legacy migration neutralized as no-op:
  - `backend/prisma/migrations/20260216133000_init_multitenant/migration.sql:1-2`

### Seed scripts
- Main seed: `backend/prisma/seed.ts`
  - `grand-hotel` + luxury rooms
  - `budget-inn` + economy rooms
- Isolation verifier: `backend/prisma/verifyIsolation.ts`

### Script wiring
- `backend/package.json:8-13` contains prisma scripts (`prisma:migrate`, `prisma:seed`, `prisma:verify`).

## Runtime usage vs schema coverage

### Used by runtime routes
- `Tenant` and `RoomType` are directly used by runtime endpoints (`backend/server.ts:59-62,84-87`).
- `Tenant` also used in middleware (`tenantResolver.ts:28-33`).

### Declared but not fully used in runtime flows
- `Booking` model exists but chat/booking flow does not persist records.
- `User` exists but no RBAC-enforced authenticated API routes yet.
- `HotelConfig` exists but chat/booking prompt still uses static `HOTEL_CONFIG` object.

## DTO mismatch / compatibility observations
- Room API returns `features`, while DB stores `amenities`; mapping is done in server route (`backend/server.ts:70,95`).
- Price is `Decimal` in DB but converted to number in response (`backend/server.ts:67,92`).
- Frontend expects `RoomDTO` with `image` and `currency` fields (`frontend/services/room.service.ts:3-11`), which are currently synthetic in backend (`server.ts:68-69,93-94`).

## Current observed behavior summary
- Tenant and rooms endpoints: DB-backed and tenant-filtered.
- Chat and booking endpoints: tenant resolved, but business context still static/hardcoded.
