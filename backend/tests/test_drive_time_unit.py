"""Unit tests for drive time calculation utilities."""

import os
import sys
from unittest.mock import MagicMock

# Mock external dependencies before importing the module under test
for _mod in ["motor", "motor.motor_asyncio", "dotenv", "httpx", "sentry_sdk"]:
    sys.modules.setdefault(_mod, MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

from services.drive_time import (  # noqa: E402
    _haversine_miles,
    _estimate_drive_minutes,
    _mem_get,
    _mem_set,
    _mem_cache,
    _mem_lock,
)


def test_haversine_same_point():
    """Distance from a point to itself should be 0."""
    dist = _haversine_miles(41.5868, -93.654, 41.5868, -93.654)
    assert abs(dist) < 1e-10


def test_haversine_known_distance():
    """Des Moines to Grinnell is approximately 49 miles as the crow flies."""
    dist = _haversine_miles(41.5868, -93.654, 41.7431, -92.7224)
    assert 45 < dist < 55


def test_haversine_symmetry():
    """Distance A->B == B->A."""
    d1 = _haversine_miles(41.5868, -93.654, 42.0492, -92.9080)
    d2 = _haversine_miles(42.0492, -92.9080, 41.5868, -93.654)
    assert abs(d1 - d2) < 0.001


def test_estimate_drive_minutes_minimum():
    """Even very short distances should return at least 1 minute."""
    minutes = _estimate_drive_minutes(41.5868, -93.654, 41.5870, -93.6542)
    assert minutes >= 1


def test_estimate_drive_minutes_reasonable():
    """Estimated drive time to Grinnell (~55 mi) should be roughly 1 hour."""
    minutes = _estimate_drive_minutes(41.5868, -93.654, 41.7431, -92.7224)
    assert 50 < minutes < 120


def test_mem_cache_set_and_get():
    """In-memory cache should store and retrieve values."""
    key = "__test_cache_key__"
    try:
        _mem_set(key, 42)
        result = _mem_get(key)
        assert result == 42
    finally:
        with _mem_lock:
            _mem_cache.pop(key, None)


def test_mem_cache_miss():
    """Cache miss should return None."""
    result = _mem_get("__nonexistent_key__")
    assert result is None
