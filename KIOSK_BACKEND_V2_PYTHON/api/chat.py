"""
api/chat.py

The main chat endpoint that the React frontend calls.
Receives a transcript and current UI state, runs it through LangGraph, and returns
the speech response and next UI screen.
"""

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field
from typing import Optional, get_args
from uuid import UUID
from urllib.parse import urlparse
from agent.graph import kiosk_agent
from agent.state import KioskState, ConversationTurn, RoomInventoryItem, UIScreen
from core.voice import normalize_language_code
from core.database import get_session
from core import database as database_runtime
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from models.tenant import Tenant
from models.room import RoomType
from services.faq_service import (
    FAQ_MATCH_THRESHOLD,
    find_best_faq_match,
    is_faq_candidate_query,
    normalize_faq_query,
)

router = APIRouter()

# In-memory session store (replace with Redis in production)
_sessions: dict[str, KioskState] = {}
_persisted_booking_by_session: dict[str, str] = {}

SLOT_NAME_MAP = {
    "room_type": "roomType",
    "adults": "adults",
    "children": "children",
    "check_in_date": "checkInDate",
    "check_out_date": "checkOutDate",
    "guest_name": "guestName",
}

UI_SCREEN_VALUES = {value for value in get_args(UIScreen)}
UI_STATE_ALIASES = {
    "AI-CHAT": "AI_CHAT",
    "AICHAT": "AI_CHAT",
    "MANUAL-MENU": "MANUAL_MENU",
    "MANUALMENU": "MANUAL_MENU",
    "SCAN-ID": "SCAN_ID",
    "ID-VERIFY": "ID_VERIFY",
    "IDVERIFY": "ID_VERIFY",
    "CHECK-IN-SUMMARY": "CHECK_IN_SUMMARY",
    "CHECKINSUMMARY": "CHECK_IN_SUMMARY",
    "ROOMSELECT": "ROOM_SELECT",
    "BOOKINGCOLLECT": "BOOKING_COLLECT",
    "BOOKINGSUMMARY": "BOOKING_SUMMARY",
    "KEY-DISPENSING": "KEY_DISPENSING",
}

FAQ_BLOCKED_SCREENS = {
    "SCAN_ID",
    "ID_VERIFY",
    "CHECK_IN_SUMMARY",
    "ROOM_SELECT",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "KEY_DISPENSING",
    "COMPLETE",
}


def _to_contract_slot_name(slot_name: Optional[str]) -> Optional[str]:
    if not slot_name:
        return None
    return SLOT_NAME_MAP.get(slot_name, slot_name)


def _parse_uuid(raw_value: Optional[str]) -> Optional[UUID]:
    if not raw_value:
        return None
    try:
        return UUID(str(raw_value))
    except Exception:
        return None


def _resolve_room_type_uuid(
    selected_room_payload: Optional[dict],
    room_type_slot_value: Optional[str],
    room_inventory: list[dict],
) -> Optional[UUID]:
    selected_room_id = None
    if selected_room_payload:
        selected_room_id = selected_room_payload.get("id")
    parsed_selected_room_id = _parse_uuid(selected_room_id)
    if parsed_selected_room_id:
        return parsed_selected_room_id

    normalized_room_hint = (room_type_slot_value or "").strip().lower()
    if not normalized_room_hint:
        return None

    for room in room_inventory:
        room_name = str(room.get("name") or "").strip().lower()
        room_code = str(room.get("code") or "").strip().lower()
        if normalized_room_hint == room_name or (room_code and normalized_room_hint == room_code):
            return _parse_uuid(str(room.get("id")))

    return None


def _database_target_hint() -> str:
    raw_url = getattr(database_runtime, "DATABASE_URL", "") or ""
    if not raw_url:
        return "DATABASE_URL=unset"
    parsed = urlparse(raw_url)
    host = parsed.hostname or "unknown-host"
    port = parsed.port or 5432
    database_name = (parsed.path or "/").lstrip("/") or "unknown-db"
    return f"{parsed.scheme}://{host}:{port}/{database_name}"


