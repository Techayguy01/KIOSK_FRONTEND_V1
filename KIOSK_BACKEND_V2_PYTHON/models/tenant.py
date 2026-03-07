"""
models/tenant.py — SQLModel mirror of the V1 `tenants` table.
"""
import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class Tenant(SQLModel, table=True):
    __tablename__ = "tenants"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    hotel_name: str = Field(sa_column=Column(String))
    slug: str = Field(sa_column=Column(String(100), unique=True))
    address: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    owner_user_id: Optional[uuid.UUID] = Field(default=None, sa_column=Column(UUID(as_uuid=True), nullable=True))
    plan_id: Optional[uuid.UUID] = Field(default=None, sa_column=Column(UUID(as_uuid=True), nullable=True))
    gstin: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    pan: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    status: bool = Field(default=True, sa_column=Column(Boolean, default=True))
    readable_id: Optional[str] = Field(default=None, sa_column=Column(String(20), nullable=True))
    image_url_1: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    image_url_2: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    image_url_3: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
