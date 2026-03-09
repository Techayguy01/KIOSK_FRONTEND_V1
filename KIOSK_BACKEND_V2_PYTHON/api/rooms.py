"""
api/rooms.py

Endpoints for room data — supports lookup by tenant UUID or slug.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional

from core.database import get_session
from models.room import RoomType
from models.tenant import Tenant

router = APIRouter()

@router.get("/rooms")
async def get_rooms(
    tenant_id: Optional[str] = Query(None, description="The UUID of the tenant"),
    slug: Optional[str] = Query(None, description="The slug of the tenant e.g. taj-mahal-palace"),
    session: AsyncSession = Depends(get_session)
):
    """
    Fetch all available room types for a specific tenant.
    Accepts either tenant_id (UUID) or slug.
    """
    try:
        # Resolve slug to tenant_id if slug is provided
        if slug and not tenant_id:
            tenant_result = await session.exec(select(Tenant).where(Tenant.slug == slug))
            tenant = tenant_result.first()
            if not tenant:
                raise HTTPException(status_code=404, detail=f"Tenant with slug '{slug}' not found")
            tenant_id = tenant.id
            print(f"[RoomsAPI] Resolved slug '{slug}' → tenant_id '{tenant_id}'")

        if not tenant_id:
            raise HTTPException(status_code=400, detail="Either tenant_id or slug must be provided")

        statement = select(RoomType).where(RoomType.tenant_id == tenant_id)
        result = await session.exec(statement)
        rooms = result.all()

        print(f"[RoomsAPI] Found {len(rooms)} rooms for tenant {tenant_id}")

        normalized_rooms = [
            {
                "id": str(room.id),
                "name": room.name,
                "code": room.code,
                "price": float(room.price),
                "currency": "INR",
                "image": "",
                "features": room.amenities or [],
            }
            for room in rooms
        ]

        return {
            "rooms": normalized_rooms,
            # Legacy compatibility fields while old consumers are being retired.
            "success": True,
            "data": normalized_rooms,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[RoomsAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch rooms")
