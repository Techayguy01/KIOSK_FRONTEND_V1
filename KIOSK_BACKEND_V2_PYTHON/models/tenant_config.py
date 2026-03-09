"""
models/tenant_config.py — SQLModel mirror of the shared `tenant_configs` table.
"""
import uuid
from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Field, SQLModel


class TenantConfig(SQLModel, table=True):
    __tablename__ = "tenant_configs"

    id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4))
    tenant_id: uuid.UUID = Field(sa_column=Column(UUID(as_uuid=True), nullable=False))
    support_phone: str = Field(sa_column=Column(String))
