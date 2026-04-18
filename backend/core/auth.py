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
from core.constants import ROLE_ADMIN, ROLE_SCHEDULER, ROLE_EDITOR


def _looks_multi_worker() -> bool:
    """Best-effort detection of a multi-process deployment.

    A per-process random fallback secret is only safe when exactly one
    worker is serving requests — otherwise a JWT signed by worker A will
    fail verification on worker B. We refuse the fallback when Railway is
    detected or when UVICORN_WORKERS/WEB_CONCURRENCY is >1, in addition to
    the explicit ``ENVIRONMENT=production`` flag.
    """
    if os.environ.get('ENVIRONMENT') == 'production':
        return True
    if os.environ.get('RAILWAY_ENVIRONMENT') or os.environ.get('RAILWAY_DEPLOYMENT_ID'):
        return True
    for key in ('UVICORN_WORKERS', 'WEB_CONCURRENCY', 'GUNICORN_WORKERS'):
        raw = os.environ.get(key)
        if raw and raw.isdigit() and int(raw) > 1:
            return True
    return False


JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    if _looks_multi_worker():
        raise ValueError(
            "CRITICAL: JWT_SECRET environment variable is missing."
            " It must be explicitly set in production or any multi-worker deployment"
            " (Railway, UVICORN_WORKERS>1, WEB_CONCURRENCY>1)."
        )
    JWT_SECRET = secrets.token_urlsafe(32)
    logging.warning(
        "JWT_SECRET is missing — using a per-process random secret."
        " This is single-process dev only: tokens will not survive a restart"
        " and requests balanced to sibling workers will 401."
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


_BCRYPT_ROUNDS = int(os.environ.get('BCRYPT_ROUNDS', '14'))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


TOKEN_LIFETIME_SECONDS = int(os.environ.get('JWT_LIFETIME_SECONDS', '14400'))  # 4 hours default
# Refresh token lives much longer so users don't get logged out every 4h.
# It is stored separately in an HttpOnly cookie and carries a ``typ: refresh``
# claim so the /auth/refresh handler can distinguish it from access tokens.
REFRESH_TOKEN_LIFETIME_SECONDS = int(
    os.environ.get('JWT_REFRESH_LIFETIME_SECONDS', str(60 * 60 * 24 * 30))  # 30 days
)


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
        'typ': 'access',
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, iat: float = None) -> tuple[str, str]:
    """Issue a refresh token. Returns (jwt_string, jti).

    The jti is returned so the handler can record it in MongoDB — refresh
    tokens are one-time-use; rotating the token on each refresh gives us
    token theft detection (if the old jti is presented after rotation, we
    know a stolen token was used).
    """
    import uuid as _uuid
    now_ts = int(datetime.now(timezone.utc).timestamp())
    jti = str(_uuid.uuid4())
    payload = {
        'user_id': user_id,
        'jti': jti,
        'iat': int(iat or now_ts),
        'exp': now_ts + REFRESH_TOKEN_LIFETIME_SECONDS,
        'typ': 'refresh',
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM), jti


