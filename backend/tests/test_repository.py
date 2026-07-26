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
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

import pytest  # noqa: E402

from core.pagination import PaginationParams  # noqa: E402
from core.repository import SoftDeleteRepository  # noqa: E402


# ---------- Fake Mongo -----------------------------------------------------
#
# ``_matches`` used to be a single function with nested for + isinstance +
# per-operator branches, which SonarPython scored at cognitive complexity 20
# (vs the 15 cap). Flattened here into one dispatcher plus per-operator
# helpers — each helper does exactly one thing so the branching budget
# collapses.

def _operator_matches(op: str, actual: Any, arg: Any) -> bool:
    if op == "$ne":
        return actual != arg
    if op == "$in":
        return actual in arg
    # Unknown operators: treat as "not matched" so a typo in a test's query
    # surfaces as a failing assertion rather than a silent pass.
    return False


def _dict_matches(actual: Any, ops: Dict[str, Any]) -> bool:
    return all(_operator_matches(op, actual, arg) for op, arg in ops.items())


def _value_matches(actual: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return _dict_matches(actual, expected)
    return actual == expected


def _matches(doc: Dict[str, Any], query: Dict[str, Any]) -> bool:
    return all(_value_matches(doc.get(k), v) for k, v in query.items())


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

    async def to_list(self, _length):  # NOSONAR — mirrors Motor cursor API
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


def _apply_update(doc: Dict[str, Any], update: Dict[str, Any]) -> None:
    """Apply the update operators the repository actually issues."""
    doc.update(update.get("$set", {}))
    for key in update.get("$unset", {}):
        doc.pop(key, None)
    for key, amount in update.get("$inc", {}).items():
        doc[key] = doc.get(key, 0) + amount


class _FakeCollection:
    """Minimal Motor stand-in.

    Every method takes ``session=None``. The repository forwards a session to
    the driver on every call so transactional callers (schedule relocate) keep
    their atomicity; a fake that rejected the kwarg would make the repository
    untestable here while passing in production — the wrong way round.
    """

    def __init__(self, seed: Optional[List[Dict[str, Any]]] = None):
        self.docs: List[Dict[str, Any]] = list(seed or [])
        self.sessions_seen: List[Any] = []

    async def find_one(self, query=None, projection=None, session=None):  # NOSONAR — mirrors Motor collection API
        self.sessions_seen.append(session)
        query = query or {}
        for doc in self.docs:
            if _matches(doc, query):
                return {k: v for k, v in doc.items() if k != "_id"}
        return None

    def find(self, query=None, projection=None, session=None):
        self.sessions_seen.append(session)
        query = query or {}
        matched = [
            {k: v for k, v in doc.items() if k != "_id"}
            for doc in self.docs
            if _matches(doc, query)
        ]
        return _FakeCursor(matched)

    async def count_documents(self, query=None, session=None):  # NOSONAR — mirrors Motor collection API
        query = query or {}
        return sum(1 for doc in self.docs if _matches(doc, query))

    async def distinct(self, field, query=None, session=None):  # NOSONAR — mirrors Motor collection API
        query = query or {}
        seen = []
        for doc in self.docs:
            if _matches(doc, query) and doc.get(field) not in seen:
                seen.append(doc.get(field))
        return seen

    async def update_one(self, filter_query, update, session=None):  # NOSONAR — mirrors Motor collection API
        for doc in self.docs:
            if _matches(doc, filter_query):
                _apply_update(doc, update)
                return _UpdateResult(matched_count=1, modified_count=1)
        return _UpdateResult(matched_count=0, modified_count=0)

    async def update_many(self, filter_query, update, session=None):  # NOSONAR — mirrors Motor collection API
        count = 0
        for doc in self.docs:
            if _matches(doc, filter_query):
                _apply_update(doc, update)
                count += 1
        return _UpdateResult(matched_count=count, modified_count=count)

    async def find_one_and_update(  # NOSONAR — mirrors Motor collection API
        self, filter_query, update, projection=None, return_document=None, session=None,
    ):
        for doc in self.docs:
            if _matches(doc, filter_query):
                _apply_update(doc, update)
                return {k: v for k, v in doc.items() if k != "_id"}
        return None


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


# ---------- Additions for the schedule_crud migration ----------------------
#
# schedule_crud.py is the first router the repository could not absorb as
# written: it relocates inside a transaction (needs a session forwarded on
# every call), bumps an optimistic-concurrency counter with $inc (needs a raw
# update document), edits a whole recurrence series at once (needs
# update_many), and reads distinct future dates for a DST check.


def test_distinct_active_excludes_soft_deleted(repo):
    _run(repo.collection.update_one({"id": "d"}, {"$set": {"name": "Gamma"}}))
    names = _run(repo.distinct_active("name"))
    # "Gamma" on the soft-deleted "c" must not appear on its own; it is only
    # here because active "d" now carries it too.
    assert sorted(names) == ["Alpha", "Beta", "Gamma"]
    assert _run(repo.distinct_active("name", {"id": "c"})) == []


def test_soft_delete_many_only_touches_active_matches(repo):
    modified = _run(repo.soft_delete_many({"id": {"$in": ["a", "b", "c"]}}))
    # "c" was already deleted, so only two rows change.
    assert modified == 2
    assert _run(repo.count_active()) == 1
    assert _run(repo.get_by_id("d")) is not None


def test_soft_delete_many_records_deleted_by(repo):
    _run(repo.soft_delete_many({"id": "a"}, deleted_by="tester"))
    raw = _run(repo.collection.find_one({"id": "a"}))
    assert raw["deleted_by"] == "tester"
    assert raw["deleted_at"] is not None


def test_update_many_active_applies_raw_operators(repo):
    matched, modified = _run(
        repo.update_many_active({}, {"$set": {"phase": "x"}, "$inc": {"version": 1}}),
    )
    assert (matched, modified) == (3, 3)  # the soft-deleted "c" is excluded
    assert _run(repo.get_by_id("a"))["version"] == 1
    # The soft-deleted row was not touched by either operator.
    assert "phase" not in _run(repo.collection.find_one({"id": "c"}))


def test_find_one_and_update_active_is_a_cas(repo):
    _run(repo.update_active("a", {"version": 7}))

    # Matching predicate: the swap happens and the new doc comes back.
    updated = _run(
        repo.find_one_and_update_active(
            {"id": "a", "version": 7}, {"$inc": {"version": 1}},
        ),
    )
    assert updated is not None and updated["version"] == 8

    # Stale predicate: no document, and nothing is written.
    assert _run(
        repo.find_one_and_update_active(
            {"id": "a", "version": 7}, {"$inc": {"version": 1}},
        ),
    ) is None
    assert _run(repo.get_by_id("a"))["version"] == 8


def test_find_one_and_update_active_will_not_resurrect_a_deleted_doc(repo):
    assert _run(
        repo.find_one_and_update_active({"id": "c"}, {"$set": {"name": "Zeta"}}),
    ) is None


def test_exists_ignores_soft_delete(repo):
    assert _run(repo.exists("c")) is True   # deleted, but a real id
    assert _run(repo.exists("a")) is True
    assert _run(repo.exists("nope")) is False


def test_session_is_forwarded_to_the_driver(repo):
    """A transactional caller's session must reach every driver call.

    Relocate runs its read, its CAS and its claim inserts in one transaction.
    If the repository dropped the session, those reads would run outside the
    transaction and the CAS would compare against uncommitted-elsewhere state
    — the exact race the version pin exists to prevent.
    """
    sentinel = object()
    repo.collection.sessions_seen.clear()
    _run(repo.get_by_id("a", session=sentinel))
    _run(repo.find_active({}, session=sentinel))
    assert repo.collection.sessions_seen == [sentinel, sentinel]