def _normalize_ui_screen(raw_screen: Optional[str]) -> UIScreen:
    """
    Compatibility normalization between frontend `currentState` and backend UIScreen.
    Unknown values safely collapse to WELCOME instead of failing validation.
    """
    if not raw_screen:
        return "WELCOME"

    candidate = raw_screen.strip()
    if candidate in UI_SCREEN_VALUES:
        return candidate  # type: ignore[return-value]

    canonical = candidate.upper().replace(" ", "_")
    mapped = (
        UI_STATE_ALIASES.get(canonical)
        or UI_STATE_ALIASES.get(canonical.replace("_", ""))
        or canonical
    )
    if mapped in UI_SCREEN_VALUES:
        return mapped  # type: ignore[return-value]

    print(f"[ChatAPI] Unknown current_ui_screen='{raw_screen}', defaulting to WELCOME")
    return "WELCOME"


def _should_attempt_faq(transcript: str, normalized_ui_screen: UIScreen) -> bool:
    if normalized_ui_screen in FAQ_BLOCKED_SCREENS:
        return False

    return is_faq_candidate_query(transcript)


async def _resolve_tenant_id(
    session: AsyncSession,
    tenant_id: Optional[str],
    tenant_slug: Optional[str],
) -> Optional[str]:
    if tenant_slug:
        tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = tenant_result.first()
        if tenant:
            return str(tenant.id)

    if tenant_id and tenant_id != "default":
        parsed_tenant_id = _parse_uuid(tenant_id)
        if parsed_tenant_id:
            return str(parsed_tenant_id)
        print(f"[ChatAPI] Ignoring invalid tenant_id (not UUID): {tenant_id}")

    return None


async def _load_room_inventory(session: AsyncSession, resolved_tenant_id: Optional[str]) -> list[dict]:
    if not resolved_tenant_id:
        return []

    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        print(f"[ChatAPI] Skipping room inventory load; tenant_id is not UUID: {resolved_tenant_id}")
        return []

    room_result = await session.exec(select(RoomType).where(RoomType.tenant_id == tenant_uuid))
    rooms = room_result.all()
    return [
        {
            "id": str(room.id),
            "name": room.name,
            "code": room.code,
            "price": float(room.price),
            "currency": "INR",
        }
        for room in rooms
    ]


class ChatRequest(BaseModel):
    """
    Accepts the frontend adapter's camelCase payload via aliases.
    """
    transcript: str
    session_id: str = Field(default="default", alias="sessionId")
    current_ui_screen: str = Field(default="WELCOME", alias="currentState")
    tenant_id: str = Field(default="default", alias="tenantId")
    tenant_slug: Optional[str] = Field(default=None, alias="tenantSlug")
    language: str = "en"
    # Extra fields the frontend sends — accepted but not required by the agent
    active_slot: Optional[str] = Field(default=None, alias="activeSlot")
    expected_type: Optional[str] = Field(default=None, alias="expectedType")
    last_system_prompt: Optional[str] = Field(default=None, alias="lastSystemPrompt")
    filled_slots: Optional[dict] = Field(default=None, alias="filledSlots")
    conversation_history: Optional[list[ConversationTurn]] = Field(default=None, alias="conversationHistory")

    class Config:
        populate_by_name = True  # Allow both camelCase and snake_case


