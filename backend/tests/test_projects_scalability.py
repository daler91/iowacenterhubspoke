import asyncio
from types import SimpleNamespace

from routers import projects as projects_router


def test_clamp_limit_hard_bounds():
    assert projects_router._clamp_limit(-50, 200) == 1
    assert projects_router._clamp_limit(1, 200) == 1
    assert projects_router._clamp_limit(250, 200) == 200


def test_build_task_stats_large_fixture_stable(monkeypatch):
    rows = [
        {"_id": "p1", "total": 5000, "completed": 3200, "partner_overdue": 42},
        {"_id": "p2", "total": 100, "completed": 20, "partner_overdue": 5},
    ]

    class FakeAgg:
        def __aiter__(self):
            async def gen():
                for r in rows:
                    yield r
            return gen()

    fake_db = SimpleNamespace(tasks=SimpleNamespace(aggregate=lambda _pipeline: FakeAgg()))
    monkeypatch.setattr(projects_router, "db", fake_db)

    stats = asyncio.run(projects_router._build_task_stats(["p1", "p2"]))
    assert stats["p1"] == {"total": 5000, "completed": 3200, "partner_overdue": 42}
    assert stats["p2"] == {"total": 100, "completed": 20, "partner_overdue": 5}
