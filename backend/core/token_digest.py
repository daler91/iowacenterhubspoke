"""Helpers for storing bearer-style tokens without persisting raw secrets."""

import hashlib
import hmac
import os

from core.auth import JWT_SECRET


def token_digest(token: str) -> str:
    """Return a stable HMAC digest for lookup-only token storage."""
    secret = os.environ.get("TOKEN_DIGEST_SECRET") or JWT_SECRET
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()
