from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from models.booking import Booking
from models.tenant import Tenant

router = APIRouter()


def _parse_uuid(raw_value: Optional[str]) -> Optional[UUID]:
    if not raw_value:
        return None
    try:
        return UUID(str(raw_value))
    except Exception:
        return None


async def _resolve_tenant_uuid(
    session: AsyncSession,
    tenant_id: Optional[str],
    tenant_slug: Optional[str],
) -> Optional[UUID]:
    if tenant_slug:
        tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = tenant_result.first()
        if tenant:
            return tenant.id

    return _parse_uuid(tenant_id)


class CheckInConfirmRequest(BaseModel):
    booking_id: str = Field(alias="bookingId")
    tenant_id: Optional[str] = Field(default=None, alias="tenantId")
    tenant_slug: Optional[str] = Field(default=None, alias="tenantSlug")
    verified_name: str = Field(alias="verifiedName")
    document_type: str = Field(alias="documentType")
    document_last4: str = Field(alias="documentLast4")
    session_id: str = Field(alias="sessionId")

    class Config:
        populate_by_name = True


class CheckInConfirmResponse(BaseModel):
    success: bool
    booking_id: str = Field(alias="bookingId")
    checkin_status: str = Field(alias="checkinStatus")
    checked_in_at: datetime = Field(alias="checkedInAt")

    class Config:
        populate_by_name = True


@router.post("/checkin/confirm", response_model=CheckInConfirmResponse)
async def confirm_checkin(
    req: CheckInConfirmRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
):
    booking_uuid = _parse_uuid(req.booking_id)
    if not booking_uuid:
        raise HTTPException(status_code=400, detail="Invalid booking_id.")

    requested_tenant_slug = req.tenant_slug or x_tenant_slug
    resolved_tenant_uuid = await _resolve_tenant_uuid(session, req.tenant_id, requested_tenant_slug)

    stmt = select(Booking).where(Booking.id == booking_uuid)
    if resolved_tenant_uuid:
        stmt = stmt.where(Booking.tenant_id == resolved_tenant_uuid)

    booking_result = await session.exec(stmt)
    booking = booking_result.first()
    if not booking:
        raise HTTPException(status_code=404, detail="Matched booking not found for check-in confirmation.")

    now = datetime.utcnow()
    booking.checked_in_at = now
    booking.checkin_status = "CHECKED_IN"
    booking.updated_at = now

    print(
        "[CheckInAPI] confirm "
        f"session={req.session_id} "
        f"booking_id={req.booking_id} "
        f"tenant={resolved_tenant_uuid or req.tenant_id or requested_tenant_slug or 'unknown'} "
        f"verified_name={req.verified_name} "
        f"document_type={req.document_type} "
        f"document_last4={req.document_last4}"
    )

    try:
        session.add(booking)
        await session.commit()
        await session.refresh(booking)
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to persist check-in confirmation: {exc}") from exc

    return CheckInConfirmResponse(
        success=True,
        bookingId=str(booking.id),
        checkinStatus=booking.checkin_status or "CHECKED_IN",
        checkedInAt=booking.checked_in_at or now,
    )
