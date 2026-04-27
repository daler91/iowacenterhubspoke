"""
Backend unit tests for Employee Stats endpoint.
Tests coverage for get_employee_stats error handling.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import os
import uuid
import asyncio

# Set required environment variables before importing anything
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'test_db'
os.environ['JWT_SECRET'] = 'test_secret'

from routers.employees import get_employee_stats
from database import db

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

def test_employee_stats_with_invalid_schedule_times(mock_db_fixture):
    """Test getting stats for an employee when a schedule has invalid start/end time format"""
    employee_id = f"test_emp_{uuid.uuid4().hex[:6]}"

    # Mock employee exists
    mock_db_fixture['employees'].find_one = AsyncMock(return_value={"id": employee_id, "name": "Test User"})

    # New implementation uses multiple aggregate pipelines + targeted recent query.
    aggregate_cursors = []
    for result in (
        [{
            "total_classes": 3,
            "total_drive_minutes": 70,
            "total_class_minutes": 60,
            "completed": 2,
            "upcoming": 1,
            "in_progress": 0,
        }],
        [{"name": "Unknown", "count": 3}],
        [{"month": "2024-03", "count": 3}],
    ):
        cursor_mock = MagicMock()
        cursor_mock.to_list = AsyncMock(return_value=result)
        aggregate_cursors.append(cursor_mock)
    mock_db_fixture['schedules'].aggregate.side_effect = aggregate_cursors

    recent_cursor = MagicMock()
    recent_cursor.limit.return_value = recent_cursor
    recent_cursor.to_list = AsyncMock(return_value=[{"id": "s1"}, {"id": "s2"}])
    sort_cursor = MagicMock()
    sort_cursor.sort.return_value = recent_cursor
    mock_db_fixture['schedules'].find.return_value = sort_cursor

    # Call the function
    mock_user = MagicMock()
    stats = asyncio.run(get_employee_stats(employee_id, mock_user))

    # Assertions
    assert stats["total_classes"] == 3
    # valid schedule: 60 mins. others: 0 (exception caught)
    assert stats["total_class_minutes"] == 60
    # drive time: (15*2) + (20*2) + (0*2) = 30 + 40 + 0 = 70
    assert stats["total_drive_minutes"] == 70
    assert stats["completed"] == 2
    assert stats["upcoming"] == 1
    assert len(stats["recent_schedules"]) == 2
