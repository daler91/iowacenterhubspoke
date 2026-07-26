"""End-to-end endpoint tests against a real MongoDB.

Why these exist: every other backend test drives a function directly with
monkeypatched module globals. That catches logic errors inside a unit but is
structurally blind to errors *between* units — routing, dependency resolution,
the actual query filters, index constraints. Three of the four bugs found in
the codebase review lived precisely there:

  * register stored a raw email while login matched exactly, so a mixed-case
    signup could never log in — every unit involved was individually correct;
  * the GDPR export read a collection that does not exist;
  * webhook delivery enqueued a job name the worker never registered.

``test_rbac.py`` acknowledged the gap in its own docstring — "End-to-end GET
tests need a real MongoDB ... so they live elsewhere" — and *elsewhere* did
not exist. This is elsewhere.

Skipped automatically when no MongoDB is reachable; CI provides one.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from core.auth import create_token
from core.constants import ROLE_ADMIN, ROLE_VIEWER
from server import app

pytestmark = pytest.mark.integration

_PASSWORD = f"Aa1-{uuid.uuid4().hex}"


def _client(csrf_headers=None):
    kwargs = {
        "transport": ASGITransport(app=app),
        "base_url": "http://test",
        "follow_redirects": True,
    }
    if csrf_headers:
        kwargs["cookies"] = csrf_headers["cookies"]
    return AsyncClient(**kwargs)


def _auth_headers(token, csrf_headers):
    return {"Authorization": f"Bearer {token}", **csrf_headers["headers"]}


# ── the email-casing trap, end to end ─────────────────────────────────

@pytest.mark.asyncio
async def test_register_then_login_with_different_casing(clean_collections, csrf_headers):
    """The exact sequence that used to lock a user out permanently.

    Register as Mixed@Case, then log in as lower@case. Before normalisation
    this returned 401 and counted toward the brute-force lockout, while
    re-registering reported "already registered" and password reset silently
    no-op'd — three dead ends, all individually "working as written".
    """
    email = f"Mixed.Case.{uuid.uuid4().hex[:8]}@Example.COM"

    async with _client(csrf_headers) as ac:
        res = await ac.post(
            "/api/v1/auth/register",
            json={
                "name": "Casing Test",
                "email": email,
                "password": _PASSWORD,
                "privacy_policy_accepted": True,
            },
            headers=csrf_headers["headers"],
        )
        assert res.status_code == 200, res.text

        stored = await clean_collections.users.find_one({"email": email.strip().lower()})
        assert stored is not None, "registration must store the normalised address"

        # Approve so login isn't blocked on pending status.
        await clean_collections.users.update_one(
            {"id": stored["id"]}, {"$set": {"status": "approved"}},
        )

        res = await ac.post(
            "/api/v1/auth/login",
            json={"email": email.lower(), "password": _PASSWORD},
            headers=csrf_headers["headers"],
        )
        assert res.status_code == 200, f"lower-case login rejected: {res.text}"
        assert res.json()["user"]["email"] == email.strip().lower()

        # And the original casing still works.
        res = await ac.post(
            "/api/v1/auth/login",
            json={"email": email.upper(), "password": _PASSWORD},
            headers=csrf_headers["headers"],
        )
        assert res.status_code == 200, f"upper-case login rejected: {res.text}"


@pytest.mark.asyncio
async def test_duplicate_registration_is_rejected_across_casings(clean_collections, csrf_headers):
    email = f"dupe.{uuid.uuid4().hex[:8]}@example.com"
    body = {
        "name": "Dupe", "email": email,
        "password": _PASSWORD, "privacy_policy_accepted": True,
    }
    async with _client(csrf_headers) as ac:
        first = await ac.post("/api/v1/auth/register", json=body,
                              headers=csrf_headers["headers"])
        assert first.status_code == 200, first.text

        second = await ac.post(
            "/api/v1/auth/register",
            json={**body, "email": email.upper()},
            headers=csrf_headers["headers"],
        )
        assert second.status_code == 400
        assert "already registered" in second.json()["detail"].lower()


# ── RBAC against a live DB ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_viewer_can_read_but_not_write(clean_collections, csrf_headers):
    token = create_token(str(uuid.uuid4()), "viewer@example.com", "V", ROLE_VIEWER)
    async with _client(csrf_headers) as ac:
        read = await ac.get("/api/v1/locations", headers=_auth_headers(token, csrf_headers))
        assert read.status_code == 200, read.text
        assert isinstance(read.json(), (list, dict))

        write = await ac.post(
            "/api/v1/locations",
            json={"city_name": "Ames", "address": "1 Main St",
                  "drive_time_minutes": 30, "latitude": 42.0, "longitude": -93.6},
            headers=_auth_headers(token, csrf_headers),
        )
        assert write.status_code == 403, f"viewer was allowed to write: {write.status_code}"


@pytest.mark.asyncio
async def test_admin_write_reaches_the_database(clean_collections, csrf_headers):
    """RBAC allows it *and* the row actually lands — the full path."""
    token = create_token(str(uuid.uuid4()), "admin@example.com", "A", ROLE_ADMIN)
    async with _client(csrf_headers) as ac:
        res = await ac.post(
            "/api/v1/locations",
            json={"city_name": "Grinnell", "address": "2 Broad St",
                  "drive_time_minutes": 55, "latitude": 41.74, "longitude": -92.72},
            headers=_auth_headers(token, csrf_headers),
        )
        assert res.status_code in {200, 201}, res.text

    stored = await clean_collections.locations.find_one({"city_name": "Grinnell"})
    assert stored is not None
    assert stored["deleted_at"] is None


@pytest.mark.asyncio
async def test_soft_deleted_rows_disappear_from_list_endpoints(clean_collections, csrf_headers):
    """The visibility property every un-migrated raw filter can break."""
    token = create_token(str(uuid.uuid4()), "admin@example.com", "A", ROLE_ADMIN)
    async with _client(csrf_headers) as ac:
        headers = _auth_headers(token, csrf_headers)
        created = await ac.post(
            "/api/v1/locations",
            json={"city_name": "Ottumwa", "address": "3 Court St",
                  "drive_time_minutes": 90, "latitude": 41.02, "longitude": -92.41},
            headers=headers,
        )
        assert created.status_code in {200, 201}, created.text
        location_id = created.json().get("id") or created.json().get("location", {}).get("id")
        assert location_id, f"no id in create response: {created.text}"

        listed = await ac.get("/api/v1/locations", headers=headers)
        names = [row["city_name"] for row in _rows(listed.json())]
        assert "Ottumwa" in names

        removed = await ac.delete(f"/api/v1/locations/{location_id}", headers=headers)
        assert removed.status_code in {200, 204}, removed.text

        listed = await ac.get("/api/v1/locations", headers=headers)
        names = [row["city_name"] for row in _rows(listed.json())]
        assert "Ottumwa" not in names, "soft-deleted row still visible"


# ── unmatched routes ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unknown_api_route_is_a_json_404(clean_collections):
    async with _client() as ac:
        res = await ac.get("/api/v1/definitely-not-a-route")
        assert res.status_code == 404
        assert "text/html" not in res.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_legacy_api_mount_is_gone(clean_collections):
    """The /api/* mount was removed after its 2026-07-01 sunset."""
    async with _client() as ac:
        res = await ac.get("/api/health")
        assert res.status_code == 404


@pytest.mark.asyncio
async def test_health_reports_component_status(clean_collections):
    """Both backing services are up in CI, so this must be a 200.

    /health 503s if *either* Mongo or Redis is unavailable — CSRF validation
    and rate limiting depend on Redis — which is why the workflow runs both
    service containers. No arq worker runs in CI, so the worker heartbeat is
    absent; that is reported in the payload but deliberately does not 503 the
    API, since killing the API because the worker is down would take
    scheduling offline for everyone.
    """
    async with _client() as ac:
        res = await ac.get("/api/v1/health")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["mongo"] == "ok", body
        assert body["redis"] == "ok", body
        assert body["status"] in {"healthy", "worker_degraded"}, body


def _rows(payload):
    """List endpoints return either a bare list or a paginated envelope."""
    if isinstance(payload, list):
        return payload
    for key in ("items", "results", "data", "locations"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []
