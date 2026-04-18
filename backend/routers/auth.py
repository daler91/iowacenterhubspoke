import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from database import db
from models.schemas import (
    UserRegister, UserLogin, PasswordChange, ErrorResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from core.auth import (
    hash_password, verify_password, create_token,
    create_refresh_token, decode_refresh_token,
    CurrentUser, invalidate_pwd_cache,
    REFRESH_TOKEN_LIFETIME_SECONDS, TOKEN_LIFETIME_SECONDS,
)
from core.constants import ROLE_VIEWER, ROLE_ADMIN, USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED
from fastapi import Request
from core.queue import safe_enqueue_job
from core.rate_limit import limiter
from core.logger import get_logger, user_var

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_session_cookies(
    response: Response,
    user_id: str,
    email: str,
    name: str,
    role: str,
):
    """Issue an access token + refresh token pair and set both cookies.

    The refresh jti is persisted so the /auth/refresh handler can
    invalidate it on rotation and refuse replays.
    """
    access = create_token(user_id, email, name, role)
    refresh, jti = create_refresh_token(user_id)
    now = datetime.now(timezone.utc)
    await db.refresh_tokens.insert_one({
        "jti": jti,
        "user_id": user_id,
        "issued_at": now.isoformat(),
        "expires_at": now + timedelta(seconds=REFRESH_TOKEN_LIFETIME_SECONDS),
        "used_at": None,
    })
    response.set_cookie(
        key="auth_token", value=access, httponly=True,
        secure=True, samesite="lax", max_age=TOKEN_LIFETIME_SECONDS,
    )
    response.set_cookie(
        key="refresh_token", value=refresh, httponly=True,
        secure=True, samesite="lax", max_age=REFRESH_TOKEN_LIFETIME_SECONDS,
        path="/api",
    )

_admin_email_str = os.getenv("ADMIN_EMAILS", os.getenv("ADMIN_EMAIL", ""))
ADMIN_EMAILS = [e.strip().lower() for e in _admin_email_str.split(",") if e.strip()]

# Per-email brute-force thresholds. IP-based rate limits already throttle
# raw traffic; this layer adds an email-scoped lockout that a botnet
# can't dodge by rotating source IPs.
LOGIN_LOCKOUT_THRESHOLD = int(os.getenv("LOGIN_LOCKOUT_THRESHOLD", "10"))
LOGIN_LOCKOUT_WINDOW_MINUTES = int(os.getenv("LOGIN_LOCKOUT_WINDOW_MINUTES", "15"))

# How recently a refresh-token jti must have been consumed for a second
# presentation to count as a legitimate race (two tabs refreshing at once
# before the rotated cookie lands) rather than a stolen-cookie replay.
# Beyond this window we assume malice and revoke the whole chain.
_REFRESH_RACE_GRACE_SECONDS = int(os.getenv("REFRESH_RACE_GRACE_SECONDS", "30"))


async def _record_login_failure(email: str) -> None:
    """Increment the failure counter and extend the expiry window."""
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=LOGIN_LOCKOUT_WINDOW_MINUTES)
    await db.login_failures.update_one(
        {"email": email.lower()},
        {
            "$inc": {"count": 1},
            "$set": {"last_failure_at": now.isoformat(), "expires_at": expiry},
        },
        upsert=True,
    )


async def _clear_login_failures(email: str) -> None:
    """Reset the counter on a successful login."""
    await db.login_failures.delete_one({"email": email.lower()})


