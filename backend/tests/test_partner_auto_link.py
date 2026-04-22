"""Unit tests for ``_auto_link_partner_project`` in routers/schedule_create.py.

Four cases:

1. Location is not a partner venue at all → returns ``(None, None)``.
2. Location belongs to an inactive/soft-deleted partner_org → returns
   ``(None, warning_str)`` so the scheduler is told the project wasn't
   created.
3. Active partner exists, no project linked yet → creates project,
   returns ``(project_id, None)``.
4. Active partner exists, project already linked → returns the existing
   id with no warning (idempotent replay).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.schedule_create import _auto_link_partner_project


def _stub_db():
    """Build a fresh fake ``db`` whose collection methods are AsyncMocks."""
    fake = MagicMock()
    fake.partner_orgs.find_one = AsyncMock(return_value=None)
    fake.projects.find_one = AsyncMock(return_value=None)
    fake.projects.insert_one = AsyncMock(return_value=None)
    return fake


_LOCATION = {"id": "loc-1", "city_name": "Ames"}
_USER = {"name": "Tester", "user_id": "u-1"}


@pytest.mark.asyncio
async def test_no_partner_org_returns_silent_none(monkeypatch):
    fake = _stub_db()
    # both lookups (active filter + status-agnostic fallback) return None
    fake.partner_orgs.find_one = AsyncMock(return_value=None)
    monkeypatch.setattr("routers.schedule_create.db", fake)

    result = await _auto_link_partner_project(
        {"id": "s-1"}, _LOCATION, None, _USER,
    )
    assert result == (None, None)


@pytest.mark.asyncio
async def test_inactive_partner_org_returns_warning(monkeypatch):
    fake = _stub_db()
    # First call (active filter) → None; second call (status-agnostic)
    # → an inactive record. AsyncMock's side_effect drives the sequence.
    fake.partner_orgs.find_one = AsyncMock(
        side_effect=[
            None,
            {"name": "Cedar Falls Center", "status": "paused", "deleted_at": None},
        ]
    )
    monkeypatch.setattr("routers.schedule_create.db", fake)

    project_id, warning = await _auto_link_partner_project(
        {"id": "s-1"}, _LOCATION, None, _USER,
    )
    assert project_id is None
    assert warning is not None
    assert "Cedar Falls Center" in warning
    assert "paused" in warning


@pytest.mark.asyncio
async def test_soft_deleted_partner_returns_removed_warning(monkeypatch):
    fake = _stub_db()
    fake.partner_orgs.find_one = AsyncMock(
        side_effect=[
            None,
            {"name": "Old Partner", "status": "active", "deleted_at": "2026-01-01T00:00:00Z"},
        ]
    )
    monkeypatch.setattr("routers.schedule_create.db", fake)

    project_id, warning = await _auto_link_partner_project(
        {"id": "s-1"}, _LOCATION, None, _USER,
    )
    assert project_id is None
    assert "removed" in warning


@pytest.mark.asyncio
async def test_active_partner_creates_project(monkeypatch):
    fake = _stub_db()
    fake.partner_orgs.find_one = AsyncMock(return_value={
        "id": "org-1",
        "name": "Active Partner",
        "community": "Ames",
        "venue_details": {},
    })
    fake.projects.find_one = AsyncMock(return_value=None)
    fake.projects.insert_one = AsyncMock(return_value=None)
    monkeypatch.setattr("routers.schedule_create.db", fake)
    monkeypatch.setattr(
        "routers.schedule_create.log_activity", AsyncMock(return_value=None)
    )

    project_id, warning = await _auto_link_partner_project(
        {"id": "s-1", "date": "2026-05-01", "class_id": "c-1"},
        _LOCATION,
        {"name": "Workshop"},
        _USER,
    )
    assert project_id is not None
    assert warning is None
    fake.projects.insert_one.assert_awaited_once()


@pytest.mark.asyncio
async def test_existing_linked_project_returns_idempotently(monkeypatch):
    fake = _stub_db()
    fake.partner_orgs.find_one = AsyncMock(return_value={
        "id": "org-1", "name": "Active Partner", "venue_details": {},
    })
    fake.projects.find_one = AsyncMock(return_value={"id": "existing-proj"})
    monkeypatch.setattr("routers.schedule_create.db", fake)

    project_id, warning = await _auto_link_partner_project(
        {"id": "s-1"}, _LOCATION, None, _USER,
    )
    assert project_id == "existing-proj"
    assert warning is None
    fake.projects.insert_one.assert_not_awaited()
