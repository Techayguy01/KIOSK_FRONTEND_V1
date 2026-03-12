"""
api/rooms.py

Endpoints for room data — supports lookup by tenant UUID or slug.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from sqlalchemy import text
from typing import Optional
import json

from core.database import get_session
from models.tenant import Tenant

router = APIRouter()


def _normalize_image_list(value: object) -> list[str]:
    """
    Normalize DB image fields into a clean list of URLs.
    Supports:
    - Postgres text[] (list/tuple)
    - JSON-encoded text array
    - Comma-separated text
    - Single URL string
    """
    if value is None:
        return []

    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []

        # Try JSON array string first.
        if raw.startswith("[") and raw.endswith("]"):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(v).strip() for v in parsed if str(v).strip()]
            except Exception:
                pass

        # Support comma-separated values.
        if "," in raw:
            return [part.strip() for part in raw.split(",") if part.strip()]

        return [raw]

    return [str(value).strip()] if str(value).strip() else []

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

        # Schema-tolerant read:
        # Support both legacy `image_url` and new `imageUrls` columns.
        available_columns_result = await session.exec(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'room_types'
                """
            )
        )
        available_columns = {row[0] for row in available_columns_result.all()}

        has_image_urls_array_camel = "imageUrls" in available_columns
        has_image_urls_array_snake = "image_urls" in available_columns
        has_image_url_single_snake = "image_url" in available_columns
        has_image_url_single_camel = "imageUrl" in available_columns
        has_image_single_plain = "image" in available_columns

        select_fields = [
            "id",
            "name",
            "code",
            "price",
            "amenities",
        ]
        if has_image_urls_array_camel:
            select_fields.append('"imageUrls" AS image_urls_array')
        if has_image_urls_array_snake:
            select_fields.append("image_urls AS image_urls_array_snake")
        if has_image_url_single_snake:
            select_fields.append("image_url AS image_url_single")
        if has_image_url_single_camel:
            select_fields.append('"imageUrl" AS image_url_single_camel')
        if has_image_single_plain:
            select_fields.append("image AS image_single_plain")

        rooms_query = f"""
            SELECT {", ".join(select_fields)}
            FROM room_types
            WHERE tenant_id = CAST(:tenant_id AS uuid)
        """
        rooms_result = await session.exec(
            text(rooms_query),
            params={"tenant_id": str(tenant_id)},
        )
        rooms = rooms_result.all()

        print(f"[RoomsAPI] Found {len(rooms)} rooms for tenant {tenant_id}")

        normalized_rooms = []
        for room in rooms:
            row = dict(room._mapping)
            image_urls = _normalize_image_list(row.get("image_urls_array"))
            image_urls_snake = _normalize_image_list(row.get("image_urls_array_snake"))
            image_url_single = str(row.get("image_url_single") or "").strip()
            image_url_single_camel = str(row.get("image_url_single_camel") or "").strip()
            image_single_plain = str(row.get("image_single_plain") or "").strip()

            for url in image_urls_snake:
                if url not in image_urls:
                    image_urls.append(url)
            if image_url_single and image_url_single not in image_urls:
                image_urls.append(image_url_single)
            if image_url_single_camel and image_url_single_camel not in image_urls:
                image_urls.append(image_url_single_camel)
            if image_single_plain and image_single_plain not in image_urls:
                image_urls.append(image_single_plain)

            normalized_rooms.append(
                {
                    "id": str(row.get("id")),
                    "name": row.get("name"),
                    "code": row.get("code"),
                    "price": float(row.get("price")),
                    "currency": "INR",
                    "image": image_urls[0] if image_urls else "",
                    "image_url": image_url_single,
                    "imageUrl": image_url_single_camel,
                    "imageUrls": image_urls,
                    "features": row.get("amenities") or [],
                }
            )

        if normalized_rooms:
            sample_room = normalized_rooms[0]
            print(
                "[RoomsAPI] Image sample "
                f"id={sample_room.get('id')} "
                f"image='{sample_room.get('image')}' "
                f"image_url='{sample_room.get('image_url')}' "
                f"imageUrl='{sample_room.get('imageUrl')}' "
                f"imageUrlsCount={len(sample_room.get('imageUrls') or [])}"
            )

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
