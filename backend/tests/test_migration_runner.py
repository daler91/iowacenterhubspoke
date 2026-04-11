"""Tests for the migration runner in ``backend/migrations/runner.py``.

The runner reads/writes the ``schema_migrations`` collection, so the tests
drive it against an in-memory fake Mongo that implements just enough of the
Motor API (``find``, ``update_one`` upsert, ``insert_one``) for the runner's
needs. That keeps the suite offline and lets us assert exact state
transitions without standing up a real MongoDB container.
"""

import asyncio
import os
import sys
from typing import Any, Dict, List
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest

import migrations  # noqa: E402
from migrations.runner import run_pending  # noqa: E402


# ---------- Minimal fake Mongo ---------------------------------------------

class _FakeCursor:
    def __init__(self, docs: List[Dict[str, Any]]):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for doc in self._docs:
                yield doc
        return gen()


class _FakeCollection:
    def __init__(self):
        self.docs: List[Dict[str, Any]] = []

    def find(self, query=None, projection=None):
        # Very small subset: support the filter shapes the runner uses.
        query = query or {}
        results: List[Dict[str, Any]] = []
        for doc in self.docs:
            if "status" in query and isinstance(query["status"], dict) and "$in" in query["status"]:
                if doc.get("status") not in query["status"]["$in"]:
                    continue
            results.append(doc)
        return _FakeCursor(results)

    async def update_one(self, filter_query, update, upsert=False):  # NOSONAR — mirrors Motor collection API
        target_id = filter_query.get("id")
        for doc in self.docs:
            if doc.get("id") == target_id:
                doc.update(update.get("$set", {}))
                return
        if upsert:
            new_doc = {"id": target_id}
            new_doc.update(update.get("$set", {}))
            self.docs.append(new_doc)


class _FakeDB:
    def __init__(self):
        self._collections: Dict[str, _FakeCollection] = {}

    def __getitem__(self, name: str) -> _FakeCollection:
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------- Tests ----------------------------------------------------------

@pytest.fixture(autouse=True)
def _replace_registry(monkeypatch):
    """Swap the real MIGRATIONS registry for trivial async callables so we
    can drive the runner without talking to any real schema or collections.
    """
    calls: List[str] = []

    async def mig_a(db):  # NOSONAR — must stay async to satisfy the MigrationFn contract
        calls.append("a")
        return 7

    async def mig_b(db):  # NOSONAR — must stay async to satisfy the MigrationFn contract
        calls.append("b")
        return 3

    fake_registry = [
        ("001_alpha", mig_a),
        ("002_beta", mig_b),
    ]
    monkeypatch.setattr("migrations.runner.MIGRATIONS", fake_registry)
    return calls


def test_first_run_applies_all_migrations_in_order(_replace_registry):
    db = _FakeDB()
    result = _run(run_pending(db))

    assert result == {"applied": ["001_alpha", "002_beta"], "skipped": []}
    assert _replace_registry == ["a", "b"]

    recorded = db["schema_migrations"].docs
    assert len(recorded) == 2
    assert [r["id"] for r in recorded] == ["001_alpha", "002_beta"]
    assert all(r["status"] == "applied" for r in recorded)
    assert recorded[0]["affected"] == 7
    assert recorded[1]["affected"] == 3


def test_second_run_is_a_noop(_replace_registry):
    db = _FakeDB()
    _run(run_pending(db))
    _replace_registry.clear()

    result = _run(run_pending(db))
    assert result == {"applied": [], "skipped": ["001_alpha", "002_beta"]}
    assert _replace_registry == []  # migrations not re-invoked


def test_partial_run_resumes_pending_only(_replace_registry):
    db = _FakeDB()
    # Pretend 001 was already applied in a previous run.
    _run(
        db["schema_migrations"].update_one(
            {"id": "001_alpha"},
            {"$set": {"id": "001_alpha", "status": "applied", "affected": 1}},
            upsert=True,
        )
    )

    result = _run(run_pending(db))
    assert result == {"applied": ["002_beta"], "skipped": ["001_alpha"]}
    assert _replace_registry == ["b"]


def test_failure_is_recorded_and_reraised(monkeypatch):
    async def bad(db):  # NOSONAR — must stay async to satisfy the MigrationFn contract
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "migrations.runner.MIGRATIONS",
        [("001_bad", bad)],
    )

    db = _FakeDB()
    with pytest.raises(RuntimeError, match="boom"):
        _run(run_pending(db))

    recorded = db["schema_migrations"].docs
    assert len(recorded) == 1
    assert recorded[0]["id"] == "001_bad"
    assert recorded[0]["status"] == "failed"
    assert "boom" in recorded[0]["error"]


def test_registry_ids_are_unique_and_sorted():
    """Guard against renames or reorderings of shipped migration IDs."""
    ids = [mid for mid, _ in migrations.MIGRATIONS]
    assert len(ids) == len(set(ids)), "duplicate migration id"
    assert ids == sorted(ids), "migration IDs must sort in execution order"
