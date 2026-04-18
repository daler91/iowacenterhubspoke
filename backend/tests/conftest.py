"""Shared pytest fixtures for the backend test suite.

Three concerns this file handles:

1. **Environment isolation.** A handful of modules read config at
   import time (JWT_SECRET, MONGO_URL, ENVIRONMENT). We seed safe
   defaults *before* pytest begins collecting test modules so the
   production guards in ``database.py`` / ``core/token_vault.py``
   don't fire during collection.

2. **Database isolation.** Tests that mount the real FastAPI app via
   httpx hit ``get_current_user`` → ``_get_pwd_changed_ts`` →
   ``db.users.find_one``. Without a real MongoDB (or a mock), that
   call either hangs on ServerSelectionTimeout or returns a MagicMock
   that isn't awaitable. An autouse fixture patches the one hot
   lookup so the RBAC pipeline executes cleanly.

3. **CSRF headers.** The double-submit CSRF middleware rejects any
   mutating request that lacks matching ``csrf_token`` cookie and
   ``X-CSRF-Token`` header. ``csrf_headers`` produces a valid pair
   that tests can splat into httpx calls.
"""

import os

# Must run before any ``from server import app`` or motor import so the
# token-vault / database production guards see a dev-mode environment.
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-chars-long!!")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
# Force ENVIRONMENT to dev even if a local ``.env`` sets it to production —
# token_vault's prod-requires-key check would otherwise trip.
os.environ["ENVIRONMENT"] = "development"
os.environ.pop("RAILWAY_ENVIRONMENT", None)

import pytest  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402


@pytest.fixture(autouse=True)
def _patch_pwd_cache_lookup(monkeypatch):
    """Stop ``_get_pwd_changed_ts`` from needing a real MongoDB.

    The password-change cache is a production defence (invalidate old
    JWTs after a password change). Under pytest there's no real DB, so
    the lookup would either time out (real motor) or blow up on a
    MagicMock stand-in. Returning ``None`` here is semantically
    identical to "no password change has ever occurred," which is the
    correct state for synthetic test tokens.
    """
    try:
        from core import auth as _auth
    except ImportError:
        return
    # Returns ``(changed_ts, is_deleted)``; ``(None, False)`` means
    # "no password change, user is live" — the correct no-op state for
    # synthetic test tokens.
    monkeypatch.setattr(
        _auth, "_get_pwd_changed_ts", AsyncMock(return_value=(None, False)),
    )


@pytest.fixture
def csrf_headers():
    """Return headers + cookie that satisfy the double-submit CSRF check.

    Use with httpx's AsyncClient like::

        async with AsyncClient(..., cookies=csrf_headers["cookies"]) as ac:
            await ac.post("/api/v1/thing", json={...}, headers=csrf_headers["headers"])
    """
    from core.auth import generate_csrf_token
    token = generate_csrf_token()
    return {
        "headers": {"X-CSRF-Token": token},
        "cookies": {"csrf_token": token},
    }
