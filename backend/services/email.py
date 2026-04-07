import os
from core.logger import get_logger

logger = get_logger(__name__)

EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "smtp")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@iowacenter.org")
SMTP_HOST = os.getenv("SMTP_HOST", "localhost")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")


async def send_email(
    to: str, subject: str, body_html: str,
) -> bool:
    """Send an email via SMTP or log it if SMTP is not configured."""
    if not SMTP_HOST or SMTP_HOST == "localhost":
        logger.info(
            "Email (dev mode): to=%s subject=%s", to, subject,
        )
        return True

    try:
        import aiosmtplib
        message = (
            f"From: {EMAIL_FROM}\r\n"
            f"To: {to}\r\n"
            f"Subject: {subject}\r\n"
            f"Content-Type: text/html; charset=utf-8\r\n"
            f"\r\n{body_html}"
        )
        await aiosmtplib.send(
            message,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER or None,
            password=SMTP_PASSWORD or None,
            start_tls=True,
            sender=EMAIL_FROM,
            recipients=[to],
        )
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        return False


async def send_task_reminder(
    to: str, contact_name: str,
    task_title: str, project_title: str,
    due_date: str, days_until: int,
) -> bool:
    subject = f"Reminder: \"{task_title}\" is due in {days_until} day(s)"
    body = (
        f"<p>Hi {contact_name},</p>"
        f"<p>This is a reminder that the task "
        f"<strong>{task_title}</strong> for "
        f"<strong>{project_title}</strong> is due on "
        f"{due_date}.</p>"
        f"<p>Please complete it at your earliest convenience.</p>"
        f"<p>— Iowa Center for Economic Success</p>"
    )
    return await send_email(to, subject, body)


async def send_task_overdue(
    to: str, contact_name: str,
    task_title: str, project_title: str,
    due_date: str, days_overdue: int,
) -> bool:
    subject = f"Overdue: \"{task_title}\" was due {days_overdue} day(s) ago"
    body = (
        f"<p>Hi {contact_name},</p>"
        f"<p>The task <strong>{task_title}</strong> for "
        f"<strong>{project_title}</strong> was due on "
        f"{due_date} and is now <strong>{days_overdue} day(s) "
        f"overdue</strong>.</p>"
        f"<p>Please complete it as soon as possible.</p>"
        f"<p>— Iowa Center for Economic Success</p>"
    )
    return await send_email(to, subject, body)
