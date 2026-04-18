import logging
import json
import contextvars
from datetime import datetime, timezone

from core.sensitive_keys import scrub as _scrub

request_id_var = contextvars.ContextVar("request_id", default=None)
user_var = contextvars.ContextVar("user", default=None)


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


def mask_id(value: object | None) -> str:
    """Return a non-reversible short form of an identifier for logging.

    The IDs we attach to log entries (user_id, schedule_id, project_id,
    etc.) are internal UUIDs — not PII by any reasonable definition —
    but CodeQL's clear-text-logging rule flags them on name match. This
    helper produces the same 4-dot-4 mask everywhere so we keep log
    correlation without tripping the scanner. Short values (less than
    9 chars, so no room for a 4/4 split) collapse to ``redacted``.
    """
    if value is None:
        return "redacted"
    text = str(value)
    if len(text) <= 8:
        return "redacted"
    return f"{text[:4]}...{text[-4:]}"
