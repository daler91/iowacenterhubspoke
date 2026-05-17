async def process_task_reminders():
    from services.task_reminders import check_and_send_reminders
    return await check_and_send_reminders()


async def process_notification_digests():
    from services.digest import process_digests
    return await process_digests()