async def _is_login_locked(email: str) -> tuple[bool, int]:
    """Return (locked, remaining_seconds_until_unlock)."""
    row = await db.login_failures.find_one({"email": email.lower()}, {"_id": 0})
    if not row:
        return False, 0
    count = row.get("count", 0)
    if count < LOGIN_LOCKOUT_THRESHOLD:
        return False, 0
    raw_exp = row.get("expires_at")
    if isinstance(raw_exp, datetime):
        expires = raw_exp if raw_exp.tzinfo else raw_exp.replace(tzinfo=timezone.utc)
    elif isinstance(raw_exp, str):
        try:
            expires = datetime.fromisoformat(raw_exp)
        except ValueError:
            return False, 0
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
    else:
        return False, 0
    now = datetime.now(timezone.utc)
    remaining = int((expires - now).total_seconds())
    if remaining <= 0:
        # Window has elapsed but the row is still here (Mongo's TTL
        # sweep runs ~once/minute, so rows linger past their
        # expires_at). Drop the stale row so the *next* failure starts
        # a fresh count from 1 rather than ``$inc``-ing a count that's
        # already at/over the threshold and immediately re-locking the
        # account on a single typo.
        await db.login_failures.delete_one({"email": email.lower()})
        return False, 0
    return True, remaining


def _invitation_is_expired(invitation: dict) -> bool:
    """Belt-and-suspenders check for expires_at alongside the TTL index.

    The MongoDB TTL daemon sweeps roughly once a minute, so a token that
    expired seconds ago may still satisfy the ``status: pending`` match.
    """
    raw = invitation.get("expires_at")
    if raw is None:
        return False  # legacy row predating expires_at
    if isinstance(raw, datetime):
        exp = raw
    else:
        try:
            exp = datetime.fromisoformat(str(raw))
        except ValueError:
            return True
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp < datetime.now(timezone.utc)


@router.get(
    "/invite/{token}",
    summary="Validate invitation link",
    responses={404: {"model": ErrorResponse, "description": "Invalid or expired invitation link"}},
)
async def validate_invite(token: str):
    invitation = await db.invitations.find_one({"token": token, "status": "pending"}, {"_id": 0})
    if not invitation or _invitation_is_expired(invitation):
        raise HTTPException(status_code=404, detail="Invalid or expired invitation link")
    return {
        "valid": True,
        "email": invitation["email"],
        "name": invitation.get("name"),
        "role": invitation["role"],
    }


async def _validate_invitation(data: UserRegister) -> Optional[dict]:
    """Look up the pending invitation matching ``data.invite_token``.

    Returns the raw invitation doc (not yet claimed) or None when the
    request is not an invitation flow. Raises 400 on any mismatch so
    the caller doesn't need to distinguish failure modes.
    """
    if not data.invite_token:
        return None
    invitation = await db.invitations.find_one(
        {"token": data.invite_token, "status": "pending"}, {"_id": 0}
    )
    if not invitation or _invitation_is_expired(invitation):
        raise HTTPException(status_code=400, detail="Invalid or expired invitation link")
    if invitation["email"].lower() != data.email.lower():
        raise HTTPException(status_code=400, detail="Email does not match invitation")
    return invitation


async def _claim_invitation_or_raise(token: str) -> dict:
    """Atomically flip the invitation's status pending→accepted.

    Two concurrent registers can't both win — only the request whose
    CAS matches ``status: pending`` proceeds. Callers that lose the
    race get a 400 and must ask the admin for a fresh link.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    claimed = await db.invitations.find_one_and_update(
        {"token": token, "status": "pending"},
        {"$set": {"status": "accepted", "accepted_at": now_iso}},
        projection={"_id": 0},
        return_document=True,
    )
    if not claimed:
        raise HTTPException(
            status_code=400, detail="This invitation has already been accepted.",
        )
    return claimed


def _derive_role_and_status(
    claimed_invitation: Optional[dict], is_admin_email: bool,
) -> tuple[str, str]:
    """Decide the new user's role + status from the registration path."""
    if claimed_invitation:
        return claimed_invitation["role"], USER_STATUS_APPROVED
    if is_admin_email:
        return ROLE_ADMIN, USER_STATUS_APPROVED
    return ROLE_VIEWER, USER_STATUS_PENDING


async def _release_invitation(token: str) -> None:
    """Roll the invitation back to pending on user-insert failure.

    Matches on the ``accepted`` status so a successful concurrent
    register from a different request isn't clobbered.
    """
    await db.invitations.update_one(
        {"token": token, "status": "accepted"},
        {"$set": {"status": "pending"}, "$unset": {"accepted_at": ""}},
    )


