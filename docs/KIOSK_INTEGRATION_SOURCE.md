# KIOSK_INTEGRATION_SOURCE.md — System DNA Specification

> **Purpose**: Source-of-Truth document for the **Kiosk Fleet** codebase.  
> Intended audience: Any external agent (e.g. Admin/Dashboard) that must integrate with, validate against, or extend this system.  
> **Generated**: 2026-02-23  
> **Repo**: `KIOSK_FRONTEND_V1`

---

## Table of Contents

1. [Database Schema (Prisma Deep-Dive)](#1-database-schema-prisma-deep-dive)
2. [Tenant Resolution Protocol](#2-tenant-resolution-protocol)
3. [Shared API Contracts](#3-shared-api-contracts)
4. [UI State Machine & Intent Logic](#4-ui-state-machine--intent-logic)
5. [Integration "Hard" Requirements](#5-integration-hard-requirements)

---

## 1. Database Schema (Prisma Deep-Dive)

**Provider**: PostgreSQL  
**ORM**: Prisma Client JS  
**Source**: [`backend/prisma/schema.prisma`](file:///d:/code/KIOSK_FRONTEND_V1/backend/prisma/schema.prisma)

### 1.1 Enums

| Enum Name        | Allowed Values                                      |
|------------------|-----------------------------------------------------|
| `Plan`           | `FREE`, `PRO`, `ENTERPRISE`                         |
| `BookingStatus`  | `DRAFT`, `CONFIRMED`                                |
| `UserRole`       | `SUPER_ADMIN`, `TENANT_OWNER`, `FRONT_DESK`, `KIOSK_MACHINE` |

### 1.2 Model: `Tenant`

**Table name**: `tenants`

| Field         | Prisma Type        | DB Type             | Constraints / Notes                          |
|---------------|--------------------|----------------------|----------------------------------------------|
| `id`          | `String`           | `Uuid`               | `@id @default(uuid())`                       |
| `name`        | `String`           | `VarChar(255)`       |                                              |
| `slug`        | `String`           | `VarChar(120)`       | `@unique`                                    |
| `plan`        | `Plan`             | Enum                 | `@default(FREE)`                             |
| `createdAt`   | `DateTime`         | `Timestamptz(6)`     | `@default(now())` · Column: `created_at`     |
| `updatedAt`   | `DateTime`         | `Timestamptz(6)`     | `@updatedAt` · Column: `updated_at`          |

**Relations**:
| Relation      | Target Model   | Cardinality |
|---------------|----------------|-------------|
| `hotelConfig` | `HotelConfig`  | One-to-One (optional) |
| `roomTypes`   | `RoomType`     | One-to-Many |
| `bookings`    | `Booking`      | One-to-Many |
| `users`       | `User`         | One-to-Many |

### 1.3 Model: `HotelConfig`

**Table name**: `hotel_configs`

| Field          | Prisma Type  | DB Type          | Constraints / Notes                                          |
|----------------|-------------|-------------------|--------------------------------------------------------------|
| `id`           | `String`    | `Uuid`            | `@id @default(uuid())`                                       |
| `tenantId`     | `String`    | `Uuid`            | `@unique` · Column: `tenant_id` · FK → `Tenant.id` · `onDelete: Cascade` |
| `timezone`     | `String`    | `VarChar(100)`    |                                                              |
| `supportPhone` | `String`    | `VarChar(40)`     | Column: `support_phone`                                      |
| `checkInTime`  | `DateTime`  | `Time(6)`         | Column: `check_in_time`                                      |
| `createdAt`    | `DateTime`  | `Timestamptz(6)`  | `@default(now())` · Column: `created_at`                     |
| `updatedAt`    | `DateTime`  | `Timestamptz(6)`  | `@updatedAt` · Column: `updated_at`                          |

**Indexes**: `@@index([tenantId])`

### 1.4 Model: `RoomType`

**Table name**: `room_types`

| Field       | Prisma Type  | DB Type          | Constraints / Notes                                          |
|-------------|-------------|-------------------|--------------------------------------------------------------|
| `id`        | `String`    | `Uuid`            | `@id @default(uuid())`                                       |
| `tenantId`  | `String`    | `Uuid`            | Column: `tenant_id` · FK → `Tenant.id` · `onDelete: Cascade` |
| `name`      | `String`    | `VarChar(255)`    |                                                              |
| `code`      | `String`    | `VarChar(60)`     |                                                              |
| `price`     | `Decimal`   | `Decimal(10, 2)`  |                                                              |
| `amenities` | `String[]`  | Text array        |                                                              |
| `createdAt` | `DateTime`  | `Timestamptz(6)`  | `@default(now())` · Column: `created_at`                     |
| `updatedAt` | `DateTime`  | `Timestamptz(6)`  | `@updatedAt` · Column: `updated_at`                          |

**Composite Unique**: `@@unique([tenantId, code])`  
**Indexes**: `@@index([tenantId])`  
**Relations**: `bookings → Booking[]` (One-to-Many)

### 1.5 Model: `Booking`

**Table name**: `bookings`

| Field            | Prisma Type      | DB Type          | Constraints / Notes                                                     |
|------------------|-----------------|-------------------|-------------------------------------------------------------------------|
| `id`             | `String`        | `Uuid`            | `@id @default(uuid())`                                                  |
| `tenantId`       | `String`        | `Uuid`            | Column: `tenant_id` · FK → `Tenant.id` · `onDelete: Cascade`           |
| `guestName`      | `String`        | `VarChar(255)`    | Column: `guest_name`                                                    |
| `checkInDate`    | `DateTime`      | `Date`            | Column: `check_in_date`                                                 |
| `checkOutDate`   | `DateTime`      | `Date`            | Column: `check_out_date`                                                |
| `adults`         | `Int`           | Integer           | Required                                                                |
| `children`       | `Int?`          | Integer           | Nullable                                                                |
| `nights`         | `Int`           | Integer           | Required                                                                |
| `totalPrice`     | `Decimal?`      | `Decimal(10, 2)`  | Nullable · Column: `total_price`                                        |
| `sessionId`      | `String?`       | `VarChar(120)`    | Nullable · Column: `session_id`                                         |
| `idempotencyKey` | `String?`       | `VarChar(190)`    | Nullable · Column: `idempotency_key`                                    |
| `paymentRef`     | `String?`       | `VarChar(120)`    | Nullable · Column: `payment_ref`                                        |
| `status`         | `BookingStatus` | Enum              | `@default(DRAFT)`                                                       |
| `roomTypeId`     | `String`        | `Uuid`            | Column: `room_type_id` · FK → `RoomType.id` · `onDelete: Restrict`     |
| `createdAt`      | `DateTime`      | `Timestamptz(6)`  | `@default(now())` · Column: `created_at`                                |
| `updatedAt`      | `DateTime`      | `Timestamptz(6)`  | `@updatedAt` · Column: `updated_at`                                     |

**Composite Unique**: `@@unique([tenantId, idempotencyKey])`  
**Indexes**: `@@index([tenantId])`, `@@index([tenantId, status])`, `@@index([roomTypeId])`

> [!IMPORTANT]
> The `roomType` FK uses `onDelete: Restrict` (not Cascade). Deleting a RoomType with active bookings will fail at the DB level.

### 1.6 Model: `User`

**Table name**: `users`

| Field      | Prisma Type  | DB Type          | Constraints / Notes                                          |
|------------|-------------|-------------------|--------------------------------------------------------------|
| `id`       | `String`    | `Uuid`            | `@id @default(uuid())`                                       |
| `tenantId` | `String`    | `Uuid`            | Column: `tenant_id` · FK → `Tenant.id` · `onDelete: Cascade` |
| `email`    | `String`    | `VarChar(255)`    |                                                              |
| `role`     | `UserRole`  | Enum              | Required                                                     |
| `createdAt`| `DateTime`  | `Timestamptz(6)`  | `@default(now())` · Column: `created_at`                     |
| `updatedAt`| `DateTime`  | `Timestamptz(6)`  | `@updatedAt` · Column: `updated_at`                          |

**Composite Unique**: `@@unique([tenantId, email])`  
**Indexes**: `@@index([tenantId])`

---

## 2. Tenant Resolution Protocol

**Source**: [`backend/src/middleware/tenantResolver.ts`](file:///d:/code/KIOSK_FRONTEND_V1/backend/src/middleware/tenantResolver.ts)

### 2.1 Resolution Order (First Match Wins)

```
1. URL path parameter  →  req.params.tenantSlug   (e.g. /api/:tenantSlug/rooms)
2. HTTP header         →  x-tenant-slug
3. HTTP header         →  x-kiosk-tenant
```

If none found → **400** `TENANT_SLUG_REQUIRED`

### 2.2 Lookup & Augmentation

```typescript
// Prisma query
prisma.tenant.findUnique({
  where: { slug: tenantSlug },
  include: { hotelConfig: true }   // ← Always eagerly loaded
});
```

| Outcome         | HTTP Status | Error Code                | Behaviour                                      |
|-----------------|-------------|---------------------------|-------------------------------------------------|
| Slug missing    | `400`       | `TENANT_SLUG_REQUIRED`    | Response returned, middleware halts              |
| Tenant not found| `404`       | `TENANT_NOT_FOUND`        | Response returned, middleware halts              |
| Resolution error| `500`       | `TENANT_RESOLUTION_FAILED`| Response returned, middleware halts              |
| Success         | —           | —                         | `req.tenant` and `req.tenantSlug` are set        |

### 2.3 Express Request Augmentation

**Source**: [`backend/src/types/express.d.ts`](file:///d:/code/KIOSK_FRONTEND_V1/backend/src/types/express.d.ts)

```typescript
declare global {
  namespace Express {
    interface Request {
      requestId?: string;               // Set by requestContext middleware (UUID)
      startTimeMs?: number;             // Set by requestContext middleware
      tenant?: Prisma.TenantGetPayload<{
        include: { hotelConfig: true }  // Tenant + hotelConfig eager-loaded
      }>;
      tenantSlug?: string;
    }
  }
}
```

### 2.4 Request Context Middleware

All HTTP requests receive:
- **`x-request-id`** header (echoed back) — accepts incoming `x-request-id` or generates a UUID.
- **Access logging** on request start and `finish`.

---

## 3. Shared API Contracts

**Source directory**: [`shared/contracts/`](file:///d:/code/KIOSK_FRONTEND_V1/shared/contracts/)

### 3.1 Error Response

```typescript
// shared/contracts/api.contract.ts
interface ApiErrorBody {
  error: {
    code: string;        // e.g. "TENANT_NOT_FOUND"
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
```

### 3.2 Tenant DTOs

```typescript
interface TenantConfigDTO {
  timezone: string;
  supportPhone: string;
  checkInTime: string;
}

interface TenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  hotelConfig?: TenantConfigDTO | null;
}

interface TenantResponseDTO {
  tenant: TenantDTO | null;
  requestId?: string;
}
```

### 3.3 Room DTOs

```typescript
interface RoomDTO {
  id: string;
  name: string;
  price: number;         // Numeric (converted from Decimal)
  currency: string;      // Always "USD" in current implementation
  image: string;         // URL
  features: string[];    // Maps from amenities[]
  code?: string;         // Room type code (e.g. "STANDARD")
}

interface RoomsResponseDTO {
  rooms: RoomDTO[];
  requestId?: string;
}
```

### 3.4 Chat DTOs

```typescript
interface ChatRequestDTO {
  transcript?: string;
  currentState?: string;
  sessionId?: string;
}

interface ChatResponseDTO {
  speech: string;
  intent: string;
  confidence: number;    // 0.0 – 1.0
}

interface BookingChatResponseDTO extends ChatResponseDTO {
  extractedSlots?: Record<string, unknown>;
  accumulatedSlots?: Record<string, unknown>;
  missingSlots?: string[];
  nextSlotToAsk?: string | null;
  isComplete?: boolean;
  persistedBookingId?: string | null;
}
```

### 3.5 Backend Response Contract

```typescript
// shared/contracts/backend.contract.ts
type UIState =
  | 'IDLE' | 'WELCOME' | 'AI_CHAT' | 'MANUAL_MENU'
  | 'SCAN_ID' | 'ROOM_SELECT' | 'BOOKING_COLLECT'
  | 'BOOKING_SUMMARY' | 'PAYMENT' | 'KEY_DISPENSING'
  | 'COMPLETE' | 'ERROR';

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
}

interface BackendResponse {
  ui_state: UIState;
  messages?: ChatMessage[];
  text_response?: string;
  audio_url?: string;
  metadata?: Record<string, any>;
}
```

### 3.6 Booking Contract (Shared Source of Truth)

**Source**: [`shared/contracts/booking.contract.ts`](file:///d:/code/KIOSK_FRONTEND_V1/shared/contracts/booking.contract.ts)

```typescript
type RoomType = "STANDARD" | "DELUXE" | "PRESIDENTIAL";

interface RoomInfo {
  type: RoomType;
  name: string;
  pricePerNight: number;
  maxAdults: number;
  maxChildren: number;
  amenities: string[];
  description: string;
}

interface BookingSlots {
  roomType: RoomType | null;
  adults: number | null;
  children: number | null;
  checkInDate: string | null;    // ISO "2026-02-13"
  checkOutDate: string | null;   // ISO "2026-02-15"
  guestName: string | null;
  nights: number | null;         // Computed
  totalPrice: number | null;     // Computed
}
```

**Required slots** (for booking completion): `roomType`, `adults`, `checkInDate`, `checkOutDate`, `guestName`

```typescript
type BookingIntent =
  | "SELECT_ROOM" | "PROVIDE_GUESTS" | "PROVIDE_DATES"
  | "PROVIDE_NAME" | "CONFIRM_BOOKING" | "MODIFY_BOOKING"
  | "CANCEL_BOOKING" | "ASK_ROOM_DETAIL" | "COMPARE_ROOMS"
  | "ASK_PRICE";

interface BookingResponse {
  speech: string;
  intent: string;
  confidence: number;
  bookingSlots?: Partial<BookingSlots>;
  nextSlotToAsk?: string;
  isComplete?: boolean;
  summary?: string;
}
```

### 3.7 UI Event Contract

```typescript
type UIEventType =
  | 'START_SESSION' | 'CHECK_IN_SELECTED' | 'BOOK_ROOM_SELECTED'
  | 'HELP_SELECTED' | 'SCAN_COMPLETED' | 'ROOM_SELECTED'
  | 'CONFIRM_PAYMENT' | 'DISPENSE_COMPLETE' | 'RESET'
  | 'VOICE_INPUT_START' | 'VOICE_INPUT_END'
  | 'ERROR' | 'ERROR_DISMISSED' | 'BACK_REQUESTED';

interface UIEvent {
  type: UIEventType;
  payload?: any;
}
```

### 3.8 All Intents (Union)

**Source**: [`shared/contracts/intents.ts`](file:///d:/code/KIOSK_FRONTEND_V1/shared/contracts/intents.ts)

```typescript
type Intent =
  | "PROXIMITY_DETECTED" | "VOICE_STARTED" | "VOICE_TRANSCRIPT_RECEIVED"
  | "VOICE_SILENCE" | "TOUCH_SELECTED"
  | "CHECK_IN_SELECTED" | "BOOK_ROOM_SELECTED" | "HELP_SELECTED"
  | "SCAN_COMPLETED" | "ROOM_SELECTED" | "CONFIRM_PAYMENT"
  | "DISPENSE_COMPLETE" | "RESET" | "BACK_REQUESTED"
  | "CANCEL_REQUESTED" | "EXPLAIN_CAPABILITIES" | "GENERAL_QUERY"
  // Booking-specific
  | "SELECT_ROOM" | "PROVIDE_GUESTS" | "PROVIDE_DATES"
  | "PROVIDE_NAME" | "CONFIRM_BOOKING" | "MODIFY_BOOKING"
  | "CANCEL_BOOKING" | "ASK_ROOM_DETAIL" | "COMPARE_ROOMS"
  | "ASK_PRICE";
```

### 3.9 LLM Contracts (Backend-only)

#### General Chat Intents (Zod Schema)

```typescript
// backend/src/llm/contracts.ts
const IntentSchema = z.enum([
  "IDLE", "WELCOME", "CHECK_IN", "SCAN_ID",
  "PAYMENT", "HELP", "REPEAT", "UNKNOWN",
  "BOOK_ROOM", "RECOMMEND_ROOM", "GENERAL_QUERY"
]);

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,    // Execute immediately
  MEDIUM: 0.50,  // Ask clarifying question
  // Below 0.50 → Reject (noise/silence)
};
```

#### Booking LLM Response (Zod Schema)

```typescript
// backend/src/llm/bookingContracts.ts
const BookingSlotsSchema = z.object({
  roomType: z.enum(["STANDARD", "DELUXE", "PRESIDENTIAL"]).nullable().optional(),
  adults: z.number().min(1).max(4).nullable().optional(),
  children: z.number().min(0).max(3).nullable().optional(),
  checkInDate: z.string().nullable().optional(),
  checkOutDate: z.string().nullable().optional(),
  guestName: z.string().nullable().optional(),
  nights: z.number().min(1).max(30).nullable().optional(),
  totalPrice: z.number().nullable().optional(),
});

const BookingIntentSchema = z.enum([
  "SELECT_ROOM", "PROVIDE_GUESTS", "PROVIDE_DATES", "PROVIDE_NAME",
  "CONFIRM_BOOKING", "MODIFY_BOOKING", "CANCEL_BOOKING",
  "ASK_ROOM_DETAIL", "COMPARE_ROOMS", "ASK_PRICE",
  "GENERAL_QUERY", "HELP", "REPEAT", "UNKNOWN"
]);

const BookingLLMResponseSchema = z.object({
  speech: z.string(),
  intent: BookingIntentSchema,
  confidence: z.number().min(0).max(1),
  extractedSlots: BookingSlotsSchema.optional(),
  nextSlotToAsk: z.string().nullable().optional(),
  isComplete: z.boolean().optional(),
});
```

---

## 4. UI State Machine & Intent Logic

**Source**: [`frontend/state/uiState.machine.ts`](file:///d:/code/KIOSK_FRONTEND_V1/frontend/state/uiState.machine.ts)

### 4.1 All UI States (12 total)

```
IDLE → WELCOME → AI_CHAT / MANUAL_MENU → SCAN_ID → ROOM_SELECT
→ BOOKING_COLLECT → BOOKING_SUMMARY → PAYMENT → KEY_DISPENSING
→ COMPLETE → (RESET to IDLE)
ERROR (reachable from any state)
```

### 4.2 Full Transition Map

| From State         | Event                 | To State            | canGoBack |
|--------------------|-----------------------|---------------------|-----------|
| **IDLE**           | `PROXIMITY_DETECTED`  | `WELCOME`           | ❌        |
|                    | `TOUCH_SELECTED`      | `WELCOME`           |           |
| **WELCOME**        | `CHECK_IN_SELECTED`   | `SCAN_ID`           | ✅        |
|                    | `BOOK_ROOM_SELECTED`  | `ROOM_SELECT`       |           |
|                    | `HELP_SELECTED`       | `WELCOME` (stay)    |           |
|                    | `TOUCH_SELECTED`      | `MANUAL_MENU`       |           |
|                    | `EXPLAIN_CAPABILITIES`| `WELCOME` (stay)    |           |
|                    | `GENERAL_QUERY`       | `WELCOME` (stay)    |           |
| **AI_CHAT**        | `CHECK_IN_SELECTED`   | `SCAN_ID`           | ✅        |
|                    | `BOOK_ROOM_SELECTED`  | `ROOM_SELECT`       |           |
|                    | `HELP_SELECTED`       | `IDLE`              |           |
| **MANUAL_MENU**    | `CHECK_IN_SELECTED`   | `SCAN_ID`           | ✅        |
|                    | `BOOK_ROOM_SELECTED`  | `ROOM_SELECT`       |           |
|                    | `HELP_SELECTED`       | `IDLE`              |           |
| **SCAN_ID**        | `SCAN_COMPLETED`      | `ROOM_SELECT`       | ✅        |
| **ROOM_SELECT**    | `ROOM_SELECTED`       | `BOOKING_COLLECT`   | ✅        |
|                    | `BACK_REQUESTED`      | `MANUAL_MENU`       |           |
|                    | `CANCEL_REQUESTED`    | `WELCOME`           |           |
| **BOOKING_COLLECT**| `PROVIDE_GUESTS`      | `BOOKING_COLLECT`   | ✅        |
|                    | `PROVIDE_DATES`       | `BOOKING_COLLECT`   |           |
|                    | `PROVIDE_NAME`        | `BOOKING_COLLECT`   |           |
|                    | `SELECT_ROOM`         | `BOOKING_COLLECT`   |           |
|                    | `ASK_ROOM_DETAIL`     | `BOOKING_COLLECT`   |           |
|                    | `ASK_PRICE`           | `BOOKING_COLLECT`   |           |
|                    | `GENERAL_QUERY`       | `BOOKING_COLLECT`   |           |
|                    | `MODIFY_BOOKING`      | `BOOKING_COLLECT`   |           |
|                    | `CONFIRM_BOOKING`     | `BOOKING_SUMMARY`   |           |
|                    | `CANCEL_BOOKING`      | `ROOM_SELECT`       |           |
|                    | `BACK_REQUESTED`      | `ROOM_SELECT`       |           |
|                    | `HELP_SELECTED`       | `BOOKING_COLLECT`   |           |
|                    | `RESET`               | `IDLE`              |           |
| **BOOKING_SUMMARY**| `CONFIRM_PAYMENT`     | `PAYMENT`           | ✅        |
|                    | `MODIFY_BOOKING`      | `BOOKING_COLLECT`   |           |
|                    | `BACK_REQUESTED`      | `BOOKING_COLLECT`   |           |
|                    | `CANCEL_BOOKING`      | `WELCOME`           |           |
|                    | `RESET`               | `IDLE`              |           |
| **PAYMENT**        | `CONFIRM_PAYMENT`     | `KEY_DISPENSING`    | ✅        |
| **KEY_DISPENSING**  | `DISPENSE_COMPLETE`   | `COMPLETE`          | ❌ (HW lock) |
| **COMPLETE**       | `RESET`               | `IDLE`              | ❌        |
|                    | `PROXIMITY_DETECTED`  | `WELCOME`           |           |
| **ERROR**          | `RESET`               | `IDLE`              | ✅        |
|                    | `BACK_REQUESTED`      | `WELCOME`           |           |

### 4.3 State Machine Behaviour

- **Invalid transitions** return the current state (no-op — stays put).
- **`getPreviousState()`** follows a linear flow: `IDLE → WELCOME → SCAN_ID → ROOM_SELECT → BOOKING_COLLECT → BOOKING_SUMMARY → PAYMENT`. Non-linear states (`MANUAL_MENU`, `AI_CHAT`, `ERROR`) fall back to `WELCOME`.

### 4.4 Intents the Backend Must Handle

These are the intents the Kiosk emits that the backend must recognise and process:

| Category       | Intents                                                                                  |
|----------------|------------------------------------------------------------------------------------------|
| **Navigation** | `PROXIMITY_DETECTED`, `TOUCH_SELECTED`, `CHECK_IN_SELECTED`, `BOOK_ROOM_SELECTED`, `HELP_SELECTED`, `BACK_REQUESTED`, `CANCEL_REQUESTED`, `RESET` |
| **Voice/Input**| `VOICE_STARTED`, `VOICE_TRANSCRIPT_RECEIVED`, `VOICE_SILENCE`                            |
| **Scan**       | `SCAN_COMPLETED`                                                                         |
| **Room**       | `ROOM_SELECTED`, `SELECT_ROOM`, `ASK_ROOM_DETAIL`, `COMPARE_ROOMS`, `ASK_PRICE`         |
| **Booking**    | `PROVIDE_GUESTS`, `PROVIDE_DATES`, `PROVIDE_NAME`, `CONFIRM_BOOKING`, `MODIFY_BOOKING`, `CANCEL_BOOKING` |
| **Payment**    | `CONFIRM_PAYMENT`, `DISPENSE_COMPLETE`                                                   |
| **Informational** | `EXPLAIN_CAPABILITIES`, `GENERAL_QUERY`                                               |

---

## 5. Integration "Hard" Requirements

These are non-negotiable contracts that any integrating system must satisfy.

### 5.1 Tenant Resolution

| # | Requirement |
|---|-------------|
| 1 | Every API request must carry a tenant identifier via **URL path param** (`:tenantSlug`) or **HTTP header** (`x-tenant-slug` / `x-kiosk-tenant`). |
| 2 | The `slug` value must correspond to a `Tenant.slug` in the database (`@unique` on `VarChar(120)`). |
| 3 | `HotelConfig` is always **eagerly loaded** with tenant queries — any code consuming `req.tenant` expects `hotelConfig` to be available. |

### 5.2 User Roles

| # | Requirement |
|---|-------------|
| 4 | The system must support the `KIOSK_MACHINE` role in `UserRole`. This role identifies the kiosk device itself for auth. |
| 5 | Roles are scoped per-tenant: `@@unique([tenantId, email])`. |

### 5.3 Booking Idempotency

| # | Requirement |
|---|-------------|
| 6 | Bookings use a composite **idempotency key**: `{tenantId}:{sessionId}:{roomId}:{checkInDate}:{checkOutDate}:{guestNameLowerTrimmed}`. |
| 7 | The idempotency key has a **composite unique constraint**: `@@unique([tenantId, idempotencyKey])`. |
| 8 | If a booking with the same idempotency key already exists, the backend returns the existing booking ID instead of creating a duplicate. |

### 5.4 Booking Persistence

| # | Requirement |
|---|-------------|
| 9 | Bookings are created as `DRAFT` and promoted to `CONFIRMED` when intent is `CONFIRM_BOOKING`. |
| 10 | **Date conflict detection**: Before confirming, the system checks for overlapping `CONFIRMED` bookings on the same room type within a transaction. Returns `409 BOOKING_DATE_CONFLICT` on conflict. |
| 11 | The `roomType` FK uses `onDelete: Restrict` — a `RoomType` cannot be deleted while bookings reference it. |
| 12 | All booking mutations occur inside a **Prisma `$transaction`**. |

### 5.5 API Endpoints

| Method | Path                               | Tenant Resolution    | Purpose                    |
|--------|-------------------------------------|---------------------|----------------------------|
| `GET`  | `/health`                          | None                 | Health check               |
| `GET`  | `/api/tenant`                      | Header-based         | Probe tenant configration  |
| `GET`  | `/api/:tenantSlug/tenant`          | Path-based           | Probe tenant configuration |
| `GET`  | `/api/rooms`                       | Header-based         | List room types            |
| `GET`  | `/api/:tenantSlug/rooms`           | Path-based           | List room types            |
| `POST` | `/api/chat`                        | Header-based         | General LLM chat           |
| `POST` | `/api/:tenantSlug/chat`            | Path-based           | General LLM chat           |
| `POST` | `/api/chat/booking`                | Header-based         | Booking conversational chat|
| `POST` | `/api/:tenantSlug/chat/booking`    | Path-based           | Booking conversational chat|
| `WS`   | `ws://localhost:3001`              | Query param          | Voice Relay (STT via Deepgram) |

### 5.6 Request/Response Headers

| Header            | Direction   | Purpose                               |
|-------------------|-------------|---------------------------------------|
| `x-tenant-slug`   | Request     | Primary tenant identifier (header)    |
| `x-kiosk-tenant`  | Request     | Alternate tenant identifier (header)  |
| `x-request-id`    | Both        | Request tracing (auto-generated if absent) |

### 5.7 Privacy & Session Rules

| # | Requirement |
|---|-------------|
| 13 | Session memory (conversation history + booking slots) is **wiped** when `currentState` is `WELCOME` or `IDLE`. This is a privacy guard — the previous guest's data must not persist. |
| 14 | In-memory session store (Map). Production should use Redis. |
| 15 | General chat retains last 6 messages (3 exchanges). Booking chat retains last 10 messages (5 exchanges). |

### 5.8 Validation

| # | Requirement |
|---|-------------|
| 16 | Request body validation uses **Zod schemas** and operates in two modes controlled by `API_VALIDATION_MODE` env var: `"warn"` (log and pass-through) or `"enforce"` (reject with `400 VALIDATION_FAILED`). |
| 17 | LLM responses are validated via `LLMResponseSchema` / `BookingLLMResponseSchema` (Zod). Invalid LLM output falls back to predefined `FALLBACK_RESPONSE` / `BOOKING_FALLBACK`. |

### 5.9 WebSocket Voice Relay

| # | Requirement |
|---|-------------|
| 18 | WebSocket server runs on port `3001` (configurable via `PORT` env). HTTP server runs on port `3002` (configurable via `HTTP_PORT` env). |
| 19 | The voice relay accepts `sample_rate` as a query parameter (default: `48000` Hz). |
| 20 | The relay is a **pipe** — it does not interpret audio or transcripts. It forwards binary audio to Deepgram and JSON transcript results back to the browser. |

---

> [!CAUTION]
> **Schema Sync Rule**: If any field, type, or constraint in the Prisma schema changes, both the Kiosk backend AND any Admin/Dashboard system sharing the same database must update simultaneously. The `shared/contracts/` directory is the canonical interface — never derive types independently.
