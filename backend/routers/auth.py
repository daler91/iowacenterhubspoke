import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Response
from database import db
from models.schemas import (
    UserRegister, UserLogin, PasswordChange, ErrorResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from core.auth import hash_password, verify_password, create_token, CurrentUser
from core.constants import ROLE_VIEWER, ROLE_ADMIN, USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED
from fastapi import Request
from core.rate_limit import limiter
from core.logger import get_logger, user_var

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_admin_email_str = os.getenv("ADMIN_EMAILS", os.getenv("ADMIN_EMAIL", ""))
ADMIN_EMAILS = [e.strip().lower() for e in _admin_email_str.split(",") if e.strip()]


@router.get(
    "/invite/{token}",
    summary="Validate invitation link",
    responses={404: {"model": ErrorResponse, "description": "Invalid or expired invitation link"}},
)
async def validate_invite(token: str):
    invitation = await db.invitations.find_one({"token": token, "status": "pending"}, {"_id": 0})
    if not invitation:
        raise HTTPException(status_code=404, detail="Invalid or expired invitation link")
    return {
        "valid": True,
        "email": invitation["email"],
        "name": invitation.get("name"),
        "role": invitation["role"],
    }


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

    invitation = None
    if data.invite_token:
        invitation = await db.invitations.find_one(
            {"token": data.invite_token, "status": "pending"}, {"_id": 0}
        )
        if not invitation:
            raise HTTPException(status_code=400, detail="Invalid or expired invitation link")
        if invitation["email"].lower() != data.email.lower():
            raise HTTPException(status_code=400, detail="Email does not match invitation")

    user_id = str(uuid.uuid4())
    is_admin_email = data.email.lower() in ADMIN_EMAILS
    if invitation:
        role = invitation["role"]
        status = USER_STATUS_APPROVED
    elif is_admin_email:
        role = ROLE_ADMIN
        status = USER_STATUS_APPROVED
    else:
        role = ROLE_VIEWER
        status = USER_STATUS_PENDING

    user_doc = {
        "id": user_id,
        "name": data.name,
        "email": data.email,
        "password_hash": hash_password(data.password),
        "role": role,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    logger.info("User registered", extra={"entity": {"user_id": user_id}})

    if invitation:
        await db.invitations.update_one(
            {"id": invitation["id"]},
            {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc).isoformat()}}
        )

    if is_admin_email or invitation:
        token = create_token(user_id, data.email, data.name, role)
        response.set_cookie(
            key="auth_token", value=token, httponly=True,
            secure=True, samesite="lax", max_age=86400 * 7,
        )
        return {
            "token": token,
            "user": {"id": user_id, "name": data.name, "email": data.email, "role": role},
        }
    else:
        # Self-service registration awaiting admin approval — send a
        # "received, pending review" acknowledgement. Non-fatal on failure.
        try:
            from services.email import send_welcome_pending
            await send_welcome_pending(to=data.email, name=data.name)
        except Exception as e:
            logger.warning(
                "Failed to send pending-welcome email to %s: %s", data.email, e,
            )
        return {"message": "Registration submitted. An admin must approve your account.", "pending": True}


@router.post(
    "/login",
    summary="Log in with email and password",
    responses={
        401: {"model": ErrorResponse, "description": "Invalid credentials"},
        403: {"model": ErrorResponse, "description": "Account pending approval or denied"},
    },
)
@limiter.limit("5/minute")
async def login(request: Request, data: UserLogin, response: Response):
    """Authenticate and receive a JWT token via HTTP-only cookie. Pending/rejected users are blocked."""
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    status = user.get("status", USER_STATUS_APPROVED)
    if status == USER_STATUS_PENDING:
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    if status == USER_STATUS_REJECTED:
        raise HTTPException(status_code=403, detail="Your registration was denied.")

    role = user.get("role", ROLE_VIEWER)
    token = create_token(user['id'], user['email'], user['name'], role)
    user_var.set(user['email'])
    logger.info("User logged in", extra={"entity": {"user_id": user['id']}})
    response.set_cookie(
        key="auth_token", value=token, httponly=True,
        secure=True, samesite="lax", max_age=86400 * 7,
    )
    return {
        "token": token,
        "user": {"id": user['id'], "name": user['name'], "email": user['email'], "role": role},
    }


@router.post("/logout", summary="Log out and clear session")
@limiter.limit("5/minute")
async def logout(request: Request, response: Response):
    """Clear the auth_token cookie to end the session."""
    response.delete_cookie(key="auth_token", httponly=True, samesite="lax", secure=True)
    return {"message": "Logged out successfully"}


PASSWORD_RESET_EXPIRY_HOURS = 1
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
    try:
        expires = datetime.fromisoformat(row["expires_at"])
    except (KeyError, ValueError):
        return None
    if expires < datetime.now(timezone.utc):
        return None
    return row


@router.post(
    "/forgot-password",
    summary="Request a password reset link",
)
@limiter.limit("3/minute")
async def forgot_password(request: Request, data: ForgotPasswordRequest):  # NOSONAR(S3516) anti-enumeration: response is intentionally invariant
    """Generate a password reset token and email it. Always returns the same
    generic response to avoid leaking which emails are registered."""
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user:
        return _GENERIC_FORGOT_RESPONSE

    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "token": token,
        "expires_at": expires.isoformat(),
        "created_at": now.isoformat(),
        "used_at": None,
    })
    logger.info(
        "Password reset token created", extra={"entity": {"user_id": user["id"]}},
    )

    try:
        from services.email import send_password_reset, resolve_app_url
        reset_url = f"{resolve_app_url()}/reset-password/{token}"
        await send_password_reset(
            to=user["email"], name=user.get("name", ""), reset_url=reset_url,
        )
    except Exception as e:
        logger.warning(
            "Failed to send password reset email to %s: %s", user["email"], e,
        )

    return _GENERIC_FORGOT_RESPONSE


@router.get(
    "/reset-password/{token}",
    summary="Validate a password reset token",
    responses={404: {"model": ErrorResponse, "description": _INVALID_RESET_TOKEN}},
)
@limiter.limit("10/minute")
async def validate_reset_token(request: Request, token: str):
    row = await _find_valid_reset_token(token)
    if not row:
        raise HTTPException(status_code=404, detail=_INVALID_RESET_TOKEN)
    return {"valid": True, "email": row["email"]}


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
    await db.password_resets.update_one(
        {"id": row["id"]},
        {"$set": {"used_at": now.isoformat()}},
    )
    logger.info(
        "Password reset via token",
        extra={"entity": {"user_id": row["user_id"]}},
    )
    return {"message": "Password reset successful"}


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
    logger.info("Password changed", extra={"entity": {"user_id": user['user_id']}})

    # Issue a new token (with iat after password_changed_at)
    token = create_token(user['user_id'], user['email'], user['name'], user.get('role', ROLE_VIEWER))
    response.set_cookie(key="auth_token", value=token, httponly=True, secure=True, samesite="lax", max_age=86400 * 7)
    return {"message": "Password changed successfully. All other sessions have been invalidated."}
