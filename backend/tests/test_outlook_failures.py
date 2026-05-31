from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from services.outlook import (
    check_outlook_availability,
    create_outlook_event,
    delete_outlook_event,
    _get_access_token_client_credentials,
    _refresh_outlook_oauth_token,
)


@pytest.mark.asyncio
async def test_check_outlook_availability_http_failure_returns_empty_and_warns(
    monkeypatch
):
    monkeypatch.setattr(
        "services.outlook._get_access_token",
        AsyncMock(return_value=("fake_token", False))
    )

    mock_client = MagicMock()
    mock_post = AsyncMock(side_effect=Exception("Connection Timeout"))
    mock_client.post = mock_post

    mock_get_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr("services.outlook._get_http_client", mock_get_client)

    with patch("services.outlook.logger.warning") as mock_logger:
        result = await check_outlook_availability(
            "test@example.com", "2024-01-01", "09:00", "10:00"
        )

    assert result == []
    mock_logger.assert_called_once_with(
        "Outlook getSchedule unreachable \u2014 availability treated as free"
    )


@pytest.mark.asyncio
async def test_create_outlook_event_http_failure_returns_none(monkeypatch):
    monkeypatch.setattr(
        "services.outlook._get_access_token",
        AsyncMock(return_value=("fake_token", False))
    )

    mock_client = MagicMock()
    mock_post = AsyncMock(side_effect=Exception("Internal Server Error"))
    mock_client.post = mock_post

    mock_get_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr("services.outlook._get_http_client", mock_get_client)

    with patch("services.outlook.logger.exception") as mock_logger:
        result = await create_outlook_event(
            email="test@example.com",
            subject="Test Event",
            location="Test Location",
            date="2024-01-01",
            start_time="09:00",
            end_time="10:00"
        )

    assert result is None
    mock_logger.assert_called_once_with(
        "Failed to create Outlook event for user"
    )


@pytest.mark.asyncio
async def test_delete_outlook_event_http_failure_returns_false(monkeypatch):
    monkeypatch.setattr(
        "services.outlook._get_access_token",
        AsyncMock(return_value=("fake_token", False))
    )

    mock_client = MagicMock()
    mock_delete = AsyncMock(side_effect=Exception("Server Unavailable"))
    mock_client.delete = mock_delete

    mock_get_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr("services.outlook._get_http_client", mock_get_client)

    with patch("services.outlook.logger.exception") as mock_logger:
        result = await delete_outlook_event("test@example.com", "event-id-123")

    assert result is False
    mock_logger.assert_called_once_with(
        "Failed to delete Outlook event %s for user", "event-id-123"
    )


@pytest.mark.asyncio
async def test_get_access_token_client_credentials_http_failure_returns_none(
    monkeypatch
):
    monkeypatch.setattr(
        "services.outlook._token_cache",
        {"access_token": None, "expires_at": 0}
    )
    monkeypatch.setattr("services.outlook.OUTLOOK_ENABLED", True)

    mock_client = MagicMock()
    mock_post = AsyncMock(side_effect=Exception("Auth Server Down"))
    mock_client.post = mock_post

    mock_get_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr("services.outlook._get_http_client", mock_get_client)

    with patch("services.outlook.logger.exception") as mock_logger:
        result = await _get_access_token_client_credentials()

    assert result is None
    msg = "Failed to acquire Microsoft Graph access token (client credentials)"
    mock_logger.assert_called_once_with(msg)


@pytest.mark.asyncio
async def test_refresh_outlook_oauth_token_http_failure_returns_none(
    monkeypatch
):
    mock_client = MagicMock()
    mock_post = AsyncMock(side_effect=Exception("OAuth Server Down"))
    mock_client.post = mock_post

    mock_get_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr("services.outlook._get_http_client", mock_get_client)

    with patch("services.outlook.logger.exception") as mock_logger:
        result = await _refresh_outlook_oauth_token("refresh_token_123")

    assert result is None
    mock_logger.assert_called_once_with(
        "Failed to refresh Outlook OAuth token"
    )
