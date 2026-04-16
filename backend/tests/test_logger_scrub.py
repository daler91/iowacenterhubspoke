"""Verify the JSON log formatter masks sensitive keys before emission."""

import json
import logging

import pytest

from core.logger import JSONFormatter


def _build_record(extra: dict) -> logging.LogRecord:
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Event",
        args=None,
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def _format(record: logging.LogRecord) -> dict:
    return json.loads(JSONFormatter().format(record))


def test_scrubs_top_level_password_in_context():
    record = _build_record({"context": {"password": "hunter2", "email": "a@b"}})
    out = _format(record)
    assert out["password"] == "[REDACTED]"
    assert out["email"] == "a@b"


def test_scrubs_nested_dict_token():
    record = _build_record(
        {"context": {"outer": {"refresh_token": "abc", "status": "ok"}}}
    )
    out = _format(record)
    assert out["outer"]["refresh_token"] == "[REDACTED]"
    assert out["outer"]["status"] == "ok"


def test_case_insensitive_and_substring_match():
    record = _build_record(
        {"context": {"Authorization": "Bearer x", "X-CSRF-Token": "y", "name": "n"}}
    )
    out = _format(record)
    assert out["Authorization"] == "[REDACTED]"
    assert out["X-CSRF-Token"] == "[REDACTED]"
    assert out["name"] == "n"


def test_entity_attribute_is_also_scrubbed():
    record = _build_record(
        {"entity": {"user_id": "u1", "session_cookie": "zzz"}}
    )
    out = _format(record)
    assert out["entity"]["user_id"] == "u1"
    assert out["entity"]["session_cookie"] == "[REDACTED]"


def test_list_values_are_walked():
    record = _build_record(
        {"context": {"items": [{"api_key": "k1", "id": "i1"}]}}
    )
    out = _format(record)
    assert out["items"][0]["api_key"] == "[REDACTED]"
    assert out["items"][0]["id"] == "i1"
