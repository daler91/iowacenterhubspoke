"""Schedule CSV import/export operations."""

import uuid
import csv
import io
import re as python_re
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from database import db
from models.schemas import ScheduleImportItem, ErrorResponse
from core.auth import AdminRequired
from services.activity import log_activity
from services.schedule_utils import check_conflicts
from core.constants import STATUS_UPCOMING, MAX_QUERY_LIMIT
from routers.schedule_helpers import logger


def _validate_import_row(
    row_clean, date_regex, time_regex, emp_by_email, loc_by_name, class_by_name
):
    row_errors = []

    date = row_clean.get("date", "")
    start_time = row_clean.get("start_time", "")
    end_time = row_clean.get("end_time", "")
    emp_email = row_clean.get("employee_email", "").lower()
    loc_name = row_clean.get("location_name", "").lower()
    class_name = row_clean.get("class_name", "").lower()
    notes = row_clean.get("notes", "")

    if not date or not date_regex.match(date):
        row_errors.append(f"Invalid date format '{date}'. Expected YYYY-MM-DD")

    if not start_time or not time_regex.match(start_time):
        row_errors.append(f"Invalid start_time '{start_time}'. Expected HH:MM")

    if not end_time or not time_regex.match(end_time):
        row_errors.append(f"Invalid end_time '{end_time}'. Expected HH:MM")

    employee = emp_by_email.get(emp_email)
    if not employee:
        row_errors.append(f"Employee email '{emp_email}' not found")

    location = loc_by_name.get(loc_name)
    if not location:
        row_errors.append(f"Location '{loc_name}' not found")

    class_obj = None
    if class_name:
        class_obj = class_by_name.get(class_name)
        if not class_obj:
            row_errors.append(f"Class '{class_name}' not found")

    if row_errors:
        return {"errors": row_errors}

    return {
        "valid_data": {
            "employee_ids": [employee["_id"]],
            "employee_name": employee["name"],
            "employee_email": employee["email"],
            "location_id": location["_id"],
            "location_name": location["city_name"],
            "class_id": class_obj["_id"] if class_obj else None,
            "class_name": class_obj["name"] if class_obj else "",
            "date": date,
            "start_time": start_time,
            "end_time": end_time,
            "notes": notes,
        }
    }


def _build_date_filter(start_date, end_date):
    """Return a date filter dict for the query, or None."""
    if start_date and end_date:
        return {"$gte": start_date, "$lte": end_date}
    if start_date:
        return {"$gte": start_date}
    if end_date:
        return {"$lte": end_date}
    return None


def _collect_employee_info(schedule, emp_map):
    """Return (names, emails) lists for a schedule's employees."""
    names = []
    emails = []
    for emp_entry in schedule.get("employees", []):
        emp = emp_map.get(emp_entry.get("id"), {})
        names.append(emp.get("name", emp_entry.get("name", "Unknown")))
        emails.append(emp.get("email", ""))
    if not names:
        for eid in schedule.get("employee_ids", []):
            emp = emp_map.get(eid, {})
            names.append(emp.get("name", "Unknown"))
            emails.append(emp.get("email", ""))
    return names, emails


router = APIRouter(tags=["schedules"])


