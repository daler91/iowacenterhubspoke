import asyncio
import sys
import types
from types import SimpleNamespace


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_startup_sequence_orders_hooks(monkeypatch):
    from backend.app_factory import run_startup_sequence

    calls = []

    class _Admin:
        async def command(self, cmd):
            calls.append(("mongo", cmd))

    client = SimpleNamespace(admin=_Admin())
    db = object()
    logger = SimpleNamespace(info=lambda *a, **k: None)
    app = SimpleNamespace(state=SimpleNamespace(redis="stale"))

    async def _redis(app_):
        calls.append(("redis", None))

    async def _migrations(db_, logger_):
        calls.append(("migrations", None))

    async def _runner(db_):
        calls.append(("runner", None))

    async def _indexes(db_, logger_):
        calls.append(("indexes", None))

    async def _seeds(db_, logger_):
        calls.append(("seeds", None))

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
