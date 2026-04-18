import os
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from database import db
from core.auth import AdminRequired
from core.constants import (
    ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER,
    USER_STATUS_APPROVED, USER_STATUS_REJECTED,
)
from models.schemas import UserRoleUpdate, InviteCreate, ErrorResponse
from core.logger import get_logger

INVITATION_EXPIRY_DAYS = int(os.environ.get("INVITATION_EXPIRY_DAYS", "14"))

logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER}
USER_NOT_FOUND = "User not found"


@router.get("/", summary="List all users")
async def list_users(user: AdminRequired):
    """Return all users (excluding password hashes). Admin only."""
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0})
    users = await cursor.to_list(length=1000)
    return {"users": users}


@router.put(
    "/{user_id}/approve",
    summary="Approve a pending user",
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def approve_user(user_id: str, user: AdminRequired):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)

    was_pending = target.get("status") != USER_STATUS_APPROVED
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_APPROVED}},
    )
    logger.info(f"User {user_id} approved by {user['email']}")

    # Only email on the pending → approved transition (idempotent re-approvals
    # shouldn't spam the user).
    if was_pending:
        try:
            from services.email import send_account_approved, resolve_app_url
            await send_account_approved(
                to=target["email"],
                name=target.get("name", ""),
                login_url=f"{resolve_app_url()}/login",
            )
        except Exception as e:
            logger.warning(
                "Failed to send approval email to %s: %s",
                target["email"], e,
            )

    return {"message": "User approved"}


