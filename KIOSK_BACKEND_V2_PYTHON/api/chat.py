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
from datetime import date, datetime
from agent.graph import kiosk_agent
from agent.state import KioskState, ConversationTurn, RoomInventoryItem, UIScreen
from core.voice import normalize_language_code, normalize_language_list
from core.database import get_session
from core import database as database_runtime
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from sqlalchemy import text
from models.tenant import Tenant
from models.tenant_config import TenantConfig
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

# Retrieval-first hotel policy architecture:
# 1. FAQ / policy DB answers deterministic, tenant-scoped questions first.
# 2. Only unmatched requests fall through to router + LLM.
# 3. Do not stuff full hotel policy into every prompt; retrieve only relevant snippets later.
# 4. Browser IndexedDB is a secondary cache, not the source of truth.


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


def _parse_iso_date(raw_value: Optional[str]) -> Optional[date]:
    if not raw_value:
        return None
    try:
        return datetime.strptime(str(raw_value), "%Y-%m-%d").date()
    except Exception:
        return None


def _resolve_room_capacity_limit(selected_room_payload: Optional[dict], key: str) -> Optional[int]:
    if not selected_room_payload:
        return None
    raw_value = selected_room_payload.get(key)
    if raw_value is None:
        return None
    try:
        parsed = int(raw_value)
        return parsed if parsed >= 0 else None
    except Exception:
        return None


def _merge_filled_slots(state: KioskState, filled_slots: dict, room_inventory: list[dict]) -> None:
    """
    Sync frontend state overrides (like manual touch input) into the backend session logic.
    Only overwrites backend state if the frontend actually provided a value.
    """
    if not filled_slots:
        return

    # Map camelCase from React to snake_case for Pydantic
    slot_mapping = {
        "roomType": "room_type",
        "adults": "adults",
        "children": "children",
        "checkInDate": "check_in_date",
        "checkOutDate": "check_out_date",
        "guestName": "guest_name",
        "nights": "nights"
    }

    current_slots = state.booking_slots.model_dump()
    has_updates = False

    for frontend_key, backend_key in slot_mapping.items():
        val = filled_slots.get(frontend_key)
        if val is not None and str(val).strip() != "":
            # Convert numeric fields
            if backend_key in ["adults", "children", "nights"]:
                try:
                    current_slots[backend_key] = int(val)
                    has_updates = True
                except ValueError:
                    pass
            else:
                current_slots[backend_key] = val
                has_updates = True

    if has_updates:
        # Rebuild the model to ensure validation
        from agent.state import BookingSlots
        state.booking_slots = BookingSlots(**current_slots)
        print(f"[ChatAPI][SlotSync] Merged frontend slots: {current_slots}")

    # If frontend told us the room type, ensure selected_room is populated
    # so capacity constraints use the correct limits.
    target_room_name = current_slots.get("room_type")
    if target_room_name:
        normalized_target = target_room_name.strip().lower()
        if not state.selected_room or (state.selected_room.name or "").lower() != normalized_target:
            import difflib
            # Find the best match in the inventory
            for room in room_inventory:
                room_name = (room.get("name") or "").strip().lower()
                room_code = (room.get("code") or "").strip().lower()
                
                if normalized_target == room_name or (room_code and normalized_target == room_code):
                    from agent.state import RoomInventoryItem
                    state.selected_room = RoomInventoryItem(**room)
                    print(f"[ChatAPI][SlotSync] Auto-selected room from payload: {state.selected_room.name}")
                    break
            else:
                # Fallback to fuzzy match if exact fails
                room_names = [r.get("name") for r in room_inventory if r.get("name")]
                matches = difflib.get_close_matches(normalized_target, room_names, n=1, cutoff=0.6)
                if matches:
                    best_match = matches[0]
                    for room in room_inventory:
                        if room.get("name") == best_match:
                            from agent.state import RoomInventoryItem
                            state.selected_room = RoomInventoryItem(**room)
                            print(f"[ChatAPI][SlotSync] Fuzzy auto-selected room from payload: {state.selected_room.name}")
                            break


