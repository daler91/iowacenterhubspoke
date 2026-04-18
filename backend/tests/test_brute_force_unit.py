"""Unit tests for per-email brute-force lockout helpers in
routers/auth.py. Motor's MotorDatabase returns a fresh MotorCollection
on every attribute access, so we can't patch ``db.login_failures``
directly — instead we swap the whole ``db`` symbol in ``routers.auth``
for a MagicMock whose ``login_failures.find_one`` is an AsyncMock.
"""

from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.auth import _is_login_locked, LOGIN_LOCKOUT_THRESHOLD


def _fake_db_with_login_failure(row):
    """Build a fake ``db`` whose ``login_failures.find_one`` returns ``row``."""
    fake = MagicMock()
    fake.login_failures.find_one = AsyncMock(return_value=row)
    # ``_is_login_locked`` cleans up stale rows when the window has
    # elapsed; stub the delete so the expired-window test doesn't
    # choke on MagicMock-awaiting.
    fake.login_failures.delete_one = AsyncMock(return_value=None)
    return fake


@pytest.mark.asyncio
async def test_unknown_email_is_not_locked(monkeypatch):
    monkeypatch.setattr("routers.auth.db", _fake_db_with_login_failure(None))
    locked, remaining = await _is_login_locked("nobody@example.com")
    assert locked is False
    assert remaining == 0


@pytest.mark.asyncio
async def test_under_threshold_is_not_locked(monkeypatch):
    row = {
        "email": "u@example.com",
        "count": max(0, LOGIN_LOCKOUT_THRESHOLD - 1),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    monkeypatch.setattr("routers.auth.db", _fake_db_with_login_failure(row))
    locked, _remaining = await _is_login_locked("u@example.com")
    assert locked is False


@pytest.mark.asyncio
async def test_at_threshold_is_locked(monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(minutes=7)
    row = {
        "email": "u@example.com",
        "count": LOGIN_LOCKOUT_THRESHOLD,
        "expires_at": future,
    }
    monkeypatch.setattr("routers.auth.db", _fake_db_with_login_failure(row))
    locked, remaining = await _is_login_locked("u@example.com")
    assert locked is True
    assert 0 < remaining <= 15 * 60


@pytest.mark.asyncio
async def test_past_expiry_window_is_not_locked(monkeypatch):
    # Even if count exceeds threshold, an already-expired window means
    # the TTL hasn't swept yet — we shouldn't block the user.
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    row = {
        "email": "u@example.com",
        "count": LOGIN_LOCKOUT_THRESHOLD + 5,
        "expires_at": past,
    }
    monkeypatch.setattr("routers.auth.db", _fake_db_with_login_failure(row))
    locked, _remaining = await _is_login_locked("u@example.com")
    assert locked is False


@pytest.mark.asyncio
async def test_iso_string_expires_at_parsed(monkeypatch):
    # Legacy rows may have stored expires_at as ISO strings. The helper
    # should parse them transparently.
    future = datetime.now(timezone.utc) + timedelta(minutes=3)
    row = {
        "email": "u@example.com",
        "count": LOGIN_LOCKOUT_THRESHOLD,
        "expires_at": future.isoformat(),
    }
    monkeypatch.setattr("routers.auth.db", _fake_db_with_login_failure(row))
    locked, remaining = await _is_login_locked("u@example.com")
    assert locked is True
    assert remaining > 0
