"""
models/tenant_config.py - SQLModel mirror of the `tenant_configs` table.
"""
import uuid
from datetime import datetime
from typing import Optional, List, Any
from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlmodel import Field, SQLModel


class TenantConfig(SQLModel, table=True):
    __tablename__ = "tenant_configs"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    timezone: str = Field(sa_column=Column(String, nullable=False))
    check_in_time: str = Field(sa_column=Column(String, nullable=False))
    check_out_time: str = Field(sa_column=Column(String, nullable=False))
    default_lang: str = Field(sa_column=Column(String, nullable=False))
    welcome_message: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    logo_url: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    support_phone: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    support_email: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    available_lang: List[str] = Field(default_factory=list, sa_column=Column(ARRAY(String), nullable=False))
