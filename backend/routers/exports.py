import io
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from database import db
from core.auth import CurrentUser
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])


def _csv_response(df, filename: str):
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.csv"',
        },
    )


def _xlsx_response(df, filename: str):
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=(
            "application/vnd.openxmlformats-officedocument"
            ".spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.xlsx"',
        },
    )


def _respond(df, fmt: str, filename: str):
    if fmt == "xlsx":
        return _xlsx_response(df, filename)
    return _csv_response(df, filename)


@router.get("/projects", summary="Export projects")
async def export_projects(
    user: CurrentUser,
    format: str = "csv",
    community: Optional[str] = None,
    phase: Optional[str] = None,
):
    import pandas as pd

    query: dict = {"deleted_at": None}
    if community:
        query["community"] = community
    if phase:
        query["phase"] = phase
    items = await db.projects.find(query, {"_id": 0}).to_list(5000)
    cols = [
        "id", "title", "class_type", "community", "venue_name",
        "event_date", "phase", "registration_count",
        "attendance_count", "warm_leads",
    ]
    df = pd.DataFrame(items, columns=cols) if items else pd.DataFrame(
        columns=cols,
    )
    return _respond(df, format, "projects")


@router.get("/tasks", summary="Export tasks")
async def export_tasks(
    user: CurrentUser,
    format: str = "csv",
    project_id: Optional[str] = None,
    completed: Optional[bool] = None,
):
    import pandas as pd

    query: dict = {}
    if project_id:
        query["project_id"] = project_id
    if completed is not None:
        query["completed"] = completed
    items = await db.tasks.find(query, {"_id": 0}).to_list(10000)
    cols = [
        "id", "project_id", "title", "phase", "owner",
        "assigned_to", "due_date", "completed", "completed_at",
        "completed_by", "details",
    ]
    df = pd.DataFrame(items, columns=cols) if items else pd.DataFrame(
        columns=cols,
    )
    return _respond(df, format, "tasks")


@router.get("/partners", summary="Export partner organizations")
async def export_partners(
    user: CurrentUser,
    format: str = "csv",
    community: Optional[str] = None,
    status: Optional[str] = None,
):
    import pandas as pd

    query: dict = {"deleted_at": None}
    if community:
        query["community"] = community
    if status:
        query["status"] = status
    orgs = await db.partner_orgs.find(query, {"_id": 0}).to_list(1000)
    rows = []
    for org in orgs:
        contacts = await db.partner_contacts.find(
            {"partner_org_id": org["id"], "deleted_at": None},
            {"_id": 0},
        ).to_list(20)
        primary = next(
            (c for c in contacts if c.get("is_primary")), None,
        )
        rows.append({
            "id": org["id"],
            "name": org["name"],
            "community": org.get("community", ""),
            "status": org.get("status", ""),
            "primary_contact": primary["name"] if primary else "",
            "primary_email": primary["email"] if primary else "",
            "contact_count": len(contacts),
        })
    df = pd.DataFrame(rows)
    return _respond(df, format, "partners")


@router.get("/outcomes", summary="Export event outcomes")
async def export_outcomes(
    user: CurrentUser,
    format: str = "csv",
    project_id: Optional[str] = None,
):
    import pandas as pd

    query: dict = {}
    if project_id:
        query["project_id"] = project_id
    items = await db.event_outcomes.find(
        query, {"_id": 0},
    ).to_list(10000)
    cols = [
        "id", "project_id", "attendee_name", "attendee_email",
        "attendee_phone", "status", "notes",
    ]
    df = pd.DataFrame(items, columns=cols) if items else pd.DataFrame(
        columns=cols,
    )
    return _respond(df, format, "outcomes")