@router.put(
    "/{user_id}/reject",
    summary="Reject a pending user",
    responses={
        400: {"model": ErrorResponse, "description": "Cannot reject an admin user"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def reject_user(user_id: str, user: AdminRequired):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    if target.get("role") == ROLE_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot reject an admin user")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_REJECTED}}
    )
    logger.info(f"User {user_id} rejected by {user['email']}")
    return {"message": "User rejected"}


@router.put(
    "/{user_id}/role",
    summary="Change a user's role",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid role or cannot remove last admin"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def update_user_role(user_id: str, data: UserRoleUpdate, user: AdminRequired):
    """Update a user's role. Prevents removing the last admin."""
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    # Prevent removing the last admin
    if target.get("role") == ROLE_ADMIN and data.role != ROLE_ADMIN:
        admin_count = await db.users.count_documents({"role": ROLE_ADMIN})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    logger.info(f"User {user_id} role changed to {data.role} by {user['email']}")
    return {"message": f"Role updated to {data.role}"}


@router.delete(
    "/{user_id}",
    summary="Delete a user account",
    responses={
        400: {"model": ErrorResponse, "description": "Cannot delete your own account"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def delete_user(user_id: str, user: AdminRequired):
    """Permanently delete a user. Cannot delete your own account."""
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    await db.users.delete_one({"id": user_id})
    logger.info(f"User {user_id} deleted by {user['email']}")
    return {"message": "User deleted"}


@router.post(
    "/invite",
    summary="Create an invitation link",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid role, user or invitation already exists"},
    },
)
async def create_invitation(data: InviteCreate, user: AdminRequired):
    """Generate a one-time invitation link for a new user with a pre-assigned role."""
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    existing_user = await db.users.find_one(
        {"email": data.email, "status": USER_STATUS_APPROVED}, {"_id": 0}
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="A user with this email already exists")

    existing_invite = await db.invitations.find_one(
        {"email": data.email, "status": "pending"}, {"_id": 0}
    )
    if existing_invite:
        raise HTTPException(status_code=400, detail="An active invitation already exists for this email")

    now = datetime.now(timezone.utc)
    invite_doc = {
        "id": str(uuid.uuid4()),
        "email": data.email,
        "name": data.name,
        "role": data.role,
        "token": str(uuid.uuid4()),
        "created_by": user["email"],
        "created_at": now.isoformat(),
        # Native datetime so the MongoDB TTL index prunes stale invitations.
        "expires_at": now + timedelta(days=INVITATION_EXPIRY_DAYS),
        "status": "pending",
    }
    await db.invitations.insert_one(invite_doc)
    logger.info(f"Invitation created for {data.email} by {user['email']}")

    try:
        from services.email import send_user_invite, resolve_app_url
        invite_url = f"{resolve_app_url()}/login?invite={invite_doc['token']}"
        await send_user_invite(
            to=data.email,
            name=data.name,
            role=data.role,
            invite_url=invite_url,
        )
        email_sent = True
    except Exception as e:
        logger.error(
            "Failed to send user invitation email to %s: %s", data.email, e,
        )
        email_sent = False

    # Return *metadata* only — never the token. If the email fails, an
    # admin can resend from the invitations list rather than copy-pasting
    # a token out of the API response body (which would otherwise land in
    # access logs and browser history).
    return {
        "id": invite_doc["id"],
        "email": invite_doc["email"],
        "name": invite_doc["name"],
        "role": invite_doc["role"],
        "created_by": invite_doc["created_by"],
        "created_at": invite_doc["created_at"],
        "expires_at": invite_doc["expires_at"].isoformat(),
        "status": invite_doc["status"],
        "email_sent": email_sent,
    }


@router.get("/invitations", summary="List all invitations")
async def list_invitations(user: AdminRequired):
    cursor = db.invitations.find({}, {"_id": 0}).sort("created_at", -1)
    invitations = await cursor.to_list(length=500)
    return {"invitations": invitations}


@router.delete(
    "/invitations/{invite_id}",
    summary="Revoke an invitation",
    responses={
        400: {"model": ErrorResponse, "description": "Only pending invitations can be revoked"},
        404: {"model": ErrorResponse, "description": "Invitation not found"},
    },
)
async def revoke_invitation(invite_id: str, user: AdminRequired):
    invite = await db.invitations.find_one({"id": invite_id}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invite["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending invitations can be revoked")
    await db.invitations.update_one(
        {"id": invite_id}, {"$set": {"status": "revoked"}}
    )
    logger.info(f"Invitation {invite_id} revoked by {user['email']}")
    return {"message": "Invitation revoked"}


# ── Admin: active refresh-token sessions ─────────────────────────────

@router.get(
    "/{user_id}/sessions",
    summary="List active refresh-token sessions for a user",
    responses={404: {"model": ErrorResponse, "description": USER_NOT_FOUND}},
)
async def list_user_sessions(user_id: str, user: AdminRequired):
    """Return every unrevoked refresh token for the target user.
    ``jti_prefix`` is for display; ``jti`` is included so admins can
    revoke individually if a targeted revocation API is added later."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    cursor = db.refresh_tokens.find(
        {"user_id": user_id, "used_at": None},
        {"_id": 0, "jti": 1, "issued_at": 1, "expires_at": 1},
    ).sort("issued_at", -1)
    rows = await cursor.to_list(length=100)
    sessions = []
    for row in rows:
        exp = row.get("expires_at")
        if hasattr(exp, "isoformat"):
            exp = exp.isoformat()
        sessions.append({
            "jti_prefix": row["jti"][:8],
            "jti": row["jti"],
            "issued_at": row.get("issued_at"),
            "expires_at": exp,
        })
    return {"sessions": sessions}


@router.post(
    "/{user_id}/sessions/revoke-all",
    summary="Revoke every active refresh token for a user",
    responses={404: {"model": ErrorResponse, "description": USER_NOT_FOUND}},
)
async def revoke_user_sessions(user_id: str, user: AdminRequired):
    """Force-sign-out the target user on every device. The user's
    current access token remains valid until it expires (typically 4h);
    revocation blocks any *renewal* via refresh."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    now = datetime.now(timezone.utc).isoformat()
    result = await db.refresh_tokens.update_many(
        {"user_id": user_id, "used_at": None},
        {"$set": {"used_at": now, "revoked_reason": "admin_revoked"}},
    )
    logger.warning(
        "Admin revoked all refresh tokens for user",
        extra={"entity": {
            "target_user_id": user_id,
            "admin": user.get("email"),
            "revoked_count": result.modified_count,
        }},
    )
    return {"revoked_count": result.modified_count}


# ── Admin: brute-force lockouts ──────────────────────────────────────

def _parse_lockout_expiry(expires_raw) -> datetime | None:
    """Normalize the stored expires_at to a UTC-aware datetime.

    Legacy rows may store it as a naive datetime, ISO string, or miss
    the field entirely — return None for anything we can't interpret
    so the caller can skip the row cleanly.
    """
    if hasattr(expires_raw, "tzinfo"):
        return (
            expires_raw
            if expires_raw.tzinfo
            else expires_raw.replace(tzinfo=timezone.utc)
        )
    if isinstance(expires_raw, str):
        try:
            parsed = datetime.fromisoformat(expires_raw)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _mask_lockout_email(email: str) -> str:
    if "@" not in email:
        return email
    return f"{email[:3]}\u2026@{email.split('@', 1)[-1]}"


@router.get(
    "/security/lockouts",
    summary="List emails currently locked out by brute-force tracking",
)
async def list_lockouts(user: AdminRequired):
    """Return login_failures rows past the threshold with an unexpired
    window. Useful to spot credential-stuffing patterns that slip
    under the per-IP SlowAPI limits."""
    from routers.auth import LOGIN_LOCKOUT_THRESHOLD

    rows = await db.login_failures.find(
        {"count": {"$gte": LOGIN_LOCKOUT_THRESHOLD}},
        {"_id": 0},
    ).to_list(500)
    now = datetime.now(timezone.utc)
    active = []
    for row in rows:
        expires = _parse_lockout_expiry(row.get("expires_at"))
        if expires is None or expires < now:
            continue
        email = row.get("email", "")
        active.append({
            "email_masked": _mask_lockout_email(email),
            "email": email,  # full value — admin-only response
            "count": row.get("count", 0),
            "expires_at": expires.isoformat(),
            "last_failure_at": row.get("last_failure_at"),
        })
    return {"lockouts": active, "count": len(active)}


@router.delete(
    "/security/lockouts/{email}",
    summary="Clear a specific brute-force lockout by email",
)
async def clear_lockout(email: str, user: AdminRequired):
    """Useful when a legitimate user trips the threshold by
    fat-fingering their password."""
    result = await db.login_failures.delete_many({"email": email.lower()})
    logger.info(
        "Admin cleared brute-force lockout",
        extra={"entity": {
            "email": email.lower(),
            "admin": user.get("email"),
            "cleared_count": result.deleted_count,
        }},
    )
    return {"cleared_count": result.deleted_count}
