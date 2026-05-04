from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from database import db
from core.constants import PROJECT_PHASES


@dataclass
class TaskStatsDTO:
    total: int = 0
    completed: int = 0
    partner_overdue: int = 0


@dataclass
class BoardMetrics:
    duration_ms: float
    query_count: int
    project_count: int
    phase_count: int


BOARD_PHASE_LIMIT_DEFAULT = 50
BOARD_PHASE_LIMIT_MAX = 200
LIST_LIMIT_MAX = 200


def clamp_limit(value: int, max_value: int) -> int:
    return max(1, min(value, max_value))


def _phase_match(phase: str) -> dict[str, Any]:
    if phase == "planning":
        return {"$or": [{"phase": "planning"}, {"phase": {"$in": [None, ""]}}, {"phase": {"$exists": False}}]}
    return {"phase": phase}


async def _build_task_stats(project_ids: list[str]) -> dict[str, TaskStatsDTO]:
    if not project_ids:
        return {}
    now = datetime.now(timezone.utc).isoformat()
    pipeline = [
        {"$match": {"project_id": {"$in": project_ids}, "deleted_at": None}},
        {"$group": {"_id": "$project_id", "total": {"$sum": 1}, "completed": {"$sum": {"$cond": [{"$eq": ["$completed", True]}, 1, 0]}}, "partner_overdue": {"$sum": {"$cond": [{"$and": [{"$ne": ["$completed", True]}, {"$in": [{"$ifNull": ["$owner", ""]}, ["partner", "both"]]}, {"$lt": [{"$ifNull": ["$due_date", ""]}, now]}]}, 1, 0]}}}},
    ]
    out: dict[str, TaskStatsDTO] = {}
    async for row in db.tasks.aggregate(pipeline):
        out[row["_id"]] = TaskStatsDTO(row.get("total", 0), row.get("completed", 0), row.get("partner_overdue", 0))
    return out


async def get_project_board_data(query: dict[str, Any], phase_limit: int) -> dict[str, Any]:
    active_phases = [p for p in PROJECT_PHASES if p != "complete"]
    async def fetch_phase(phase: str):
        rows = await db.projects.find({**query, **_phase_match(phase)}, {"_id": 0}).sort("updated_at", -1).limit(phase_limit + 1).to_list(phase_limit + 1)
        truncated = len(rows) > phase_limit
        page = rows[:phase_limit]
        for row in page:
            row["phase"] = phase
        return phase, page, truncated

    facets_query = {**query, "phase": {"$ne": "complete"}}
    results = await asyncio.gather(*[fetch_phase(p) for p in active_phases], db.projects.distinct("community", facets_query))
    phase_results = results[:len(active_phases)]
    communities = results[-1]
    all_ids = [p["id"] for _, rows, _ in phase_results for p in rows]
    stats = await _build_task_stats(all_ids)

    columns: dict[str, list[dict[str, Any]]] = {p: [] for p in active_phases}
    truncated: dict[str, bool] = {}
    for phase, rows, is_trunc in phase_results:
        truncated[phase] = is_trunc
        for row in rows:
            s = stats.get(row["id"], TaskStatsDTO())
            row["task_total"] = s.total
            row["task_completed"] = s.completed
            row["partner_overdue"] = s.partner_overdue
        columns[phase] = rows

    return {
        "columns": columns,
        "phase_truncated": truncated,
        "phase_limit": phase_limit,
        "facets": {"communities": sorted(c for c in communities if c)},
        "query_count": len(active_phases) + 2,
        "project_count": len(all_ids),
        "phase_count": len(active_phases),
    }


async def aggregate_completed_metrics() -> dict[str, int]:
    rows = await db.projects.aggregate([
        {"$match": {"deleted_at": None, "phase": "complete"}},
        {"$group": {"_id": None, "classes_delivered": {"$sum": 1}, "total_attendance": {"$sum": {"$ifNull": ["$attendance_count", 0]}}, "warm_leads": {"$sum": {"$ifNull": ["$warm_leads", 0]}}}},
    ]).to_list(1)
    row = rows[0] if rows else {}
    return {"classes_delivered": row.get("classes_delivered", 0), "total_attendance": row.get("total_attendance", 0), "warm_leads": row.get("warm_leads", 0)}


def build_trends(projects: list[dict[str, Any]], period_days: int) -> dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=period_days)).isoformat()
    months: dict[str, dict[str, dict[str, int]]] = {}
    for p in projects:
        if p.get("phase") != "complete" or (p.get("event_date") or "") < cutoff:
            continue
        month = (p.get("event_date") or "")[:7]
        community = p.get("community", "Unknown")
        months.setdefault(month, {}).setdefault(community, {"delivered": 0, "attendance": 0})
        months[month][community]["delivered"] += 1
        months[month][community]["attendance"] += p.get("attendance_count") or 0
    return {"months": sorted(months.keys()), "by_month": {m: months[m] for m in sorted(months.keys())}}