class ChatResponse(BaseModel):
    """
    Response contract - matches exactly what the React brain.service.ts expects.
    Uses camelCase to be compatible with the existing frontend without any changes.
    """
    speech: str
    intent: str
    confidence: float
    # camelCase to match frontend contract
    nextUiScreen: str
    accumulatedSlots: dict
    extractedSlots: Optional[dict] = None
    missingSlots: list[str] = []
    nextSlotToAsk: Optional[str] = None
    selectedRoom: Optional[dict] = None
    isComplete: bool
    persistedBookingId: Optional[str] = None
    error: Optional[str] = None
    answerSource: str = "LLM"
    faqId: Optional[str] = None
    sessionId: str
    language: str

    class Config:
        # Allow camelCase output for JSON serialization
        populate_by_name = True


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
):
    """
    Main conversational endpoint.
    
    1. Loads or creates the session state.
    2. Updates the state with the incoming transcript + screen.
    3. Runs the LangGraph agent.
    4. Returns the AI response and updated state.
    5. Saves booking to database when complete.
    """
    try:
        requested_tenant_slug = req.tenant_slug or x_tenant_slug
        resolved_tenant_id = await _resolve_tenant_id(session, req.tenant_id, requested_tenant_slug)
        room_inventory = await _load_room_inventory(session, resolved_tenant_id)
        normalized_ui_screen = _normalize_ui_screen(req.current_ui_screen)
        print(
            "[ChatAPI] request "
            f"session={req.session_id} "
            f"screen={normalized_ui_screen} "
            f"tenant={resolved_tenant_id or req.tenant_id} "
            f"rooms={len(room_inventory)} "
            f"db={_database_target_hint()}"
        )

        # Load or create session
        if req.session_id not in _sessions:
            _sessions[req.session_id] = KioskState(
                session_id=req.session_id,
                tenant_id=resolved_tenant_id or req.tenant_id,
                current_ui_screen=normalized_ui_screen,
                language=normalize_language_code(req.language),
                tenant_room_inventory=room_inventory,
            )

        state = _sessions[req.session_id]

        # Update state with current request data
        state.latest_transcript = req.transcript
        state.current_ui_screen = normalized_ui_screen
        state.language = normalize_language_code(req.language)
        state.tenant_id = resolved_tenant_id or state.tenant_id
        state.tenant_room_inventory = [RoomInventoryItem(**room) for room in room_inventory]

        # Deterministic FAQ retrieval layer (tenant-scoped), only for non-transactional turns.
        if _should_attempt_faq(req.transcript, normalized_ui_screen):
            normalized_transcript = normalize_faq_query(req.transcript)
            print(
                "[ChatAPI][FAQ] attempt "
                f"session={req.session_id} "
                f"tenant={resolved_tenant_id or req.tenant_id} "
                f"query='{normalized_transcript}'"
            )
            faq_match = await find_best_faq_match(
                session=session,
                tenant_id=resolved_tenant_id or req.tenant_id,
                user_query=req.transcript,
            )
            if faq_match and faq_match.confidence >= FAQ_MATCH_THRESHOLD:
                print(
                    "[ChatAPI][FAQ] matched "
                    f"session={req.session_id} "
                    f"faq_id={faq_match.faq_id} "
                    f"confidence={faq_match.confidence:.3f}"
                )
                faq_response = faq_match.answer.strip() or "Please ask a different question."
                state.history = state.history + [
                    ConversationTurn(role="user", content=state.latest_transcript),
                    ConversationTurn(role="assistant", content=faq_response),
                ]
                state.speech_response = faq_response
                state.resolved_intent = "GENERAL_QUERY"
                state.confidence = faq_match.confidence
                state.next_ui_screen = normalized_ui_screen
                _sessions[req.session_id] = state

                return ChatResponse(
                    speech=faq_response,
                    intent="GENERAL_QUERY",
                    confidence=faq_match.confidence,
                    nextUiScreen=normalized_ui_screen,
                    accumulatedSlots=state.booking_slots.model_dump(by_alias=True),
                    extractedSlots={},
                    missingSlots=[],
                    nextSlotToAsk=None,
                    selectedRoom=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
                    isComplete=state.booking_slots.is_complete(),
                    persistedBookingId=_persisted_booking_by_session.get(req.session_id),
                    error=None,
                    answerSource="FAQ_DB",
                    faqId=faq_match.faq_id,
                    sessionId=req.session_id,
                    language=state.language,
                )

            print(
                "[ChatAPI][FAQ] fallback "
                f"session={req.session_id} "
                f"reason={'no_match' if not faq_match else f'low_confidence:{faq_match.confidence:.3f}'}"
            )

        # Run LangGraph agent
        # ainvoke() returns a dict of the final state fields
        result: dict = await kiosk_agent.ainvoke(state.model_dump())

        # Reconstruct updated state from result dict
        updated_state = KioskState(**result)
        _sessions[req.session_id] = updated_state

        slots_dict = updated_state.booking_slots.model_dump()
        is_complete = updated_state.booking_slots.is_complete()
        missing_slots = [
            _to_contract_slot_name(slot_name)
            for slot_name in updated_state.booking_slots.missing_required_slots()
        ]
        next_slot_to_ask = _to_contract_slot_name(updated_state.active_slot)
        persisted_booking_id: Optional[str] = _persisted_booking_by_session.get(req.session_id)
        persistence_error: Optional[str] = None
        selected_room_payload = updated_state.selected_room.model_dump(by_alias=True) if updated_state.selected_room else None
        if selected_room_payload and selected_room_payload.get("name"):
            selected_room_payload["displayName"] = selected_room_payload.get("name")
        response_next_screen = updated_state.next_ui_screen or normalized_ui_screen
        response_speech = updated_state.speech_response or "I'm not sure how to help with that."

        # Authoritative booking confirmation path:
        # confirm on BOOKING_SUMMARY + all slots complete => persist + move to PAYMENT.
        should_persist_booking = (
            normalized_ui_screen == "BOOKING_SUMMARY"
            and updated_state.resolved_intent == "CONFIRM_BOOKING"
            and is_complete
        )
        print(
            "[ChatAPI][PersistBooking] gate "
            f"session={req.session_id} "
            f"intent={updated_state.resolved_intent} "
            f"is_complete={is_complete} "
            f"screen={normalized_ui_screen} "
            f"allowed={should_persist_booking}"
        )
        if should_persist_booking:
            if not persisted_booking_id:
                from models.booking import Booking
                from datetime import datetime
                print(
                    "[ChatAPI][PersistBooking] attempt "
                    f"session={req.session_id} "
                    f"room_hint={slots_dict.get('room_type')} "
                    f"check_in={slots_dict.get('check_in_date')} "
                    f"check_out={slots_dict.get('check_out_date')}"
                )
                try:
                    tenant_uuid = _parse_uuid(resolved_tenant_id or updated_state.tenant_id or req.tenant_id)
                    if not tenant_uuid:
                        raise ValueError("Missing or invalid tenant_id for booking persistence.")

                    room_type_uuid = _resolve_room_type_uuid(
                        selected_room_payload,
                        slots_dict.get("room_type"),
                        room_inventory,
                    )
                    if not room_type_uuid:
                        raise ValueError("Could not resolve a valid room_type_id UUID for booking persistence.")

                    check_in = datetime.strptime(slots_dict["check_in_date"], "%Y-%m-%d").date()
                    check_out = datetime.strptime(slots_dict["check_out_date"], "%Y-%m-%d").date()
                    nights_value = slots_dict.get("nights")
                    if not nights_value:
                        nights_value = max(1, (check_out - check_in).days)

                    new_booking = Booking(
                        tenant_id=tenant_uuid,
                        room_type_id=room_type_uuid,
                        guest_name=slots_dict.get("guest_name", "Unknown"),
                        check_in_date=check_in,
                        check_out_date=check_out,
                        adults=slots_dict.get("adults", 1) or 1,
                        children=slots_dict.get("children", 0) or 0,
                        nights=nights_value,
                        status="CONFIRMED",
                    )
                    session.add(new_booking)
                    await session.commit()
                    persisted_booking_id = str(new_booking.id)
                    _persisted_booking_by_session[req.session_id] = persisted_booking_id
                    print(
                        "[ChatAPI][PersistBooking] success "
                        f"session={req.session_id} "
                        f"booking_id={persisted_booking_id}"
                    )
                except Exception as db_err:
                    await session.rollback()
                    persistence_error = f"BOOKING_PERSIST_FAILED: {db_err}"
                    print(
                        "[ChatAPI][PersistBooking] failure "
                        f"session={req.session_id} "
                        f"error={db_err}"
                    )
            else:
                print(
                    "[ChatAPI][PersistBooking] skip "
                    f"session={req.session_id} "
                    f"reason=already_persisted "
                    f"booking_id={persisted_booking_id}"
                )

            if persistence_error:
                response_next_screen = "BOOKING_SUMMARY"
                response_speech = (
                    "I could not finalize your booking due to a system issue. "
                    "Please try confirm again or use the touch confirm button."
                )
            else:
                response_next_screen = "PAYMENT"
                if not response_speech.strip():
                    response_speech = "Your booking is confirmed. Taking you to payment now."

        return ChatResponse(
            speech=response_speech,
            intent=updated_state.resolved_intent or "GENERAL_QUERY",
            confidence=updated_state.confidence,
            nextUiScreen=response_next_screen,
            accumulatedSlots=updated_state.booking_slots.model_dump(by_alias=True),
            extractedSlots={},
            missingSlots=[slot for slot in missing_slots if slot],
            nextSlotToAsk=next_slot_to_ask,
            selectedRoom=selected_room_payload,
            isComplete=is_complete,
            persistedBookingId=persisted_booking_id,
            error=persistence_error,
            answerSource="LLM",
            faqId=None,
            sessionId=req.session_id,
            language=updated_state.language,
        )

    except Exception as e:
        import traceback
        print(f"[ChatAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat/{session_id}")
async def clear_session(session_id: str):
    """Clear a session (called when guest leaves or kiosk resets)."""
    if session_id in _sessions:
        del _sessions[session_id]
    _persisted_booking_by_session.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}
