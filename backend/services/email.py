import os
from html import escape
from html import escape as _esc
from urllib.parse import urlparse

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

_SIGNATURE = "<p>— HubSpoke</p>"
_BUTTON_STYLE = (
    "display:inline-block;padding:12px 24px;"
    "background-color:#4F46E5;color:#ffffff;text-decoration:none;"
    "border-radius:8px;font-weight:600;"
)
_APP_URL_PRODUCTION_HINT = "https://theiowacenter-hub.org"


def _is_production_env() -> bool:
    return (
        os.getenv("ENVIRONMENT", "development") == "production"
        or bool(os.getenv("RAILWAY_ENVIRONMENT"))
    )


def _normalize_public_origin(value: str, name: str) -> str:
    origin = value.strip().rstrip("/")
    parsed = urlparse(origin)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or (parsed.path and parsed.path != "/")
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError(
            f"{name} must be an http(s) origin without a path, query, or fragment."
        )
    return origin


def resolve_app_url() -> str:
    """Return the public base URL for magic links.

    APP_URL is required in production because CORS_ORIGINS may intentionally
    be empty for same-origin deployments, and falling back to localhost would
    generate broken password-reset and partner-portal links.
    """
    app_url = os.getenv("APP_URL", "").strip()
    if app_url:
        return _normalize_public_origin(app_url, "APP_URL")

    if _is_production_env():
        raise RuntimeError(
            "APP_URL must be set in production before generating email links "
            f"(expected {_APP_URL_PRODUCTION_HINT})."
        )

    cors_origin = os.getenv("CORS_ORIGINS", "").split(",")[0].strip()
    if cors_origin:
        return _normalize_public_origin(cors_origin, "CORS_ORIGINS")
    return "http://localhost:5173"


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
        from email.message import EmailMessage

        message = EmailMessage()
        message["From"] = EMAIL_FROM
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body_html, subtype="html", charset="utf-8")

        await aiosmtplib.send(
            message,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER or None,
            password=SMTP_PASSWORD or None,
            start_tls=True,
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
        f"partner portal on HubSpoke.</p>"
        f"<p>Use the link below to view your upcoming classes, tasks, "
        f"shared documents, and messages:</p>"
        f'<p><a href="{_e(portal_url)}" '
        f'style="{_BUTTON_STYLE}">Open Partner Portal</a></p>'
        f'<p style="color:#6b7280;font-size:13px;">This link expires in '
        f"{PORTAL_TOKEN_EXPIRY_DAYS} day(s). If it expires, ask your HubSpoke "
        f"contact to send a new one.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_user_invite(
    to: str, name: str, role: str, invite_url: str,
) -> bool:
    """Send an admin-created user invitation with a signup link."""
    subject = "You're invited to HubSpoke"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>You've been invited to join HubSpoke "
        f"as a <strong>{_e(role)}</strong>.</p>"
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
    subject = "Your HubSpoke registration is pending"
    display_name = name or "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>Thanks for signing up for HubSpoke. Your account has "
        f"been created and is now waiting for an administrator to "
        f"review and approve it.</p>"
        f"<p>You'll receive another email as soon as your account is "
        f"approved and you can sign in.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_account_approved(
    to: str, name: str, login_url: str,
) -> bool:
    """Notify a user that their pending account has been approved."""
    subject = "Your HubSpoke account is approved"
    display_name = escape(name) if name else "there"
    body = (
        f"<p>Hi {_e(display_name)},</p>"
        f"<p>Good news — an administrator has approved your HubSpoke "
        f"account. You can sign in any time using the button below.</p>"
        f'<p><a href="{_e(login_url)}" '
        f'style="{_BUTTON_STYLE}">Sign In</a></p>'
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_account_rejected(to: str, name: str) -> bool:
    """Notify a user that their pending registration was declined.

    Transactional — kept short and respectful. No link (there's no next
    step for them in the app); we direct them to reach out to an admin.
    """
    subject = "Update on your HubSpoke registration"
    display_name = escape(name) if name else "there"
    body = (
        f"<p>Hi {display_name},</p>"
        f"<p>Thanks for your interest in HubSpoke. After review, "
        f"an administrator has declined your registration request.</p>"
        f"<p>If you believe this was a mistake or you'd like more context, "
        f"please reply to this email or reach out to your HubSpoke "
        f"contact directly.</p>"
        f"{_SIGNATURE}"
    )
    return await send_email(to, subject, body)


async def send_password_reset(
    to: str, name: str, reset_url: str,
) -> bool:
    """Send a password reset link. Expiry comes from email_jobs so
    the copy stays in sync with the actual token lifetime."""
    from services.email_jobs import PASSWORD_RESET_EXPIRY_HOURS
    subject = "Reset your HubSpoke password"
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
        f"<a href=\"{escape(app_url)}/settings\" style=\"color:#6b7280;\">Manage "
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

    ``name`` and ``link`` are caller-supplied strings that could contain
    HTML metacharacters; we escape them before embedding. ``body_html`` is
    the dispatcher's rendered HTML and is assumed pre-escaped by the caller
    (``make_event`` + per-helper HTML uses ``html.escape`` consistently).
    """
    display_name = escape(name) if name else "there"
    cta = (
        f"<p><a href=\"{escape(link)}\" style=\"{_BUTTON_STYLE}\">View details</a></p>"
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

    display_name = escape(name) if name else "there"
    label = "daily" if frequency == "daily" else "weekly"
    subject = f"Your {label} HubSpoke digest ({len(items)} update"
    if len(items) != 1:
        subject += "s"
    subject += ")"

    # Digest item fields come from NotificationEvent.title/body (plaintext)
    # and .link (URL). All need escaping before embedding in HTML.
    rows = []
    for item in items:
        title = escape(str(item.get("title", "")))
        body = escape(str(item.get("body", "")))
        link = item.get("link")
        if link:
            link_html = (
                "<p style=\"margin:6px 0 0 0;font-size:13px;\">"
                f"<a href=\"{escape(str(link))}\" style=\"color:#4F46E5;\">View</a>"
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
        f"<p>Here's your {label} round-up from HubSpoke:</p>"
        f"<table style=\"width:100%;border-collapse:collapse;\">"
        f"{''.join(rows)}"
        f"</table>"
        f"{_SIGNATURE}"
        f"{_settings_footer()}"
    )
    return await send_email(to, subject, body_html)
