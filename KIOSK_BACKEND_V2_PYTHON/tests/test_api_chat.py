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
