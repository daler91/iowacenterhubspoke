import os
import sys
from unittest.mock import MagicMock

# Mock necessary modules to avoid missing dependencies
mock_motor = MagicMock()
mock_fastapi = MagicMock()
mock_dotenv = MagicMock()

# We need a real-ish Pydantic for the schemas to load
try:
    from pydantic import BaseModel
except ImportError:
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
    mock_pydantic = MagicMock()
    mock_pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = mock_pydantic

sys.modules["motor"] = mock_motor
sys.modules["motor.motor_asyncio"] = mock_motor
sys.modules["fastapi"] = mock_fastapi
sys.modules["dotenv"] = mock_dotenv

os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "test_db"
os.environ["JWT_SECRET"] = "test_secret"

import pytest
from datetime import date
from services.schedule_utils import (
    time_to_minutes,
    calculate_class_minutes,
    add_months,
    get_start_weekday_value
)

def test_time_to_minutes():
    assert time_to_minutes("00:00") == 0
    assert time_to_minutes("01:30") == 90
    assert time_to_minutes("12:00") == 720
    assert time_to_minutes("23:59") == 1439
    assert time_to_minutes("9:00") == 540

def test_calculate_class_minutes():
    assert calculate_class_minutes("10:00", "11:30") == 90
    assert calculate_class_minutes("10:00", "10:00") == 0
    assert calculate_class_minutes("11:00", "10:00") == -60

def test_add_months():
    # Regular case
    assert add_months(date(2024, 1, 1), 1) == date(2024, 2, 1)
    # Month end adjustment (2023 is not a leap year)
    assert add_months(date(2023, 1, 31), 1) == date(2023, 2, 28)
    # Leap year case
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    # Year wrap
    assert add_months(date(2024, 12, 1), 2) == date(2025, 2, 1)
    # Multiple years wrap
    assert add_months(date(2024, 1, 1), 24) == date(2026, 1, 1)

def test_get_start_weekday_value():
    # Sunday = 0
    assert get_start_weekday_value(date(2025, 2, 23)) == 0
    # Monday = 1
    assert get_start_weekday_value(date(2025, 2, 24)) == 1
    # Saturday = 6
    assert get_start_weekday_value(date(2025, 3, 1)) == 6
