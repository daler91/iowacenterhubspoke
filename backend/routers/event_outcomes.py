import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import (
    OutcomeCreate, OutcomeUpdate, OutcomeBulkCreate,
)
from core.auth import CurrentUser, EditorRequired, SchedulerRequired
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/outcomes", tags=["outcomes"],
)

PROJECT_NOT_FOUND = "Project not found"
OUTCOME_NOT_FOUND = "Outcome not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


async def _verify_project(project_id: str):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


@router.get(
    "",
    summary="List outcomes for a project",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def list_outcomes(
    project_id: str,
    user: CurrentUser,
    status: Optional[str] = None,
):
    await _verify_project(project_id)
    query: dict = {"project_id": project_id, "deleted_at": None}
    if status:
        query["status"] = status
    items = (
        await db.event_outcomes.find(query, {"_id": 0})
        .sort("created_at", -1)
        .to_list(5000)
    )
    # Summary counts
    counts: dict = {}
    for item in items:
        s = item.get("status", "attended")
        counts[s] = counts.get(s, 0) + 1
    return {"items": items, "total": len(items), "counts": counts}


@router.post(
    "",
    summary="Add an attendee outcome",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def create_outcome(
    project_id: str, data: OutcomeCreate, user: EditorRequired,
):
    await _verify_project(project_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "attendee_name": data.attendee_name,
        "attendee_email": data.attendee_email,
        "attendee_phone": data.attendee_phone,
        "status": data.status,
        "notes": data.notes or "",
        "contacted_at": None,
        "consultation_at": None,
        "converted_at": None,
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    await db.event_outcomes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post(
    "/bulk",
    summary="Bulk import attendee outcomes",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def bulk_create_outcomes(
    project_id: str, data: OutcomeBulkCreate, user: EditorRequired,
):
    await _verify_project(project_id)
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for att in data.attendees:
        docs.append({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "attendee_name": att.attendee_name,
            "attendee_email": att.attendee_email,
            "attendee_phone": att.attendee_phone,
            "status": att.status,
            "notes": att.notes or "",
            "contacted_at": None,
            "consultation_at": None,
            "converted_at": None,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        })
    if docs:
        await db.event_outcomes.insert_many(docs)
    await log_activity(
        "outcomes_imported",
        f"{len(docs)} attendees imported for project",
        "project", project_id, user.get("name", "System"),
    )
    return {"created": len(docs)}


@router.put(
    "/{outcome_id}",
    summary="Update an outcome",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": OUTCOME_NOT_FOUND},
    },
)
async def update_outcome(
    project_id: str,
    outcome_id: str,
    data: OutcomeUpdate,
    user: EditorRequired,
):
    update_data = {
        k: v for k, v in data.model_dump().items() if v is not None
    }
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Check for backward funnel transitions
    new_status = update_data.get("status")
    force = update_data.pop("force", None)

    if new_status:
        from core.constants import OUTCOME_FUNNEL_ORDER
        current_outcome = await db.event_outcomes.find_one(
            {"id": outcome_id, "project_id": project_id}, {"_id": 0, "status": 1}
        )
        if current_outcome:
            current_order = OUTCOME_FUNNEL_ORDER.get(current_outcome.get("status"), 0)
            new_order = OUTCOME_FUNNEL_ORDER.get(new_status, 0)
            # Warn on backward transitions (except moves to/from "lost" which has order -1)
            if new_order >= 0 and current_order >= 0 and new_order < current_order and not force:
                return {
                    "warning": True,
                    "requires_confirmation": True,
                    "current_status": current_outcome.get("status"),
                    "requested_status": new_status,
                    "message": f"Moving from {current_outcome.get('status')} back to {new_status}",
                }

    # Auto-set timestamps on status transitions
    ts_field = {
        "contacted": "contacted_at",
        "consultation": "consultation_at",
        "converted": "converted_at",
    }.get(new_status or "")
    if ts_field and ts_field not in update_data:
        update_data[ts_field] = update_data["updated_at"]

    result = await db.event_outcomes.update_one(
        {"id": outcome_id, "project_id": project_id, "deleted_at": None},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=OUTCOME_NOT_FOUND)
    updated = await db.event_outcomes.find_one(
        {"id": outcome_id}, {"_id": 0},
    )
    return updated


@router.delete(
    "/{outcome_id}",
    summary="Delete an outcome",
    responses={404: {"description": OUTCOME_NOT_FOUND}},
)
async def delete_outcome(
    project_id: str, outcome_id: str, user: SchedulerRequired,
):
    now = datetime.now(timezone.utc).isoformat()
    result = await db.event_outcomes.update_one(
        {"id": outcome_id, "project_id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=OUTCOME_NOT_FOUND)
    return {"message": "Outcome deleted"}


@router.get(
    "/funnel",
    summary="Conversion funnel summary",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def get_funnel(project_id: str, user: CurrentUser):
    await _verify_project(project_id)
    outcomes = await db.event_outcomes.find(
        {"project_id": project_id, "deleted_at": None},
        {"_id": 0, "status": 1},
    ).to_list(10000)
    total = len(outcomes)
    counts = {
        "attended": 0, "contacted": 0, "consultation": 0,
        "converted": 0, "lost": 0,
    }
    for o in outcomes:
        s = o.get("status", "attended")
        if s in counts:
            counts[s] += 1
    conversion_rate = (
        round(counts["converted"] / total * 100, 1)
        if total > 0 else 0
    )
    return {
        "total": total,
        **counts,
        "conversion_rate": conversion_rate,
    }
