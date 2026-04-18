"""
Backend unit tests for Workload Stats endpoint.
Tests coverage for get_workload_stats error handling.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import os
import uuid

# Set required environment variables before importing anything
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "test_db"
os.environ["JWT_SECRET"] = "test_secret"

from routers.reports import get_workload_stats  # noqa: E402
from database import db  # noqa: E402


@pytest.fixture
def mock_db_fixture():
    """Create a mock for the database"""
    # Need to patch the specific collections
    with patch.object(db, "employees") as mock_employees, patch.object(
        db, "schedules"
    ) as mock_schedules:
        yield {"employees": mock_employees, "schedules": mock_schedules}


@pytest.mark.asyncio
async def test_workload_stats_with_invalid_schedule_times(mock_db_fixture):
    """Test getting workload stats when a schedule has invalid time format"""
    employee_id = f"test_emp_{uuid.uuid4().hex[:6]}"

    # Mock employee exists
    emp_cursor_mock = MagicMock()
    emp_cursor_mock.to_list = AsyncMock(
        return_value=[
            {"id": employee_id, "name": "Test User", "color": "#123456"}
        ]
    )
    mock_db_fixture["employees"].find.return_value = emp_cursor_mock

    # Setup mock schedules — the workload aggregator reads employee_ids
    # (the multi-employee array), not the legacy employee_id scalar.
    valid_schedule = {
        "employee_ids": [employee_id],
        "status": "completed",
        "start_time": "10:00",
        "end_time": "11:00",
        "drive_time_minutes": 15,
        "date": "2024-03-21",
        "class_id": "class1",
        "class_name": "Math",
    }

    invalid_schedule = {
        "employee_ids": [employee_id],
        "status": "upcoming",
        "start_time": "invalid",
        "end_time": "invalid",
        "drive_time_minutes": 20,
        "date": "2024-03-21",
        "class_id": "class1",
        "class_name": "Math",
    }

    missing_keys_schedule = {
        "employee_ids": [employee_id],
        "status": "completed",
        "date": "2024-03-21",
        "class_id": "class2",
        "class_name": "Science",
        # start_time and end_time missing
    }

    # Mock the find().to_list() chain
    cursor_mock = MagicMock()
    cursor_mock.to_list = AsyncMock(
        return_value=[valid_schedule, invalid_schedule, missing_keys_schedule]
    )
    mock_db_fixture["schedules"].find.return_value = cursor_mock

    # Call the function
    mock_user = MagicMock()
    stats_list = await get_workload_stats(mock_user)

    assert len(stats_list) == 1
    stats = stats_list[0]

    # Assertions
    assert stats["total_classes"] == 3
    # valid schedule: 60 mins -> class hours 1.0. others: 0
    assert stats["total_class_hours"] == pytest.approx(1.0)
    # drive time: 30 + 40 + 0 = 70 mins
    assert stats["total_drive_hours"] == pytest.approx(round(70 / 60, 1))
    assert stats["completed"] == 2
    assert stats["upcoming"] == 1
