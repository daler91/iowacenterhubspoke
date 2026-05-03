import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from routers import schedule_crud


def test_get_schedules_clamps_limit_and_has_more(monkeypatch):
    class FakeCursor:
        def __init__(self, rows):
            self.rows = rows
            self.to_list = AsyncMock(return_value=rows)

        def sort(self, *_args, **_kwargs):
            return self

        def skip(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

    fake_db = SimpleNamespace(
        schedules=SimpleNamespace(
            count_documents=AsyncMock(return_value=250),
            find=lambda *_a, **_k: FakeCursor([{"id": f"s{i}"} for i in range(200)]),
        ),
        projects=SimpleNamespace(
            find=lambda *_a, **_k: FakeCursor([]),
        ),
    )
    monkeypatch.setattr(schedule_crud, "db", fake_db)

    pagination = SimpleNamespace(skip=0, limit=1000)
    res = asyncio.run(schedule_crud.get_schedules(user={"id": "u1"}, pagination=pagination))

    assert res["limit"] == 200
    assert res["has_more"] is True
    assert isinstance(res["items"], list)
