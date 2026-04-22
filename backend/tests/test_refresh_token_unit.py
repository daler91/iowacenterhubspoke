"""Unit tests for the refresh-token helpers in core/auth.

These cover the pure token functions (create/decode roundtrip, type
discrimination, expiry enforcement). End-to-end replay-detection tests
would need Motor mocking — deferred until we add mongomock-motor.
"""

import jwt
import pytest
import asyncio
from fastapi import HTTPException
from starlette.requests import Request
from unittest.mock import AsyncMock

from core import auth as _auth
from core.auth import (
    create_token,
    create_refresh_token,
    decode_refresh_token,
    REFRESH_TOKEN_LIFETIME_SECONDS,
    TOKEN_LIFETIME_SECONDS,
)


def test_refresh_token_roundtrip():
    token, jti = create_refresh_token("user-123")
    assert isinstance(token, str)
    assert isinstance(jti, str) and len(jti) >= 8

    payload = decode_refresh_token(token)
    assert payload["user_id"] == "user-123"
    assert payload["jti"] == jti
    assert payload["typ"] == "refresh"


def test_refresh_token_lifetime_longer_than_access():
    # Sanity check on the two lifetime constants so a future env tweak
    # doesn't quietly invert them (access should always be shorter than
    # the refresh that's supposed to re-issue it).
    assert TOKEN_LIFETIME_SECONDS < REFRESH_TOKEN_LIFETIME_SECONDS


def test_decode_refresh_token_rejects_access_token():
    access = create_token("user-123", "u@example.com", "U", "admin")
    with pytest.raises(Exception) as exc_info:
        decode_refresh_token(access)
    # The helper raises HTTPException(401) with "Not a refresh token".
    assert "refresh" in str(exc_info.value.detail).lower()


def test_decode_refresh_token_rejects_garbage():
    with pytest.raises(Exception) as exc_info:
        decode_refresh_token("not.a.real.jwt")
    assert "invalid" in str(exc_info.value.detail).lower()


def test_decode_refresh_token_rejects_expired():
    # Forge an expired refresh token by signing directly with the same
    # secret and an exp in the past.
    import uuid
    from datetime import datetime, timezone
    past = int(datetime.now(timezone.utc).timestamp()) - 60
    payload = {
        "user_id": "user-123",
        "jti": str(uuid.uuid4()),
        "iat": past - 100,
        "exp": past,
        "typ": "refresh",
    }
    expired = jwt.encode(payload, _auth.JWT_SECRET, algorithm=_auth.JWT_ALGORITHM)
    with pytest.raises(Exception) as exc_info:
        decode_refresh_token(expired)
    assert "expired" in str(exc_info.value.detail).lower()


def test_refresh_token_is_signed_with_jwt_secret():
    # Tampered tokens (wrong signature) should not decode.
    token, _jti = create_refresh_token("user-123")
    header, payload_b64, _sig = token.split(".")
    bogus = f"{header}.{payload_b64}.wrongsignature"
    with pytest.raises(Exception):
        decode_refresh_token(bogus)


def test_deleted_user_token_rejected_on_protected_auth_gate(monkeypatch):
    """Existing access token should 401 once account has been deleted."""
    token = create_token("deleted-user-123", "u@example.com", "U", "viewer")
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/auth/me",
        "headers": [(b"authorization", f"Bearer {token}".encode())],
    }
    request = Request(scope)

    # Simulate post-self-delete auth state check.
    monkeypatch.setattr(_auth, "_get_pwd_changed_ts", AsyncMock(return_value=(None, True)))

    async def _call():
        await _auth.get_current_user(request, authorization=f"Bearer {token}")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_call())
    assert exc_info.value.status_code == 401
    assert "deactivated" in str(exc_info.value.detail).lower()


def test_pwd_cache_marks_missing_user_as_deleted(monkeypatch):
    import importlib
    auth_mod = importlib.reload(_auth)

    user_id = "hard-deleted-1"
    auth_mod._pwd_change_cache.pop(user_id, None)

    monkeypatch.setattr(auth_mod, "_read_redis_markers", AsyncMock(return_value=(None, None)))

    class _DB:
        users = type(
            "_Users",
            (),
            {"find_one": AsyncMock(return_value=None)},
        )()

    import database
    monkeypatch.setattr(database, "db", _DB())

    changed_ts, is_deleted = asyncio.run(auth_mod._get_pwd_changed_ts(user_id))
    assert changed_ts is None
    assert is_deleted is True
    # Ensure L1 cache doesn't retain a stale "active" state for absent rows.
    assert auth_mod._pwd_change_cache[user_id][2] is True
