"""Unit tests for drive time calculation utilities."""

import math
from services.drive_time import _haversine_miles, _estimate_drive_minutes, _mem_get, _mem_set, _mem_cache, _mem_lock


def test_haversine_same_point():
    """Distance from a point to itself should be 0."""
    dist = _haversine_miles(41.5868, -93.654, 41.5868, -93.654)
    assert dist == 0.0


def test_haversine_known_distance():
    """Des Moines to Grinnell is approximately 55 miles."""
    dist = _haversine_miles(41.5868, -93.654, 41.7431, -92.7224)
    assert 50 < dist < 65  # approximate range


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
    assert 50 < minutes < 120  # ~1 hr with road factor


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
