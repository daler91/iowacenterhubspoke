"""``restore_schedule`` must stay idempotent after the repository migration.

The endpoint used to run ``update_one({"id": ...}, {"$set": {"deleted_at":
None}})`` and 404 only on ``matched_count == 0`` — so restoring a schedule
that was already active returned 200. ``SoftDeleteRepository.restore`` filters
on ``deleted_at: {"$ne": None}`` and returns False for *both* "no such id" and
"already active", which would have quietly turned the second case into a 404.

That difference is invisible in the happy path and only shows up on a retry:
a double-clicked restore button, or a client resending after a network
timeout. Nothing covered it before, which is why it is covered here.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from conftest import use_fake_db
from routers import schedule_crud
from routers.schedule_crud import restore_schedule


def _fake_db(*, modified_count: int, existing_row):
    """modified_count: what the restore write reports.
    existing_row: what the id-existence probe finds (None = unknown id).
    """
    fake = MagicMock()
    fake.schedules.update_one = AsyncMock(
        return_value=MagicMock(modified_count=modified_count),
    )
    fake.schedules.find_one = AsyncMock(return_value=existing_row)
    return fake


@pytest.fixture(autouse=True)
def _no_side_effects(monkeypatch):
    monkeypatch.setattr(
        "routers.schedule_crud.log_activity", AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "routers.schedule_crud.invalidate_workload_cache",
        AsyncMock(return_value=None),
    )


@pytest.mark.asyncio
async def test_restoring_a_deleted_schedule_succeeds(monkeypatch):
    use_fake_db(
        monkeypatch, schedule_crud,
        _fake_db(modified_count=1, existing_row={"id": "s1"}),
    )
    result = await restore_schedule("s1", {"name": "tester"})
    assert result == {"message": "Schedule restored"}


@pytest.mark.asyncio
async def test_restoring_an_already_active_schedule_is_a_200_not_a_404(monkeypatch):
    """The regression the migration could have introduced."""
    fake = _fake_db(modified_count=0, existing_row={"id": "s1"})
    use_fake_db(monkeypatch, schedule_crud, fake)

    result = await restore_schedule("s1", {"name": "tester"})
    assert result == {"message": "Schedule restored"}

    # The existence probe must ignore deleted_at — that is what separates
    # "already active" from "no such schedule".
    probe_filter = fake.schedules.find_one.call_args.args[0]
    assert "deleted_at" not in probe_filter


@pytest.mark.asyncio
async def test_restoring_an_unknown_schedule_still_404s(monkeypatch):
    use_fake_db(
        monkeypatch, schedule_crud,
        _fake_db(modified_count=0, existing_row=None),
    )
    with pytest.raises(HTTPException) as exc:
        await restore_schedule("no-such-schedule", {"name": "tester"})
    assert exc.value.status_code == 404
