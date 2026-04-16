"""Single source of truth for the sensitive-key allowlist + redaction walker.

Used by both ``core.logger`` (masks structured log payloads) and
``core.sentry_scrub`` (masks Sentry event payloads). Having these in one
module keeps the two masks from drifting apart and satisfies the project's
duplicate-code quality gate.
"""

from typing import Any

MASK = "[REDACTED]"
MAX_DEPTH = 6

# Any key containing one of these substrings (case-insensitive) is masked.
SENSITIVE_KEY_PARTS = (
    "authorization",
    "cookie",
    "csrf",
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "private_key",
    "refresh",
    "session",
)


def is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEY_PARTS)


def scrub(value: Any, depth: int = 0) -> Any:
    """Return a copy of ``value`` with sensitive-keyed fields masked."""
    if depth >= MAX_DEPTH:
        return value
    if isinstance(value, dict):
        return {
            k: (MASK if is_sensitive_key(k) else scrub(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [scrub(v, depth + 1) for v in value]
    if isinstance(value, tuple):
        return tuple(scrub(v, depth + 1) for v in value)
    return value
