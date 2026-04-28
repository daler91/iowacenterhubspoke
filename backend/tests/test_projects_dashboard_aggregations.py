import os
import sys
import asyncio
from unittest.mock import MagicMock


# Keep imports lightweight in unit tests.
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

from routers import projects as projects_router  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return self._rows

    def __aiter__(self):
        return _CursorAsyncIter(self._rows)


class _CursorAsyncIter:
    def __init__(self, rows):
        self._iter = iter(rows)

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class _Collection:
    def __init__(self, name, docs, db_ref):
        self.name = name
        self.docs = docs
        self.db_ref = db_ref

    def aggregate(self, pipeline):
        if self.name == "projects":
            return self._aggregate_projects(pipeline)

        if self.name == "schedules":
            return self._aggregate_schedules()

        raise AssertionError(f"Unexpected aggregate collection: {self.name}")

    def _aggregate_projects(self, pipeline):
        group_stage = pipeline[1]["$group"]
        if "classes_delivered" in group_stage:
            return self._aggregate_completed_metrics()
        if isinstance(group_stage.get("_id"), dict) and "community" in group_stage["_id"]:
            return self._aggregate_community_breakdown()
        return self._aggregate_class_breakdown()

    def _aggregate_completed_metrics(self):
        completed = [
            p for p in self.docs
            if p.get("deleted_at") is None and p.get("phase") == "complete"
        ]
        if not completed:
            return _Cursor([])
        return _Cursor([{
            "classes_delivered": len(completed),
            "total_attendance": sum(p.get("attendance_count") or 0 for p in completed),
            "warm_leads": sum(p.get("warm_leads") or 0 for p in completed),
        }])

    def _aggregate_community_breakdown(self):
        grouped = {}
        for p in self.docs:
            if p.get("deleted_at") is not None:
                continue
            community = p.get("community", "Unknown")
            phase = p.get("phase", "planning")
            key = (community, phase)
            if key not in grouped:
                grouped[key] = {"count": 0, "attendance": 0, "warm_leads": 0}
            grouped[key]["count"] += 1
            grouped[key]["attendance"] += p.get("attendance_count") or 0
            grouped[key]["warm_leads"] += p.get("warm_leads") or 0
        rows = {}
        for (community, phase), vals in grouped.items():
            rows.setdefault(community, []).append({
                "phase": phase,
                "count": vals["count"],
                "attendance": vals["attendance"],
                "warm_leads": vals["warm_leads"],
            })
        return _Cursor([{"_id": c, "parts": parts} for c, parts in rows.items()])

    def _aggregate_class_breakdown(self):
        grouped = {}
        for p in self.docs:
            if p.get("deleted_at") is not None or p.get("phase") != "complete":
                continue
            cid = p.get("class_id") or "unlinked"
            grouped.setdefault(cid, {"delivered": 0, "attendance": 0, "warm_leads": 0})
            grouped[cid]["delivered"] += 1
            grouped[cid]["attendance"] += p.get("attendance_count") or 0
            grouped[cid]["warm_leads"] += p.get("warm_leads") or 0
        return _Cursor([{"_id": cid, **vals} for cid, vals in grouped.items()])

    def _aggregate_schedules(self):
        active_links = {
            p.get("schedule_id")
            for p in self.db_ref.projects.docs
            if p.get("deleted_at") is None and p.get("schedule_id")
        }
        count = sum(
            1 for s in self.docs
            if s.get("deleted_at") is None
            and s.get("status") == "completed"
            and s.get("id") not in active_links
        )
        return _Cursor([{"count": count}] if count else [])


class _FakeDB:
    def __init__(self, projects, schedules):
        self.projects = _Collection("projects", projects, self)
        self.schedules = _Collection("schedules", schedules, self)


def _legacy_community_breakdown(all_projects):
    communities = {}
    for p in all_projects:
        c = p.get("community", "Unknown")
        if c not in communities:
            communities[c] = {
                "community": c, "delivered": 0, "upcoming": 0,
                "attendance": 0, "warm_leads": 0, "phases": {},
            }
        if p.get("phase") == "complete":
            communities[c]["delivered"] += 1
            communities[c]["attendance"] += p.get("attendance_count") or 0
            communities[c]["warm_leads"] += p.get("warm_leads") or 0
        else:
            communities[c]["upcoming"] += 1
            phase = p.get("phase", "planning")
            communities[c]["phases"][phase] = communities[c]["phases"].get(phase, 0) + 1
    return list(communities.values())


def _legacy_class_breakdown(completed):
    breakdown = {}
    for p in completed:
        cid = p.get("class_id") or "unlinked"
        if cid not in breakdown:
            breakdown[cid] = {
                "class_id": cid if cid != "unlinked" else None,
                "delivered": 0, "attendance": 0, "warm_leads": 0,
            }
        breakdown[cid]["delivered"] += 1
        breakdown[cid]["attendance"] += p.get("attendance_count") or 0
        breakdown[cid]["warm_leads"] += p.get("warm_leads") or 0
    return breakdown


def test_dashboard_aggregate_parity(monkeypatch):
    projects = [
        {
            "id": "p1", "phase": "complete", "community": "A",
            "attendance_count": 10, "warm_leads": 2, "class_id": "c1",
            "schedule_id": "s1", "deleted_at": None,
        },
        {
            "id": "p2", "phase": "planning", "community": "A",
            "attendance_count": None, "warm_leads": None, "class_id": None,
            "schedule_id": "s2", "deleted_at": None,
        },
        {
            "id": "p3", "phase": "complete", "community": "B",
            "attendance_count": 6, "warm_leads": 1, "class_id": None,
            "schedule_id": None, "deleted_at": None,
        },
        {
            "id": "p4", "phase": "ready", "community": None,
            "attendance_count": 4, "warm_leads": 1, "class_id": "c2",
            "schedule_id": "s4", "deleted_at": None,
        },
    ]
    schedules = [
        {"id": "s1", "status": "completed", "deleted_at": None},
        {"id": "s3", "status": "completed", "deleted_at": None},
    ]
    monkeypatch.setattr(projects_router, "db", _FakeDB(projects, schedules))

    all_projects = [p for p in projects if p.get("deleted_at") is None]
    completed = [p for p in all_projects if p.get("phase") == "complete"]
    legacy_completed = {
        "classes_delivered": len(completed),
        "total_attendance": sum(p.get("attendance_count") or 0 for p in completed),
        "warm_leads": sum(p.get("warm_leads") or 0 for p in completed),
    }
    legacy_communities = sorted(
        _legacy_community_breakdown(all_projects),
        key=lambda x: str(x["community"]),
    )
    legacy_classes = _legacy_class_breakdown(completed)
    legacy_orphans = 1  # only s3 has no active linked project

    new_completed = asyncio.run(projects_router._aggregate_completed_metrics())
    new_communities = sorted(
        asyncio.run(projects_router._aggregate_community_breakdown()),
        key=lambda x: str(x["community"]),
    )
    new_classes, _ = asyncio.run(projects_router._aggregate_class_breakdown())
    new_orphans = asyncio.run(projects_router._count_orphan_schedules())

    assert new_completed == legacy_completed
    assert new_communities == legacy_communities
    assert new_classes == legacy_classes
    assert new_orphans == legacy_orphans
