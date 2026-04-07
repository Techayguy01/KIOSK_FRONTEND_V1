ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS assigned_room_id UUID NULL;

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS assigned_room_number VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_room_type_dates
    ON public.bookings (tenant_id, room_type_id, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_bookings_assigned_room_dates
    ON public.bookings (assigned_room_id, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_rooms_tenant_type_operational_status
    ON public.rooms (tenant_id, room_type_id, operational_status, room_number);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'rooms'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'assigned_room_id'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bookings_assigned_room_id_fkey'
    ) THEN
        ALTER TABLE public.bookings
        ADD CONSTRAINT bookings_assigned_room_id_fkey
        FOREIGN KEY (assigned_room_id)
        REFERENCES public.rooms(id)
        ON DELETE SET NULL;
    END IF;
END $$;
