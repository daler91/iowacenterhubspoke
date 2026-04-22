"""Unit tests for ``delete_series`` in routers/schedule_crud.py.

Three branches matter:

1. Series doesn't exist anywhere → 404.
2. Series exists with future dates → 200, deleted_count > 0.
3. Series exists but every date is in the past → 200, deleted_count == 0
   (no-op, not an error).

We monkeypatch ``routers.schedule_crud.db`` with a MagicMock the same
way ``test_brute_force_unit.py`` does, because Motor returns a fresh
collection proxy on every attribute access.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from routers.schedule_crud import delete_series


def _fake_db(modified_count: int, any_existing):
    fake = MagicMock()
    fake.schedules.update_many = AsyncMock(
        return_value=MagicMock(modified_count=modified_count)
    )
    fake.schedules.find_one = AsyncMock(return_value=any_existing)
    return fake


@pytest.mark.asyncio
async def test_delete_series_unknown_returns_404(monkeypatch):
    monkeypatch.setattr(
        "routers.schedule_crud.db",
        _fake_db(modified_count=0, any_existing=None),
    )
    with pytest.raises(HTTPException) as exc:
        await delete_series("no-such-series", {"name": "tester"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_series_with_future_dates_returns_count(monkeypatch):
    monkeypatch.setattr(
        "routers.schedule_crud.db",
        _fake_db(modified_count=3, any_existing={"id": "s1"}),
    )
    # log_activity / invalidate_workload_cache are awaited on success;
    # stub them to no-ops to keep the test free of side effects.
    monkeypatch.setattr(
        "routers.schedule_crud.log_activity", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        "routers.schedule_crud.invalidate_workload_cache",
        AsyncMock(return_value=None),
    )
    result = await delete_series("series-1", {"name": "tester"})
    assert result == {"deleted_count": 3, "series_id": "series-1"}


@pytest.mark.asyncio
async def test_delete_series_past_only_returns_zero_not_404(monkeypatch):
    # update_many matches nothing (all dates in past), but find_one finds
    # at least one record for the series → not a 404, just a no-op 200.
    monkeypatch.setattr(
        "routers.schedule_crud.db",
        _fake_db(modified_count=0, any_existing={"id": "s-past"}),
    )
    result = await delete_series("series-past", {"name": "tester"})
    assert result == {"deleted_count": 0, "series_id": "series-past"}