def _validate_booking_constraints(
    slots_dict: dict,
    selected_room_payload: Optional[dict],
) -> tuple[Optional[str], Optional[str], str]:
    today = date.today()
    check_in = _parse_iso_date(slots_dict.get("check_in_date"))
    check_out = _parse_iso_date(slots_dict.get("check_out_date"))

    if check_in and check_in < today:
        return (
            "Check-in date cannot be in the past. Please choose today or a future date.",
            "checkInDate",
            "BOOKING_COLLECT",
        )

    if check_in and check_out and check_out <= check_in:
        return (
            "Check-out date must be after check-in date. Please update the dates.",
            "checkOutDate",
            "BOOKING_COLLECT",
        )

    adults = slots_dict.get("adults")
    children = slots_dict.get("children")
    max_adults = _resolve_room_capacity_limit(selected_room_payload, "maxAdults")
    max_children = _resolve_room_capacity_limit(selected_room_payload, "maxChildren")
    max_total_guests = _resolve_room_capacity_limit(selected_room_payload, "maxTotalGuests")

    try:
        adult_count = int(adults) if adults is not None else None
    except Exception:
        adult_count = None

    try:
        child_count = int(children) if children is not None else 0
    except Exception:
        child_count = 0

    if max_adults is not None and adult_count is not None and adult_count > max_adults:
        return (
            f"This room allows up to {max_adults} adult{'s' if max_adults != 1 else ''}. "
            "Please reduce the adult count or choose another room.",
            "adults",
            "BOOKING_COLLECT",
        )

    if max_children is not None and child_count > max_children:
        return (
            f"This room allows up to {max_children} child{'ren' if max_children != 1 else ''}. "
            "Please reduce the child count or choose another room.",
            "children",
            "BOOKING_COLLECT",
        )

    if (
        max_total_guests is not None
        and adult_count is not None
        and adult_count + child_count > max_total_guests
    ):
        return (
            f"This room allows up to {max_total_guests} guest{'s' if max_total_guests != 1 else ''} in total. "
            "Please adjust the guest count or choose another room.",
            "adults",
            "BOOKING_COLLECT",
        )

    return None, None, "BOOKING_SUMMARY"


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
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=blocked_screen"
        )
        return False

    # Do not rely on language-specific candidate detection; instead attempt FAQ
    # retrieval on allowed screens and let the matcher decide.
    cleaned = (transcript or "").strip()
    if not cleaned:
        return False
    # Avoid running FAQ retrieval on very long turns (likely conversational/transactional).
    if len(cleaned) > 240:
        return False

    is_candidate = True
    print(
        "[ChatAPI][FAQ] candidate "
        f"screen={normalized_ui_screen} "
        f"allowed={is_candidate}"
    )
    return is_candidate


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

    select_fields = [
        "id",
        "name",
        "code",
        "price",
    ]
    if "max_adults" in available_columns:
        select_fields.append("max_adults")
    if "max_children" in available_columns:
        select_fields.append("max_children")
    if "max_total_guests" in available_columns:
        select_fields.append("max_total_guests")

    rooms_result = await session.exec(
        text(
            f"""
            SELECT {", ".join(select_fields)}
            FROM room_types
            WHERE tenant_id = CAST(:tenant_id AS uuid)
            """
        ),
        params={"tenant_id": str(tenant_uuid)},
    )
    rooms = rooms_result.all()
    return [
        {
            "id": str(row._mapping.get("id")),
            "name": row._mapping.get("name"),
            "code": row._mapping.get("code"),
            "price": float(row._mapping.get("price")),
            "currency": "INR",
            "maxAdults": row._mapping.get("max_adults"),
            "maxChildren": row._mapping.get("max_children"),
            "maxTotalGuests": row._mapping.get("max_total_guests"),
        }
        for row in rooms
    ]


async def _load_tenant_config(session: AsyncSession, resolved_tenant_id: Optional[str]) -> Optional[TenantConfig]:
    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        return None

    config_result = await session.exec(
        select(TenantConfig).where(TenantConfig.tenant_id == tenant_uuid)
    )
    return config_result.first()


