"""Unit tests for the refresh-token helpers in core/auth.

These cover the pure token functions (create/decode roundtrip, type
discrimination, expiry enforcement). End-to-end replay-detection tests
would need Motor mocking — deferred until we add mongomock-motor.
"""

import jwt
import pytest

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
