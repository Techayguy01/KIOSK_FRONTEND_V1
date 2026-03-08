"""
api/chat.py

The main chat endpoint that the React frontend calls.
Receives a transcript and current UI state, runs it through LangGraph, and returns
the speech response and next UI screen.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from agent.graph import kiosk_agent
from agent.state import KioskState, BookingSlots, ConversationTurn
from core.voice import normalize_language_code
from core.database import get_session
from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import Depends

router = APIRouter()

# In-memory session store (replace with Redis in production)
_sessions: dict[str, KioskState] = {}


class ChatRequest(BaseModel):
    """
    Accepts the frontend adapter's camelCase payload via aliases.
    """
    transcript: str
    session_id: str = Field(default="default", alias="sessionId")
    current_ui_screen: str = Field(default="WELCOME", alias="currentState")
    tenant_id: str = Field(default="default", alias="tenantId")
    language: str = "en"
    # Extra fields the frontend sends — accepted but not required by the agent
    active_slot: Optional[str] = Field(default=None, alias="activeSlot")
    expected_type: Optional[str] = Field(default=None, alias="expectedType")
    last_system_prompt: Optional[str] = Field(default=None, alias="lastSystemPrompt")
    filled_slots: Optional[dict] = Field(default=None, alias="filledSlots")

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
    isComplete: bool
    sessionId: str
    language: str

    class Config:
        # Allow camelCase output for JSON serialization
        populate_by_name = True


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, session: AsyncSession = Depends(get_session)):
    """
    Main conversational endpoint.
    
    1. Loads or creates the session state.
    2. Updates the state with the incoming transcript + screen.
    3. Runs the LangGraph agent.
    4. Returns the AI response and updated state.
    5. Saves booking to database when complete.
    """
    try:
        # Load or create session
        if req.session_id not in _sessions:
            _sessions[req.session_id] = KioskState(
                session_id=req.session_id,
                tenant_id=req.tenant_id,
                current_ui_screen=req.current_ui_screen,
                language=normalize_language_code(req.language),
            )

        state = _sessions[req.session_id]

        # Update state with current request data
        state.latest_transcript = req.transcript
        state.current_ui_screen = req.current_ui_screen
        state.language = normalize_language_code(req.language)

        # Run LangGraph agent
        # ainvoke() returns a dict of the final state fields
        result: dict = await kiosk_agent.ainvoke(state.model_dump())

        # Reconstruct updated state from result dict
        updated_state = KioskState(**result)
        _sessions[req.session_id] = updated_state

        slots_dict = updated_state.booking_slots.model_dump()
        is_complete = updated_state.booking_slots.is_complete()

        # Database Persistence for Complete Bookings
        if is_complete and updated_state.resolved_intent == "CONFIRM_BOOKING":
            if not getattr(state, "_booking_saved", False):
                from models.booking import Booking
                from datetime import datetime
                try:
                    check_in = datetime.strptime(slots_dict["check_in_date"], "%Y-%m-%d").date()
                    check_out = datetime.strptime(slots_dict["check_out_date"], "%Y-%m-%d").date()
                    
                    new_booking = Booking(
                        tenant_id=req.tenant_id,
                        room_type_id=slots_dict.get("room_type") or "default_room",
                        guest_name=slots_dict.get("guest_name", "Unknown"),
                        check_in_date=check_in,
                        check_out_date=check_out,
                        adults=slots_dict.get("adults", 1) or 1,
                        children=slots_dict.get("children", 0) or 0,
                        nights=slots_dict.get("nights", 1) or 1,
                        status="CONFIRMED"
                    )
                    session.add(new_booking)
                    await session.commit()
                    print(f"[ChatAPI] ✅ Booking {new_booking.id} saved to DB")
                    state._booking_saved = True
                except Exception as db_err:
                    print(f"[ChatAPI] ❌ Failed to save booking: {db_err}")

        return ChatResponse(
            speech=updated_state.speech_response or "I'm not sure how to help with that.",
            intent=updated_state.resolved_intent or "GENERAL_QUERY",
            confidence=updated_state.confidence,
            nextUiScreen=updated_state.next_ui_screen or req.current_ui_screen,
            accumulatedSlots=updated_state.booking_slots.model_dump(by_alias=True),
            isComplete=is_complete,
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
    return {"status": "cleared", "session_id": session_id}
