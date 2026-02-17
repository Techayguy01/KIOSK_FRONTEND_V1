-- Phase 2: Persist booking transactions with tenant-safe idempotency support
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "check_out_date" DATE;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "adults" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "children" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "nights" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "total_price" DECIMAL(10,2);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "session_id" VARCHAR(120);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(190);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payment_ref" VARCHAR(120);

UPDATE "bookings" SET "check_out_date" = "check_in_date" WHERE "check_out_date" IS NULL;
UPDATE "bookings" SET "adults" = 1 WHERE "adults" IS NULL;
UPDATE "bookings" SET "nights" = 1 WHERE "nights" IS NULL;

ALTER TABLE "bookings" ALTER COLUMN "check_out_date" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "adults" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "nights" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_tenant_id_idempotency_key_key"
ON "bookings" ("tenant_id", "idempotency_key")
WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bookings_tenant_id_status_idx"
ON "bookings" ("tenant_id", "status");