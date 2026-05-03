async def process_task_reminders(ctx):
    from worker import process_task_reminders as _impl
    return await _impl(ctx)


async def process_notification_digests(ctx):
    from worker import process_notification_digests as _impl
    return await _impl(ctx)


async def deliver_webhook_job(ctx, subscription_id, event, payload):
    from worker import deliver_webhook_job as _impl
    return await _impl(ctx, subscription_id, event, payload)


async def send_password_reset_email_job(ctx, email):
    from worker import send_password_reset_email_job as _impl
    return await _impl(ctx, email)


async def send_partner_magic_link_email_job(ctx, email):
    from worker import send_partner_magic_link_email_job as _impl
    return await _impl(ctx, email)
