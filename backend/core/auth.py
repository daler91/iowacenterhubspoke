import os
import secrets
import logging
import hashlib
import hmac
import time as _time
import bcrypt
import jwt
from datetime import datetime, timezone
from fastapi import HTTPException, Depends, Header, Request
from typing import Annotated, Optional, List
from core.constants import ROLE_ADMIN, ROLE_SCHEDULER

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    if os.environ.get('ENVIRONMENT') == 'production' or os.environ.get('RAILWAY_ENVIRONMENT'):
        raise ValueError(
            "CRITICAL: JWT_SECRET environment variable is missing."
            " It must be explicitly set in production environments."
        )
    JWT_SECRET = secrets.token_urlsafe(32)
    logging.warning(
        "JWT_SECRET environment variable is missing. Using a randomly generated secret."
        " All user sessions will be invalidated when the server restarts."
        " Do not use this configuration in production."
    )
JWT_ALGORITHM = 'HS256'

# CSRF protection - double-submit cookie pattern
CSRF_SECRET = os.environ.get('CSRF_SECRET', JWT_SECRET)


def generate_csrf_token() -> str:
    """Generate a CSRF token derived from a random nonce + HMAC signature."""
    nonce = secrets.token_hex(16)
    sig = hmac.new(CSRF_SECRET.encode(), nonce.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{nonce}.{sig}"


def validate_csrf_token(token: str) -> bool:
    """Validate a CSRF token's HMAC signature."""
    if not token or "." not in token:
        return False
    nonce, sig = token.rsplit(".", 1)
    expected = hmac.new(CSRF_SECRET.encode(), nonce.encode(), hashlib.sha256).hexdigest()[:16]
    return hmac.compare_digest(sig, expected)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def create_token(user_id: str, email: str, name: str, role: str = '', iat: float = None) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'name': name,
        'role': role,
        'iat': int(iat or datetime.now(timezone.utc).timestamp()),
        'exp': int(datetime.now(timezone.utc).timestamp()) + 86400 * 7
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request, authorization: Annotated[Optional[str], Header()] = None):
    token = request.cookies.get('auth_token')
    if not token and authorization and authorization.startswith('Bearer '):
        token = authorization.split(' ')[1]

    if not token:
        raise HTTPException(status_code=401, detail='Not authenticated')

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')

    # Session invalidation: reject tokens issued before a password change
    token_iat = payload.get('iat', 0)
    if token_iat:
        changed_ts = await _get_pwd_changed_ts(payload['user_id'])
        if changed_ts and token_iat < changed_ts:
            raise HTTPException(
                status_code=401,
                detail='Session invalidated by password change. Please log in again.'
            )

    return payload


# ── Password-change timestamp cache ──────────────────────────────────
_pwd_change_cache: dict[str, tuple[float, float | None]] = {}  # user_id -> (cached_at, changed_ts)
_PWD_CACHE_TTL = 300  # 5 minutes


async def _get_pwd_changed_ts(user_id: str) -> float | None:
    """Get cached password_changed_at timestamp, refreshing from DB if stale."""
    now = _time.monotonic()
    cached = _pwd_change_cache.get(user_id)
    if cached and (now - cached[0]) < _PWD_CACHE_TTL:
        return cached[1]
    from database import db
    user_doc = await db.users.find_one({"id": user_id}, {"password_changed_at": 1})
    changed_ts = None
    if user_doc and user_doc.get('password_changed_at'):
        changed_ts = datetime.fromisoformat(user_doc['password_changed_at']).timestamp()
    _pwd_change_cache[user_id] = (now, changed_ts)
    return changed_ts


CurrentUser = Annotated[dict, Depends(get_current_user)]


class RoleRequired:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, user: CurrentUser):
        if user.get("role") not in self.allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Operation not permitted. Required roles: {', '.join(self.allowed_roles)}"
            )
        return user


AdminRequired = Annotated[dict, Depends(RoleRequired([ROLE_ADMIN]))]
SchedulerRequired = Annotated[dict, Depends(RoleRequired([ROLE_ADMIN, ROLE_SCHEDULER]))]
