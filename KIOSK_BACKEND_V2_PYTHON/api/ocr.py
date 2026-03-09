"""
api/ocr.py

Phase 1 OCR + check-in lookup endpoint.
"""

from __future__ import annotations

from datetime import date, timedelta
from difflib import SequenceMatcher
import re
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.ocr_service import (
    NormalizedCropBox,
    OcrBadImageError,
    OcrEngineUnavailableError,
    OcrProcessingError,
    decode_image_data_url,
    get_ocr_engine_status,
    parse_identity_fields,
    run_ocr,
)
from models.booking import Booking
from models.room import RoomType
from models.tenant import Tenant

router = APIRouter()


class CropBoxPayload(BaseModel):
    x: float
    y: float
    width: float
    height: float


class OcrRequest(BaseModel):
    image_data_url: str = Field(alias="imageDataUrl")
    language: Optional[str] = "eng"
    crop_box: Optional[CropBoxPayload] = Field(default=None, alias="cropBox")

    class Config:
        populate_by_name = True


class OcrFields(BaseModel):
    fullName: Optional[str] = None
    documentNumber: Optional[str] = None
    dateOfBirth: Optional[str] = None
    yearOfBirth: Optional[str] = None
    documentType: Optional[str] = None


class OcrPayload(BaseModel):
    text: str
    confidence: float = 0.0
    fields: OcrFields


class MatchedBookingPayload(BaseModel):
    id: str
    guestName: str
    checkInDate: str
    checkOutDate: str
    status: str
    roomTypeId: str
    roomName: Optional[str] = None


class OcrResponse(BaseModel):
    ocr: OcrPayload
    matchedBooking: Optional[MatchedBookingPayload] = None
    multiplePossibleMatches: bool = False
    weakExtraction: bool = False
    extractionMessage: Optional[str] = None
    requestId: Optional[str] = None


def _error_response(code: str, message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
            }
        },
    )


