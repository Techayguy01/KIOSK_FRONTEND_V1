-- DB Hardening: integrity constraints + performance indexes

-- Booking integrity checks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_adults_positive') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "ck_bookings_adults_positive"
      CHECK ("adults" >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_children_non_negative') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "ck_bookings_children_non_negative"
      CHECK ("children" IS NULL OR "children" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_nights_positive') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "ck_bookings_nights_positive"
      CHECK ("nights" >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_total_price_non_negative') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "ck_bookings_total_price_non_negative"
      CHECK ("total_price" IS NULL OR "total_price" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_date_range') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "ck_bookings_date_range"
      CHECK ("check_out_date" > "check_in_date");
  END IF;
END $$;

-- Room price should never be negative
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_room_types_price_non_negative') THEN
    ALTER TABLE "room_types"
      ADD CONSTRAINT "ck_room_types_price_non_negative"
      CHECK ("price" >= 0);
  END IF;
END $$;

-- Query performance indexes
CREATE INDEX IF NOT EXISTS "bookings_tenant_id_check_in_date_idx"
ON "bookings" ("tenant_id", "check_in_date");

CREATE INDEX IF NOT EXISTS "bookings_tenant_room_type_status_idx"
ON "bookings" ("tenant_id", "room_type_id", "status");

CREATE INDEX IF NOT EXISTS "room_types_tenant_id_price_idx"
ON "room_types" ("tenant_id", "price");
