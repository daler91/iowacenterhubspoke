async def deliver_webhook_job(ctx, subscription_id, event, payload):
    from services.webhooks import deliver_webhook
    return await deliver_webhook(ctx, subscription_id, event, payload)


async def send_password_reset_email_job(ctx, email):
    from services.email_jobs import send_password_reset_email
    return await send_password_reset_email(email)


async def send_partner_magic_link_email_job(ctx, email):
    from services.email_jobs import send_partner_magic_link_email
    return await send_partner_magic_link_email(email)
