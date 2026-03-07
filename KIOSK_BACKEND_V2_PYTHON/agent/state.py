"""
agent/state.py

The single source of truth for the LangGraph conversation state.

This is what the "brain" knows at every step of the conversation.
Think of it like the entire working memory for one guest interaction.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


# All possible UI screens the frontend can render
UIScreen = Literal[
    "IDLE",
    "WELCOME",
    "ROOM_SELECT",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "COMPLETE",
    "ERROR",
]

# All possible intents the backend can determine from the user
IntentType = Literal[
    "GENERAL_QUERY",
    "BOOK_ROOM",
    "SELECT_ROOM",
    "PROVIDE_GUESTS",
    "PROVIDE_DATES",
    "PROVIDE_NAME",
    "CONFIRM_BOOKING",
    "CANCEL_BOOKING",
    "MODIFY_BOOKING",
    "IDLE",
    "RESET",
]


class BookingSlots(BaseModel):
    """All slots the agent needs to complete a booking."""
    room_type: Optional[str] = Field(default=None, alias="roomType")
    adults: Optional[int] = Field(default=None)
    children: Optional[int] = Field(default=None)
    check_in_date: Optional[str] = Field(default=None, alias="checkInDate")
    check_out_date: Optional[str] = Field(default=None, alias="checkOutDate")
    guest_name: Optional[str] = Field(default=None, alias="guestName")
    nights: Optional[int] = Field(default=None)
    total_price: Optional[float] = Field(default=None, alias="totalPrice")

    class Config:
        populate_by_name = True

    def missing_required_slots(self) -> list[str]:
        """Returns the list of slots still needed to confirm a booking."""
        required = {
            "room_type": self.room_type,
            "adults": self.adults,
            "check_in_date": self.check_in_date,
            "check_out_date": self.check_out_date,
            "guest_name": self.guest_name,
        }
        return [k for k, v in required.items() if v is None]

    def is_complete(self) -> bool:
        return len(self.missing_required_slots()) == 0


class ConversationTurn(BaseModel):
    """A single exchange in the conversation."""
    role: Literal["user", "assistant"]
    content: str


class KioskState(BaseModel):
    """
    The full state of a kiosk interaction.
    
    This is passed through every node in the LangGraph agent.
    A node reads a part of the state, does work, and returns updated fields.
    """

    # Session tracking
    session_id: str
    tenant_id: str = "default"
    language: str = "en"
    current_ui_screen: UIScreen = "WELCOME"

    # Conversation history (last N turns sent to LLM for context)
    history: list[ConversationTurn] = Field(default_factory=list)

    # Last thing the user said (raw transcript)
    latest_transcript: str = ""

    # Intent resolved by the router node
    resolved_intent: Optional[IntentType] = None
    confidence: float = 0.0

    # Booking progress
    booking_slots: BookingSlots = Field(default_factory=BookingSlots)
    active_slot: Optional[str] = None  # Which slot is the LLM currently asking for?

    # What the AI will say back to the user (TTS input)
    speech_response: str = ""

    # The UI screen the frontend should transition to after this turn
    next_ui_screen: Optional[UIScreen] = None

    # Error tracking
    error: Optional[str] = None
