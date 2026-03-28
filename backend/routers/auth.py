import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Response
from database import db
from models.schemas import UserRegister, UserLogin, ErrorResponse
from core.auth import hash_password, verify_password, create_token, CurrentUser
from core.constants import ROLE_VIEWER, ROLE_ADMIN, USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED
from fastapi import Request
from core.rate_limit import limiter
from core.logger import get_logger, user_var

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

ADMIN_EMAILS = ["russell.dale1@gmail.com"]

@router.get("/invite/{token}")
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


@router.post("/register", responses={400: {"model": ErrorResponse, "description": "Email already registered"}})
@limiter.limit("5/minute")
async def register(request: Request, data: UserRegister, response: Response):
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
    is_admin_email = data.email in ADMIN_EMAILS
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
    logger.info(f"User registered: {data.email}", extra={"entity": {"user_id": user_id}})

    if invitation:
        await db.invitations.update_one(
            {"id": invitation["id"]},
            {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc).isoformat()}}
        )

    if is_admin_email or invitation:
        token = create_token(user_id, data.email, data.name, role)
        response.set_cookie(key="auth_token", value=token, httponly=True, secure=True, samesite="lax", max_age=86400 * 7)
        return {"token": token, "user": {"id": user_id, "name": data.name, "email": data.email, "role": role}}
    else:
        return {"message": "Registration submitted. An admin must approve your account.", "pending": True}

@router.post("/login", responses={401: {"model": ErrorResponse, "description": "Invalid credentials"}, 403: {"model": ErrorResponse, "description": "Account pending approval or denied"}})
@limiter.limit("5/minute")
async def login(request: Request, data: UserLogin, response: Response):
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
    logger.info(f"User logged in: {user['email']}", extra={"entity": {"user_id": user['id']}})
    response.set_cookie(key="auth_token", value=token, httponly=True, secure=True, samesite="lax", max_age=86400 * 7)
    return {"token": token, "user": {"id": user['id'], "name": user['name'], "email": user['email'], "role": role}}

@router.post("/logout")
@limiter.limit("5/minute")
async def logout(request: Request, response: Response):
    response.delete_cookie(key="auth_token", httponly=True, samesite="lax", secure=True)
    return {"message": "Logged out successfully"}

@router.get("/me")
async def get_me(user: CurrentUser):
    user_var.set(user['email'])
    return {
        "user_id": user['user_id'],
        "email": user['email'],
        "name": user['name'],
        "role": user.get("role", ROLE_VIEWER)
    }
