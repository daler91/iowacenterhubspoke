"""Credential redaction for **structured application logs**.

Used by ``core.logger`` only. Sentry payloads go through a deliberately
stricter mask in ``services.observability_scrubber`` (via ``core.sentry_scrub``)
because they leave our infrastructure: that one additionally redacts ``email``,
``phone`` and ``ssn``, which this one intentionally preserves so operators can
correlate log lines to an account. ``tests/test_logger_scrub.py`` pins that
difference — do not "unify" the two key lists without changing that test on
purpose.

An earlier version of this docstring claimed to be the single source of truth
for both paths. It never was: ``core.sentry_scrub`` has always imported from
``services.observability_scrubber``.
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
