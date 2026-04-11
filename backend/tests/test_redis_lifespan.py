"""Tests for the Redis helpers in ``backend/server.py``.

These pin the reconnect semantics documented on ``_ensure_redis_client``
and ``_probe_redis``: if Redis was unreachable at app startup, the health
check must be able to bring the cached client back up without a container
restart.

The real FastAPI app in ``server.py`` pulls in JWT/cryptography at import
time, so the test uses a minimal stand-in that exposes just the ``state``
namespace the helpers touch. That also keeps the suite offline.
"""

import asyncio
import os
import sys
import types
from typing import Optional
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _FakeApp:
    """Minimal stand-in for ``FastAPI`` — only the attributes the helpers read."""

    def __init__(self):
        self.state = types.SimpleNamespace(redis=None)


class _FakeRedisClient:
    """Records ping / close activity so tests can assert the reconnect flow."""

    def __init__(self, *, ping_result: bool = True):
        self._ping_result = ping_result
        self.ping_calls = 0
        self.close_calls = 0

    async def ping(self):  # NOSONAR — mirrors redis.asyncio client API
        self.ping_calls += 1
        if self._ping_result is True:
            return True
        raise ConnectionError("simulated redis outage")

    async def aclose(self):  # NOSONAR — mirrors redis.asyncio client API
        self.close_calls += 1


def _install_fake_redis_module(
    monkeypatch,
    client_factory,
):
    """Patch ``redis.asyncio.from_url`` to return the provided client."""

    async_ns = types.SimpleNamespace(
        from_url=lambda *args, **kwargs: client_factory(),
    )
    redis_mod = types.ModuleType("redis")
    redis_async_mod = types.ModuleType("redis.asyncio")
    # The helper does ``import redis.asyncio as _async_redis`` then calls
    # ``_async_redis.from_url(...)`` — mirror that surface on the fake.
    redis_async_mod.from_url = async_ns.from_url
    redis_mod.asyncio = redis_async_mod
    monkeypatch.setitem(sys.modules, "redis", redis_mod)
    monkeypatch.setitem(sys.modules, "redis.asyncio", redis_async_mod)


import pytest


@pytest.fixture
def server_helpers(monkeypatch):
    """Import ``_ensure_redis_client`` / ``_probe_redis`` without triggering
    the full ``server.py`` module load. We execute just the helper snippets
    in an isolated namespace because importing ``server`` transitively
    pulls in ``core.auth`` → ``cryptography`` which is broken in the local
    sandbox. CI uses the real import path via ``pytest tests/``.
    """
    import importlib
    import importlib.util
    import pathlib

    server_path = pathlib.Path(__file__).parent.parent / "server.py"
    source = server_path.read_text()

    # Extract the helper function block (``_safe_aclose``, plus
    # ``_ensure_redis_client`` / ``_probe_redis``) out of ``server.py`` so we
    # can exec them into an isolated namespace. Starts at the first line
    # that begins one of the helpers and stops at the lifespan context
    # manager decorator.
    helper_src = []
    capture = False
    for line in source.splitlines():
        if line.startswith("async def _safe_aclose"):
            capture = True
        if capture:
            if line.startswith("@asynccontextmanager"):
                break
            helper_src.append(line)

    module_globals: dict = {
        "__name__": "server_helpers_under_test",
        "__builtins__": __builtins__,
        "os": os,
        "logger": MagicMock(),
        "DEFAULT_REDIS_URL": "redis://localhost:6379",
        "FastAPI": _FakeApp,  # the type annotation only
    }
    exec("\n".join(helper_src), module_globals)
    return module_globals


def test_ensure_client_builds_and_caches_on_success(server_helpers, monkeypatch):
    fake = _FakeRedisClient(ping_result=True)
    _install_fake_redis_module(monkeypatch, lambda: fake)

    app = _FakeApp()
    result = _run(server_helpers["_ensure_redis_client"](app))

    assert result is fake
    assert app.state.redis is fake
    assert fake.ping_calls == 1