async def _send_pending_notifications(user_doc: dict) -> None:
    """Fire the post-registration notifications for a pending user.

    Two independent non-fatal calls: the courtesy "we got your application"
    email to the applicant, and the admin-fanout notification. Either can
    fail without blocking registration.
    """
    email = user_doc.get("email", "")
    name = user_doc.get("name", "")
    user_id = user_doc.get("id", "")
    try:
        from services.email import send_welcome_pending
        await send_welcome_pending(to=email, name=name)
    except Exception as e:
        logger.warning("Failed to send pending-welcome email to %s: %s", email, e)
    try:
        from services.notification_events import notify_new_user_pending
        await notify_new_user_pending(user_doc)
    except Exception as e:
        logger.warning("Failed to notify admins of pending user %s: %s", user_id, e)


@router.post(
    "/register",
    summary="Register a new user account",
    responses={400: {"model": ErrorResponse, "description": "Email already registered"}},
)
@limiter.limit("5/minute")
async def register(request: Request, data: UserRegister, response: Response):
    """Create a new user account. Invited and admin-email users are auto-approved; others require admin approval."""
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    is_admin_email = data.email.lower() in ADMIN_EMAILS
    invitation_lookup = await _validate_invitation(data)

    # Self-service registrants must accept the privacy notice.
    # Invitation flows and admin-email bootstrap are exempt because the
    # invitation + the admin-email allowlist is out-of-band consent.
    if not invitation_lookup and not is_admin_email and not data.privacy_policy_accepted:
        raise HTTPException(
            status_code=400,
            detail=(
                "You must accept the privacy policy to register. This app "
                "stores your name and email, and may share location and "
                "calendar data with Google or Microsoft if you connect "
                "those integrations."
            ),
        )

    claimed_invitation = (
        await _claim_invitation_or_raise(data.invite_token)
        if invitation_lookup else None
    )

    user_id = str(uuid.uuid4())
    role, status = _derive_role_and_status(claimed_invitation, is_admin_email)
    now_iso = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "id": user_id,
        "name": data.name,
        "email": data.email,
        "password_hash": hash_password(data.password),
        "role": role,
        "status": status,
        "created_at": now_iso,
        "privacy_policy_accepted_at": (
            now_iso if data.privacy_policy_accepted or claimed_invitation else None
        ),
    }
    try:
        await db.users.insert_one(user_doc)
    except Exception:
        # If the user insert fails after we already claimed the
        # invitation, roll it back so the user can retry the link.
        if claimed_invitation:
            await _release_invitation(data.invite_token)
        raise
    logger.info("User registered", extra={"entity": {"user_id": user_id}})

    if is_admin_email or claimed_invitation:
        await _issue_session_cookies(response, user_id, data.email, data.name, role)
        return {
            "user": {"id": user_id, "name": data.name, "email": data.email, "role": role},
        }

    # Self-service registration awaiting admin approval.
    await _send_pending_notifications(user_doc)
    return {
        "message": "Registration submitted. An admin must approve your account.",
        "pending": True,
    }


