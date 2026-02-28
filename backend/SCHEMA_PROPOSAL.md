# Kiosk Schema Additions Proposal

To support the core multi-tenant booking flow of the Kiosk MVP, the frontend requires the addition of two specific tables to the current "Bible Schema" hosted on Neon DB.

We have explicitly excluded fleet-management tables (`kiosk_devices`, `kiosk_sessions`) and tenant operational settings (`hotel_configs`) from this proposal to reduce implementation overhead, as data isolation is already fully satisfied via the existing `Tenant.slug` lookup.

## Proposed Additions

### 1. `room_types`
Stores the rooms that a hotel makes available for booking via the kiosk.

| Column | Type | Constraints | Context |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | Primary Key | |
| `tenant_id` | `UUID` | Foreign Key (-> `tenants.id`) | Cascades |
| `name` | `VARCHAR(255)` | | e.g. "Ocean View Suite" |
| `code` | `VARCHAR(60)` | | e.g. "OCEAN_VIEW" (Used by LLM) |
| `price` | `DECIMAL(10, 2)` | | Nightly base rate |
| `amenities` | `TEXT[]` | | e.g. `["WiFi", "Balcony"]` |
| `created_at` | `TIMESTAMP` | Default Now | |
| `updated_at` | `TIMESTAMP` | Allows Null | |

**Indexes/Uniques:**
* `UNIQUE (tenant_id, code)`: A hotel cannot have two room types with the exact same machine code.
* `INDEX (tenant_id)`: Quick lookups by hotel.

---

### 2. `bookings`
Stores the actual reservations made by users on the kiosk.

| Column | Type | Constraints | Context |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | Primary Key | |
| `tenant_id` | `UUID` | Foreign Key (-> `tenants.id`) | Cascades |
| `room_type_id`| `UUID` | Foreign Key (-> `room_types.id`) | Restrict Delete |
| `guest_name` | `VARCHAR(255)` | | First/Last |
| `check_in_date`| `DATE` | | |
| `check_out_date`| `DATE`| | |
| `adults` | `INTEGER` | | |
| `children` | `INTEGER` | Allows Null | |
| `nights` | `INTEGER` | | |
| `total_price` | `DECIMAL(10, 2)` | Allows Null | Pre-calculated total |
| `status` | `ENUM` | Default `'DRAFT'` | `DRAFT`, `CONFIRMED` |
| `idempotency_key`| `VARCHAR(190)`| Allows Null | To prevent double-booking |
| `payment_ref` | `VARCHAR(120)` | Allows Null | Stripe/Razorpay ref |
| `created_at` | `TIMESTAMP` | Default Now | |
| `updated_at` | `TIMESTAMP` | Allows Null | |

**Indexes/Uniques:**
* `UNIQUE (tenant_id, idempotency_key)`: Prevents accidental duplicated bookings from network retries.
* `INDEX (tenant_id, status)`: For querying active vs past reservations per hotel.
* `INDEX (room_type_id)`: To find all bookings for a specific physical room type.

---

## Next Steps for Backend Team
1. Apply these two tables to the Neon Database `public` schema.
2. The Frontend Mock service layer uses data structures strictly matching this schema. Once applied, we can disable the mock flag and integrate live.
