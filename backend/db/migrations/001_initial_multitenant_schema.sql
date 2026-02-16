-- 001_initial_multitenant_schema.sql
-- Purpose: Introduce multi-tenant relational schema from backend mock and in-memory structures.
-- Target: PostgreSQL

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- Tenancy Foundation
-- =========================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(120) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Hotel Configuration (backend/src/context/hotelData.ts)
-- =========================================================
CREATE TABLE hotel_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    check_in_start TIME NOT NULL,
    check_out_end TIME NOT NULL,
    support_phone VARCHAR(40) NOT NULL,
    location VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hotel_configs_tenant UNIQUE (tenant_id)
);

CREATE TABLE hotel_amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hotel_config_id UUID NOT NULL REFERENCES hotel_configs(id) ON DELETE CASCADE,
    amenity VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Room Inventory (backend/src/context/roomInventory.ts)
-- =========================================================
CREATE TABLE room_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    price_per_night NUMERIC(10, 2) NOT NULL,
    max_adults INTEGER NOT NULL,
    max_children INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_room_types_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE room_type_amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Chat Session Memory (backend/src/routes/chat.ts)
-- =========================================================
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_key VARCHAR(255) NOT NULL,
    current_state VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chat_sessions_tenant_key UNIQUE (tenant_id, session_key)
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Booking Session Memory (backend/src/routes/bookingChat.ts)
-- =========================================================
CREATE TABLE booking_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_key VARCHAR(255) NOT NULL,
    current_state VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_booking_sessions_tenant_key UNIQUE (tenant_id, session_key)
);

CREATE TABLE booking_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_session_id UUID NOT NULL REFERENCES booking_sessions(id) ON DELETE CASCADE,
    room_type_id UUID REFERENCES room_types(id) ON DELETE SET NULL,
    adults INTEGER,
    children INTEGER,
    check_in_date DATE,
    check_out_date DATE,
    guest_name VARCHAR(255),
    nights INTEGER,
    total_price NUMERIC(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_booking_slots_tenant_session UNIQUE (tenant_id, booking_session_id),
    CONSTRAINT ck_booking_slots_adults CHECK (adults IS NULL OR adults >= 0),
    CONSTRAINT ck_booking_slots_children CHECK (children IS NULL OR children >= 0),
    CONSTRAINT ck_booking_slots_nights CHECK (nights IS NULL OR nights >= 0),
    CONSTRAINT ck_booking_slots_total_price CHECK (total_price IS NULL OR total_price >= 0)
);

CREATE TABLE booking_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_session_id UUID NOT NULL REFERENCES booking_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Indexes
-- =========================================================
CREATE INDEX idx_hotel_configs_tenant_id ON hotel_configs(tenant_id);
CREATE INDEX idx_hotel_amenities_tenant_id ON hotel_amenities(tenant_id);
CREATE INDEX idx_hotel_amenities_hotel_config_id ON hotel_amenities(hotel_config_id);

CREATE INDEX idx_room_types_tenant_id ON room_types(tenant_id);
CREATE INDEX idx_room_type_amenities_tenant_id ON room_type_amenities(tenant_id);
CREATE INDEX idx_room_type_amenities_room_type_id ON room_type_amenities(room_type_id);

CREATE INDEX idx_chat_sessions_tenant_id ON chat_sessions(tenant_id);
CREATE INDEX idx_chat_messages_tenant_id ON chat_messages(tenant_id);
CREATE INDEX idx_chat_messages_chat_session_id ON chat_messages(chat_session_id);

CREATE INDEX idx_booking_sessions_tenant_id ON booking_sessions(tenant_id);
CREATE INDEX idx_booking_slots_tenant_id ON booking_slots(tenant_id);
CREATE INDEX idx_booking_slots_booking_session_id ON booking_slots(booking_session_id);
CREATE INDEX idx_booking_slots_room_type_id ON booking_slots(room_type_id);
CREATE INDEX idx_booking_messages_tenant_id ON booking_messages(tenant_id);
CREATE INDEX idx_booking_messages_booking_session_id ON booking_messages(booking_session_id);

COMMIT;
