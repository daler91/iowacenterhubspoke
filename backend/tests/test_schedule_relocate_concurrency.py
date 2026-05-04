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

    async def find_one(self, query, projection=None):
        qid = query.get("id")
        if isinstance(qid, str) and qid in self.docs:
            doc = self.docs[qid]
            if query.get("date") and doc.get("date") != query["date"]:
                return None
            return deepcopy(doc)
        if query.get("id", {}).get("$ne"):
            # conflict probe after failed update: return current occupant
            for d in self.docs.values():
                if d["date"] == query["date"] and d["start_time"] < query["$or"][0]["start_time"]["$lt"] and d["end_time"] > query["$or"][0]["end_time"]["$gt"]:
                    return {"id": d["id"]}
        return None

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        sid = query["id"]
        doc = self.docs[sid]
        # first write wins target slot
        target = update["$set"]
        occupied = any(
            d["id"] != sid and d["date"] == target["date"] and d["start_time"] == target["start_time"]
            for d in self.docs.values()
        )
        if occupied:
            return None
        if doc["version"] != query["version"]:
            return None
        doc.update(target)
        doc["version"] += 1
        return deepcopy(doc)


class FakeDB:
    def __init__(self):
        self.schedules = FakeSchedules()


def test_competing_relocations_only_one_succeeds(monkeypatch):
    monkeypatch.setattr("routers.schedule_crud.db", FakeDB())

    async def noop(*_a, **_k):
        return None

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
    assert failure.detail["conflict_type"] == "slot_taken"
