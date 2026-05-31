import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

# Mock external dependencies before importing the module under test
for _mod in ["motor", "motor.motor_asyncio", "dotenv", "sentry_sdk", "httpx"]:
    sys.modules.setdefault(_mod, MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

import pytest  # noqa: E402
from services.outlook import create_outlook_event, GRAPH_BASE_URL  # noqa: E402


@pytest.mark.asyncio
@patch("services.outlook._get_http_client")
@patch("services.outlook._get_access_token")
async def test_create_outlook_event_delegated(mock_get_token, mock_get_client):
    mock_get_token.return_value = ("fake-token", True)

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "event-123"}

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_resp
    mock_get_client.return_value = mock_client

    result = await create_outlook_event(
        email="user@example.com",
        subject="Test Event",
        location="Conference Room",
        date="2023-10-25",
        start_time="09:00",
        end_time="10:00",
        notes="Discuss testing",
        employee={"outlook_refresh_token": "some-token"}
    )

    assert result == "event-123"

    mock_client.post.assert_called_once()
    args, kwargs = mock_client.post.call_args
    assert args[0] == f"{GRAPH_BASE_URL}/me/events"
    assert kwargs["headers"]["Authorization"] == "Bearer fake-token"
    assert kwargs["json"]["subject"] == "Test Event"
    assert kwargs["json"]["location"]["displayName"] == "Conference Room"
    assert kwargs["json"]["start"]["dateTime"] == "2023-10-25T09:00:00"
    assert kwargs["json"]["end"]["dateTime"] == "2023-10-25T10:00:00"
    assert kwargs["json"]["body"]["content"] == "Discuss testing"


@pytest.mark.asyncio
@patch("services.outlook._get_http_client")
@patch("services.outlook._get_access_token")
async def test_create_outlook_event_application(mock_get_token, mock_get_client):
    mock_get_token.return_value = ("fake-token", False)

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "event-456"}

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_resp
    mock_get_client.return_value = mock_client

    result = await create_outlook_event(
        email="user@example.com",
        subject="Test Event",
        location="Conference Room",
        date="2023-10-25",
        start_time="09:00",
        end_time="10:00",
    )

    assert result == "event-456"

    mock_client.post.assert_called_once()
    args, kwargs = mock_client.post.call_args
    assert args[0] == f"{GRAPH_BASE_URL}/users/user@example.com/events"
    assert kwargs["headers"]["Authorization"] == "Bearer fake-token"


@pytest.mark.asyncio
@patch("services.outlook._get_http_client")
@patch("services.outlook._get_access_token")
async def test_create_outlook_event_no_token(mock_get_token, mock_get_client):
    mock_get_token.return_value = (None, False)

    result = await create_outlook_event(
        email="user@example.com",
        subject="Test Event",
        location="Conference Room",
        date="2023-10-25",
        start_time="09:00",
        end_time="10:00",
    )

    assert result is None
    mock_get_client.assert_not_called()


@pytest.mark.asyncio
@patch("services.outlook._get_http_client")
@patch("services.outlook._get_access_token")
async def test_create_outlook_event_http_error(mock_get_token, mock_get_client):
    mock_get_token.return_value = ("fake-token", True)

    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = Exception("HTTP Error")

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_resp
    mock_get_client.return_value = mock_client

    result = await create_outlook_event(
        email="user@example.com",
        subject="Test Event",
        location="Conference Room",
        date="2023-10-25",
        start_time="09:00",
        end_time="10:00",
    )

    assert result is None
    mock_client.post.assert_called_once()
