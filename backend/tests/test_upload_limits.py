"""Unit tests for the streaming upload helpers in core.upload.

These cover the DoS guard on CSV import (previously `await file.read()` with
no cap): we verify ``stream_upload_to_bytes`` enforces both the byte cap and
the content-type allow-list.

Tests are driven synchronously via ``asyncio.run`` so the suite does not
require ``pytest-asyncio`` (which is not in ``backend/requirements.txt``).
"""

import asyncio
import os
import sys
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
from fastapi import HTTPException

from core.upload import (
    MAX_UPLOAD_BYTES,
    stream_upload_to_bytes,
)


class _FakeUploadFile:
    """Minimal UploadFile stand-in exposing the attributes the helper touches."""

    def __init__(self, payload: bytes, content_type: str = "text/csv"):
        self._buf = payload
        self._pos = 0
        self.content_type = content_type

    async def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk = self._buf[self._pos:]
            self._pos = len(self._buf)
            return chunk
        chunk = self._buf[self._pos:self._pos + size]
        self._pos += len(chunk)
        return chunk


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_stream_upload_to_bytes_returns_payload_under_cap():
    payload = b"date,start_time,end_time,employee_email,location_name,class_name\n"
    file = _FakeUploadFile(payload)
    assert _run(stream_upload_to_bytes(file)) == payload


def test_stream_upload_to_bytes_rejects_oversized_payload():
    oversized = b"x" * (MAX_UPLOAD_BYTES + 1)
    file = _FakeUploadFile(oversized)
    with pytest.raises(HTTPException) as exc:
        _run(stream_upload_to_bytes(file))
    assert exc.value.status_code == 413


def test_stream_upload_to_bytes_rejects_disallowed_content_type():
    file = _FakeUploadFile(b"anything", content_type="application/x-msdownload")
    with pytest.raises(HTTPException) as exc:
        _run(stream_upload_to_bytes(file))
    assert exc.value.status_code == 400


def test_stream_upload_to_bytes_allows_missing_content_type():
    # UploadFile may report no content_type (some clients); the helper must
    # still allow the upload so long as it stays under the size cap.
    file = _FakeUploadFile(b"hello", content_type=None)
    assert _run(stream_upload_to_bytes(file)) == b"hello"
