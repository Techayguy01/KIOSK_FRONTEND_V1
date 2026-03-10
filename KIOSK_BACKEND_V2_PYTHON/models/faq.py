"""
models/faq.py - SQLModel mirror of the tenant-scoped `faqs` table.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class FAQ(SQLModel, table=True):
    __tablename__ = "faqs"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    question: str = Field(sa_column=Column(String(500), nullable=False))
    answer: str = Field(sa_column=Column(Text, nullable=False))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, default=True, nullable=False))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
