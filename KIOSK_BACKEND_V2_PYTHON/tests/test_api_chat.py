"""
API-level tests for the FastAPI application.
Uses httpx ASGI transport so no live server is required.
"""

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from api import chat as chat_api
from agent.state import BookingSlots, KioskState, RoomInventoryItem
from main import app


@pytest.fixture
def mock_db_session():
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_result.first.return_value = None
    mock_session.exec = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()
    return mock_session


@pytest.fixture
def override_session(mock_db_session):
    async def _override():
        yield mock_db_session

    app.dependency_overrides[chat_api.get_session] = _override
    yield mock_db_session
    app.dependency_overrides.pop(chat_api.get_session, None)


@pytest.fixture(autouse=True)
def clear_chat_runtime_state():
    chat_api._sessions.clear()
    chat_api._persisted_booking_by_session.clear()
    chat_api._persisted_room_id_by_session.clear()
    chat_api._persisted_room_number_by_session.clear()
    yield
    chat_api._sessions.clear()
    chat_api._persisted_booking_by_session.clear()
    chat_api._persisted_room_id_by_session.clear()
    chat_api._persisted_room_number_by_session.clear()


def build_state_payload(
    session_id: str,
    current_ui_screen: str,
    *,
    resolved_intent: str = "GENERAL_QUERY",
    speech_response: str = "Hello there.",
    next_ui_screen: str | None = None,
    booking_slots: BookingSlots | None = None,
    selected_room: RoomInventoryItem | None = None,
    active_slot: str | None = None,
) -> dict:
    state = KioskState(
        session_id=session_id,
        tenant_id="default",
        current_ui_screen=current_ui_screen,
        resolved_intent=resolved_intent,
        confidence=0.9,
        speech_response=speech_response,
        next_ui_screen=next_ui_screen or current_ui_screen,
        booking_slots=booking_slots or BookingSlots(),
        selected_room=selected_room,
        active_slot=active_slot,
    )
    return state.model_dump()


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_check(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    @pytest.mark.asyncio
    async def test_health_returns_version(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")
        data = response.json()
        assert "version" in data
        assert data["version"] == "2.0.0"

    @pytest.mark.asyncio
    async def test_health_is_fast(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            start = time.time()
            response = await client.get("/health")
            elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 1.0


class TestChatEndpointValidation:
    @pytest.mark.asyncio
    async def test_chat_missing_body_returns_422(self, override_session):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/chat")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_chat_empty_body_returns_422(self, override_session):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/chat", json={})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_chat_missing_transcript_returns_422(self, override_session):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/chat", json={"sessionId": "test-session"})
        assert response.status_code == 422


class TestChatEndpointWithMocks:
    @pytest.mark.asyncio
    async def test_chat_returns_200_with_valid_payload(self, override_session):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [
                json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.9}),
                "Hello! Welcome to our hotel.",
            ]
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "test-session",
                        "transcript": "hello",
                        "currentState": "WELCOME",
                    },
                )
        assert response.status_code == 200
        data = response.json()
        assert data["speech"] == "Hello! Welcome to our hotel."
        assert data["intent"] == "GENERAL_QUERY"

    @pytest.mark.asyncio
    async def test_chat_check_in_returns_scan_id(self, override_session):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "test-session-checkin",
                        "transcript": "I want to check in",
                        "currentState": "WELCOME",
                    },
                )
        mock_llm.assert_not_called()
        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "SCAN_ID"

    @pytest.mark.asyncio
    async def test_chat_supports_snake_case_payload_names(self, override_session):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [
                json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.9}),
                "Hello there.",
            ]
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "session_id": "snake-session",
                        "transcript": "hello",
                        "current_ui_screen": "WELCOME",
                    },
                )
        assert response.status_code == 200
        assert response.json()["sessionId"] == "snake-session"

    @pytest.mark.asyncio
    async def test_chat_room_browsing_can_land_on_room_select(self, override_session):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.return_value = json.dumps(
                {
                    "extracted_slots": {"room_type": None},
                    "speech": "Let me show you our rooms.",
                    "is_complete": False,
                    "next_slot_to_ask": "room_type",
                }
            )
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "room-browse",
                        "transcript": "show me rooms",
                        "currentState": "WELCOME",
                    },
                )
        assert response.status_code == 200
        assert response.json()["nextUiScreen"] == "ROOM_SELECT"

    @pytest.mark.asyncio
    async def test_chat_response_contains_session_id(self, override_session):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [
                json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.9}),
                "Welcome back.",
            ]
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "session-echo",
                        "transcript": "hello",
                        "currentState": "WELCOME",
                    },
                )
        assert response.status_code == 200
        assert response.json()["sessionId"] == "session-echo"

    @pytest.mark.asyncio
    async def test_chat_family_room_recommendation_bypasses_faq_fallback(self, override_session):
        mock_ainvoke = AsyncMock(
            return_value=build_state_payload(
                "family-room",
                "WELCOME",
                resolved_intent="BOOK_ROOM",
                speech_response="Let me show you room options that fit your family.",
                next_ui_screen="ROOM_SELECT",
            )
        )
        transport = ASGITransport(app=app)
        with patch.object(chat_api.kiosk_agent, "ainvoke", mock_ainvoke), patch(
            "api.chat.find_best_faq_match",
            new_callable=AsyncMock,
        ) as mock_faq_lookup:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "family-room",
                        "transcript": "We are a family of four. Which room should we look at?",
                        "currentState": "WELCOME",
                    },
                )
        assert response.status_code == 200
        assert response.json()["nextUiScreen"] == "ROOM_SELECT"
        mock_ainvoke.assert_awaited_once()
        mock_faq_lookup.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_chat_room_comparison_from_welcome_does_not_jump_into_preview(self, override_session):
        comparison_catalog = [
            {
                "id": "room-budget-deluxe",
                "name": "Budget Deluxe Room",
                "code": "BDR",
                "price": 999,
                "currency": "INR",
                "maxAdults": 2,
                "maxChildren": 1,
                "maxTotalGuests": 3,
            },
            {
                "id": "room-grand-luxury",
                "name": "Grand Luxury Suite",
                "code": "GLS",
                "price": 10000,
                "currency": "INR",
                "maxAdults": 4,
                "maxChildren": 1,
                "maxTotalGuests": 5,
            },
        ]
        transport = ASGITransport(app=app)
        with patch("agent.nodes.get_llm_response") as mock_llm, patch(
            "api.chat.find_best_faq_match",
            new_callable=AsyncMock,
        ) as mock_faq_lookup:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "welcome-room-comparison",
                        "transcript": "Can you compare the Budget Deluxe Room and the Grand Luxury Suite?",
                        "currentState": "WELCOME",
                        "roomCatalog": comparison_catalog,
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "ROOM_SELECT"
        assert data["intent"] == "BOOK_ROOM"
        assert not data.get("selectedRoom")
        mock_llm.assert_not_called()
        mock_faq_lookup.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_chat_room_difference_from_welcome_stays_in_room_select(self, override_session):
        comparison_catalog = [
            {
                "id": "room-budget-deluxe",
                "name": "Budget Deluxe Room",
                "code": "BDR",
                "price": 999,
                "currency": "INR",
                "maxAdults": 2,
                "maxChildren": 1,
                "maxTotalGuests": 3,
            },
            {
                "id": "room-grand-luxury",
                "name": "Grand Luxury Suite",
                "code": "GLS",
                "price": 10000,
                "currency": "INR",
                "maxAdults": 4,
                "maxChildren": 1,
                "maxTotalGuests": 5,
            },
        ]
        transport = ASGITransport(app=app)
        with patch("agent.nodes.get_llm_response") as mock_llm, patch(
            "api.chat.find_best_faq_match",
            new_callable=AsyncMock,
        ) as mock_faq_lookup:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "welcome-room-difference",
                        "transcript": "What is the difference between Budget Deluxe Room and Grand Luxury Suite?",
                        "currentState": "WELCOME",
                        "roomCatalog": comparison_catalog,
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "ROOM_SELECT"
        assert data["intent"] == "BOOK_ROOM"
        assert not data.get("selectedRoom")
        mock_llm.assert_not_called()
        mock_faq_lookup.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_chat_room_which_is_better_from_welcome_stays_in_room_select(self, override_session):
        comparison_catalog = [
            {
                "id": "room-budget-deluxe",
                "name": "Budget Deluxe Room",
                "code": "BDR",
                "price": 999,
                "currency": "INR",
                "maxAdults": 2,
                "maxChildren": 1,
                "maxTotalGuests": 3,
            },
            {
                "id": "room-grand-luxury",
                "name": "Grand Luxury Suite",
                "code": "GLS",
                "price": 10000,
                "currency": "INR",
                "maxAdults": 4,
                "maxChildren": 1,
                "maxTotalGuests": 5,
            },
        ]
        transport = ASGITransport(app=app)
        with patch("agent.nodes.get_llm_response") as mock_llm, patch(
            "api.chat.find_best_faq_match",
            new_callable=AsyncMock,
        ) as mock_faq_lookup:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "welcome-room-which-is-better",
                        "transcript": "Which is better, Budget Deluxe Room or Grand Luxury Suite?",
                        "currentState": "WELCOME",
                        "roomCatalog": comparison_catalog,
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "ROOM_SELECT"
        assert data["intent"] == "BOOK_ROOM"
        assert not data.get("selectedRoom")
        mock_llm.assert_not_called()
        mock_faq_lookup.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_chat_room_better_comparison_from_room_select_stays_in_room_select(self, override_session):
        comparison_catalog = [
            {
                "id": "room-budget-deluxe",
                "name": "Budget Deluxe Room",
                "code": "BDR",
                "price": 999,
                "currency": "INR",
                "maxAdults": 2,
                "maxChildren": 1,
                "maxTotalGuests": 3,
            },
            {
                "id": "room-grand-luxury",
                "name": "Grand Luxury Suite",
                "code": "GLS",
                "price": 10000,
                "currency": "INR",
                "maxAdults": 4,
                "maxChildren": 1,
                "maxTotalGuests": 5,
            },
        ]
        transport = ASGITransport(app=app)
        with patch("agent.nodes.get_llm_response") as mock_llm:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "room-select-better-comparison",
                        "transcript": "Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite?",
                        "currentState": "ROOM_SELECT",
                        "roomCatalog": comparison_catalog,
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "ROOM_SELECT"
        assert data["intent"] == "BOOK_ROOM"
        assert not data.get("selectedRoom")
        mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_chat_summary_confirm_runs_through_agent_not_api_short_circuit(self, override_session):
        captured_payload = {}

        async def fake_ainvoke(payload):
            captured_payload.update(payload)
            payload["resolved_intent"] = "GENERAL_QUERY"
            payload["speech_response"] = "Still reviewing your booking summary."
            payload["next_ui_screen"] = "BOOKING_SUMMARY"
            return payload

        transport = ASGITransport(app=app)
        with patch.object(chat_api.kiosk_agent, "ainvoke", AsyncMock(side_effect=fake_ainvoke)) as mock_ainvoke:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "summary-confirm",
                        "transcript": "Yes, those details are correct. Please proceed to payment.",
                        "currentState": "BOOKING_SUMMARY",
                        "filledSlots": {
                            "roomType": "Family Suite",
                            "adults": 2,
                            "checkInDate": "2026-03-21",
                            "checkOutDate": "2026-03-23",
                            "guestName": "John Carter",
                        },
                    },
                )
        assert response.status_code == 200
        assert response.json()["nextUiScreen"] == "BOOKING_SUMMARY"
        assert captured_payload["current_ui_screen"] == "BOOKING_SUMMARY"
        mock_ainvoke.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_chat_preserves_booking_screen_when_request_regresses_to_welcome(self, override_session):
        family_suite = RoomInventoryItem(
            id="room-family-suite",
            name="Family Suite",
            code="FAM-S",
            price=8999,
            maxAdults=4,
            maxChildren=2,
            maxTotalGuests=6,
        )
        chat_api._sessions["preserve-booking-screen"] = KioskState(
            session_id="preserve-booking-screen",
            tenant_id="default",
            current_ui_screen="BOOKING_COLLECT",
            booking_slots=BookingSlots(
                roomType="Family Suite",
                adults=2,
                checkInDate="2026-03-21",
                checkOutDate="2026-03-23",
            ),
            active_slot="guest_name",
            selectedRoom=family_suite,
        )
        captured_payload = {}

        async def fake_ainvoke(payload):
            captured_payload.update(payload)
            payload["resolved_intent"] = "PROVIDE_NAME"
            payload["speech_response"] = "Thanks, I am still collecting your booking details."
            payload["next_ui_screen"] = payload["current_ui_screen"]
            return payload

        transport = ASGITransport(app=app)
        with patch.object(chat_api.kiosk_agent, "ainvoke", AsyncMock(side_effect=fake_ainvoke)) as mock_ainvoke:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json={
                        "sessionId": "preserve-booking-screen",
                        "transcript": "The guest name is John Carter.",
                        "currentState": "WELCOME",
                        "filledSlots": {
                            "guestName": "John Carter",
                        },
                    },
                )
        assert response.status_code == 200
        assert response.json()["nextUiScreen"] == "BOOKING_COLLECT"
        assert captured_payload["current_ui_screen"] == "BOOKING_COLLECT"
        assert captured_payload["selected_room"]["name"] == "Family Suite"
        mock_ainvoke.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_chat_preview_detail_question_stays_in_room_preview_context(
        self,
        override_session,
        booking_flow_payload_factory,
    ):
        with patch(
            "agent.nodes.get_llm_response",
            return_value=json.dumps(
                {
                    "extracted_slots": {},
                    "speech": "This room keeps you on the preview, and I can show another option if you like.",
                    "is_complete": False,
                    "next_slot_to_ask": None,
                }
            ),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        "preview-detail",
                        "ROOM_PREVIEW",
                        "Does this room have a balcony or a city view?",
                        filled_slots={"roomType": "Family Suite"},
                    ),
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "ROOM_PREVIEW"
        assert data["intent"] == "GENERAL_QUERY"
        assert data["selectedRoom"]["name"] == "Family Suite"

    @pytest.mark.asyncio
    async def test_chat_booking_collect_compound_turn_moves_to_booking_summary(
        self,
        override_session,
        booking_flow_payload_factory,
    ):
        with patch(
            "agent.semantic_classifier.classify_intent_semantically",
            new=AsyncMock(return_value=None),
        ), patch(
            "agent.nodes.get_llm_response",
            side_effect=[
                json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.65}),
                json.dumps({"intent": "BOOK_ROOM", "confidence": 0.95}),
                json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.65}),
            ],
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        "compound-booking-details",
                        "BOOKING_COLLECT",
                        "My name is John Carter. There will be two adults and one child. We want to check in tomorrow for two nights.",
                        filled_slots={"roomType": "Family Suite"},
                    ),
                )

        assert response.status_code == 200
        data = response.json()
        assert data["nextUiScreen"] == "BOOKING_SUMMARY"
        assert data["selectedRoom"]["name"] == "Family Suite"
        assert data["accumulatedSlots"]["guestName"] == "John Carter"
        assert data["accumulatedSlots"]["adults"] == 2
        assert data["accumulatedSlots"]["children"] == 1
        assert data["accumulatedSlots"]["checkInDate"] == "2026-03-21"
        assert data["accumulatedSlots"]["checkOutDate"] == "2026-03-23"

    @pytest.mark.asyncio
    async def test_chat_booking_summary_confirm_routes_to_payment(
        self,
        override_session,
        booking_flow_payload_factory,
        booking_summary_filled_slots,
    ):
        chat_api._persisted_booking_by_session["summary-to-payment"] = "existing-booking-id"
        with patch("agent.nodes.get_llm_response") as mock_llm:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        "summary-to-payment",
                        "BOOKING_SUMMARY",
                        "Yes, those details are correct. Please proceed to payment.",
                        filled_slots=booking_summary_filled_slots,
                    ),
                )

        mock_llm.assert_not_called()
        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == "CONFIRM_BOOKING"
        assert data["nextUiScreen"] == "PAYMENT"
        assert data["selectedRoom"]["name"] == "Family Suite"

    @pytest.mark.asyncio
    async def test_chat_booking_summary_modify_routes_to_booking_collect(
        self,
        override_session,
        booking_flow_payload_factory,
        booking_summary_filled_slots,
    ):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        "summary-to-edit",
                        "BOOKING_SUMMARY",
                        "I need to change the guest name before paying.",
                        filled_slots=booking_summary_filled_slots,
                    ),
                )

        mock_llm.assert_not_called()
        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == "MODIFY_BOOKING"
        assert data["nextUiScreen"] == "BOOKING_COLLECT"
        assert data["nextSlotToAsk"] == "guestName"
        assert data["selectedRoom"]["name"] == "Family Suite"

    @pytest.mark.asyncio
    async def test_chat_family_booking_journey_reaches_payment(
        self,
        override_session,
        booking_flow_payload_factory,
        booking_flow_context_factory,
    ):
        flow_context = booking_flow_context_factory("family-booking-journey")
        session_id = flow_context["session_id"]
        filled_slots = None

        def fake_llm(messages, temperature=0.0):
            user_text = str(messages[-1]["content"]).lower()
            if "please show me the family suite" in user_text:
                return json.dumps({"intent": "BOOK_ROOM", "confidence": 0.95})
            if "this looks good. i want to book this room" in user_text:
                return json.dumps({"intent": "BOOK_ROOM", "confidence": 0.95})
            return json.dumps({"intent": "GENERAL_QUERY", "confidence": 0.65})

        with patch(
            "agent.semantic_classifier.classify_intent_semantically",
            new=AsyncMock(return_value=None),
        ), patch(
            "agent.nodes.get_llm_response",
            side_effect=fake_llm,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                step_one = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        session_id,
                        "WELCOME",
                        "We are a family of four. Which room should we look at?",
                        filled_slots=filled_slots,
                    ),
                )
                assert step_one.status_code == 200
                assert step_one.json()["nextUiScreen"] == "ROOM_SELECT"
                filled_slots = step_one.json()["accumulatedSlots"]

                step_two = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        session_id,
                        "ROOM_SELECT",
                        "Please show me the Family Suite.",
                        filled_slots=filled_slots,
                    ),
                )
                assert step_two.status_code == 200
                assert step_two.json()["nextUiScreen"] == "ROOM_PREVIEW"
                filled_slots = step_two.json()["accumulatedSlots"]

                step_three = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        session_id,
                        "ROOM_PREVIEW",
                        "This looks good. I want to book this room.",
                        filled_slots=filled_slots,
                    ),
                )
                assert step_three.status_code == 200
                assert step_three.json()["nextUiScreen"] == "BOOKING_COLLECT"
                filled_slots = step_three.json()["accumulatedSlots"]

                step_four = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        session_id,
                        "BOOKING_COLLECT",
                        "My name is John Carter. There will be two adults and two children. We want to check in tomorrow for two nights.",
                        filled_slots=filled_slots,
                    ),
                )
                assert step_four.status_code == 200
                assert step_four.json()["nextUiScreen"] == "BOOKING_SUMMARY"
                filled_slots = step_four.json()["accumulatedSlots"]
                chat_api._persisted_booking_by_session[session_id] = "existing-booking-id"

                step_five = await client.post(
                    "/api/chat",
                    json=booking_flow_payload_factory(
                        session_id,
                        "BOOKING_SUMMARY",
                        "Yes, everything is correct. Proceed to payment.",
                        filled_slots=filled_slots,
                    ),
                )

        assert step_five.status_code == 200
        assert step_five.json()["nextUiScreen"] == "PAYMENT"
        assert step_five.json()["selectedRoom"]["name"] == "Family Suite"


class TestAPIRobustness:
    @pytest.mark.asyncio
    async def test_unknown_route_returns_404(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/nonexistent")
        assert response.status_code in {404, 405}

    @pytest.mark.asyncio
    async def test_get_on_chat_returns_method_not_allowed(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/chat")
        assert response.status_code == 405

    @pytest.mark.asyncio
    async def test_post_on_health_returns_method_not_allowed(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/health")
        assert response.status_code == 405
