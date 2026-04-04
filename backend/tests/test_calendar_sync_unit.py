"""Unit tests for calendar sync time helpers."""

import os
import sys
from unittest.mock import MagicMock

# Mock external dependencies before importing the module under test
for _mod in ["motor", "motor.motor_asyncio", "dotenv", "httpx", "sentry_sdk"]:
    sys.modules.setdefault(_mod, MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

from services.calendar_sync import (  # noqa: E402
    add_minutes_to_time,
    subtract_minutes_from_time,
)


def test_add_minutes_basic():
    assert add_minutes_to_time("09:00", 30) == "09:30"


def test_add_minutes_hour_boundary():
    assert add_minutes_to_time("09:45", 30) == "10:15"


def test_add_minutes_wrap_midnight():
    assert add_minutes_to_time("23:30", 60) == "00:30"


def test_add_zero_minutes():
    assert add_minutes_to_time("14:00", 0) == "14:00"


def test_subtract_minutes_basic():
    assert subtract_minutes_from_time("09:30", 30) == "09:00"


def test_subtract_minutes_hour_boundary():
    assert subtract_minutes_from_time("10:15", 30) == "09:45"


def test_subtract_minutes_floor_at_zero():
    """Subtracting more minutes than available should floor at 00:00."""
    assert subtract_minutes_from_time("00:15", 30) == "00:00"


def test_subtract_zero_minutes():
    assert subtract_minutes_from_time("14:00", 0) == "14:00"


def test_add_large_minutes():
    """Adding several hours."""
    assert add_minutes_to_time("06:00", 180) == "09:00"


def test_subtract_large_minutes():
    """Subtracting several hours."""
    assert subtract_minutes_from_time("15:00", 180) == "12:00"
