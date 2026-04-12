import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from database import db
from core.auth import AdminRequired
from core.rate_limit import limiter
from core.constants import (
    ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER,
    USER_STATUS_APPROVED, USER_STATUS_REJECTED,
)
from models.schemas import UserRoleUpdate, InviteCreate, ErrorResponse
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER}
USER_NOT_FOUND = "User not found"


@router.get("/")
async def list_users(user: AdminRequired):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0})
    users = await cursor.to_list(length=1000)
    return {"users": users}


@router.put(
    "/{user_id}/approve",
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def approve_user(user_id: str, user: AdminRequired):
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_APPROVED}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    logger.info(f"User {user_id} approved by {user['email']}")
    return {"message": "User approved"}


@router.put(
    "/{user_id}/reject",
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
    responses={
        400: {"model": ErrorResponse, "description": "Invalid role or cannot remove last admin"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def update_user_role(user_id: str, data: UserRoleUpdate, user: AdminRequired):
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
    responses={
        400: {"model": ErrorResponse, "description": "Cannot delete your own account"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
)
async def delete_user(user_id: str, user: AdminRequired):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
    await db.users.delete_one({"id": user_id})
    logger.info(f"User {user_id} deleted by {user['email']}")
    return {"message": "User deleted"}


@router.post("/invite")
@limiter.limit("10/minute")
async def create_invitation(request: Request, data: InviteCreate, user: AdminRequired):
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


@router.get("/invitations")
async def list_invitations(user: AdminRequired):
    cursor = db.invitations.find({}, {"_id": 0}).sort("created_at", -1)
    invitations = await cursor.to_list(length=500)
    return {"invitations": invitations}


@router.delete("/invitations/{invite_id}")
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
