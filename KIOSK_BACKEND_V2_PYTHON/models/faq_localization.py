"""
models/faq_localization.py - SQLModel mirror of the `faq_localizations` table.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class FAQLocalization(SQLModel, table=True):
    __tablename__ = "faq_localizations"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    faq_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), ForeignKey("faqs.id", ondelete="CASCADE"), nullable=False))
    lang_code: str = Field(sa_column=Column(String(16), nullable=False))
    localized_question: str = Field(sa_column=Column(Text, nullable=False))
    localized_answer: str = Field(sa_column=Column(Text, nullable=False))
    normalized_question: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