def test_ensure_client_returns_none_when_ping_fails(server_helpers, monkeypatch):
    fake = _FakeRedisClient(ping_result=False)
    _install_fake_redis_module(monkeypatch, lambda: fake)

    app = _FakeApp()
    result = _run(server_helpers["_ensure_redis_client"](app))

    assert result is None
    assert app.state.redis is None
    # Regression for Codex P2: the just-created client must be closed on the
    # exception path, otherwise every failing probe leaks a connection pool.
    assert fake.close_calls == 1


def test_ensure_client_closes_freshly_created_pool_on_repeated_failures(
    server_helpers, monkeypatch,
):
    """If Redis is down for multiple probes in a row, each ``from_url`` call
    must be followed by an ``aclose`` so file descriptors and memory aren't
    leaked one pool per probe."""
    created: list[_FakeRedisClient] = []

    def _factory():
        client_ = _FakeRedisClient(ping_result=False)
        created.append(client_)
        return client_

    _install_fake_redis_module(monkeypatch, _factory)

    app = _FakeApp()
    for _ in range(3):
        assert _run(server_helpers["_ensure_redis_client"](app)) is None

    assert len(created) == 3
    # Every client we built was explicitly closed — no leaked pools.
    assert all(c.close_calls == 1 for c in created)


def test_probe_reuses_healthy_cached_client(server_helpers, monkeypatch):
    fake = _FakeRedisClient(ping_result=True)
    app = _FakeApp()
    app.state.redis = fake

    # Bomb redis.asyncio.from_url — we should NOT hit it when the cached
    # client is healthy.
    def _should_not_reconnect():
        raise AssertionError("probe should not reconnect when cached client is healthy")

    _install_fake_redis_module(monkeypatch, _should_not_reconnect)

    assert _run(server_helpers["_probe_redis"](app)) is True
    assert fake.ping_calls == 1
    assert app.state.redis is fake


def test_probe_reconnects_after_cached_client_goes_stale(server_helpers, monkeypatch):
    stale = _FakeRedisClient(ping_result=False)
    fresh = _FakeRedisClient(ping_result=True)

    call_count = {"n": 0}

    def _factory():
        call_count["n"] += 1
        return fresh

    _install_fake_redis_module(monkeypatch, _factory)

    app = _FakeApp()
    app.state.redis = stale

    assert _run(server_helpers["_probe_redis"](app)) is True
    # Stale client was closed, fresh was created and pinged twice
    # (once inside ``_ensure_redis_client`` to validate, once inside
    # ``_probe_redis`` after the ensure returns).
    assert stale.close_calls == 1
    assert call_count["n"] == 1
    assert app.state.redis is fresh
    assert fresh.ping_calls >= 1


def test_probe_returns_false_when_no_client_available(server_helpers, monkeypatch):
    _install_fake_redis_module(
        monkeypatch,
        lambda: _FakeRedisClient(ping_result=False),
    )
    app = _FakeApp()
    assert _run(server_helpers["_probe_redis"](app)) is False
    assert app.state.redis is None


def test_ensure_client_after_boot_time_failure_can_recover(server_helpers, monkeypatch):
    """First boot: Redis is down → cache is None. Next probe: Redis is up →
    cache repopulates and subsequent health checks return healthy."""
    results = [False, True]
    ping_decisions = iter(results)

    def _factory():
        return _FakeRedisClient(ping_result=next(ping_decisions))

    _install_fake_redis_module(monkeypatch, _factory)

    app = _FakeApp()

    # Boot probe fails.
    assert _run(server_helpers["_ensure_redis_client"](app)) is None
    assert app.state.redis is None

    # Next probe (e.g. a health check hit five minutes later) tries again
    # and succeeds.
    assert _run(server_helpers["_probe_redis"](app)) is True
    assert app.state.redis is not None
