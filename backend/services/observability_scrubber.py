"""Payload scrubber for data that leaves our infrastructure (Sentry).

Scrubs nested mappings/lists by key-name denylist, with explicit allowlist
exceptions for non-sensitive keys that would otherwise match broad patterns.

Stricter than ``core.sensitive_keys`` (which masks structured application
logs): this denylist also covers ``email``, ``phone`` and ``ssn``, because the
payload is sent to a third party. The log-side mask deliberately keeps those
for operational correlation. Keep the two in sync only where they overlap —
the extra PII keys here are the intended difference.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

MASK = "[REDACTED]"
DEFAULT_MAX_DEPTH = 8

DEFAULT_DENY_KEY_PARTS = (
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
    "email",
    "phone",
    "ssn",
)

# Allowlist guards against false positives from broad deny patterns.
DEFAULT_ALLOW_KEYS = {
    "session_id",
    "status_code",
    "code_version",
}


class ObservabilityScrubber:
    def __init__(
        self,
        deny_key_parts: Sequence[str] | None = None,
        allow_keys: set[str] | None = None,
        mask: str = MASK,
        max_depth: int = DEFAULT_MAX_DEPTH,
    ) -> None:
        self._deny_key_parts = tuple(
            p.lower() for p in (deny_key_parts or DEFAULT_DENY_KEY_PARTS)
        )
        self._allow_keys = {k.lower() for k in (allow_keys or DEFAULT_ALLOW_KEYS)}
        self._mask = mask
        self._max_depth = max_depth

    def is_sensitive_key(self, key: Any) -> bool:
        if not isinstance(key, str):
            return False
        lowered = key.lower()
        if lowered in self._allow_keys:
            return False
        return any(part in lowered for part in self._deny_key_parts)

    def scrub(self, payload: Any, depth: int = 0) -> Any:
        if depth >= self._max_depth:
            return payload
        if isinstance(payload, Mapping):
            out: dict[Any, Any] = {}
            for key, value in payload.items():
                if self.is_sensitive_key(key):
                    out[key] = self._mask
                else:
                    out[key] = self.scrub(value, depth + 1)
            return out
        if isinstance(payload, tuple):
            return tuple(self.scrub(v, depth + 1) for v in payload)
        if isinstance(payload, list):
            return [self.scrub(v, depth + 1) for v in payload]
        return payload


DEFAULT_OBSERVABILITY_SCRUBBER = ObservabilityScrubber()


def scrub_observability_payload(payload: Any) -> Any:
    return DEFAULT_OBSERVABILITY_SCRUBBER.scrub(payload)
