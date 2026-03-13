"""
models/room.py — SQLModel mirror of the V1 `room_types` table.
"""
import uuid
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Column, String, Numeric, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlmodel import Field, SQLModel


class RoomType(SQLModel, table=True):
    __tablename__ = "room_types"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    name: str = Field(sa_column=Column(String(255)))
    code: str = Field(sa_column=Column(String(60)))
    price: Decimal = Field(sa_column=Column(Numeric))
    max_adults: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    max_children: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    max_total_guests: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    amenities: List[str] = Field(default_factory=list, sa_column=Column(ARRAY(String)))
    # Shared schema update: RoomType now stores Cloudinary URLs in an array column.
    # We map to the DB column `image_urls` explicitly.
    image_urls: List[str] = Field(
        default_factory=list,
        sa_column=Column("image_urls", ARRAY(String), nullable=True),
    )
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
