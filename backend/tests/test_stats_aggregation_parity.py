"""Tests for stats endpoints using aggregation pipelines and non-truncated datasets."""
import os
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Set required environment variables before importing anything
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'test_db'
os.environ['JWT_SECRET'] = 'test_secret'

from database import db
from routers.classes import get_class_stats
from routers.employees import get_employee_stats
from routers.locations import get_location_stats


@pytest.fixture
def mock_db_fixture():
    with patch.object(db, 'schedules') as mock_schedules, \
         patch.object(db, 'projects') as mock_projects:
        yield {
            'schedules': mock_schedules,
            'projects': mock_projects,
        }


def _mock_three_aggregate_calls(mock_schedules, summary, breakdown_a, breakdown_b):
    cursors = []
    for payload in (summary, breakdown_a, breakdown_b):
        c = MagicMock()
        c.to_list = AsyncMock(return_value=payload)
        cursors.append(c)
    mock_schedules.aggregate.side_effect = cursors


def test_class_stats_aggregation_handles_more_than_1000_and_date_filters(mock_db_fixture):
    class_id = 'class-1'

    _mock_three_aggregate_calls(
        mock_db_fixture['schedules'],
        [{
            'total_schedules': 1205,
            'total_drive_minutes': 2410,
            'total_class_minutes': 3615,
            'completed': 600,
            'upcoming': 500,
            'in_progress': 105,
        }],
        [{'name': 'Employee A', 'count': 1205}],
        [{'name': 'Location A', 'count': 1205}],
    )

    recent_cursor = MagicMock()
    recent_cursor.limit.return_value = recent_cursor
    recent_cursor.to_list = AsyncMock(return_value=[{'id': f's{i}'} for i in range(10)])
    sort_cursor = MagicMock()
    sort_cursor.sort.return_value = recent_cursor
    mock_db_fixture['schedules'].find.return_value = sort_cursor

    projects_cursor = MagicMock()
    projects_cursor.to_list = AsyncMock(return_value=[
        {'phase': 'complete', 'attendance_count': 20, 'warm_leads': 3},
        {'phase': 'planning', 'attendance_count': 5, 'warm_leads': 1},
    ])
    mock_db_fixture['projects'].find.return_value = projects_cursor

    with patch('routers.classes.classes_repo.get_by_id', AsyncMock(return_value={'id': class_id, 'name': 'Class A'})):
        stats = asyncio.run(get_class_stats(class_id, {'id': 'u-1'}, start_date='2026-01-01', end_date='2026-12-31'))

    assert stats['total_schedules'] == 1205
    assert stats['completed'] == 600
    assert len(stats['recent_schedules']) == 10

    first_pipeline = mock_db_fixture['schedules'].aggregate.call_args_list[0].args[0]
    assert first_pipeline[0]['$match']['date'] == {'$gte': '2026-01-01', '$lte': '2026-12-31'}


def test_location_stats_aggregation_handles_more_than_1000_and_date_filters(mock_db_fixture):
    location_id = 'loc-1'

    _mock_three_aggregate_calls(
        mock_db_fixture['schedules'],
        [{
            'total_schedules': 1400,
            'total_drive_minutes': 2800,
            'total_class_minutes': 4200,
            'completed': 800,
            'upcoming': 500,
            'in_progress': 100,
        }],
        [{'name': 'Employee A', 'count': 1200}, {'name': 'Employee B', 'count': 200}],
        [{'name': 'Class A', 'count': 700}, {'name': 'Class B', 'count': 700}],
    )

    recent_cursor = MagicMock()
    recent_cursor.limit.return_value = recent_cursor
    recent_cursor.to_list = AsyncMock(return_value=[{'id': f's{i}'} for i in range(10)])
    sort_cursor = MagicMock()
    sort_cursor.sort.return_value = recent_cursor
    mock_db_fixture['schedules'].find.return_value = sort_cursor

    with patch('routers.locations.locations_repo.get_by_id', AsyncMock(return_value={'id': location_id, 'city_name': 'Des Moines'})):
        stats = asyncio.run(get_location_stats(location_id, {'id': 'u-1'}, start_date='2026-02-01', end_date='2026-02-28'))

    assert stats['total_schedules'] == 1400
    assert stats['in_progress'] == 100
    assert len(stats['recent_schedules']) == 10

    first_pipeline = mock_db_fixture['schedules'].aggregate.call_args_list[0].args[0]
    assert first_pipeline[0]['$match']['date'] == {'$gte': '2026-02-01', '$lte': '2026-02-28'}
    class_breakdown_pipeline = mock_db_fixture['schedules'].aggregate.call_args_list[2].args[0]
    class_id_expr = class_breakdown_pipeline[1]['$group']['_id']
    assert class_id_expr['$let']['in']['$cond'][0] == {'$eq': ['$$class_name', '']}


def test_employee_stats_aggregation_handles_more_than_1000(mock_db_fixture):
    employee_id = 'emp-1'

    _mock_three_aggregate_calls(
        mock_db_fixture['schedules'],
        [{
            'total_classes': 1300,
            'total_drive_minutes': 2600,
            'total_class_minutes': 3900,
            'completed': 900,
            'upcoming': 300,
            'in_progress': 100,
        }],
        [{'name': 'Location A', 'count': 1300}],
        [{'month': '2026-03', 'count': 1300}],
    )

    recent_cursor = MagicMock()
    recent_cursor.limit.return_value = recent_cursor
    recent_cursor.to_list = AsyncMock(return_value=[{'id': f's{i}'} for i in range(10)])
    sort_cursor = MagicMock()
    sort_cursor.sort.return_value = recent_cursor
    mock_db_fixture['schedules'].find.return_value = sort_cursor

    with patch.object(db, 'employees') as mock_employees:
        mock_employees.find_one = AsyncMock(return_value={'id': employee_id, 'name': 'Employee A'})
        stats = asyncio.run(get_employee_stats(employee_id, {'id': 'u-1'}))

    assert stats['total_classes'] == 1300
    assert stats['completed'] == 900
    assert len(stats['recent_schedules']) == 10