@router.get("/export", summary="Export schedules as CSV")
async def export_schedules(
    current_user: AdminRequired,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    employee_id: Optional[str] = None,
    location_id: Optional[str] = None,
    fields: Optional[
        str
    ] = "date,start_time,end_time,employee_name,employee_email,location_name,class_name,status,notes",
):
    query = {"deleted_at": None}

    date_filter = _build_date_filter(start_date, end_date)
    if date_filter:
        query["date"] = date_filter

    if employee_id:
        query["employee_ids"] = employee_id
    if location_id:
        query["location_id"] = location_id

    cursor = db.schedules.find(query).sort("date", 1)
    schedules = await cursor.to_list(length=MAX_QUERY_LIMIT)

    emp_ids = list({eid for s in schedules for eid in s.get("employee_ids", [])})
    loc_ids = list({s["location_id"] for s in schedules if "location_id" in s})
    class_ids = list({s["class_id"] for s in schedules if s.get("class_id")})

    employees = await db.employees.find({"id": {"$in": emp_ids}}).to_list(
        length=MAX_QUERY_LIMIT
    )
    locations = await db.locations.find({"_id": {"$in": loc_ids}}).to_list(
        length=MAX_QUERY_LIMIT
    )
    classes = await db.classes.find({"_id": {"$in": class_ids}}).to_list(
        length=MAX_QUERY_LIMIT
    )

    emp_map = {e["id"]: e for e in employees}
    loc_map = {loc["_id"]: loc for loc in locations}
    class_map = {c["_id"]: c for c in classes}

    field_list = [f.strip() for f in fields.split(",") if f.strip()]
    if not field_list:
        field_list = [
            "date",
            "start_time",
            "end_time",
            "employee_name",
            "location_name",
        ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(field_list)

    for s in schedules:
        loc = loc_map.get(s.get("location_id"), {})
        cls = class_map.get(s.get("class_id"), {})

        emp_names, emp_emails = _collect_employee_info(s, emp_map)

        row_data = {
            "date": s.get("date", ""),
            "start_time": s.get("start_time", ""),
            "end_time": s.get("end_time", ""),
            "employee_name": ", ".join(emp_names) if emp_names else "Unknown",
            "employee_email": ", ".join(emp_emails) if emp_emails else "",
            "location_name": loc.get("city_name", "Unknown"),
            "class_name": cls.get("name", ""),
            "status": s.get("status", ""),
            "notes": s.get("notes", ""),
        }

        row = [row_data.get(f, "") for f in field_list]
        writer.writerow(row)

    output.seek(0)

    filename = f"schedules_export_{datetime.now().strftime('%Y%m%d')}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}

    return StreamingResponse(
        iter([output.getvalue()]), media_type="text/csv", headers=headers
    )


def _parse_csv_content(content: bytes) -> csv.DictReader:
    """Decode CSV content and return a DictReader, validating required columns."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    required_cols = {"date", "start_time", "end_time", "employee_email", "location_name"}
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Empty CSV file or missing headers")

    actual_cols = {c.lower().strip() for c in reader.fieldnames if c}
    missing = required_cols - actual_cols
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Missing required columns. File must have headers: "
                   "date, start_time, end_time, employee_email, location_name",
        )
    return reader


async def _build_lookup_maps():
    """Fetch all employees, locations, and classes and build lookup dicts."""
    all_employees = await db.employees.find({"deleted_at": None}).to_list(length=MAX_QUERY_LIMIT)
    all_locations = await db.locations.find({"deleted_at": None}).to_list(length=MAX_QUERY_LIMIT)
    all_classes = await db.classes.find({"deleted_at": None}).to_list(length=MAX_QUERY_LIMIT)
    return (
        {e.get("email", "").lower(): e for e in all_employees if e.get("email")},
        {loc.get("city_name", "").lower(): loc for loc in all_locations if loc.get("city_name")},
        {c.get("name", "").lower(): c for c in all_classes if c.get("name")},
    )


@router.post(
    "/import/preview",
    summary="Preview CSV import (dry run)",
    responses={400: {"model": ErrorResponse, "description": "Invalid CSV file or missing required columns"}},
)
async def import_schedules_preview(
    current_user: AdminRequired, file: Annotated[UploadFile, File()]
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    reader = _parse_csv_content(content)
    emp_by_email, loc_by_name, class_by_name = await _build_lookup_maps()

    valid_rows = []
    errors = []
    date_regex = python_re.compile(r"^\d{4}-\d{2}-\d{2}$")
    time_regex = python_re.compile(r"^\d{2}:\d{2}$")

    for row_idx, row in enumerate(reader, start=2):
        row_clean = {
            k.lower().strip(): v.strip()
            for k, v in row.items()
            if k and v is not None
        }
        if not row_clean:
            continue

        result = _validate_import_row(
            row_clean, date_regex, time_regex, emp_by_email, loc_by_name, class_by_name,
        )

        if "errors" in result:
            errors.append({"row": row_idx, "errors": result["errors"], "data": row_clean})
        else:
            valid_data = result["valid_data"]
            valid_data["row_idx"] = row_idx
            valid_rows.append(valid_data)

    return {
        "valid_rows": valid_rows,
        "errors": errors,
        "total_rows": len(valid_rows) + len(errors),
    }


@router.post("/import", summary="Commit CSV import")
async def import_schedules_commit(
    current_user: AdminRequired, items: list[ScheduleImportItem]
):
    if not items:
        return {"inserted_count": 0, "errors": []}

    inserted_count = 0
    errors = []

    for item in items:
        try:
            # Fetch all employees for this schedule
            employees_list = await db.employees.find(
                {"id": {"$in": item.employee_ids}, "deleted_at": None}
            ).to_list(len(item.employee_ids))
            location = await db.locations.find_one(
                {"_id": item.location_id, "deleted_at": None}
            )

            if not employees_list or len(employees_list) != len(item.employee_ids) or not location:
                errors.append(
                    {
                        "row": item.row_idx,
                        "error": "Employee(s) or Location no longer exists",
                    }
                )
                continue

            drive_minutes = location.get("drive_time_minutes", 0)

            # Check conflicts for each employee
            has_conflict = False
            for emp in employees_list:
                conflict = await check_conflicts(
                    emp["id"],
                    item.date,
                    item.start_time,
                    item.end_time,
                    drive_minutes,
                )
                if conflict:
                    errors.append(
                        {
                            "row": item.row_idx,
                            "error": (
                                f"Conflict with existing schedule for "
                                f"{emp.get('name')} on {item.date} at {item.start_time}"
                            ),
                        }
                    )
                    has_conflict = True
                    break

            if has_conflict:
                continue

            emp_snapshots = [
                {"id": e["id"], "name": e["name"], "color": e.get("color", "#4F46E5")}
                for e in employees_list
            ]

            new_schedule = {
                "_id": str(uuid.uuid4()),
                "employee_ids": item.employee_ids,
                "employees": emp_snapshots,
                "location_id": item.location_id,
                "class_id": item.class_id,
                "date": item.date,
                "start_time": item.start_time,
                "end_time": item.end_time,
                "notes": item.notes,
                "travel_override_minutes": None,
                "status": STATUS_UPCOMING,
                "recurrence": "none",
                "recurrence_end_date": None,
                "recurrence_end_mode": None,
                "recurrence_occurrences": None,
                "custom_recurrence": None,
                "calendar_events": {},
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "deleted_at": None,
            }

            await db.schedules.insert_one(new_schedule)
            inserted_count += 1

        except Exception:
            logger.exception(
                "Error importing schedule row %s",
                getattr(item, "row_idx", None),
            )
            errors.append(
                {
                    "row": item.row_idx,
                    "error": "An internal error occurred while importing this row.",
                }
            )

    if inserted_count > 0:
        await log_activity(
            action="import_schedules",
            description=f"Imported {inserted_count} schedules via CSV",
            entity_type="schedule",
            entity_id="bulk_import",
            user_name=current_user["name"],
        )

    return {"inserted_count": inserted_count, "errors": errors}