def decode_refresh_token(token: str) -> dict:
    """Decode and validate a refresh token's signature/expiry.

    Raises HTTPException(401) on anything but a well-formed, unexpired
    refresh token. Revocation (``used_at`` or rotated jti) is checked
    separately by the handler.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail='Refresh token expired') from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail='Invalid refresh token') from e
    if payload.get('typ') != 'refresh':
        raise HTTPException(status_code=401, detail='Not a refresh token')
    return payload


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

    # Enforce access/refresh separation. A refresh JWT is signed with
    # the same JWT_SECRET but carries ``typ: refresh`` and is meant to
    # be exchanged at /auth/refresh only — it must not grant access to
    # authenticated endpoints. Without this check a stolen/logged
    # refresh cookie could impersonate the user for the refresh
    # token's full lifetime, and some handlers would crash on missing
    # access-only claims (email/name).
    if payload.get('typ') != 'access':
        raise HTTPException(status_code=401, detail='Invalid token type')

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
# Two-layer: L1 is per-process (30s TTL) and L2 is Redis (15-min TTL). On
# a password change / user-delete / user-restore, ``invalidate_pwd_cache``
# drops the L1 entry on the issuing worker AND writes a Redis marker that
# sibling workers read on their next L1 miss, so cross-worker staleness
# is capped at ``_PWD_CACHE_TTL`` seconds. Redis is best-effort: if the
# cluster is down we still serve from Mongo and degrade to the L1-only
# behavior.
_pwd_change_cache: dict[str, tuple[float, float | None, bool]] = {}  # user_id -> (cached_at, changed_ts, is_deleted)
_PWD_CACHE_TTL = 30  # seconds; short enough that cross-worker staleness is bounded
_REDIS_MARKER_TTL = 900  # seconds; long enough to outlive the longest expected L1 gap
_REDIS_CHANGED_PREFIX = "auth:pwd_changed:"
_REDIS_DELETED_PREFIX = "auth:user_deleted:"


async def _read_redis_markers(user_id: str) -> tuple[float | None, bool | None]:
    """Return (changed_ts, is_deleted) from Redis, or (None, None) on miss.

    ``is_deleted=None`` distinguishes "no marker present" from
    "marker says not deleted" so the caller can still fall through to
    Mongo for authoritative deleted-state when Redis has no info.
    """
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is None:
            return None, None
        changed_raw = await pool.get(f"{_REDIS_CHANGED_PREFIX}{user_id}")
        deleted_raw = await pool.get(f"{_REDIS_DELETED_PREFIX}{user_id}")
        changed_ts: float | None = None
        if changed_raw is not None:
            if isinstance(changed_raw, bytes):
                changed_raw = changed_raw.decode()
            try:
                changed_ts = datetime.fromisoformat(changed_raw).timestamp()
            except ValueError:
                changed_ts = None
        is_deleted: bool | None = None
        if deleted_raw is not None:
            if isinstance(deleted_raw, bytes):
                deleted_raw = deleted_raw.decode()
            is_deleted = deleted_raw == "1"
        return changed_ts, is_deleted
    except Exception as exc:
        logging.debug("auth redis read failed for %s: %s", user_id, exc)
        return None, None


async def _get_pwd_changed_ts(user_id: str) -> tuple[float | None, bool]:
    """Get (password_changed_at timestamp, is_deleted) for a user.

    L1 (in-process) → L2 (Redis) → L3 (Mongo). A Redis hit refreshes L1;
    a Mongo read also warms Redis so sibling workers benefit on the next
    miss.
    """
    now = _time.monotonic()
    cached = _pwd_change_cache.get(user_id)
    if cached and (now - cached[0]) < _PWD_CACHE_TTL:
        return cached[1], cached[2]

    redis_changed, redis_deleted = await _read_redis_markers(user_id)

    # Always confirm deletion against Mongo — Redis is a hint, not the source
    # of truth. If restore_user raced a Redis write that silently failed, a
    # stale ``auth:user_deleted`` marker would otherwise keep the restored
    # user blocked with 401 until the marker TTL expired.
    from database import db
    user_doc = await db.users.find_one(
        {"id": user_id}, {"password_changed_at": 1, "deleted_at": 1}
    )
    is_deleted = bool(user_doc and user_doc.get('deleted_at'))
    changed_ts: float | None = redis_changed
    if user_doc and user_doc.get('password_changed_at'):
        mongo_ts = datetime.fromisoformat(user_doc['password_changed_at']).timestamp()
        # Prefer the later of the two — Redis marker may pre-date Mongo on
        # a race where the write landed but hasn't propagated yet.
        changed_ts = max(changed_ts or 0.0, mongo_ts) or None

    # If Redis said "deleted" but Mongo says otherwise, clear the stale
    # marker so sibling workers don't keep consulting it.
    if redis_deleted is True and not is_deleted:
        try:
            from core.queue import get_redis_pool
            pool = await get_redis_pool()
            if pool is not None:
                await pool.delete(f"{_REDIS_DELETED_PREFIX}{user_id}")
        except Exception as exc:
            logging.debug("auth redis stale-marker cleanup failed for %s: %s", user_id, exc)

    _pwd_change_cache[user_id] = (now, changed_ts, is_deleted)
    return changed_ts, is_deleted


async def invalidate_pwd_cache(user_id: str, *, is_deleted: Optional[bool] = None) -> None:
    """Drop the L1 auth cache and broadcast the change via Redis.

    Called after every ``password_changed_at`` write and after soft-delete
    / restore of a user account. ``is_deleted`` controls the deletion
    marker in Redis:

    * ``None`` (default): only refresh the pwd_changed timestamp.
    * ``True``: also set the deleted marker (soft-delete).
    * ``False``: also clear the deleted marker (restore).

    Redis failures are logged at DEBUG and swallowed — L1 invalidation on
    the issuing worker still succeeds, so the local behavior is correct
    even when Redis is unreachable.
    """
    _pwd_change_cache.pop(user_id, None)
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is None:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        await pool.set(
            f"{_REDIS_CHANGED_PREFIX}{user_id}", now_iso, ex=_REDIS_MARKER_TTL,
        )
        if is_deleted is True:
            await pool.set(
                f"{_REDIS_DELETED_PREFIX}{user_id}", "1", ex=_REDIS_MARKER_TTL,
            )
        elif is_deleted is False:
            await pool.delete(f"{_REDIS_DELETED_PREFIX}{user_id}")
    except Exception as exc:
        logging.debug("auth redis broadcast failed for %s: %s", user_id, exc)


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
# Editor+ — can update task state and coordination content; cannot destroy
# shared records, manage users, or create/delete projects/partners.
EditorRequired = Annotated[dict, Depends(RoleRequired([ROLE_ADMIN, ROLE_SCHEDULER, ROLE_EDITOR]))]