@router.post(
    "/login",
    summary="Log in with email and password",
    responses={
        401: {"model": ErrorResponse, "description": "Invalid credentials"},
        403: {"model": ErrorResponse, "description": "Account pending approval or denied"},
        429: {"model": ErrorResponse, "description": "Too many failed login attempts — temporary lockout"},
    },
)
@limiter.limit("5/minute")
async def login(request: Request, data: UserLogin, response: Response):
    """Authenticate and receive a JWT token via HTTP-only cookie. Pending/rejected users are blocked."""
    locked, remaining = await _is_login_locked(data.email)
    if locked:
        minutes = max(1, remaining // 60)
        # Surface lockouts at WARNING — ops wants this visible in log
        # aggregation to spot credential-stuffing patterns. Email domain
        # only (no local-part) keeps PII out of the log.
        _domain = data.email.split("@", 1)[-1].lower() if "@" in data.email else "?"
        logger.warning(
            "Login attempt blocked — brute-force lockout active",
            extra={"entity": {"email_domain": _domain, "remaining_minutes": minutes}},
        )
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many failed login attempts for this email. "
                f"Try again in {minutes} minute(s) or reset your password."
            ),
        )

    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user['password_hash']):
        await _record_login_failure(data.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    status = user.get("status", USER_STATUS_APPROVED)
    if status == USER_STATUS_PENDING:
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    if status == USER_STATUS_REJECTED:
        raise HTTPException(status_code=403, detail="Your registration was denied.")

    # Successful credential + status check — reset the failure counter so
    # a later mistyped password doesn't start from a tripped threshold.
    await _clear_login_failures(data.email)

    role = user.get("role", ROLE_VIEWER)
    user_var.set(user['email'])
    logger.info("User logged in", extra={"entity": {"user_id": user['id']}})
    await _issue_session_cookies(response, user['id'], user['email'], user['name'], role)
    return {
        "user": {"id": user['id'], "name": user['name'], "email": user['email'], "role": role},
    }


@router.post(
    "/logout",
    summary="Log out and clear session",
    responses={
        401: {"model": ErrorResponse, "description": "Refresh token invalid or expired"},
    },
)
@limiter.limit("5/minute")
async def logout(request: Request, response: Response):
    """Clear the session cookies to end the session."""
    # Revoke the refresh token on the way out so a stolen cookie can't
    # outlive the logout click.
    refresh = request.cookies.get("refresh_token")
    if refresh:
        try:
            payload = decode_refresh_token(refresh)
            await db.refresh_tokens.update_one(
                {"jti": payload["jti"]},
                {"$set": {"used_at": datetime.now(timezone.utc).isoformat(), "revoked_reason": "logout"}},
            )
        except HTTPException:
            pass
    response.delete_cookie(key="auth_token", httponly=True, samesite="lax", secure=True)
    response.delete_cookie(key="refresh_token", httponly=True, samesite="lax", secure=True, path="/api")
    return {"message": "Logged out successfully"}


@router.post(
    "/refresh",
    summary="Rotate refresh token and issue a new access token",
    responses={
        401: {
            "model": ErrorResponse,
            "description": (
                "No refresh cookie, token invalid/expired, unknown jti, "
                "replay detected (all sessions revoked), or user no "
                "longer active"
            ),
        },
    },
)
@limiter.limit("20/minute")
async def refresh_session(request: Request, response: Response):
    """Exchange a valid refresh cookie for a fresh access+refresh pair.

    One-time use: each refresh token is invalidated on exchange. If the
    same jti is presented again we assume a leaked/stolen cookie and
    revoke the whole token chain for that user.
    """
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(status_code=401, detail="No refresh token")

    payload = decode_refresh_token(refresh)
    jti = payload["jti"]
    user_id = payload["user_id"]

    # Atomic claim: ``find_one_and_update`` with ``used_at: None`` as
    # part of the filter lets MongoDB do the check-and-set in a single
    # document operation. Two concurrent requests presenting the same
    # cookie can't both win — the loser sees ``None`` and we correctly
    # take the replay branch. Previously the sequence was
    # ``find_one → check used_at → await users.find_one → update_one``
    # with no predicate, which yielded the event loop between check
    # and write and let both callers pass the replay guard.
    now_iso = datetime.now(timezone.utc).isoformat()
    claimed = await db.refresh_tokens.find_one_and_update(
        {"jti": jti, "used_at": None},
        {"$set": {"used_at": now_iso}},
        projection={"_id": 0},
    )

    if claimed is None:
        # Either the jti doesn't exist or it was already consumed.
        # Distinguish:
        #   * no row → unknown token, just 401.
        #   * row exists and was consumed moments ago → legitimate
        #     concurrent refresh (two tabs / double-click). The winner
        #     has already rotated the cookie in the shared browser jar,
        #     so we just ask the loser to retry.
        #   * row exists and was consumed longer ago → genuine replay
        #     (stolen cookie resurfacing) → revoke the whole chain.
        existing = await db.refresh_tokens.find_one(
            {"jti": jti}, {"_id": 0, "user_id": 1, "used_at": 1},
        )
        if not existing:
            raise HTTPException(status_code=401, detail="Unknown refresh token")

        used_at = existing.get("used_at")
        age_seconds = None
        if isinstance(used_at, str):
            try:
                used_dt = datetime.fromisoformat(used_at)
                if used_dt.tzinfo is None:
                    used_dt = used_dt.replace(tzinfo=timezone.utc)
                age_seconds = (
                    datetime.now(timezone.utc) - used_dt
                ).total_seconds()
            except ValueError:
                age_seconds = None

        if age_seconds is not None and age_seconds < _REFRESH_RACE_GRACE_SECONDS:
            # Legit race. Don't revoke — the winning request already
            # rotated the cookie; the browser will present the fresh
            # one on the next call.
            logger.info(
                "Refresh race ignored (within grace window)",
                extra={"entity": {
                    "user_id": existing["user_id"],
                    "jti_prefix": jti[:8],
                    "age_seconds": round(age_seconds, 2),
                }},
            )
            raise HTTPException(
                status_code=401,
                detail="Refresh already in flight — retry with the latest cookie.",
            )

        await db.refresh_tokens.update_many(
            {"user_id": existing["user_id"], "used_at": None},
            {"$set": {
                "used_at": now_iso,
                "revoked_reason": "replay_detected",
            }},
        )
        response.delete_cookie(key="auth_token", httponly=True, samesite="lax", secure=True)
        response.delete_cookie(key="refresh_token", httponly=True, samesite="lax", secure=True, path="/api")
        logger.warning(
            "Refresh token replay — all sessions revoked",
            extra={"entity": {"user_id": existing["user_id"], "jti_prefix": jti[:8]}},
        )
        raise HTTPException(
            status_code=401,
            detail="Session reused — all devices have been signed out for safety. Sign in again.",
        )

    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_doc or user_doc.get("status") != USER_STATUS_APPROVED:
        # We've already consumed the token; don't hand out new cookies
        # to a deactivated user. Chain stays revoked.
        raise HTTPException(status_code=401, detail="User no longer active")

    await _issue_session_cookies(
        response,
        user_doc["id"],
        user_doc["email"],
        user_doc["name"],
        user_doc.get("role", ROLE_VIEWER),
    )
    return {"refreshed": True}


_GENERIC_FORGOT_RESPONSE = {
    "message": "If that email is registered, a reset link has been sent.",
}
_INVALID_RESET_TOKEN = "Invalid or expired reset link"


async def _find_valid_reset_token(token: str):
    """Look up a password_resets row that is unused and not expired."""
    row = await db.password_resets.find_one(
        {"token": token, "used_at": None}, {"_id": 0},
    )
    if not row:
        return None
    raw_expires = row.get("expires_at")
    # expires_at may be a native datetime (current writes) or an ISO string
    # (legacy rows) — accept both so rolling deploys don't orphan tokens.
    if isinstance(raw_expires, datetime):
        expires = raw_expires
    elif isinstance(raw_expires, str):
        try:
            expires = datetime.fromisoformat(raw_expires)
        except ValueError:
            return None
    else:
        return None
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    return row


@router.post(
    "/forgot-password",
    summary="Request a password reset link",
)
@limiter.limit("3/minute")
async def forgot_password(request: Request, data: ForgotPasswordRequest):  # NOSONAR(S3516)
    """Request a password reset link.

    The DB lookup, token creation, and SMTP send are all dispatched to
    a background worker so request timing is identical whether or not
    the email is registered (anti-enumeration — intentional invariant
    response and constant-time handler). `safe_enqueue_job` never
    raises, so even a transient Redis failure still returns the generic
    response rather than leaking a 500."""
    await safe_enqueue_job("send_password_reset_email_job", data.email)
    return _GENERIC_FORGOT_RESPONSE


@router.get(
    "/reset-password/{token}",
    summary="Validate a password reset token",
    responses={404: {"model": ErrorResponse, "description": _INVALID_RESET_TOKEN}},
)
@limiter.limit("10/minute")
async def validate_reset_token(request: Request, token: str):
    """Return only whether the token is valid — not which email it belongs to.

    The previous behaviour leaked the user email via the reset URL, which
    made the token useful as an enumeration oracle for any URL an attacker
    obtained from a log or email forwarder.
    """
    row = await _find_valid_reset_token(token)
    if not row:
        raise HTTPException(status_code=404, detail=_INVALID_RESET_TOKEN)
    return {"valid": True}


@router.post(
    "/reset-password",
    summary="Set a new password using a reset token",
    responses={404: {"model": ErrorResponse, "description": _INVALID_RESET_TOKEN}},
)
@limiter.limit("5/minute")
async def reset_password(request: Request, data: ResetPasswordRequest):
    row = await _find_valid_reset_token(data.token)
    if not row:
        raise HTTPException(status_code=404, detail=_INVALID_RESET_TOKEN)

    now = datetime.now(timezone.utc)
    # Also bump password_changed_at so any active sessions (which carry an
    # older iat) are invalidated by the token validator in core/auth.py.
    await db.users.update_one(
        {"id": row["user_id"]},
        {"$set": {
            "password_hash": hash_password(data.new_password),
            "password_changed_at": now.isoformat(),
        }},
    )
    await invalidate_pwd_cache(row["user_id"])
    # Invalidate ALL outstanding reset tokens for this user, not just the one
    # that was submitted. Otherwise a second leaked link could still be used
    # to reset the password again after a successful reset.
    await db.password_resets.update_many(
        {"user_id": row["user_id"], "used_at": None},
        {"$set": {"used_at": now.isoformat()}},
    )
    logger.info(
        "Password reset via token",
        extra={"entity": {"user_id": row["user_id"]}},
    )
    return {"message": "Password reset successful"}


@router.get(
    "/me/export",
    summary="Export all personal data stored about the current user (GDPR Art. 20)",
)
async def export_my_data(user: CurrentUser):
    """Return every piece of data linked to the authenticated user.

    Satisfies the right to data portability. The response contains:
    - the user record (minus password hash)
    - the employee record linked by email, if any (minus OAuth tokens)
    - activity log entries attributed to this user
    - password-reset audit rows (timestamps only — not the tokens)
    """
    user_id = user["user_id"]
    email = user["email"]

    user_doc = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "password_hash": 0},
    )
    # Case-insensitive match so mixed-case stored addresses are found.
    import re as _re
    employee_doc = await db.employees.find_one(
        {
            "email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"},
            "deleted_at": None,
        },
        {
            "_id": 0,
            "google_refresh_token": 0,
            "outlook_refresh_token": 0,
        },
    )
    # Filter by user_id when possible. Legacy rows (before user_id was
    # captured on write) fall back to name-match only for the current
    # user — not strictly correct if two users share a display name,
    # but it's the best we can do for pre-migration data and at least
    # bounds the ambiguity to the caller's own account.
    activity = await db.activity_logs.find(
        {
            "$or": [
                {"user_id": user_id},
                {"user_id": {"$in": [None, ""]}, "user_name": user.get("name", "")},
            ]
        },
        {"_id": 0, "expires_at": 0},
    ).sort("timestamp", -1).to_list(10_000)
    password_resets = await db.password_resets.find(
        {"user_id": user_id},
        {"_id": 0, "token": 0},
    ).to_list(100)

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": user_doc,
        "employee": employee_doc,
        "activity_log": activity,
        "password_reset_history": password_resets,
    }


