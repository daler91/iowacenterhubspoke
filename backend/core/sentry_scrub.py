"""Sentry ``before_send`` filter that masks credentials and PII from events.

Without this filter, a 5xx raised during login or bulk-write can ship request
bodies containing passwords, JWT cookies, OAuth tokens, and calendar payloads
to Sentry. We recursively walk the event payload and mask any value whose key
matches our sensitive-key allowlist (case-insensitive, substring match so
``X-CSRF-Token`` is covered).
"""

from typing import Any

_MASK = "[REDACTED]"
_MAX_DEPTH = 6

# Any key containing one of these substrings (case-insensitive) is masked.
_SENSITIVE_KEY_PARTS = (
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


def _is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return any(part in lowered for part in _SENSITIVE_KEY_PARTS)


def _scrub(value: Any, depth: int = 0) -> Any:
    if depth >= _MAX_DEPTH:
        return value
    if isinstance(value, dict):
        return {
            k: (_MASK if _is_sensitive_key(k) else _scrub(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub(v, depth + 1) for v in value]
    if isinstance(value, tuple):
        return tuple(_scrub(v, depth + 1) for v in value)
    return value


def sentry_before_send(event: dict, hint: dict) -> dict | None:
    """Recursively redact sensitive keys before Sentry transmits the event."""
    try:
        request = event.get("request")
        if isinstance(request, dict):
            for section in ("headers", "cookies", "data", "query_string"):
                if section in request:
                    request[section] = _scrub(request[section])
        for section in ("extra", "contexts", "tags", "user"):
            if section in event and isinstance(event[section], (dict, list)):
                event[section] = _scrub(event[section])
    except Exception:
        # Never let scrubbing errors break telemetry — fail open on the event
        # rather than drop it, but log nothing (we're inside Sentry's pipeline).
        pass
    return event
