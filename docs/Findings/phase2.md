Booking table already exists.
So in Phase 2, we are mostly doing behavior + a few schema additions, not creating booking from scratch.

What exists right now in DB (Booking)
Current columns:

id

tenant_id

guest_name

check_in_date

status (DRAFT / CONFIRMED)

room_type_id

created_at

updated_at

So today: 8 columns in bookings.

What Phase 2 will do exactly
1) Persist booking from chat flow
When booking conversation is complete, backend will INSERT into bookings with:

tenant_id (from middleware-resolved tenant)
guest_name
check_in_date
room_type_id
status = DRAFT (or CONFIRMED depending on your flow choice)
2) Most likely schema additions (recommended)
To match your current multi-turn booking data, we should add:

check_out_date (Date)
adults (Int)
children (Int, nullable)
nights (Int)
total_price (Decimal)
idempotency_key (String, unique per tenant)
session_id (String, optional trace)
If we add all these, bookings go from 8 -> 15 columns.

3) Duplicate protection
Add unique constraint like:

@@unique([tenantId, idempotencyKey])
This prevents duplicate rows when user retries/clicks confirm twice.
4) Payment mock compatibility
No real gateway needed now:

create booking as DRAFT
on mock success, update status to CONFIRMED