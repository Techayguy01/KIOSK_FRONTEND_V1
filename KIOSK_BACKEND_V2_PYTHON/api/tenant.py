"""
api/tenant.py

Endpoint to resolve tenant info by slug — replaces the old Node.js /api/:slug/tenant route.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional

from core.database import get_session
from models.tenant import Tenant
from models.tenant_config import TenantConfig

router = APIRouter()

@router.get("/tenant")
async def get_tenant(
    slug: Optional[str] = Query(None, description="Tenant slug e.g. taj-mahal-palace"),
    session: AsyncSession = Depends(get_session)
):
    """
    Resolve tenant info by slug. Returns the shape the frontend expects: { tenant: {...} }
    """
    if not slug:
        raise HTTPException(status_code=400, detail="slug query param is required")

    try:
        result = await session.exec(select(Tenant).where(Tenant.slug == slug))
        tenant = result.first()

        if not tenant:
            raise HTTPException(status_code=404, detail=f"Tenant '{slug}' not found")

        config_result = await session.exec(
            select(TenantConfig).where(TenantConfig.tenant_id == tenant.id)
        )
        tenant_config = config_result.first()

        return {
            "tenant": {
                "id": str(tenant.id),
                "name": tenant.hotel_name,
                "slug": tenant.slug,
                "plan": "ENTERPRISE",
                "hotelConfig": {
                    "timezone": tenant_config.timezone,
                    "supportPhone": tenant_config.support_phone,
                    "checkInTime": tenant_config.check_in_time,
                    "checkOutTime": tenant_config.check_out_time,
                    "defaultLang": tenant_config.default_lang,
                    "availableLang": tenant_config.available_lang or [],
                    "welcomeMessage": tenant_config.welcome_message,
                    "supportEmail": tenant_config.support_email,
                    "logoUrl": tenant_config.logo_url,
                } if tenant_config else None,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[TenantAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch tenant info")
