"""
models/booking.py — SQLModel mirror of the V1 `bookings` table.
"""
import uuid
from typing import Optional
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Column, String, Integer, Numeric, Date, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class Booking(SQLModel, table=True):
    __tablename__ = "bookings"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    room_type_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    guest_name: str = Field(sa_column=Column(String(255)))
    check_in_date: date = Field(sa_column=Column(Date))
    check_out_date: date = Field(sa_column=Column(Date))
    adults: int = Field(sa_column=Column(Integer))
    children: Optional[int] = Field(default=0, sa_column=Column(Integer, nullable=True))
    nights: int = Field(sa_column=Column(Integer))
    total_price: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric, nullable=True))
    status: str = Field(default="CONFIRMED", sa_column=Column(String(20)))
    idempotency_key: Optional[str] = Field(default=None, sa_column=Column(String(190), nullable=True))
    payment_ref: Optional[str] = Field(default=None, sa_column=Column(String(120), nullable=True))
    checked_in_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    checkin_status: Optional[str] = Field(default=None, sa_column=Column(String(40), nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=True)))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
