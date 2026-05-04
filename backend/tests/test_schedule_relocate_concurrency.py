import asyncio
from copy import deepcopy

from fastapi import HTTPException

from models.schemas import ScheduleRelocate
from routers.schedule_crud import relocate_schedule


class FakeSchedules:
    def __init__(self):
        self.docs = {
            "s-1": {"id": "s-1", "deleted_at": None, "date": "2026-06-01", "start_time": "09:00", "end_time": "10:00", "version": 1, "employee_ids": ["e-1"], "location_name": "A"},
            "s-2": {"id": "s-2", "deleted_at": None, "date": "2026-06-01", "start_time": "11:00", "end_time": "12:00", "version": 1, "employee_ids": ["e-1"], "location_name": "B"},
        }

    async def find_one(self, query, projection=None, session=None):
        await asyncio.sleep(0)
        qid = query.get("id")
        if isinstance(qid, str) and qid in self.docs:
            doc = self.docs[qid]
            if query.get("date") and doc.get("date") != query["date"]:
                return None
            return deepcopy(doc)
        if isinstance(query.get("id"), dict) and query["id"].get("$ne"):
            blocking = self._find_blocking_schedule(query)
            if blocking:
                return {"id": blocking["id"]}
        return None

    async def find_one_and_update(self, query, update, projection=None, return_document=None, session=None):
        await asyncio.sleep(0)
        sid = query["id"]
        doc = self.docs[sid]
        # first write wins target slot
        target = update["$set"]
        if self._target_slot_occupied(sid, target):
            return None
        if doc["version"] != query["version"]:
            return None
        doc.update(target)
        doc["version"] += 1
        return deepcopy(doc)

    def _find_blocking_schedule(self, query):
        for doc in self.docs.values():
            if self._matches_conflict_query(doc, query):
                return doc
        return None

    def _matches_conflict_query(self, doc, query):
        if doc["id"] == query["id"]["$ne"]:
            return False
        if doc["date"] != query["date"]:
            return False
        if not any(emp in query["employee_ids"]["$in"] for emp in doc.get("employee_ids", [])):
            return False
        return (
            doc["start_time"] < query["start_time"]["$lt"]
            and doc["end_time"] > query["end_time"]["$gt"]
        )

    def _target_slot_occupied(self, sid, target):
        return any(
            doc["id"] != sid
            and doc["date"] == target["date"]
            and doc["start_time"] == target["start_time"]
            for doc in self.docs.values()
        )


class FakeDB:
    def __init__(self):
        self.schedules = FakeSchedules()
        self.client = self

    async def start_session(self):
        await asyncio.sleep(0)
        return _FakeSession()


class _FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def start_transaction(self):
        return self


def test_competing_relocations_only_one_succeeds(monkeypatch):
    monkeypatch.setattr("routers.schedule_crud.db", FakeDB())

    async def noop(*_a, **_k):
        await asyncio.sleep(0)

    monkeypatch.setattr("routers.schedule_crud._check_relocate_conflicts", noop)
    monkeypatch.setattr("routers.schedule_crud._sync_same_day_town_to_town", noop)
    monkeypatch.setattr("routers.schedule_crud.sync_relocate_calendar", noop)
    monkeypatch.setattr("routers.schedule_crud._sync_linked_project_date", noop)
    monkeypatch.setattr("routers.schedule_crud.log_activity", noop)
    monkeypatch.setattr("routers.schedule_crud.notify_schedule_changed", noop)
    monkeypatch.setattr("routers.schedule_crud.invalidate_workload_cache", noop)

    payload = ScheduleRelocate(date="2026-06-01", start_time="13:00", end_time="14:00", force=False)

    async def _run():
        return await asyncio.gather(
            relocate_schedule("s-1", payload, {"name": "tester"}),
            relocate_schedule("s-2", payload, {"name": "tester"}),
            return_exceptions=True,
        )

    results = asyncio.run(_run())
    assert sum(isinstance(r, dict) for r in results) == 1
    failures = [r for r in results if not isinstance(r, dict)]
    assert len(failures) == 1
    failure = failures[0]
    assert isinstance(failure, HTTPException)
    assert failure.status_code == 409
    assert failure.detail["conflict_type"] in {"slot_taken", "stale_schedule"}