def _normalize_name(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _tokenize_name(value: str) -> set[str]:
    tokens = [token for token in _normalize_name(value).split(" ") if len(token) >= 2]
    return set(tokens)


def _name_match_score(target: str, candidate: str) -> float:
    normalized_target = _normalize_name(target)
    normalized_candidate = _normalize_name(candidate)
    if not normalized_target or not normalized_candidate:
        return 0.0

    if normalized_target == normalized_candidate:
        return 1.0

    sequence_score = SequenceMatcher(None, normalized_target, normalized_candidate).ratio()
    target_tokens = _tokenize_name(normalized_target)
    candidate_tokens = _tokenize_name(normalized_candidate)
    if not target_tokens or not candidate_tokens:
        return sequence_score

    overlap = len(target_tokens & candidate_tokens) / max(len(target_tokens), len(candidate_tokens))
    first_name_bonus = 0.08 if normalized_target.split(" ")[0] == normalized_candidate.split(" ")[0] else 0.0
    return min(1.0, max(sequence_score, overlap) + first_name_bonus)


def _mask_document_number(document_number: Optional[str]) -> str:
    value = (document_number or "").strip()
    if not value:
        return "none"
    if len(value) <= 4:
        return "*" * len(value)
    return f"{'*' * (len(value) - 4)}{value[-4:]}"


def _text_snippet(value: str, limit: int = 120) -> str:
    compact = " ".join((value or "").split())
    if not compact:
        return ""
    return compact[:limit] + ("..." if len(compact) > limit else "")


def _assess_extraction_quality(fields: dict, confidence: float, raw_text: str) -> tuple[bool, Optional[str]]:
    full_name = (fields.get("fullName") or "").strip()
    document_number = (fields.get("documentNumber") or "").strip()
    dob = (fields.get("dateOfBirth") or "").strip()
    yob = (fields.get("yearOfBirth") or "").strip()
    document_type = (fields.get("documentType") or "UNKNOWN").strip().upper()
    text_length = len((raw_text or "").strip())
    has_birth_anchor = bool(dob or yob)

    def _plausible_name(value: str) -> bool:
        tokens = [token for token in re.split(r"\s+", value.strip()) if token]
        if len(tokens) < 2 or len(tokens) > 5:
            return False
        if any(len(token) < 2 for token in tokens):
            return False
        if not re.fullmatch(r"[A-Za-z ]{5,60}", value):
            return False
        blocked = {
            "government",
            "india",
            "aadhaar",
            "authority",
            "address",
            "male",
            "female",
            "birth",
            "year",
            "card",
            "uidai",
        }
        return not any(token.lower() in blocked for token in tokens)

    def _plausible_document_number(value: str, doc_type: str) -> bool:
        compact = re.sub(r"[\s-]+", "", value or "").upper()
        if not compact:
            return False
        if doc_type == "AADHAAR":
            return bool(re.fullmatch(r"[2-9]\d{11}", compact))
        if doc_type == "PASSPORT":
            return bool(re.fullmatch(r"[A-Z][0-9]{7}", compact))
        if doc_type == "DRIVER_LICENSE":
            return bool(re.fullmatch(r"[A-Z]{2}\d{2}\d{4}\d{7}", compact))
        return len(compact) >= 6

    has_name = _plausible_name(full_name)
    has_document_number = _plausible_document_number(document_number, document_type)
    has_known_document_type = document_type != "UNKNOWN"

    if document_type == "AADHAAR":
        if not has_name:
            return (
                True,
                "Aadhaar name could not be read clearly. Please keep the front of the card flat, avoid glare, and rescan.",
            )
        if not (has_document_number or has_birth_anchor):
            return (
                True,
                "Aadhaar details were incomplete. Please rescan with the full card inside the frame and text clearly visible.",
            )
        if confidence < 0.3 and text_length < 36:
            return (
                True,
                "Aadhaar text was too faint to verify. Please hold the card steady and closer to the camera.",
            )
        return False, None

    if not has_name and not (has_known_document_type and has_document_number and has_birth_anchor):
        return (
            True,
            "We could not clearly read your identity details. Please rescan with better lighting and keep the ID inside the frame.",
        )

    if not has_known_document_type:
        return (
            True,
            "The document type could not be verified. Please align the full ID inside the frame and retry.",
        )

    if has_name and not (has_document_number or has_birth_anchor) and confidence < 0.45:
        return (
            True,
            "The scan captured a partial identity only. Please rescan with clearer text and minimal glare.",
        )

    if confidence < 0.2 and not (has_name and (has_document_number or has_birth_anchor)):
        return (
            True,
            "ID text was too faint to verify confidently. Please rescan in steadier lighting.",
        )

    if text_length < 24 and not (has_name and (has_document_number or has_birth_anchor)):
        return (
            True,
            "The scan captured very little text. Please hold the ID closer and rescan.",
        )

    return False, None


async def _resolve_tenant_id(
    session: AsyncSession,
    tenant_slug: Optional[str],
) -> Optional[UUID]:
    if not tenant_slug:
        return None
    result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = result.first()
    if not tenant:
        return None
    return tenant.id


async def _lookup_booking_match(
    session: AsyncSession,
    tenant_id: Optional[UUID],
    extracted_full_name: Optional[str],
) -> tuple[Optional[MatchedBookingPayload], bool, int]:
    if not tenant_id or not extracted_full_name:
        return None, False, 0

    today = date.today()
    window_start = today - timedelta(days=1)
    window_end = today + timedelta(days=7)

    stmt = select(Booking).where(
        Booking.tenant_id == tenant_id,
        Booking.status == "CONFIRMED",
        Booking.check_out_date >= window_start,
        Booking.check_in_date <= window_end,
    )
    result = await session.exec(stmt)
    bookings = result.all()
    if not bookings:
        return None, False, 0

    target_name = _normalize_name(extracted_full_name)
    scored: list[tuple[float, int, Booking]] = []
    for booking in bookings:
        guest_name = _normalize_name(booking.guest_name)
        if not guest_name:
            continue
        name_score = _name_match_score(target_name, guest_name)
        if name_score < 0.76:
            continue
        if not (_tokenize_name(target_name) & _tokenize_name(guest_name)):
            # Conservative guard: require at least one overlapping name token.
            continue
        day_distance = abs((booking.check_in_date - today).days)
        recency_bonus = 0.06 if day_distance <= 1 else (0.03 if day_distance <= 3 else 0.0)
        final_score = min(1.0, name_score + recency_bonus)
        if final_score < 0.84:
            continue
        scored.append((final_score, day_distance, booking))

    if not scored:
        return None, False, 0

    scored.sort(key=lambda item: (-item[0], item[1]))
    if len(scored) > 1:
        # Conservative Phase 1 rule: do not auto-pick if multiple plausible matches.
        top_score = scored[0][0]
        second_score = scored[1][0]
        if abs(top_score - second_score) <= 0.06:
            return None, True, len(scored)

    chosen_booking = scored[0][2]
    room_name = None
    room = await session.get(RoomType, chosen_booking.room_type_id)
    if room:
        room_name = room.name

    payload = MatchedBookingPayload(
        id=str(chosen_booking.id),
        guestName=chosen_booking.guest_name,
        checkInDate=chosen_booking.check_in_date.isoformat(),
        checkOutDate=chosen_booking.check_out_date.isoformat(),
        status=chosen_booking.status,
        roomTypeId=str(chosen_booking.room_type_id),
        roomName=room_name,
    )
    return payload, False, len(scored)


@router.post("/ocr", response_model=OcrResponse)
async def run_ocr_endpoint(
    req: OcrRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
):
    request_id = str(uuid4())
    print(
        "[OCR] request "
        f"request_id={request_id} "
        f"tenant_slug={x_tenant_slug or 'none'} "
        f"language={req.language or 'eng'}"
    )
    try:
        engine_status = get_ocr_engine_status()
        if not engine_status.get("available"):
            message = str(engine_status.get("message") or "OCR engine is not available.")
            cmd = str(engine_status.get("tesseract_cmd") or "unset")
            print(
                "[OCR] engine_unavailable "
                f"request_id={request_id} "
                f"cmd={cmd} "
                f"reason={message}"
            )
            return _error_response(
                "OCR_ENGINE_NOT_AVAILABLE",
                f"{message} (resolved_cmd={cmd})",
                status_code=503,
            )

        image_bytes = decode_image_data_url(req.image_data_url)
        crop_box = (
            NormalizedCropBox(
                x=req.crop_box.x,
                y=req.crop_box.y,
                width=req.crop_box.width,
                height=req.crop_box.height,
            )
            if req.crop_box
            else None
        )
        text, confidence = run_ocr(
            image_bytes=image_bytes,
            language=req.language or "eng",
            crop_box=crop_box,
        )
        fields = parse_identity_fields(text)
        weak_extraction, extraction_message = _assess_extraction_quality(fields, confidence, text)
        print(
            "[OCR] extracted "
            f"request_id={request_id} "
            f"text_snippet='{_text_snippet(text)}' "
            f"full_name={fields.get('fullName') or 'none'} "
            f"document_type={fields.get('documentType') or 'UNKNOWN'} "
            f"document_number={_mask_document_number(fields.get('documentNumber'))} "
            f"year_of_birth={fields.get('yearOfBirth') or 'none'} "
            f"weak_extraction={weak_extraction} "
            f"confidence={confidence}"
        )

        tenant_id = await _resolve_tenant_id(session, x_tenant_slug)
        matched_booking: Optional[MatchedBookingPayload] = None
        multiple_possible = False
        match_count = 0
        if not weak_extraction:
            matched_booking, multiple_possible, match_count = await _lookup_booking_match(
                session=session,
                tenant_id=tenant_id,
                extracted_full_name=fields.get("fullName"),
            )

        print(
            "[OCR] result "
            f"request_id={request_id} "
            f"tenant_id={tenant_id or 'none'} "
            f"match_candidates={match_count} "
            f"matched_booking={matched_booking.id if matched_booking else 'none'} "
            f"multiple_possible={multiple_possible}"
        )

        return OcrResponse(
            ocr=OcrPayload(
                text=text,
                confidence=confidence,
                fields=OcrFields(**fields),
            ),
            matchedBooking=matched_booking,
            multiplePossibleMatches=multiple_possible,
            weakExtraction=weak_extraction,
            extractionMessage=extraction_message,
            requestId=request_id,
        )
    except OcrBadImageError as exc:
        print(f"[OCR] bad_image request_id={request_id} reason={exc}")
        return _error_response("OCR_BAD_IMAGE", str(exc), status_code=400)
    except OcrEngineUnavailableError as exc:
        print(f"[OCR] engine_unavailable request_id={request_id} reason={exc}")
        return _error_response("OCR_ENGINE_NOT_AVAILABLE", str(exc), status_code=503)
    except OcrProcessingError as exc:
        print(f"[OCR] processing_failed request_id={request_id} reason={exc}")
        return _error_response("OCR_PROCESSING_FAILED", str(exc), status_code=422)
    except Exception as exc:
        print(f"[OCR] failure request_id={request_id} reason={exc}")
        return _error_response("OCR_FAILED", str(exc), status_code=500)
