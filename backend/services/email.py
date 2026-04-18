import os
from html import escape as _esc

from core.logger import get_logger


logger = get_logger(__name__)


def _e(value: object) -> str:
    """HTML-escape a user-controlled value before embedding in an
    email body. Wraps ``html.escape`` so every template site is a
    single short call — the goal is to make unsafe interpolations
    visible the moment someone reads the code.
    """
    return _esc("" if value is None else str(value), quote=True)


EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "smtp")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@iowacenter.org")
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

# Email is considered "enabled" (real send) only when SMTP_HOST is set to
# something other than localhost. Otherwise we log-only — useful in dev.
EMAIL_ENABLED = bool(SMTP_HOST) and SMTP_HOST != "localhost"

_SIGNATURE = "<p>— Iowa Center for Economic Success</p>"
_BUTTON_STYLE = (
    "display:inline-block;padding:12px 24px;"
    "background-color:#4F46E5;color:#ffffff;text-decoration:none;"
    "border-radius:8px;font-weight:600;"
)


def resolve_app_url() -> str:
    """Return the public base URL for magic links.

    Prefers APP_URL, falls back to the first entry in CORS_ORIGINS, and
    finally to the local dev server. Kept in one place so every router that
    builds a user-facing link uses the same resolution.
    """
    return (
        os.getenv("APP_URL")
        or os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")[0].strip()
    )


async def send_email(
    to: str, subject: str, body_html: str,
) -> bool:
    """Send an email via SMTP or log it if SMTP is not configured."""
    if not EMAIL_ENABLED:
        if os.getenv("ENVIRONMENT") == "production":
            # Silent drops in prod are dangerous — surface them loudly.
            logger.warning(
                "Email not sent (SMTP not configured in production): "
                "to=%s subject=%s",
                to, subject,
            )
        else:
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
    # User-controlled strings are HTML-escaped before interpolation so
    # a malicious task title like ``<img src=x onerror=...>`` can't
    # execute in the recipient's mail client. Subjects are plain text
    # per RFC 5322 so escaping there is defence-in-depth.
    subject = f'Reminder: "{task_title}" is due in {days_until} day(s)'
    body = (
        f"<p>Hi {_e(contact_name)},</p>"
        f"<p>This is a reminder that the task "
        f"<strong>{_e(task_title)}</strong> for "
        f"<strong>{_e(project_title)}</strong> is due on "
        f"{_e(due_date)}.</p>"
        f"<p>Please complete it at your earliest convenience.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_task_overdue(
    to: str, contact_name: str,
    task_title: str, project_title: str,
    due_date: str, days_overdue: int,
) -> bool:
    subject = f'Overdue: "{task_title}" was due {days_overdue} day(s) ago'
    body = (
        f"<p>Hi {_e(contact_name)},</p>"
        f"<p>The task <strong>{_e(task_title)}</strong> for "
        f"<strong>{_e(project_title)}</strong> was due on "
        f"{_e(due_date)} and is now <strong>{days_overdue} day(s) "
        f"overdue</strong>.</p>"
        f"<p>Please complete it as soon as possible.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_portal_invite(
    to: str, contact_name: str, org_name: str,
    portal_url: str,
) -> bool:
    """Send a portal access magic link to a partner contact."""
    # Local import keeps this module's import graph flat — email_jobs
    # imports services.email, so a top-level import would be circular.
    from services.email_jobs import PORTAL_TOKEN_EXPIRY_DAYS
    subject = f"You're invited to the {org_name} partner portal"
    body = (
        f"<p>Hi {_e(contact_name)},</p>"
        f"<p>You've been invited to access the <strong>{_e(org_name)}</strong> "
        f"partner portal for the Iowa Center for Economic Success.</p>"
        f"<p>Use the link below to view your upcoming classes, tasks, "
        f"shared documents, and messages:</p>"
        f'<p><a href="{_e(portal_url)}" '
        f'style="{_BUTTON_STYLE}">Open Partner Portal</a></p>'
        f'<p style="color:#6b7280;font-size:13px;">This link expires in '
        f"{PORTAL_TOKEN_EXPIRY_DAYS} day(s). If it expires, ask your Iowa "
        f"Center contact to send a new one.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_user_invite(
    to: str, name: str, role: str, invite_url: str,
) -> bool:
    """Send an admin-created user invitation with a signup link."""
    subject = "You're invited to the Iowa Center Hub"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>You've been invited to join the Iowa Center for Economic "
        f"Success scheduling hub as a <strong>{_e(role)}</strong>.</p>"
        f"<p>Click the button below to create your account and get started:</p>"
        f'<p><a href="{_e(invite_url)}" '
        f'style="{_BUTTON_STYLE}">Accept Invitation</a></p>'
        f'<p style="color:#6b7280;font-size:13px;">If the button doesn\'t '
        f"work, copy and paste this link into your browser:<br>{_e(invite_url)}</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_welcome_pending(to: str, name: str) -> bool:
    """Acknowledge a self-service registration that needs admin approval."""
    subject = "Your Iowa Center Hub registration is pending"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>Thanks for signing up for the Iowa Center for Economic Success "
        f"scheduling hub. Your account has been created and is now waiting "
        f"for an administrator to review and approve it.</p>"
        f"<p>You'll receive another email as soon as your account is "
        f"approved and you can sign in.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_account_approved(
    to: str, name: str, login_url: str,
) -> bool:
    """Notify a user that their pending account has been approved."""
    subject = "Your Iowa Center Hub account is approved"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>Good news — an administrator has approved your Iowa Center Hub "
        f"account. You can sign in any time using the button below.</p>"
        f'<p><a href="{_e(login_url)}" '
        f'style="{_BUTTON_STYLE}">Sign In</a></p>'
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_password_reset(
    to: str, name: str, reset_url: str,
) -> bool:
    """Send a password reset link. Expiry comes from email_jobs so
    the copy stays in sync with the actual token lifetime."""
    from services.email_jobs import PASSWORD_RESET_EXPIRY_HOURS
    subject = "Reset your Iowa Center Hub password"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>We received a request to reset the password on your Iowa "
        f"Center Hub account. Click the button below to choose a new "
        f"password:</p>"
        f'<p><a href="{_e(reset_url)}" '
        f'style="{_BUTTON_STYLE}">Reset Password</a></p>'
        f'<p style="color:#6b7280;font-size:13px;">This link expires in '
        f"{PASSWORD_RESET_EXPIRY_HOURS} hour(s). If you didn't request a "
        f"password reset, you can safely ignore this email.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)