@router.delete(
    "/me",
    summary="Delete the current user's account and anonymize their data (GDPR Art. 17)",
    responses={
        400: {
            "model": ErrorResponse,
            "description": (
                "Caller is the last admin — another admin must exist "
                "before self-delete is allowed"
            ),
        },
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def delete_my_account(user: CurrentUser, response: Response):
    """Self-service account deletion.

    - Hard-deletes the user record so the email can be re-used.
    - Soft-deletes the linked employee record (preserves historical
      schedules for audit, but strips PII like email and phone).
    - Anonymizes the user's name in activity logs and messages.
    - Revokes the session cookie.

    Admins cannot self-delete via this endpoint — that would stranding
    other users; they must transfer admin to another user first.
    """
    from core.constants import ROLE_ADMIN as _ADMIN

    user_doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if user_doc.get("role") == _ADMIN:
        # Atomic last-admin guard. A racy count-then-check lets two
        # concurrent admin self-deletes both pass and leave a tenant
        # with zero admins. Instead, *claim* by demoting the caller's
        # own role with a CAS; then check how many admins remain. If
        # the claim left zero, roll it back and 400 the caller. Doing
        # this BEFORE any destructive writes means a losing racer
        # hasn't anonymized any records — failure is clean.
        claimed = await db.users.find_one_and_update(
            {"id": user["user_id"], "role": _ADMIN},
            {"$set": {"role": ROLE_VIEWER}},
        )
        if claimed is not None:
            remaining = await db.users.count_documents({"role": _ADMIN})
            if remaining == 0:
                await db.users.update_one(
                    {"id": user["user_id"]},
                    {"$set": {"role": _ADMIN}},
                )
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "You are the only admin. Promote another user to admin "
                        "before deleting your account."
                    ),
                )

    now = datetime.now(timezone.utc).isoformat()
    anon_name = f"[deleted-user-{user['user_id'][:8]}]"

    # Anonymize activity logs. Prefer matching by user_id (added on
    # new log rows so a display-name collision with another user
    # doesn't over-scrub their audit trail). Legacy rows written
    # before user_id was captured still fall back to name-match, but
    # the GDPR export's use of this same pair means the ambiguity is
    # bounded to pre-migration data.
    await db.activity_logs.update_many(
        {"user_id": user["user_id"]},
        {"$set": {"user_name": anon_name}},
    )
    await db.activity_logs.update_many(
        {
            "user_id": {"$in": [None, ""]},
            "user_name": user_doc.get("name", ""),
        },
        {"$set": {"user_name": anon_name}},
    )
    # Anonymize message senders
    await db.messages.update_many(
        {"sender_id": user["user_id"]},
        {"$set": {"sender_name": anon_name}},
    )
    # Anonymize comment authors
    await db.task_comments.update_many(
        {"sender_id": user["user_id"]},
        {"$set": {"sender_name": anon_name}},
    )

    # Case-insensitive email match so a mixed-case invitation or
    # contact row (e.g. ``Bob@Example.com``) isn't orphaned when the
    # user-facing email is stored lower-cased. ``^...$`` anchors
    # prevent partial matches like ``sub.bob@...``; ``re.escape``
    # neutralises any regex metacharacters in the address.
    import re as _re
    email_pattern = {
        "$regex": f"^{_re.escape(user_doc['email'])}$",
        "$options": "i",
    }

    # Soft-delete any employee record with this email, scrub PII fields.
    employee_ids_to_anonymize: list[str] = []
    async for emp in db.employees.find(
        {"email": email_pattern, "deleted_at": None},
        {"_id": 0, "id": 1},
    ):
        employee_ids_to_anonymize.append(emp["id"])

    await db.employees.update_many(
        {"email": email_pattern, "deleted_at": None},
        {
            "$set": {
                "deleted_at": now,
                "email": None,
                "phone": None,
                "name": anon_name,
            },
            "$unset": {
                "google_refresh_token": "",
                "google_calendar_email": "",
                "outlook_refresh_token": "",
                "outlook_calendar_email": "",
            },
        },
    )

    # Scrub the denormalized employee snapshots that every schedule
    # carries (employees: [{id, name, color}]). Historical analytics
    # keep the id + color so charts still render, but the name is
    # replaced with the deletion placeholder.
    if employee_ids_to_anonymize:
        await db.schedules.update_many(
            {"employees.id": {"$in": employee_ids_to_anonymize}},
            {"$set": {"employees.$[e].name": anon_name}},
            array_filters=[{"e.id": {"$in": employee_ids_to_anonymize}}],
        )

    # Anonymize partner-contact records that match the departing user's
    # email. Most are unrelated (partners have their own identities),
    # but a user who also happens to be a partner contact needs both
    # records cleaned.
    await db.partner_contacts.update_many(
        {"email": email_pattern, "deleted_at": None},
        {
            "$set": {
                "deleted_at": now,
                "email": None,
                "phone": None,
                "name": anon_name,
            },
        },
    )

    # Delete pending invitations, reset tokens, refresh tokens, and
    # any portal tokens tied to contacts we just anonymized. Portal
    # tokens that outlive the contact would still hold a valid
    # magic-link session.
    await db.invitations.delete_many({"email": email_pattern})
    await db.password_resets.delete_many({"user_id": user["user_id"]})
    await db.refresh_tokens.delete_many({"user_id": user["user_id"]})
    await db.login_failures.delete_many({"email": user_doc["email"].lower()})

    anonymized_contacts = await db.partner_contacts.distinct(
        "id", {"deleted_at": now},
    )
    if anonymized_contacts:
        await db.portal_tokens.delete_many(
            {"contact_id": {"$in": anonymized_contacts}},
        )

    # Remove the user last so the foreign-key-like references above
    # still resolve during the anonymization phase. The last-admin
    # invariant was already enforced atomically at the top of this
    # handler via the role-demote CAS, before any destructive writes.
    await db.users.delete_one({"id": user["user_id"]})
    invalidate_pwd_cache(user["user_id"])

    response.delete_cookie(
        key="auth_token", httponly=True, samesite="lax", secure=True,
    )
    response.delete_cookie(
        key="refresh_token", httponly=True, samesite="lax", secure=True, path="/api",
    )
    logger.info("User self-deleted", extra={"entity": {"user_id": user["user_id"]}})
    return {"message": "Your account has been deleted."}


