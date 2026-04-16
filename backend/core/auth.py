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


TOKEN_LIFETIME_SECONDS = 86400  # 1 day


def create_token(user_id: str, email: str, name: str, role: str = '', iat: float = None) -> str:
    import uuid as _uuid
    now_ts = int(datetime.now(timezone.utc).timestamp())
    payload = {
        'user_id': user_id,
        'email': email,
        'name': name,
        'role': role,
        'jti': str(_uuid.uuid4()),
        'iat': int(iat or now_ts),
        'exp': now_ts + TOKEN_LIFETIME_SECONDS,
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
    # or belonging to a soft-deleted user account.
    token_iat = payload.get('iat', 0)
    changed_ts, is_deleted = await _get_pwd_changed_ts(payload['user_id'])
    if is_deleted:
        raise HTTPException(status_code=401, detail='Account deactivated')
    if token_iat and changed_ts and token_iat < changed_ts:
        raise HTTPException(
            status_code=401,
            detail='Session invalidated by password change. Please log in again.'
        )

    return payload


# ── Password-change timestamp cache ──────────────────────────────────
# In-process only. Multi-worker deployments will see stale reads for up to
# ``_PWD_CACHE_TTL`` seconds per worker after a password change. Password
# change/reset handlers call ``invalidate_pwd_cache(user_id)`` to clear the
# local entry immediately so the issuing worker cannot revalidate an old JWT.
_pwd_change_cache: dict[str, tuple[float, float | None, bool]] = {}  # user_id -> (cached_at, changed_ts, is_deleted)
_PWD_CACHE_TTL = 300  # 5 minutes


async def _get_pwd_changed_ts(user_id: str) -> tuple[float | None, bool]:
    """Get cached (password_changed_at timestamp, is_deleted) for a user."""
    now = _time.monotonic()
    cached = _pwd_change_cache.get(user_id)
    if cached and (now - cached[0]) < _PWD_CACHE_TTL:
        return cached[1], cached[2]
    from database import db
    user_doc = await db.users.find_one(
        {"id": user_id}, {"password_changed_at": 1, "deleted_at": 1}
    )
    changed_ts = None
    is_deleted = bool(user_doc and user_doc.get('deleted_at'))
    if user_doc and user_doc.get('password_changed_at'):
        changed_ts = datetime.fromisoformat(user_doc['password_changed_at']).timestamp()
    _pwd_change_cache[user_id] = (now, changed_ts, is_deleted)
    return changed_ts, is_deleted


def invalidate_pwd_cache(user_id: str) -> None:
    """Drop the cached password-change timestamp for ``user_id``.

    Called from the auth router immediately after a ``password_changed_at``
    write so subsequent requests in the same process do not serve a stale
    cache entry and let the old JWT ride another ``_PWD_CACHE_TTL`` seconds.
    """
    _pwd_change_cache.pop(user_id, None)


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
