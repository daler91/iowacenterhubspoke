from fastapi import APIRouter, HTTPException
from database import db
from core.auth import AdminRequired
from core.constants import (
    ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER,
    USER_STATUS_APPROVED, USER_STATUS_REJECTED,
)
from models.schemas import UserRoleUpdate
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {ROLE_ADMIN, ROLE_EDITOR, ROLE_SCHEDULER, ROLE_VIEWER}


@router.get("/")
async def list_users(user: AdminRequired):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0})
    users = await cursor.to_list(length=1000)
    return {"users": users}


@router.put("/{user_id}/approve")
async def approve_user(user_id: str, user: AdminRequired):
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_APPROVED}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    logger.info(f"User {user_id} approved by {user['email']}")
    return {"message": "User approved"}


@router.put("/{user_id}/reject")
async def reject_user(user_id: str, user: AdminRequired):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == ROLE_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot reject an admin user")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": USER_STATUS_REJECTED}}
    )
    logger.info(f"User {user_id} rejected by {user['email']}")
    return {"message": "User rejected"}


@router.put("/{user_id}/role")
async def update_user_role(user_id: str, data: UserRoleUpdate, user: AdminRequired):
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent removing the last admin
    if target.get("role") == ROLE_ADMIN and data.role != ROLE_ADMIN:
        admin_count = await db.users.count_documents({"role": ROLE_ADMIN})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    logger.info(f"User {user_id} role changed to {data.role} by {user['email']}")
    return {"message": f"Role updated to {data.role}"}


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: AdminRequired):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.delete_one({"id": user_id})
    logger.info(f"User {user_id} deleted by {user['email']}")
    return {"message": "User deleted"}
