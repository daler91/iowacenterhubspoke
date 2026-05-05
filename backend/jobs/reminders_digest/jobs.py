async def process_task_reminders(ctx):
    from services.task_reminders import check_and_send_reminders
    return await check_and_send_reminders()


async def process_notification_digests(ctx):
    from services.digest import process_digests
    return await process_digests()
