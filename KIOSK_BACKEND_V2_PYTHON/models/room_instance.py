"""
models/room_instance.py - Physical room inventory used for booking allocation.
"""
import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class RoomInstance(SQLModel, table=True):
    __tablename__ = "room_instances"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    room_type_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    room_number: str = Field(sa_column=Column(String(64), nullable=False))
    status: str = Field(default="ACTIVE", sa_column=Column(String(20), nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
