import logging
import json
import contextvars
from datetime import datetime, timezone
from typing import Any

request_id_var = contextvars.ContextVar("request_id", default=None)
user_var = contextvars.ContextVar("user", default=None)


# Any log field whose key matches one of these substrings (case-insensitive)
# is replaced with ``_MASK`` before the record is emitted. Mirrored from
# ``core/sentry_scrub.py`` — kept as a duplicate to avoid an import cycle
# (sentry_scrub already imports from typing only; logger is imported very
# early during server boot).
_MASK = "[REDACTED]"
_MAX_DEPTH = 6
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


class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }

        req_id = request_id_var.get()
        if req_id:
            log_entry["request_id"] = req_id

        user = user_var.get()
        if user:
            log_entry["user"] = user

        if hasattr(record, "entity"):
            log_entry["entity"] = _scrub(record.entity)

        if hasattr(record, "context") and isinstance(record.context, dict):
            log_entry.update(_scrub(record.context))

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


def setup_logging():
    # Set up root logger to use JSON formatting
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove all existing handlers from root logger
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())
    root_logger.addHandler(handler)

    # Configure external loggers to propagate and use our JSON format
    for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"]:
        logger = logging.getLogger(logger_name)
        logger.handlers = []  # Clear default handlers
        logger.propagate = True  # Rely on root logger


def get_logger(name):
    return logging.getLogger(name)
