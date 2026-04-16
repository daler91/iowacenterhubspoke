"""Sentry ``before_send`` filter that masks credentials and PII from events.

Without this filter, a 5xx raised during login or bulk-write can ship request
bodies containing passwords, JWT cookies, OAuth tokens, and calendar payloads
to Sentry. We recursively walk the event payload and mask any value whose key
matches our sensitive-key allowlist (case-insensitive, substring match so
``X-CSRF-Token`` is covered).
"""

from typing import Any
from urllib.parse import parse_qsl, urlencode

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

# Query-string parameters get an extra list. These are short enough that
# substring matching on the full _SENSITIVE_KEY_PARTS set would produce
# false positives on header/body dicts (``status_code``, ``code_version``),
# so they're only applied to the parsed ``?a=b&code=xyz`` URL segment where
# the key space is much smaller.
_SENSITIVE_QUERY_KEYS = {
    "code",
    "state",
    "id_token",
    "access_token",
    "refresh_token",
    "reset_token",
    "invite_token",
    "verify_token",
    "magic_link",
    "otp",
}


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


def _is_sensitive_query_key(key: str) -> bool:
    if _is_sensitive_key(key):
        return True
    return key.lower() in _SENSITIVE_QUERY_KEYS


def _scrub_query_string(value: Any) -> Any:
    """Mask sensitive params in a raw ``?a=b&token=xyz`` query string.

    Sentry sends ``request.query_string`` as plain text, not a dict, so the
    generic dict walker can't reach individual parameters. We parse, mask,
    and re-encode to keep the URL shape for debugging while stripping
    secrets (``token``, ``code``, reset params, etc).
    """
    if isinstance(value, str):
        pairs = parse_qsl(value, keep_blank_values=True)
        if not pairs:
            return value
        return urlencode(
            [(k, _MASK if _is_sensitive_query_key(k) else v) for k, v in pairs]
        )
    if isinstance(value, (list, tuple)):
        return type(value)(_scrub_query_string(v) for v in value)
    return _scrub(value)


def sentry_before_send(event: dict, _hint: dict) -> dict | None:
    """Recursively redact sensitive keys before Sentry transmits the event."""
    try:
        request = event.get("request")
        if isinstance(request, dict):
            for section in ("headers", "cookies", "data"):
                if section in request:
                    request[section] = _scrub(request[section])
            if "query_string" in request:
                request["query_string"] = _scrub_query_string(request["query_string"])
        for section in ("extra", "contexts", "tags", "user"):
            if section in event and isinstance(event[section], (dict, list)):
                event[section] = _scrub(event[section])
    except Exception:
        # Never let scrubbing errors break telemetry — fail open on the event
        # rather than drop it, but log nothing (we're inside Sentry's pipeline).
        pass
    return event
