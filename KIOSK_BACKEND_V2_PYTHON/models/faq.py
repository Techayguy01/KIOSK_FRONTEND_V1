"""
models/faq.py — SQLModel mirror of the shared `faqs` table.
"""
import uuid
from sqlalchemy import Column, String, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class FAQ(SQLModel, table=True):
    __tablename__ = "faqs"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False))
    question: str = Field(sa_column=Column(String))
    answer: str = Field(sa_column=Column(String))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, default=True))