@router.get("/me", summary="Get current user profile")
async def get_me(user: CurrentUser):
    """Return the authenticated user's ID, email, name, and role."""
    user_var.set(user['email'])
    return {
        "user_id": user['user_id'],
        "email": user['email'],
        "name": user['name'],
        "role": user.get("role", ROLE_VIEWER)
    }


@router.get("/my-employee", summary="Get the employee record linked to the current user (by email)")
async def get_my_employee(user: CurrentUser):
    """Look up the employee record matching the authenticated user's email."""
    employee = await db.employees.find_one(
        {"email": user["email"], "deleted_at": None},
        {"_id": 0, "google_refresh_token": 0, "outlook_refresh_token": 0},
    )
    return {"employee": employee}


@router.post(
    "/change-password",
    summary="Change password and invalidate existing sessions",
    responses={
        400: {"model": ErrorResponse, "description": "Current password is incorrect"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def change_password(data: PasswordChange, user: CurrentUser, response: Response):
    """Change the current user's password. All existing sessions (tokens issued before
    this change) are automatically invalidated. A new token is issued."""
    user_doc = await db.users.find_one({"id": user['user_id']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(data.current_password, user_doc['password_hash']):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": user['user_id']},
        {"$set": {
            "password_hash": hash_password(data.new_password),
            "password_changed_at": now.isoformat(),
        }}
    )
    await invalidate_pwd_cache(user['user_id'])
    logger.info("Password changed", extra={"entity": {"user_id": user['user_id']}})

    # Revoke all outstanding refresh tokens for this user so other devices
    # can't quietly re-exchange their old refresh token for a new access
    # token after the password change.
    await db.refresh_tokens.update_many(
        {"user_id": user['user_id'], "used_at": None},
        {"$set": {
            "used_at": datetime.now(timezone.utc).isoformat(),
            "revoked_reason": "password_changed",
        }},
    )
    # Issue a fresh access+refresh pair for the device that just changed
    # the password so they stay logged in.
    await _issue_session_cookies(
        response,
        user['user_id'],
        user['email'],
        user['name'],
        user.get('role', ROLE_VIEWER),
    )
    return {"message": "Password changed successfully. All other sessions have been invalidated."}
