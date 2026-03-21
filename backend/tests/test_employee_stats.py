"""
Backend unit tests for Employee Stats endpoint.
Tests coverage for get_employee_stats error handling.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import os
import uuid

# Set required environment variables before importing anything
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'test_db'
os.environ['JWT_SECRET'] = 'test_secret'

from server import get_employee_stats, db

@pytest.fixture
def mock_db_fixture():
    """Create a mock for the database"""
    # Need to patch the specific collections
    with patch.object(db, 'employees') as mock_employees, \
         patch.object(db, 'schedules') as mock_schedules:
        yield {
            'employees': mock_employees,
            'schedules': mock_schedules
        }

@pytest.mark.asyncio
async def test_employee_stats_with_invalid_schedule_times(mock_db_fixture):
    """Test getting stats for an employee when a schedule has invalid start/end time format"""
    employee_id = f"test_emp_{uuid.uuid4().hex[:6]}"

    # Mock employee exists
    mock_db_fixture['employees'].find_one = AsyncMock(return_value={"id": employee_id, "name": "Test User"})

    # Setup mock schedules
    valid_schedule = {
        "employee_id": employee_id,
        "status": "completed",
        "start_time": "10:00",
        "end_time": "11:00",
        "drive_time_minutes": 15,
        "date": "2024-03-21"
    }

    invalid_schedule = {
        "employee_id": employee_id,
        "status": "upcoming",
        "start_time": "invalid",
        "end_time": "invalid",
        "drive_time_minutes": 20,
        "date": "2024-03-21"
    }

    missing_keys_schedule = {
        "employee_id": employee_id,
        "status": "completed",
        "date": "2024-03-21"
        # start_time and end_time missing
    }

    # Mock the find().to_list() chain
    cursor_mock = MagicMock()
    cursor_mock.to_list = AsyncMock(return_value=[valid_schedule, invalid_schedule, missing_keys_schedule])
    mock_db_fixture['schedules'].find.return_value = cursor_mock

    # Call the function
    mock_user = MagicMock()
    stats = await get_employee_stats(employee_id, mock_user)

    # Assertions
    assert stats["total_classes"] == 3
    # valid schedule: 60 mins. others: 0 (exception caught)
    assert stats["total_class_minutes"] == 60
    # drive time: (15*2) + (20*2) + (0*2) = 30 + 40 + 0 = 70
    assert stats["total_drive_minutes"] == 70
    assert stats["completed"] == 2
    assert stats["upcoming"] == 1
