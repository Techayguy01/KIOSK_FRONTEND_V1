"""
seed_tenant.py — Seed the database with the taj-mahal-palace tenant.

Usage:
    python seed_tenant.py
"""

import asyncio
import uuid
from datetime import datetime, timezone

from core.database import engine, AsyncSessionLocal
from models.tenant import Tenant
from sqlmodel import select


async def seed():
    if not AsyncSessionLocal:
        print("❌ DATABASE_URL not set. Check your .env file.")
        return

    async with AsyncSessionLocal() as session:
        # Check if already seeded
        result = await session.exec(select(Tenant).where(Tenant.slug == "taj-mahal-palace"))
        existing = result.first()
        if existing:
            print(f"✅ Tenant '{existing.hotel_name}' (slug: {existing.slug}) already exists.")
            return

        tenant = Tenant(
            id=uuid.uuid4(),
            hotel_name="Taj Mahal Palace",
            slug="taj-mahal-palace",
            address="Apollo Bunder, Colaba, Mumbai, Maharashtra 400001",
            status=True,
            readable_id="TMP-001",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(tenant)
        await session.commit()
        print(f"✅ Seeded tenant: {tenant.hotel_name} (slug: {tenant.slug})")


if __name__ == "__main__":
    asyncio.run(seed())
