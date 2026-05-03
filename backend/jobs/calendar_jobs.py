from core.logger import get_logger

logger = get_logger("Worker")


def _add_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _subtract_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = max(0, h * 60 + m - minutes)
    return f"{total // 60:02d}:{total % 60:02d}"


async def create_outlook_event(
    ctx,
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
    from worker import create_outlook_event as _impl

    return await _impl(
        ctx,
        schedule_id,
        email,
        subject,
        location_name,
        date,
        start_time,
        end_time,
        notes,
        employee_id,
    )


async def delete_outlook_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from worker import delete_outlook_event as _impl

    return await _impl(ctx, email, event_id, employee_id)


async def create_google_event(
    ctx,
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
    from worker import create_google_event as _impl

    return await _impl(
        ctx,
        schedule_id,
        email,
        subject,
        location_name,
        date,
        start_time,
        end_time,
        notes,
        employee_id,
    )


async def delete_google_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from worker import delete_google_event as _impl

    return await _impl(ctx, email, event_id, employee_id)
