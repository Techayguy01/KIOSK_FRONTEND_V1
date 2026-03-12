CREATE TABLE IF NOT EXISTS room_instances (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    room_type_id UUID NOT NULL REFERENCES room_types(id),
    room_number VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_instances_tenant_type_room_number
    ON room_instances (tenant_id, room_type_id, room_number);

CREATE INDEX IF NOT EXISTS idx_room_instances_room_type
    ON room_instances (tenant_id, room_type_id, status);

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS assigned_room_id UUID NULL,
ADD COLUMN IF NOT EXISTS assigned_room_number VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_room_type_dates
    ON bookings (tenant_id, room_type_id, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_bookings_assigned_room_dates
    ON bookings (assigned_room_id, check_in_date, check_out_date);

INSERT INTO room_instances (id, tenant_id, room_type_id, room_number, status, created_at)
SELECT
    (
        SUBSTRING(md5(rt.id::text || '|room-instance') FROM 1 FOR 8) || '-' ||
        SUBSTRING(md5(rt.id::text || '|room-instance') FROM 9 FOR 4) || '-' ||
        SUBSTRING(md5(rt.id::text || '|room-instance') FROM 13 FOR 4) || '-' ||
        SUBSTRING(md5(rt.id::text || '|room-instance') FROM 17 FOR 4) || '-' ||
        SUBSTRING(md5(rt.id::text || '|room-instance') FROM 21 FOR 12)
    )::uuid,
    rt.tenant_id,
    rt.id,
    COALESCE(
        NULLIF(BTRIM(rt.code), ''),
        NULLIF(UPPER(REGEXP_REPLACE(BTRIM(rt.name), '[^A-Za-z0-9]+', '-', 'g')), ''),
        'ROOM-' || UPPER(SUBSTRING(rt.id::text FROM 1 FOR 6))
    ),
    'ACTIVE',
    COALESCE(rt.created_at, NOW())
FROM room_types rt
WHERE NOT EXISTS (
    SELECT 1
    FROM room_instances ri
    WHERE ri.room_type_id = rt.id
);
