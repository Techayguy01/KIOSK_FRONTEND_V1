from __future__ import annotations

import pytest

from agent.state import RoomInventoryItem


@pytest.fixture
def room_catalog_payload() -> list[dict]:
    return [
        {
            "id": "room-deluxe-king",
            "name": "Deluxe King",
            "code": "DLX-K",
            "price": 6499,
            "currency": "INR",
            "maxAdults": 2,
            "maxChildren": 1,
            "maxTotalGuests": 3,
        },
        {
            "id": "room-family-suite",
            "name": "Family Suite",
            "code": "FAM-S",
            "price": 8999,
            "currency": "INR",
            "maxAdults": 4,
            "maxChildren": 2,
            "maxTotalGuests": 6,
        },
        {
            "id": "room-premium-twin",
            "name": "Premium Twin",
            "code": "PRM-T",
            "price": 7299,
            "currency": "INR",
            "maxAdults": 2,
            "maxChildren": 2,
            "maxTotalGuests": 4,
        },
    ]


@pytest.fixture
def room_inventory_items(room_catalog_payload: list[dict]) -> list[RoomInventoryItem]:
    return [RoomInventoryItem(**room) for room in room_catalog_payload]


@pytest.fixture
def family_suite_room(room_inventory_items: list[RoomInventoryItem]) -> RoomInventoryItem:
    return next(room for room in room_inventory_items if room.name == "Family Suite")


@pytest.fixture
def booking_summary_filled_slots() -> dict:
    return {
        "roomType": "Family Suite",
        "adults": 2,
        "children": 1,
        "checkInDate": "2026-03-21",
        "checkOutDate": "2026-03-23",
        "guestName": "John Carter",
    }


@pytest.fixture
def booking_flow_payload_factory(room_catalog_payload: list[dict]):
    def _make(
        session_id: str,
        current_state: str,
        transcript: str,
        *,
        filled_slots: dict | None = None,
        include_room_catalog: bool = True,
    ) -> dict:
        payload = {
            "sessionId": session_id,
            "transcript": transcript,
            "currentState": current_state,
            "language": "en",
        }
        if include_room_catalog:
            payload["roomCatalog"] = room_catalog_payload
        if filled_slots:
            payload["filledSlots"] = filled_slots
        return payload

    return _make


@pytest.fixture
def booking_flow_context_factory(room_catalog_payload: list[dict], booking_summary_filled_slots: dict):
    def _make(session_id: str = "booking-flow") -> dict:
        return {
            "session_id": session_id,
            "room_catalog": list(room_catalog_payload),
            "partial_slots": {"roomType": "Family Suite"},
            "complete_slots": dict(booking_summary_filled_slots),
        }

    return _make
