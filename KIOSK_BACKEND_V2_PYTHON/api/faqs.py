"""
api/faqs.py

Tenant-isolated FAQ listing endpoint for frontend IndexedDB prewarm.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from models.faq import FAQ
from models.tenant import Tenant

router = APIRouter()


@router.get("/faqs")
async def list_faqs(
    slug: Optional[str] = Query(default=None, description="Tenant slug"),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
    session: AsyncSession = Depends(get_session),
):
    tenant_slug = (slug or x_tenant_slug or "").strip()
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="tenant slug is required")

    tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = tenant_result.first()
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant '{tenant_slug}' not found")

    faq_result = await session.exec(
        select(FAQ)
        .where(FAQ.tenant_id == tenant.id, FAQ.is_active.is_(True))
        .order_by(FAQ.updated_at.desc())
    )
    faqs = faq_result.all()

    return {
        "tenantId": str(tenant.id),
        "tenantSlug": tenant.slug,
        "count": len(faqs),
        "faqs": [
            {
                "id": str(faq.id),
                "tenant_id": str(faq.tenant_id),
                "tenant_slug": tenant.slug,
                "question": faq.question,
                "answer": faq.answer,
                "is_active": bool(faq.is_active),
                "updated_at": faq.updated_at.isoformat() if faq.updated_at else None,
            }
            for faq in faqs
        ],
    }