def _resolve_effective_language(requested_language: Optional[str], tenant_config: Optional[TenantConfig]) -> str:
    requested = normalize_language_code(requested_language or "")
    if not tenant_config:
        return requested

    allowed_languages = normalize_language_list(tenant_config.available_lang or [])
    default_language = normalize_language_code(tenant_config.default_lang or "en")

    if allowed_languages:
        if requested in allowed_languages:
            return requested
        if default_language in allowed_languages:
            return default_language
        return allowed_languages[0]

    return default_language


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
    normalizedQuery: Optional[str] = None
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
        tenant_config = await _load_tenant_config(session, resolved_tenant_id)
        effective_language = _resolve_effective_language(req.language, tenant_config)
        room_inventory = await _load_room_inventory(session, resolved_tenant_id)
        normalized_ui_screen = _normalize_ui_screen(req.current_ui_screen)
        print(
            "[ChatAPI] request "
            f"session={req.session_id} "
            f"screen={normalized_ui_screen} "
            f"tenant={resolved_tenant_id or req.tenant_id} "
            f"language={effective_language} "
            f"rooms={len(room_inventory)} "
            f"db={_database_target_hint()}"
        )

        # Load or create session
        if req.session_id not in _sessions:
            _sessions[req.session_id] = KioskState(
                session_id=req.session_id,
                tenant_id=resolved_tenant_id or req.tenant_id,
                current_ui_screen=normalized_ui_screen,
                language=effective_language,
                tenant_room_inventory=room_inventory,
            )

        state = _sessions[req.session_id]

        # Update state with current request data
        state.latest_transcript = req.transcript
        state.current_ui_screen = normalized_ui_screen
        state.language = effective_language
        state.tenant_id = resolved_tenant_id or state.tenant_id
        state.tenant_room_inventory = [RoomInventoryItem(**room) for room in room_inventory]

        # Sync frontend-filled slots into session so manual (touch) booking path
        # keeps backend slot state coherent with UI state.
        if req.filled_slots:
            _merge_filled_slots(state, req.filled_slots, room_inventory)

        # Deterministic FAQ retrieval layer (tenant-scoped), only for non-transactional turns.
        if _should_attempt_faq(req.transcript, normalized_ui_screen):
            normalized_transcript = normalize_faq_query(req.transcript)
            print(
                "[ChatAPI][FAQ] attempt "
                f"session={req.session_id} "
                f"tenant={resolved_tenant_id or req.tenant_id} "
                f"query='{normalized_transcript}'"
            )
            faq_lookup = await find_best_faq_match(
                session=session,
                tenant_id=resolved_tenant_id or req.tenant_id,
                user_query=req.transcript,
            )
            faq_match = faq_lookup.match
            print(
                "[ChatAPI][FAQ] loaded "
                f"session={req.session_id} "
                f"faq_count={faq_lookup.faq_count} "
                f"normalized='{faq_lookup.normalized_query}'"
            )
            if faq_match and faq_match.confidence >= FAQ_MATCH_THRESHOLD:
                print(
                    "[ChatAPI][FAQ] matched "
                    f"session={req.session_id} "
                    f"faq_id={faq_match.faq_id} "
                    f"confidence={faq_match.confidence:.3f} "
                    f"match_type={faq_match.match_type}"
                )
                faq_response = faq_match.answer
                state.history = state.history + [
                    ConversationTurn(role="user", content=state.latest_transcript),
                    ConversationTurn(role="assistant", content=faq_response),
                ]
                state.speech_response = faq_response
                state.resolved_intent = "GENERAL_QUERY"
                state.confidence = faq_match.confidence
                state.next_ui_screen = normalized_ui_screen
                _sessions[req.session_id] = state
                print(
                    "[ChatAPI][FAQ] respond "
                    f"session={req.session_id} "
                    f"answerSource=FAQ_DB faq_id={faq_match.faq_id}"
                )

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
                    normalizedQuery=faq_lookup.normalized_query,
                    sessionId=req.session_id,
                    language=state.language,
                )

            # Deterministic fallback for FAQ-style questions with no tenant FAQ match.
            # Avoid hallucinated policy answers from the LLM path.
            fallback_text = "I don't have information for that right now."
            state.history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=fallback_text),
            ]
            state.speech_response = fallback_text
            state.resolved_intent = "GENERAL_QUERY"
            state.confidence = 1.0
            state.next_ui_screen = normalized_ui_screen
            _sessions[req.session_id] = state
            print(
                "[ChatAPI][FAQ] fallback "
                f"session={req.session_id} "
                f"reason={'no_match' if not faq_match else f'low_confidence:{faq_match.confidence:.3f}'} "
                f"faq_count={faq_lookup.faq_count}"
            )
            return ChatResponse(
                speech=fallback_text,
                intent="GENERAL_QUERY",
                confidence=1.0,
                nextUiScreen=normalized_ui_screen,
                accumulatedSlots=state.booking_slots.model_dump(by_alias=True),
                extractedSlots={},
                missingSlots=[],
                nextSlotToAsk=None,
                selectedRoom=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
                isComplete=state.booking_slots.is_complete(),
                persistedBookingId=_persisted_booking_by_session.get(req.session_id),
                error=None,
                answerSource="FAQ_FALLBACK",
                faqId=None,
                sessionId=req.session_id,
                language=state.language,
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

        constraint_error, constraint_slot, constraint_screen = _validate_booking_constraints(
            slots_dict,
            selected_room_payload,
        )
        if constraint_error:
            is_complete = False
            response_speech = constraint_error
            response_next_screen = constraint_screen
            next_slot_to_ask = constraint_slot
            print(
                "[ChatAPI][BookingValidation] rejected "
                f"session={req.session_id} "
                f"slot={constraint_slot} "
                f"screen={constraint_screen} "
                f"reason={constraint_error}"
            )

        # Authoritative booking confirmation path:
        # confirm on BOOKING_SUMMARY + all slots complete => persist + move to PAYMENT.
        should_persist_booking = (
            not constraint_error
            and normalized_ui_screen == "BOOKING_SUMMARY"
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
            error=constraint_error or persistence_error,
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
