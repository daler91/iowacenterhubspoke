import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from core.auth import AdminRequired, invalidate_pwd_cache
from core.constants import (
    ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER,
    USER_STATUS_APPROVED, USER_STATUS_REJECTED,
)
from models.schemas import UserRoleUpdate, InviteCreate, ErrorResponse
from services.notification_events import notify_role_changed
from services.activity import log_activity, redact_user_from_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER}
USER_NOT_FOUND = "User not found"


@router.get("/", summary="List all users")
async def list_users(user: AdminRequired, include_deleted: bool = False):
    """Return all users (excluding password hashes). Admin only."""
    query: dict = {} if include_deleted else {"deleted_at": None}
    cursor = db.users.find(query, {"_id": 0, "password_hash": 0})
    users = await cursor.to_list(length=1000)
    return {"users": users}


@router.put(
    "/{user_id}/approve",
    summary="Approve a pending user",
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def approve_user(user_id: str, user: AdminRequired):
    target = await db.users.find_one({"id": user_id, "deleted_at": None}, {"_id": 0})
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
    target = await db.users.find_one({"id": user_id, "deleted_at": None}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    if target.get("role") == ROLE_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot reject an admin user")
    was_pending = target.get("status") != USER_STATUS_REJECTED
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_REJECTED}}
    )
    logger.info(f"User {user_id} rejected by {user['email']}")
    # Transactional courtesy email — non-fatal on failure. Only send on
    # the meaningful transition, not idempotent re-rejections.
    if was_pending:
        try:
            from services.email import send_account_rejected
            await send_account_rejected(
                to=target["email"],
                name=target.get("name", ""),
            )
        except Exception as e:
            logger.warning(
                "Failed to send rejection email to %s: %s",
                target["email"], e,
            )
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
    target = await db.users.find_one({"id": user_id, "deleted_at": None}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    # Prevent removing the last admin
    if target.get("role") == ROLE_ADMIN and data.role != ROLE_ADMIN:
        admin_count = await db.users.count_documents({"role": ROLE_ADMIN, "deleted_at": None})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    old_role = target.get("role", "")
    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    logger.info(f"User {user_id} role changed to {data.role} by {user['email']}")
    await notify_role_changed(user_id, old_role, data.role, user)
    return {"message": f"Role updated to {data.role}"}


@router.delete(
    "/{user_id}",
    summary="Soft-delete a user account",
    responses={
        400: {"model": ErrorResponse, "description": "Cannot delete your own account or the last admin"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def delete_user(user_id: str, user: AdminRequired):
    """Soft-delete a user and redact their PII from historical activity logs.

    Sets ``deleted_at`` instead of removing the document so audit trails remain
    joinable. The user's name in ``activity_logs`` is replaced with
    ``"Deleted user"`` so PII is not reconstructable.
    """
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": user_id, "deleted_at": None}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    if target.get("role") == ROLE_ADMIN:
        admin_count = await db.users.count_documents({"role": ROLE_ADMIN, "deleted_at": None})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"deleted_at": now, "deleted_by": user["email"]}},
    )
    # Drop the L1 cache entry and broadcast deletion to sibling workers so
    # no JWT for this user survives past the 30-second L1 window.
    await invalidate_pwd_cache(user_id, is_deleted=True)
    redacted = await redact_user_from_activity(user_id, target.get("name", ""))
    await log_activity(
        action="user.delete",
        description=f"User {target.get('email', user_id)} soft-deleted; {redacted} activity rows redacted",
        entity_type="user",
        entity_id=user_id,
        user_name=user.get("name", user.get("email", "admin")),
        user_id=user.get("user_id"),
    )
    logger.info(f"User {user_id} soft-deleted by {user['email']} (redacted {redacted} activity rows)")
    return {"message": "User deleted", "redacted_activity_rows": redacted}


@router.post(
    "/{user_id}/restore",
    summary="Restore a soft-deleted user",
    responses={
        404: {"model": ErrorResponse, "description": "User not found or not deleted"},
    },
)
async def restore_user(user_id: str, user: AdminRequired):
    """Clear ``deleted_at`` on a previously soft-deleted user.

    PII redacted from activity logs is NOT un-redacted (that data is lost
    on purpose — restoration only reactivates the account).
    """
    result = await db.users.update_one(
        {"id": user_id, "deleted_at": {"$ne": None}},
        {"$set": {"deleted_at": None, "deleted_by": None}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    # Clear the is_deleted marker everywhere so workers don't keep
    # rejecting the restored user's session.
    await invalidate_pwd_cache(user_id, is_deleted=False)
    await log_activity(
        action="user.restore",
        description=f"User {user_id} restored",
        entity_type="user",
        entity_id=user_id,
        user_name=user.get("name", user.get("email", "admin")),
        user_id=user.get("user_id"),
    )
    logger.info(f"User {user_id} restored by {user['email']}")
    return {"message": "User restored"}


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

    invite_doc = {
        "id": str(uuid.uuid4()),
        "email": data.email,
        "name": data.name,
        "role": data.role,
        "token": str(uuid.uuid4()),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    }
    await db.invitations.insert_one(invite_doc)
    logger.info(f"Invitation created for {data.email} by {user['email']}")

    # Auto-email the invitee; failure is non-fatal so the admin can still
    # copy the link from the response.
    try:
        from services.email import send_user_invite, resolve_app_url
        invite_url = f"{resolve_app_url()}/login?invite={invite_doc['token']}"
        await send_user_invite(
            to=data.email,
            name=data.name,
            role=data.role,
            invite_url=invite_url,
        )
    except Exception as e:
        logger.warning(
            "Failed to send user invitation email to %s: %s", data.email, e,
        )

    return {
        "id": invite_doc["id"],
        "email": invite_doc["email"],
        "name": invite_doc["name"],
        "role": invite_doc["role"],
        "token": invite_doc["token"],
        "created_by": invite_doc["created_by"],
        "created_at": invite_doc["created_at"],
        "status": invite_doc["status"],
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
