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
    "AI_CHAT",
    "MANUAL_MENU",
    "SCAN_ID",
    "ID_VERIFY",
    "CHECK_IN_SUMMARY",
    "ROOM_SELECT",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "KEY_DISPENSING",
    "COMPLETE",
    "ERROR",
]

# Backend-owned progression states for booking orchestration.
BOOKING_PROGRESS_SCREENS = {"ROOM_SELECT", "BOOKING_COLLECT", "BOOKING_SUMMARY"}

# Frontend presentation states that are chat-compatible but not booking progression states.
FRONTEND_PRESENTATION_SCREENS = {"AI_CHAT", "MANUAL_MENU"}

# All possible intents the backend can determine from the user
IntentType = Literal[
    "GENERAL_QUERY",
    "BOOK_ROOM",
    "CHECK_IN",
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


class RoomInventoryItem(BaseModel):
    """Tenant-specific room catalog entry available for booking validation."""
    id: str
    name: str
    code: Optional[str] = None
    price: Optional[float] = None
    currency: str = "INR"
    max_adults: Optional[int] = Field(default=None, alias="maxAdults")
    max_children: Optional[int] = Field(default=None, alias="maxChildren")
    max_total_guests: Optional[int] = Field(default=None, alias="maxTotalGuests")
    features: list[str] = Field(default_factory=list)
    amenities: list[str] = Field(default_factory=list)

    class Config:
        populate_by_name = True


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
    tenant_room_inventory: list[RoomInventoryItem] = Field(default_factory=list, alias="tenantRoomInventory")
    selected_room: Optional[RoomInventoryItem] = Field(default=None, alias="selectedRoom")

    # What the AI will say back to the user (TTS input)
    speech_response: str = ""

    # The UI screen the frontend should transition to after this turn
    next_ui_screen: Optional[UIScreen] = None

    # Error tracking
    error: Optional[str] = None
