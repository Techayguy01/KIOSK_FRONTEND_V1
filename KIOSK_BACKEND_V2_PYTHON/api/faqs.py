"""
api/faqs.py

Tenant-isolated FAQ listing endpoint for frontend IndexedDB prewarm.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.voice import normalize_language_code
from models.faq import FAQ
from models.faq_localization import FAQLocalization
from models.tenant import Tenant
from models.tenant_config import TenantConfig
from services.faq_localization_service import ensure_faq_localizations

router = APIRouter()


@router.get("/faqs")
async def list_faqs(
    slug: Optional[str] = Query(default=None, description="Tenant slug"),
    tenant_id: Optional[str] = Query(default=None, description="Tenant UUID"),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
    session: AsyncSession = Depends(get_session),
):
    tenant_slug = (slug or x_tenant_slug or "").strip()
    requested_tenant_id = (tenant_id or "").strip()

    if not tenant_slug and not requested_tenant_id:
        raise HTTPException(status_code=400, detail="tenant slug or tenant_id is required")

    tenant = None
    if requested_tenant_id:
        try:
            tenant_uuid = uuid.UUID(requested_tenant_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="tenant_id must be a valid UUID") from exc

        tenant_id_result = await session.exec(select(Tenant).where(Tenant.id == tenant_uuid))
        tenant = tenant_id_result.first()
        if not tenant:
            raise HTTPException(status_code=404, detail=f"Tenant '{requested_tenant_id}' not found")

    if tenant_slug:
        tenant_slug_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant_from_slug = tenant_slug_result.first()
        if not tenant_from_slug:
            raise HTTPException(status_code=404, detail=f"Tenant '{tenant_slug}' not found")
        if tenant and tenant.id != tenant_from_slug.id:
            raise HTTPException(status_code=400, detail="tenant_id and slug refer to different tenants")
        tenant = tenant_from_slug

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant_config_result = await session.exec(
        select(TenantConfig).where(TenantConfig.tenant_id == tenant.id)
    )
    tenant_config = tenant_config_result.first()
    active_language = normalize_language_code(
        tenant_config.default_lang if tenant_config else "en"
    )

    faq_result = await session.exec(
        select(FAQ)
        .where(FAQ.tenant_id == tenant.id, FAQ.is_active.is_(True))
        .order_by(FAQ.updated_at.desc())
    )
    faqs = faq_result.all()
    changed = False
    available_languages = tenant_config.available_lang if tenant_config else [active_language]
    for faq in faqs:
        changed = await ensure_faq_localizations(
            session,
            faq,
            available_languages=available_languages,
            requested_language=active_language,
        ) or changed
    if changed:
        await session.commit()

    faq_ids = [faq.id for faq in faqs]
    localization_map: dict[tuple[str, str], FAQLocalization] = {}
    if faq_ids:
        localization_result = await session.exec(
            select(FAQLocalization).where(FAQLocalization.faq_id.in_(faq_ids))
        )
        localization_map = {
            (str(localization.faq_id), normalize_language_code(localization.lang_code)): localization
            for localization in localization_result.all()
        }

    return {
        "tenantId": str(tenant.id),
        "tenantSlug": tenant.slug,
        "langCode": active_language,
        "count": len(faqs),
        "faqs": [
            {
                "id": str(faq.id),
                "tenant_id": str(faq.tenant_id),
                "tenant_slug": tenant.slug,
                "lang_code": active_language,
                "question": (
                    localization_map.get((str(faq.id), active_language)).localized_question
                    if localization_map.get((str(faq.id), active_language))
                    else faq.question
                ),
                "answer": (
                    localization_map.get((str(faq.id), active_language)).localized_answer
                    if localization_map.get((str(faq.id), active_language))
                    else faq.answer
                ),
                "is_active": bool(faq.is_active),
                "updated_at": faq.updated_at.isoformat() if faq.updated_at else None,
            }
            for faq in faqs
        ],
    }
