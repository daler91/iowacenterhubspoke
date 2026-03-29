import logging
import json
import contextvars
from datetime import datetime, timezone

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
            log_entry["entity"] = record.entity

        if hasattr(record, "context") and isinstance(record.context, dict):
            log_entry.update(record.context)

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
