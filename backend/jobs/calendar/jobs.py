from core.logger import get_logger
from services.worker_jobs import CalendarProviderAdapter, create_calendar_event_idempotent, delete_calendar_event

logger = get_logger("Worker")


async def create_outlook_event(
    _ctx,
    schedule_id: str,
    email: str,
    subject: str,
    location_name: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str = "",
    employee_id: str = "",
):
    from database import db
    from services.outlook import create_outlook_event as provider_create
    from services.outlook import delete_outlook_event as provider_delete

    adapter = CalendarProviderAdapter(
        name="outlook",
        id_field="outlook_event_id",
        create_event=provider_create,
        delete_event=provider_delete,
    )

    return await create_calendar_event_idempotent(
        db=db,
        adapter=adapter,
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


async def delete_outlook_event(_ctx, email: str, event_id: str, employee_id: str = ""):
    from database import db
    from services.outlook import create_outlook_event as provider_create
    from services.outlook import delete_outlook_event as provider_delete

    adapter = CalendarProviderAdapter(
        name="outlook",
        id_field="outlook_event_id",
        create_event=provider_create,
        delete_event=provider_delete,
    )

    return await delete_calendar_event(
        db=db,
        adapter=adapter,
        email=email,
        event_id=event_id,
        employee_id=employee_id,
    )


async def create_google_event(
    _ctx,
    schedule_id: str,
    email: str,
    subject: str,
    location_name: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str = "",
    employee_id: str = "",
):
    from database import db
    from services.google_calendar import create_google_event as provider_create
    from services.google_calendar import delete_google_event as provider_delete

    adapter = CalendarProviderAdapter(
        name="google",
        id_field="google_event_id",
        create_event=provider_create,
        delete_event=provider_delete,
    )

    return await create_calendar_event_idempotent(
        db=db,
        adapter=adapter,
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


async def delete_google_event(_ctx, email: str, event_id: str, employee_id: str = ""):
    from database import db
    from services.google_calendar import create_google_event as provider_create
    from services.google_calendar import delete_google_event as provider_delete

    adapter = CalendarProviderAdapter(
        name="google",
        id_field="google_event_id",
        create_event=provider_create,
        delete_event=provider_delete,
    )

    return await delete_calendar_event(
        db=db,
        adapter=adapter,
        email=email,
        event_id=event_id,
        employee_id=employee_id,
    )
