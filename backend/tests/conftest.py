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
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
# Force ENVIRONMENT to dev even if a local ``.env`` sets it to production —
# token_vault's prod-requires-key check would otherwise trip.
os.environ["ENVIRONMENT"] = "development"
os.environ.pop("RAILWAY_ENVIRONMENT", None)

# Import the real drivers here, before pytest imports any test module.
#
# A dozen unit-test modules install MagicMock stand-ins via
# ``sys.modules.setdefault("motor.motor_asyncio", MagicMock())`` so they can
# import application code without a database. ``setdefault`` is a no-op once
# the genuine module is present — so importing it here means those stubs
# never take effect, while modules that only ever touch the mock are
# unaffected.
#
# Without this, the stub leaks into anything needing the real driver:
# ``AsyncIOMotorClient`` resolved to a MagicMock and the integration suite
# died on ``TypeError: object MagicMock can't be used in 'await' expression``.
# ``test_pagination.py`` already carried a local workaround for the same
# hazard with ``httpx``; this fixes the class of problem in one place.
import httpx  # noqa: E402,F401
import motor.motor_asyncio  # noqa: E402,F401

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from unittest.mock import AsyncMock, MagicMock  # noqa: E402


@pytest.fixture(autouse=True)
def _patch_pwd_cache_lookup(monkeypatch):
    """Stop auth invalidation lookups from needing a real MongoDB.

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
    monkeypatch.setattr(
        _auth, "_load_pwd_invalidation_state", AsyncMock(return_value=(0, False, None)),
    )
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


# ── Fake-db injection for migrated routers ───────────────────────────

class _ItemAccessAdapter:
    """Makes ``fake["schedules"]`` resolve to ``fake.schedules``.

    Router fakes in this suite are MagicMocks or SimpleNamespaces exposing
    collections as *attributes*, but ``SoftDeleteRepository`` looks them up
    as *items*. Without this, a MagicMock would happily hand back a fresh
    child mock for ``db["schedules"]`` — a different object from the
    ``db.schedules`` the test asserts against, so the test would watch a
    mock nothing ever called.
    """

    def __init__(self, inner):
        self._inner = inner

    def __getitem__(self, name):
        return getattr(self._inner, name)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def use_fake_db(monkeypatch, module, fake_db):
    """Point a router's ``db`` *and* its repositories at ``fake_db``.

    Patching ``module.db`` alone stops working the moment a router migrates
    onto ``SoftDeleteRepository``: the repository resolves
    ``db["<collection>"]`` and captures the handle when it is constructed at
    import time, so it keeps talking to whatever ``db`` was then — in a unit
    test, the real one, which surfaces as a ServerSelectionTimeout or a
    cross-event-loop RuntimeError rather than an obvious wiring error.

    Rebuilding every repository the module holds keeps that failure from
    being rediscovered once per migration.
    """
    from core.repository import SoftDeleteRepository

    adapter = _ItemAccessAdapter(fake_db)
    monkeypatch.setattr(module, "db", fake_db)
    for attr, value in list(vars(module).items()):
        if isinstance(value, SoftDeleteRepository):
            monkeypatch.setattr(
                module, attr, SoftDeleteRepository(adapter, value.collection_name),
            )


# ── Integration-test support ─────────────────────────────────────────
# Everything above this line runs against monkeypatched module globals.
# The fixtures below give tests a *real* MongoDB, which is the only way to
# exercise the seams where the app's units meet — routing, dependency
# resolution, index constraints, and the actual query filters. Three of the
# four bugs found in the codebase review lived in exactly those seams and
# were invisible to unit tests against fakes.
#
# DB_NAME is seeded to "test_db" above, so ``database.db`` — the handle every
# module binds at import time — already points at a throwaway database.
#
# Loop scoping matters here. A Motor client binds to the running event loop
# on first use, and pytest-asyncio gives each test its own loop by default —
# so the shared ``database.db`` client would bind to the first integration
# test's loop and then fail in every later one. Integration tests therefore
# run on a session-scoped loop (``asyncio_default_test_loop_scope`` in
# pytest.ini), and these fixtures must be async so they share it rather than
# spinning up their own via ``asyncio.run``.

_MONGO_PING_TIMEOUT_MS = 1500

_INTEGRATION_COLLECTIONS = (
    "users", "invitations", "refresh_tokens", "password_resets",
    "login_failures", "portal_tokens", "partner_contacts", "partner_orgs",
    "projects", "tasks", "locations", "employees", "classes", "schedules",
    "activity_logs",
    # Deleting a project cascades a soft-delete into these.
    "documents", "messages", "event_outcomes",
)


@pytest.fixture(scope="session")
def mongo_url():
    return os.environ["MONGO_URL"]


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def mongo_db(mongo_url):
    """Real MongoDB handle, or skip the test if none is reachable.

    Skips rather than fails so a developer without Mongo running still gets a
    green unit-test run; CI provides a service container, so these do not
    silently vanish where it matters.
    """
    from motor.motor_asyncio import AsyncIOMotorClient

    if isinstance(AsyncIOMotorClient, MagicMock):
        # Belt-and-braces: a test module stubbed motor despite the real import
        # at the top of this file. Say so plainly rather than reporting it as
        # an unreachable database.
        pytest.fail(
            "motor.motor_asyncio is a MagicMock — a test module stubbed it via "
            "sys.modules before the integration fixtures ran."
        )

    probe = AsyncIOMotorClient(
        mongo_url, serverSelectionTimeoutMS=_MONGO_PING_TIMEOUT_MS,
    )
    try:
        await probe.admin.command("ping")
    except Exception as exc:  # pragma: no cover - environment dependent
        # Skipping is right on a laptop with no Mongo running, and useless in
        # CI — a suite that silently skips is indistinguishable from one that
        # passes. REQUIRE_MONGO turns the skip into a hard failure so the
        # workflow cannot quietly stop exercising these.
        if os.getenv("REQUIRE_MONGO") == "1":
            pytest.fail(
                f"REQUIRE_MONGO=1 but no MongoDB at {mongo_url}: {exc}. "
                "The CI service container is not reachable."
            )
        pytest.skip(f"No MongoDB at {mongo_url}: {exc}")
    finally:
        probe.close()

    from database import db as _db
    return _db


@pytest_asyncio.fixture(loop_scope="session")
async def clean_collections(mongo_db):
    """Empty the collections a test touches, before and after it runs."""
    for name in _INTEGRATION_COLLECTIONS:
        await mongo_db[name].delete_many({})
    yield mongo_db
    for name in _INTEGRATION_COLLECTIONS:
        await mongo_db[name].delete_many({})
