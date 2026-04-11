"""Tests for ``core.repository.SoftDeleteRepository``.

Exercises the contract documented in the module docstring:
- The ``deleted_at: None`` filter is injected automatically.
- ``soft_delete`` / ``restore`` flip state without touching deleted-by metadata
  by accident.
- ``paginate`` returns ``(items, total)`` and respects sort / skip / limit.

Uses a minimal in-memory fake Mongo collection so the suite doesn't need a
real MongoDB. The fake intentionally supports only the operations the
repository actually issues — adding more surface area here would drift out
of sync with the real Motor API.
"""

import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest  # noqa: E402

from core.pagination import PaginationParams  # noqa: E402
from core.repository import SoftDeleteRepository  # noqa: E402


# ---------- Fake Mongo -----------------------------------------------------

def _matches(doc: Dict[str, Any], query: Dict[str, Any]) -> bool:
    for key, value in query.items():
        actual = doc.get(key)
        if isinstance(value, dict):
            for op, arg in value.items():
                if op == "$ne" and actual == arg:
                    return False
                if op == "$in" and actual not in arg:
                    return False
        else:
            if actual != value:
                return False
    return True


@dataclass
class _UpdateResult:
    matched_count: int
    modified_count: int


class _FakeCursor:
    def __init__(self, docs: List[Dict[str, Any]]):
        self._docs = docs
        self._sort: Optional[List] = None
        self._skip = 0
        self._limit: Optional[int] = None

    def sort(self, spec):
        self._sort = spec
        return self

    def skip(self, n: int):
        self._skip = n
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    async def to_list(self, _length):
        results = list(self._docs)
        if self._sort:
            for field, direction in reversed(self._sort):
                results.sort(
                    key=lambda d, f=field: d.get(f),
                    reverse=(direction == -1),
                )
        if self._skip:
            results = results[self._skip:]
        if self._limit:
            results = results[: self._limit]
        return results


class _FakeCollection:
    def __init__(self, seed: Optional[List[Dict[str, Any]]] = None):
        self.docs: List[Dict[str, Any]] = list(seed or [])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for doc in self.docs:
            if _matches(doc, query):
                return {k: v for k, v in doc.items() if k != "_id"}
        return None

    def find(self, query=None, projection=None):
        query = query or {}
        matched = [
            {k: v for k, v in doc.items() if k != "_id"}
            for doc in self.docs
            if _matches(doc, query)
        ]
        return _FakeCursor(matched)

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for doc in self.docs if _matches(doc, query))

    async def update_one(self, filter_query, update):
        for doc in self.docs:
            if _matches(doc, filter_query):
                set_ops = update.get("$set", {})
                unset_ops = update.get("$unset", {})
                doc.update(set_ops)
                for key in unset_ops:
                    doc.pop(key, None)
                return _UpdateResult(matched_count=1, modified_count=1)
        return _UpdateResult(matched_count=0, modified_count=0)


class _FakeDB:
    def __init__(self, collections: Dict[str, _FakeCollection]):
        self._collections = collections

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collections[name]


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------- Fixtures -------------------------------------------------------

@pytest.fixture
def repo() -> SoftDeleteRepository:
    collection = _FakeCollection(
        [
            {"id": "a", "name": "Alpha", "deleted_at": None},
            {"id": "b", "name": "Beta", "deleted_at": None},
            {"id": "c", "name": "Gamma", "deleted_at": "2025-01-01T00:00:00+00:00"},
            {"id": "d", "name": "Delta", "deleted_at": None},
        ]
    )
    db = _FakeDB({"items": collection})
    return SoftDeleteRepository(db, "items")


# ---------- Tests ----------------------------------------------------------

def test_find_active_hides_deleted_docs(repo):
    items = _run(repo.find_active({}))
    ids = sorted(i["id"] for i in items)
    assert ids == ["a", "b", "d"]  # "c" is soft-deleted


def test_find_one_active_ignores_soft_deleted(repo):
    assert _run(repo.find_one_active({"id": "c"})) is None
    doc = _run(repo.find_one_active({"id": "a"}))
    assert doc is not None and doc["name"] == "Alpha"


def test_get_by_id_wrapper(repo):
    doc = _run(repo.get_by_id("a"))
    assert doc["name"] == "Alpha"
    assert _run(repo.get_by_id("c")) is None  # soft-deleted
    assert _run(repo.get_by_id("nonexistent")) is None


def test_paginate_returns_items_and_total(repo):
    pagination = PaginationParams(skip=0, limit=2)
    items, total = _run(repo.paginate({}, pagination, sort=[("name", 1)]))
    assert total == 3  # only active docs
    assert [i["id"] for i in items] == ["a", "b"]


def test_paginate_skip(repo):
    pagination = PaginationParams(skip=1, limit=10)
    items, total = _run(repo.paginate({}, pagination, sort=[("name", 1)]))
    assert total == 3
    assert [i["id"] for i in items] == ["b", "d"]


def test_paginated_response_envelope(repo):
    pagination = PaginationParams(skip=0, limit=2)
    res = _run(repo.paginated_response({}, pagination, sort=[("name", 1)]))
    assert set(res.keys()) == {"items", "total", "skip", "limit"}
    assert res["total"] == 3
    assert res["skip"] == 0
    assert res["limit"] == 2
    assert len(res["items"]) == 2


def test_soft_delete_flips_deleted_at_and_returns_true(repo):
    assert _run(repo.soft_delete("a", deleted_by="tester")) is True
    # A second soft-delete is a no-op because the first already set deleted_at.
    assert _run(repo.soft_delete("a")) is False
    # The repo's active lookups no longer see it.
    assert _run(repo.get_by_id("a")) is None
    # And it no longer counts.
    assert _run(repo.count_active()) == 2


def test_soft_delete_missing_id_returns_false(repo):
    assert _run(repo.soft_delete("nonexistent")) is False


def test_restore_previously_deleted_doc(repo):
    # "c" is soft-deleted in the fixture.
    assert _run(repo.restore("c")) is True
    doc = _run(repo.get_by_id("c"))
    assert doc is not None and doc["name"] == "Gamma"
    assert doc.get("deleted_at") is None


def test_restore_already_active_is_noop(repo):
    assert _run(repo.restore("a")) is False


def test_update_active_sets_fields(repo):
    assert _run(repo.update_active("a", {"name": "Alpha!"})) is True
    doc = _run(repo.get_by_id("a"))
    assert doc["name"] == "Alpha!"


def test_update_active_ignores_soft_deleted(repo):
    assert _run(repo.update_active("c", {"name": "Should not apply"})) is False
