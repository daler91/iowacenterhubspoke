async def generate_bulk_schedules(*args, **kwargs):
    from worker import generate_bulk_schedules as _generate_bulk_schedules

    return await _generate_bulk_schedules(*args, **kwargs)


async def sync_schedules_denormalized(*args, **kwargs):
    from worker import sync_schedules_denormalized as _sync_schedules_denormalized

    return await _sync_schedules_denormalized(*args, **kwargs)
