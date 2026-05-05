from core.logger import get_logger
from services.worker_jobs import create_calendar_event_idempotent, delete_calendar_event

logger = get_logger("Worker")


async def create_outlook_event(ctx, schedule_id: str, email: str, subject: str, location_name: str, date: str, start_time: str, end_time: str, notes: str = "", employee_id: str = ""):
    from database import db
    from services.outlook import create_outlook_event as provider_create

    return await create_calendar_event_idempotent(
        db=db,
        provider_create=provider_create,
        provider_name="outlook",
        schedule_id=schedule_id,
        email=email,
        subject=subject,
        location_name=location_name,
        date=date,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
        employee_id=employee_id,
    )


async def delete_outlook_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from database import db
    from services.outlook import delete_outlook_event as provider_delete

    return await delete_calendar_event(db=db, provider_delete=provider_delete, email=email, event_id=event_id, employee_id=employee_id)


async def create_google_event(ctx, schedule_id: str, email: str, subject: str, location_name: str, date: str, start_time: str, end_time: str, notes: str = "", employee_id: str = ""):
    from database import db
    from services.google_calendar import create_google_event as provider_create

    return await create_calendar_event_idempotent(
        db=db,
        provider_create=provider_create,
        provider_name="google",
        schedule_id=schedule_id,
        email=email,
        subject=subject,
        location_name=location_name,
        date=date,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
        employee_id=employee_id,
    )


async def delete_google_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from database import db
    from services.google_calendar import delete_google_event as provider_delete

    return await delete_calendar_event(db=db, provider_delete=provider_delete, email=email, event_id=event_id, employee_id=employee_id)
