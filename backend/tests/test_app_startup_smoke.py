import asyncio
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_startup_sequence_orders_hooks(monkeypatch):
    from backend.app_factory import run_startup_sequence

    calls = []

    admin = SimpleNamespace(command=AsyncMock(side_effect=lambda cmd: calls.append(("mongo", cmd))))

    client = SimpleNamespace(admin=admin)
    db = object()
    logger = SimpleNamespace(info=lambda *a, **k: None)
    app = SimpleNamespace(state=SimpleNamespace(redis="stale"))

    _redis = AsyncMock(side_effect=lambda app_: calls.append(("redis", None)))
    _migrations = AsyncMock(side_effect=lambda db_, logger_: calls.append(("migrations", None)))
    _runner = AsyncMock(side_effect=lambda db_: calls.append(("runner", None)))
    _indexes = AsyncMock(side_effect=lambda db_, logger_: calls.append(("indexes", None)))
    _seeds = AsyncMock(side_effect=lambda db_, logger_: calls.append(("seeds", None)))

    monkeypatch.setitem(sys.modules, "startup", types.ModuleType("startup"))
    monkeypatch.setitem(sys.modules, "migrations", types.ModuleType("migrations"))
    monkeypatch.setitem(sys.modules, "startup.migrations", types.SimpleNamespace(run_startup_migrations=_migrations))
    monkeypatch.setitem(sys.modules, "migrations.runner", types.SimpleNamespace(run_pending=_runner))
    monkeypatch.setitem(sys.modules, "startup.indexes", types.SimpleNamespace(ensure_indexes=_indexes))
    monkeypatch.setitem(sys.modules, "startup.seeds", types.SimpleNamespace(seed_bootstrap_data=_seeds))

    _run(run_startup_sequence(app=app, client=client, db=db, logger=logger, ensure_redis_client=_redis))

    assert app.state.redis is None
    assert calls == [
        ("mongo", "ping"),
        ("migrations", None),
        ("runner", None),
        ("indexes", None),
        ("seeds", None),
        ("redis", None),
    ]
