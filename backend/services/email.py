import os
from core.logger import get_logger

logger = get_logger(__name__)

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
    subject = f"Reminder: \"{task_title}\" is due in {days_until} day(s)"
    body = (
        f"<p>Hi {contact_name},</p>"
        f"<p>This is a reminder that the task "
        f"<strong>{task_title}</strong> for "
        f"<strong>{project_title}</strong> is due on "
        f"{due_date}.</p>"
        f"<p>Please complete it at your earliest convenience.</p>"
        f"{_SIGNATURE}"
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
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_portal_invite(
    to: str, contact_name: str, org_name: str,
    portal_url: str,
) -> bool:
    """Send a portal access magic link to a partner contact."""
    subject = f"You're invited to the {org_name} partner portal"
    body = (
        f"<p>Hi {contact_name},</p>"
        f"<p>You've been invited to access the <strong>{org_name}</strong> "
        f"partner portal for the Iowa Center for Economic Success.</p>"
        f"<p>Use the link below to view your upcoming classes, tasks, "
        f"shared documents, and messages:</p>"
        f"<p><a href=\"{portal_url}\" "
        f"style=\"{_BUTTON_STYLE}\">Open Partner Portal</a></p>"
        f"<p style=\"color:#6b7280;font-size:13px;\">This link expires in "
        f"7 days. If it expires, ask your Iowa Center contact to send a "
        f"new one.</p>"
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
        f"<p>Hi {display_name},</p>"
        f"<p>You've been invited to join the Iowa Center for Economic "
        f"Success scheduling hub as a <strong>{role}</strong>.</p>"
        f"<p>Click the button below to create your account and get started:</p>"
        f"<p><a href=\"{invite_url}\" "
        f"style=\"{_BUTTON_STYLE}\">Accept Invitation</a></p>"
        f"<p style=\"color:#6b7280;font-size:13px;\">If the button doesn't "
        f"work, copy and paste this link into your browser:<br>{invite_url}</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_welcome_pending(to: str, name: str) -> bool:
    """Acknowledge a self-service registration that needs admin approval."""
    subject = "Your Iowa Center Hub registration is pending"
    display_name = name or "there"
    body = (
        f"<p>Hi {display_name},</p>"
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
        f"<p>Hi {display_name},</p>"
        f"<p>Good news — an administrator has approved your Iowa Center Hub "
        f"account. You can sign in any time using the button below.</p>"
        f"<p><a href=\"{login_url}\" "
        f"style=\"{_BUTTON_STYLE}\">Sign In</a></p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_password_reset(
    to: str, name: str, reset_url: str,
) -> bool:
    """Send a password reset link. Link expires in 1 hour."""
    subject = "Reset your Iowa Center Hub password"
    display_name = name or "there"
    body = (
        f"<p>Hi {display_name},</p>"
        f"<p>We received a request to reset the password on your Iowa "
        f"Center Hub account. Click the button below to choose a new "
        f"password:</p>"
        f"<p><a href=\"{reset_url}\" "
        f"style=\"{_BUTTON_STYLE}\">Reset Password</a></p>"
        f"<p style=\"color:#6b7280;font-size:13px;\">This link expires in "
        f"1 hour. If you didn't request a password reset, you can safely "
        f"ignore this email.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


def _settings_footer() -> str:
    """HTML footer linking recipients to their notification settings.

    Keeping this in one place means every notification email has a
    consistent unsubscribe/manage-preferences path, which both matches user
    expectations and helps keep deliverability healthy.
    """
    app_url = resolve_app_url().rstrip("/")
    return (
        f"<p style=\"color:#9ca3af;font-size:12px;margin-top:24px;\">"
        f"You're receiving this because of your notification preferences. "
        f"<a href=\"{app_url}/settings\" style=\"color:#6b7280;\">Manage "
        f"notifications</a>."
        f"</p>"
    )


async def send_notification_email(
    to: str, name: str, title: str, body_html: str,
    link: str | None = None,
) -> bool:
    """Send an instant notification email.

    Called by the notification dispatcher when the recipient has asked for
    instant email delivery of a given type. The caller supplies a
    user-friendly ``title`` and pre-rendered ``body_html``; we wrap them in
    the shared header/footer.
    """
    display_name = name or "there"
    cta = (
        f"<p><a href=\"{link}\" style=\"{_BUTTON_STYLE}\">View details</a></p>"
        if link else ""
    )
    body = (
        f"<p>Hi {display_name},</p>"
        f"<p>{body_html}</p>"
        f"{cta}"
        f"{_SIGNATURE}"
        f"{_settings_footer()}"
    )
    return await send_email(to, title, body)


async def send_digest_email(
    to: str, name: str, frequency: str, items: list[dict],
) -> bool:
    """Send a grouped digest of queued notifications.

    ``items`` is a list of dicts with at least ``title`` / ``body`` and
    optionally ``link``. One email per recipient per digest run; the digest
    worker deletes the queued rows on success.
    """
    if not items:
        return True  # nothing to send — treat as success so we clear state

    display_name = name or "there"
    label = "daily" if frequency == "daily" else "weekly"
    subject = f"Your {label} Iowa Center Hub digest ({len(items)} update"
    if len(items) != 1:
        subject += "s"
    subject += ")"

    rows = []
    for item in items:
        title = item.get("title", "")
        body = item.get("body", "")
        link = item.get("link")
        if link:
            link_html = (
                "<p style=\"margin:6px 0 0 0;font-size:13px;\">"
                f"<a href=\"{link}\" style=\"color:#4F46E5;\">View</a>"
                "</p>"
            )
        else:
            link_html = ""
        rows.append(
            "<tr>"
            "<td style=\"padding:12px 0;border-bottom:1px solid #e5e7eb;\">"
            "<p style=\"margin:0 0 4px 0;font-weight:600;color:#111827;\">"
            f"{title}</p>"
            "<p style=\"margin:0;color:#4b5563;font-size:14px;\">"
            f"{body}</p>"
            f"{link_html}"
            "</td>"
            "</tr>"
        )
    body_html = (
        f"<p>Hi {display_name},</p>"
        f"<p>Here's your {label} round-up from the Iowa Center Hub:</p>"
        f"<table style=\"width:100%;border-collapse:collapse;\">"
        f"{''.join(rows)}"
        f"</table>"
        f"{_SIGNATURE}"
        f"{_settings_footer()}"
    )
    return await send_email(to, subject, body_html)
