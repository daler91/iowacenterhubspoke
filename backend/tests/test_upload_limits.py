"""Unit tests for the streaming upload helpers in core.upload.

These cover the DoS guard on CSV import (previously `await file.read()` with
no cap): we verify ``stream_upload_to_bytes`` enforces both the byte cap and
the content-type allow-list.

Tests are driven synchronously via ``asyncio.run`` so the suite does not
require ``pytest-asyncio`` (which is not in ``backend/requirements.txt``).
"""

import asyncio
import io
import os
import sys
from typing import Optional
from unittest.mock import MagicMock

# Mirror the stub pattern used by sibling tests so the module loads without
# pulling in real Motor/dotenv/etc.
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from core.upload import (
    MAX_UPLOAD_BYTES,
    _parse_max_upload_bytes,
    stream_upload_to_bytes,
)


def _make_upload_file(payload: bytes, content_type: Optional[str] = "text/csv") -> UploadFile:
    """Build a real ``fastapi.UploadFile`` around an in-memory byte buffer.

    Using the real class (rather than a lookalike) keeps the tests honest:
    ``stream_upload_to_bytes`` is called with the exact type production code
    passes in, including starlette's ``Headers`` accessor that ``UploadFile``
    uses to derive ``content_type``.
    """
    headers = Headers({"content-type": content_type}) if content_type is not None else None
    return UploadFile(file=io.BytesIO(payload), filename="test.csv", headers=headers)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_stream_upload_to_bytes_returns_payload_under_cap():
    payload = b"date,start_time,end_time,employee_email,location_name,class_name\n"
    file = _make_upload_file(payload)
    assert _run(stream_upload_to_bytes(file)) == payload


def test_stream_upload_to_bytes_rejects_oversized_payload():
    oversized = b"x" * (MAX_UPLOAD_BYTES + 1)
    file = _make_upload_file(oversized)
    with pytest.raises(HTTPException) as exc:
        _run(stream_upload_to_bytes(file))
    assert exc.value.status_code == 413


def test_stream_upload_to_bytes_accepts_payload_at_exact_cap():
    exact = b"x" * MAX_UPLOAD_BYTES
    file = _make_upload_file(exact)
    assert _run(stream_upload_to_bytes(file)) == exact


def test_stream_upload_to_bytes_rejects_disallowed_content_type():
    file = _make_upload_file(b"anything", content_type="application/x-msdownload")
    with pytest.raises(HTTPException) as exc:
        _run(stream_upload_to_bytes(file))
    assert exc.value.status_code == 400


def test_stream_upload_to_bytes_rejects_malformed_content_type():
    file = _make_upload_file(b"anything", content_type="not/a-real/type; boundary")
    with pytest.raises(HTTPException) as exc:
        _run(stream_upload_to_bytes(file))
    assert exc.value.status_code == 400


def test_stream_upload_to_bytes_allows_missing_content_type():
    # UploadFile may report no content_type (some clients); the helper must
    # still allow the upload so long as it stays under the size cap.
    file = _make_upload_file(b"hello", content_type=None)
    assert _run(stream_upload_to_bytes(file)) == b"hello"


def test_parse_max_upload_bytes_uses_default_on_invalid_values():
    default_limit = _parse_max_upload_bytes(None)
    assert _parse_max_upload_bytes("10MB") == default_limit
    assert _parse_max_upload_bytes("") == default_limit
    assert _parse_max_upload_bytes("0") == default_limit
    assert _parse_max_upload_bytes("-1") == default_limit
