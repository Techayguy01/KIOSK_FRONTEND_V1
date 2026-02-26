# Kiosk ↔ HMS Admin Dashboard — Integration Plan

> **Date:** 2026-02-23  
> **Sources:**  
> - [`KIOSK_INTEGRATION_SOURCE.md`](file:///d:/code/KIOSK_FRONTEND_V1/KIOSK_INTEGRATION_SOURCE.md) — Kiosk Fleet System DNA  
> - [`Kiosk_Integration_Spec.md`](file:///d:/code/KIOSK_FRONTEND_V1/HMS_Final/Kiosk_Integration_Spec.md) — HMS Admin Dashboard Spec  
> **Purpose:** Single source of truth for integrating the Kiosk Fleet (Express/Prisma) with the HMS Admin Dashboard (FastAPI/SQLAlchemy).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tenant Model — Critical Mismatches](#2-tenant-model--critical-mismatches)
3. [Missing HMS Entities](#3-missing-hms-entities)
4. [Room Type Model Alignment](#4-room-type-model-alignment)
5. [Booking Contract Alignment](#5-booking-contract-alignment)
6. [API Contract Gaps](#6-api-contract-gaps)
7. [Auth & Security Integration](#7-auth--security-integration)
8. [Real-Time Dashboard Sync](#8-real-time-dashboard-sync)
9. [DTO Mapping Reference](#9-dto-mapping-reference)
10. [6-Phase Integration Plan](#10-6-phase-integration-plan)
11. [Risk Register](#11-risk-register)

---

## 1. Architecture Overview

| Dimension | Kiosk Fleet | HMS Admin Dashboard |
|-----------|-------------|---------------------|
| **Backend** | Node.js / Express | Python / FastAPI |
| **ORM** | Prisma (`schema.prisma`) | SQLAlchemy 2.0 (`mapped_column`) |
| **Validation** | Zod schemas | Pydantic v2 |
| **Database** | PostgreSQL | PostgreSQL |
| **Auth model** | Header-based tenant resolution (`x-tenant-slug`) | JWT + RBAC (`require_permission`) |
| **Frontend** | Vite + Vanilla JS (kiosk touchscreen UI) | Next.js + Clean Architecture (dashboard) |
| **Migrations** | Prisma Migrate | Alembic |
| **Real-time** | WebSocket (voice relay via Deepgram) | None (yet) |

> [!IMPORTANT]
> Both systems use PostgreSQL but **different ORMs and migration tools**. If they share a single database, migration conflicts are inevitable. If they use separate databases, a synchronization layer is required.

---

## 2. Tenant Model — Critical Mismatches

### Kiosk `tenants` (Prisma)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `name` | VARCHAR(255) | Display name |
| `slug` | VARCHAR(120) | `@unique` — used for tenant resolution |
| `plan` | Enum: `FREE \| PRO \| ENTERPRISE` | Inline enum |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | `@updatedAt` |

### HMS `tenants` (SQLAlchemy)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `hotel_name` | VARCHAR | Display name |
| `address` | TEXT | nullable |
| `owner_user_id` | UUID | FK → `tenant_users.id`, nullable |
| `plan_id` | UUID | FK → `plans` table, nullable |
| `gstin` | VARCHAR | nullable |
| `pan` | VARCHAR | nullable |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | nullable |

### Mismatch Summary

| Issue | Kiosk | HMS | Resolution |
|-------|-------|-----|------------|
| **Name field** | `name` | `hotel_name` | DTO adapter: alias one to the other |
| **Slug** | `slug` (UNIQUE, required) | ❌ Not present | **HMS must add `slug` column** |
| **Plan** | Enum (`FREE`/`PRO`/`ENTERPRISE`) | UUID FK → `plans` table | Adapter maps enum ↔ plan name |
| **Address** | Not present | `address` (TEXT) | Kiosk ignores; HMS-only field |
| **Owner linkage** | Via `users` relation | `owner_user_id` FK | Different model; no direct conflict |
| **Tax IDs** | Not present | `gstin`, `pan` | HMS-only fields; no Kiosk impact |
| **HotelConfig** | Separate `hotel_configs` table (eager-loaded) | ❌ Not present | HMS must add `hotel_configs` or equivalent |

---

## 3. Missing HMS Entities

The HMS spec explicitly identifies these entities as **not yet modeled**. All are required for Kiosk workflows.

| Entity | Kiosk Has It? | HMS Status | Severity |
|--------|:---:|:---:|----------|
| `room_types` | ✅ | ❌ | **BLOCKER** — Kiosk room selection depends on it |
| `bookings` | ✅ | ❌ | **BLOCKER** — Core check-in + walk-in flows |
| `hotel_configs` | ✅ | ❌ | **BLOCKER** — Kiosk eager-loads with tenant |
| `guests` | ❌ | ❌ | Required for ID scan & registration |
| `payments` | Partial (`paymentRef` field) | ❌ | Required for payment flow |
| `kiosks` (device) | ❌ | ❌ | Required for device mgmt & heartbeats |
| `check_ins` | ❌ | ❌ | Required for check-in records |
| `rooms` (inventory) | ❌ | ❌ | Required for room assignment |

---

## 4. Room Type Model Alignment

### Kiosk `room_types` Table

```
id          UUID          PK
tenantId    UUID          FK → tenants, onDelete: Cascade
name        VARCHAR(255)
code        VARCHAR(60)   Composite UNIQUE(tenantId, code)
price       DECIMAL(10,2)
amenities   String[]      Postgres text array
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

### Kiosk `RoomDTO` (API Response)

```typescript
interface RoomDTO {
  id: string;
  name: string;
  price: number;       // Converted from Decimal
  currency: string;    // Hardcoded "USD"
  image: string;       // URL
  features: string[];  // Maps from amenities[]
  code?: string;
}
```

### Kiosk `RoomType` Enum (Booking Contract)

```typescript
type RoomType = "STANDARD" | "DELUXE" | "PRESIDENTIAL";
```

### HMS — Must Create

HMS must model `room_types` with these compatible fields:

| HMS Column | Must Match | Notes |
|------------|-----------|-------|
| `id` | UUID PK | ✅ |
| `tenant_id` | UUID FK | Must match Kiosk FK behavior |
| `name` | VARCHAR | ✅ |
| `code` | VARCHAR | **Must enforce UNIQUE(tenant_id, code)** |
| `price` | DECIMAL(10,2) | Match precision exactly |
| `amenities` | ARRAY(TEXT) | Postgres array |

Additionally, HMS should create a `rooms` table for individual room inventory (room_number, room_type_id, status, floor, etc.) which the Kiosk doesn't track but the dashboard needs.

---

## 5. Booking Contract Alignment

### Kiosk `bookings` Table

```
id              UUID          PK
tenantId        UUID          FK → tenants, Cascade
guestName       VARCHAR(255)
checkInDate     DATE
checkOutDate    DATE
adults          INT           Required
children        INT?          Nullable
nights          INT           Required
totalPrice      DECIMAL(10,2) Nullable
sessionId       VARCHAR(120)  Nullable
idempotencyKey  VARCHAR(190)  Nullable, UNIQUE(tenantId, idempotencyKey)
paymentRef      VARCHAR(120)  Nullable
status          Enum          DRAFT | CONFIRMED
roomTypeId      UUID          FK → room_types, onDelete: Restrict
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### Kiosk `BookingSlots` (Conversational Collection)

```typescript
interface BookingSlots {
  roomType: "STANDARD" | "DELUXE" | "PRESIDENTIAL" | null;
  adults: number | null;
  children: number | null;
  checkInDate: string | null;    // ISO "2026-02-13"
  checkOutDate: string | null;   // ISO "2026-02-15"
  guestName: string | null;
  nights: number | null;         // Computed
  totalPrice: number | null;     // Computed
}
```

### HMS — Must Create `bookings` With These Rules

| Rule | Detail |
|------|--------|
| **Status enum** | Must include `DRAFT` and `CONFIRMED` at minimum |
| **Idempotency key** | Composite: `{tenantId}:{sessionId}:{roomId}:{checkInDate}:{checkOutDate}:{guestNameLowerTrimmed}` |
| **Unique constraint** | `UNIQUE(tenant_id, idempotency_key)` |
| **Duplicate handling** | If key exists → return existing booking, don't create new |
| **Date conflict** | Before confirming: check overlapping `CONFIRMED` bookings on same room type within a transaction → `409 BOOKING_DATE_CONFLICT` |
| **FK restriction** | `roomTypeId` FK uses `onDelete: Restrict` — cannot delete room type with active bookings |
| **Transactions** | All booking mutations inside DB transaction |

---

## 6. API Contract Gaps

### 6.1 Tenant Resolution — Incompatible

| Aspect | Kiosk | HMS |
|--------|-------|-----|
| **Primary identifier** | Slug (string via header/URL) | UUID (from JWT payload) |
| **Headers** | `x-tenant-slug`, `x-kiosk-tenant` | `Authorization: Bearer <jwt>` |
| **Resolution** | Express middleware → `req.tenant` | FastAPI DI → `get_current_user()` |

**Resolution:** HMS must add slug-based lookup OR introduce an API gateway that translates `slug → UUID`.

### 6.2 Kiosk Endpoints Without HMS Equivalent

| Kiosk Endpoint | Purpose | HMS Gap |
|----------------|---------|---------|
| `GET /api/:slug/rooms` | List room types | No rooms model |
| `GET /api/:slug/tenant` | Tenant + HotelConfig | Different shape, missing HotelConfig |
| `POST /api/:slug/chat` | LLM general chat | N/A (Kiosk-only) |
| `POST /api/:slug/chat/booking` | LLM booking chat | N/A (Kiosk-only) |
| `WS ws://localhost:3001` | Voice relay | N/A (Kiosk-only) |

### 6.3 HMS Endpoints Needed for Kiosk (12 New Endpoints)

| Method | Endpoint | Purpose | Flow |
|--------|----------|---------|------|
| `POST` | `/api/hotels/{id}/guests` | Register walk-in guest | Walk-in |
| `GET` | `/api/hotels/{id}/guests/{guest_id}` | Retrieve guest by ID scan | Check-in |
| `PUT` | `/api/hotels/{id}/guests/{guest_id}` | Update guest info | Check-in |
| `GET` | `/api/hotels/{id}/bookings/{ref}` | Lookup pre-booked reservation | Check-in |
| `POST` | `/api/hotels/{id}/bookings` | Create walk-in booking | Walk-in |
| `PATCH` | `/api/hotels/{id}/bookings/{id}/status` | Update booking status | Check-in |
| `GET` | `/api/hotels/{id}/rooms/available` | Query available rooms | Walk-in |
| `PATCH` | `/api/hotels/{id}/rooms/{id}/status` | Mark room occupied/available | Check-in / Checkout |
| `POST` | `/api/hotels/{id}/check-in` | Execute check-in | Check-in |
| `POST` | `/api/hotels/{id}/checkout` | Execute checkout | Checkout |
| `POST` | `/api/hotels/{id}/payments` | Process payment | Payment |
| `POST` | `/api/hotels/{id}/kiosks/register` | Register kiosk device | Setup |
| `POST` | `/api/hotels/{id}/kiosks/{id}/heartbeat` | Health monitoring | Ongoing |
| `GET` | `/api/hotels/{id}/kiosks` | List kiosks | Dashboard |
| `PATCH` | `/api/hotels/{id}/kiosks/{id}/status` | Update kiosk status | Dashboard |
| `GET` | `/api/hotels/{id}/payments/{id}` | Check payment status | Payment |

---

## 7. Auth & Security Integration

### 7.1 Current State

| System | Auth Mechanism | User Model |
|--------|----------------|------------|
| Kiosk | `x-tenant-slug` header + `KIOSK_MACHINE` role in `UserRole` enum | `users` table (tenantId, email, role enum) |
| HMS | JWT (HS256) + bcrypt + RBAC via `require_permission` | Separate `platform_users` + `tenant_users` tables |

### 7.2 Required Steps

1. **Add `slug` to HMS `tenants`** — Required for Kiosk tenant resolution
2. **Create `kiosks` device table** — `id`, `tenant_id`, `api_key`, `firmware_version`, `status`, `last_heartbeat_at`
3. **Implement device JWT** — Long-lived token with payload: `{ sub: kiosk_uuid, device_table: "kiosk", tenant_id: tenant_uuid }`
4. **Add HMS permission keys** for Kiosk operations:
   ```
   hotel:kiosks:read
   hotel:kiosks:write
   hotel:rooms:read
   hotel:rooms:write
   hotel:bookings:read
   hotel:bookings:write
   hotel:guests:read
   hotel:guests:write
   hotel:checkin:write
   hotel:payments:read
   hotel:payments:write
   ```
5. **Update CORS** — Add Kiosk device origins to HMS allowed origins
6. **Guest verification** — Implement booking-ref lookup, QR scan decode, and optional OTP verification

---

## 8. Real-Time Dashboard Sync

### 8.1 Required Events (Kiosk → Dashboard)

| Event | Trigger | Dashboard Action | Priority |
|-------|---------|------------------|----------|
| `kiosk.check_in.completed` | POST check-in succeeds | Update room occupancy, guest list | HIGH |
| `kiosk.check_in.failed` | POST check-in fails | Alert staff, log failure | HIGH |
| `kiosk.booking.created` | Walk-in POST booking | Add to booking list, update availability | HIGH |
| `kiosk.payment.completed` | Payment POST succeeds | Update revenue dashboard | HIGH |
| `kiosk.payment.failed` | Payment POST fails | Alert front desk, flag booking | CRITICAL |
| `kiosk.checkout.completed` | Checkout POST | Free room, trigger housekeeping | HIGH |
| `kiosk.heartbeat` | Periodic POST | Update device status indicator | LOW |
| `kiosk.offline` | Heartbeat timeout | Display alert banner | CRITICAL |
| `kiosk.hardware.error` | Heartbeat payload | Create support ticket | HIGH |
| `kiosk.paper.low` | Heartbeat payload | Display maintenance alert | MEDIUM |

### 8.2 Heartbeat Payload Structure

```json
{
  "kiosk_id": "uuid",
  "tenant_id": "uuid",
  "status": "online",
  "firmware_version": "2.4.1",
  "uptime_seconds": 86400,
  "hardware": {
    "printer": { "status": "ok|error|paper_low|paper_out", "paper_level_pct": 45 },
    "card_dispenser": { "status": "ok|error|empty", "cards_remaining": 120 },
    "scanner": { "status": "ok|error" },
    "network": { "type": "ethernet|wifi", "signal_strength_dbm": -45 }
  },
  "last_check_in_at": "2026-02-23T14:30:00Z",
  "error_log": [
    { "timestamp": "ISO", "code": "CARD_DISPENSE_JAM", "message": "..." }
  ]
}
```

### 8.3 Implementation Options

| Option | Pros | Cons |
|--------|------|------|
| **SSE (Server-Sent Events)** | Simple, HTTP-based, auto-reconnect | Unidirectional only |
| **WebSocket** | Bidirectional, lower latency | More complex, connection management |
| **Polling** | Simplest to implement | Higher latency, wasted bandwidth |

**Recommendation:** SSE for dashboard consumption (unidirectional is sufficient). Kiosk already has WebSocket for voice relay on port 3001.

---

## 9. DTO Mapping Reference

### Tenant DTO

| Kiosk Field (TypeScript) | HMS Field (Python) | Transform |
|---|---|---|
| `TenantDTO.id` | `TenantRead.id` | Direct (UUID) |
| `TenantDTO.name` | `TenantRead.hotel_name` | **Rename** |
| `TenantDTO.slug` | N/A (must add) | HMS must add field |
| `TenantDTO.plan` | `TenantRead.plan_id` → `PlanRead.name` | Lookup + map |
| `TenantDTO.hotelConfig` | N/A (must add) | HMS must add entity |

### Room DTO

| Kiosk Field | Proposed HMS Equivalent | Transform |
|---|---|---|
| `RoomDTO.id` | `RoomTypeRead.id` | Direct |
| `RoomDTO.name` | `RoomTypeRead.name` | Direct |
| `RoomDTO.price` | `RoomTypeRead.price` | Decimal → float |
| `RoomDTO.currency` | Hardcoded `"USD"` | HMS may need multi-currency |
| `RoomDTO.image` | `RoomTypeRead.image_url` | HMS must store URLs |
| `RoomDTO.features` | `RoomTypeRead.amenities` | **Rename** |
| `RoomDTO.code` | `RoomTypeRead.code` | Direct |

### Booking DTO

| Kiosk Field | Proposed HMS Equivalent | Transform |
|---|---|---|
| `guestName` | `guest_name` | snake_case |
| `checkInDate` | `check_in_date` | camelCase → snake_case |
| `checkOutDate` | `check_out_date` | camelCase → snake_case |
| `roomTypeId` | `room_type_id` | camelCase → snake_case |
| `totalPrice` | `total_price` | Decimal → float |
| `status` | `status` | Enum: must share `DRAFT`, `CONFIRMED` |
| `idempotencyKey` | `idempotency_key` | **Must replicate composite formula** |
| `sessionId` | `session_id` | Direct |
| `paymentRef` | `payment_ref` | Direct |

---

## 10. 6-Phase Integration Plan

### Phase 1 — HMS Schema Alignment (**BLOCKER**)

| # | Task | File / Location |
|---|------|-----------------|
| 1 | Add `slug` column (VARCHAR, UNIQUE) to `tenants` | HMS `BackEnd/app/models/` |
| 2 | Create `hotel_configs` model | HMS `BackEnd/app/models/` |
| 3 | Create `room_types` model (match Kiosk schema) | HMS `BackEnd/app/models/` |
| 4 | Create `rooms` model (individual inventory) | HMS `BackEnd/app/models/` |
| 5 | Create `bookings` model (Kiosk-compatible fields + idempotency) | HMS `BackEnd/app/models/` |
| 6 | Create `guests` model | HMS `BackEnd/app/models/` |
| 7 | Create `kiosks` device model | HMS `BackEnd/app/models/` |
| 8 | Create `check_ins` model | HMS `BackEnd/app/models/` |
| 9 | Create `payments` model | HMS `BackEnd/app/models/` |
| 10 | Generate + run Alembic migrations | HMS `BackEnd/` |

### Phase 2 — HMS API Endpoints

| # | Task |
|---|------|
| 1 | Build guest CRUD endpoints |
| 2 | Build room type + room inventory endpoints |
| 3 | Build booking CRUD + status update endpoints |
| 4 | Build `POST /check-in` and `POST /checkout` endpoints |
| 5 | Build payment endpoints |
| 6 | Build kiosk device registration + heartbeat endpoints |
| 7 | Add slug-based tenant resolution middleware |

### Phase 3 — Auth Integration

| # | Task |
|---|------|
| 1 | Create `KIOSK_MACHINE` role equivalent in HMS `tenant_roles` |
| 2 | Implement device JWT issuance at kiosk registration |
| 3 | Seed new permission keys (`hotel:kiosks:*`, `hotel:rooms:*`, etc.) |
| 4 | Add Kiosk origins to CORS config |

### Phase 4 — Real-Time Sync

| # | Task |
|---|------|
| 1 | Implement SSE endpoint in HMS backend |
| 2 | Emit events on booking/check-in/payment/heartbeat mutations |
| 3 | Build dashboard widgets consuming SSE stream |

### Phase 5 — DTO Harmonization

| # | Task |
|---|------|
| 1 | Define shared DTO interface contracts in documentation |
| 2 | Build adapter layer: Kiosk camelCase ↔ HMS snake_case |
| 3 | Align field naming: `name`↔`hotel_name`, `features`↔`amenities` |

### Phase 6 — HMS Frontend Integration

| # | Task |
|---|------|
| 1 | Activate `super/kiosks` route → kiosk management page |
| 2 | Activate `hotel/rooms` route → room management page |
| 3 | Activate `hotel/bookings` route → booking management page |
| 4 | Activate `hotel/guests` route → guest management page |
| 5 | Build real-time status widgets (kiosk health, live bookings) |

---

## 11. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Shared DB + dual ORM** — Prisma Migrate vs Alembic modifying same database | CRITICAL | Designate one ORM as migration owner; other system reads only |
| **Migration collisions** | HIGH | Coordinate migration naming/ordering; use CI checks |
| **HMS missing `slug`** | HIGH | Add to HMS `tenants` as first integration step |
| **Plan model mismatch** — Kiosk enum vs HMS FK table | MEDIUM | Build adapter; each system keeps its model |
| **Idempotency key formula** — HMS must replicate exact composite | HIGH | Copy formula verbatim from Kiosk spec |
| **Currency hardcoding** — Kiosk uses `"USD"` only | MEDIUM | HMS supports multi-currency; Kiosk adapter defaults to USD |
| **Session memory** — Kiosk wipes on `WELCOME`/`IDLE` | LOW | HMS doesn't touch; Kiosk-only concern |
| **No shared type system** — TypeScript (Kiosk) vs Python (HMS) | MEDIUM | Document contracts in this spec; generate types if possible |
| **CORS in production** — Kiosk origins unknown at build time | MEDIUM | Use server-side proxy or environment-based CORS config |

---

> [!CAUTION]
> **Schema Sync Rule:** If any field, type, or constraint changes in either system's database schema, both the Kiosk backend AND the HMS Admin Dashboard must update simultaneously. This document is the canonical integration contract.
