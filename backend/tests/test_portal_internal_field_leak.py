"""Regression tests: partner portal responses must not leak internal-only
fields.

Portal endpoints previously returned project docs (with the internal `notes`
and `created_by`) and partner-org docs (with internal `notes` and the
prospect/active `status`) to partner contacts using only a ``{"_id": 0}``
projection. These pin that the project projection and the org choke point drop
those fields while keeping everything the portal actually renders.
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.append(os.path.abspath("backend"))
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

from core import portal_auth  # noqa: E402
from core.token_digest import token_digest  # noqa: E402
from routers.portal import dashboard as portal_dashboard  # noqa: E402
from routers.portal import workspace as portal_workspace  # noqa: E402
from routers.portal._shared import PORTAL_PROJECT_PROJECTION  # noqa: E402


def _project(row, projection):
    out = dict(row)
    if projection:
        for key, enabled in projection.items():
            if enabled == 0:
                out.pop(key, None)
    return out


def _matches(row, query):
    return all(row.get(key) == value for key, value in query.items())


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return list(self.rows)


class _Collection:
    """Fake collection that honours exclusion projections in find/find_one."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    def find(self, query, projection=None):
        return _Cursor(
            [_project(row, projection) for row in self.rows if _matches(row, query)]
        )

    async def update_one(self, *_args, **_kwargs):
        await asyncio.sleep(0)


_INTERNAL_PROJECT = {
    "id": "p1",
    "partner_org_id": "org1",
    "title": "Fall Workshop",
    "event_date": "2026-09-15",
    "phase": "planning",
    "deleted_at": None,
    "notes": "INTERNAL: partner is behind on payment",
    "created_by": "internal-user-42",
}

_INTERNAL_ORG = {
    "id": "org1",
    "name": "Acme Partner",
    "deleted_at": None,
    "notes": "INTERNAL: renegotiating contract terms",
    "status": "prospect",
}


def test_project_projection_excludes_internal_fields():
    # Guard the constant itself so an edit can't silently re-expose a field.
    assert PORTAL_PROJECT_PROJECTION.get("notes") == 0
    assert PORTAL_PROJECT_PROJECTION.get("created_by") == 0
    assert PORTAL_PROJECT_PROJECTION.get("_id") == 0


def test_portal_list_projects_hides_notes_and_created_by(monkeypatch):
    monkeypatch.setattr(
        portal_dashboard, "db", SimpleNamespace(projects=_Collection([_INTERNAL_PROJECT]))
    )
    result = asyncio.run(
        portal_dashboard.portal_list_projects({"partner_org_id": "org1"})
    )
    assert result["total"] == 1
    project = result["items"][0]
    assert project["id"] == "p1"
    assert project["title"] == "Fall Workshop"  # still returned
    assert "notes" not in project
    assert "created_by" not in project


def test_workspace_project_query_hides_internal_fields(monkeypatch):
    monkeypatch.setattr(
        portal_workspace, "db", SimpleNamespace(projects=_Collection([_INTERNAL_PROJECT]))
    )
    ctx = {"partner_org_id": "org1"}

    projects = asyncio.run(portal_workspace._workspace_projects(ctx))
    assert projects and "notes" not in projects[0] and "created_by" not in projects[0]

    project = asyncio.run(portal_workspace._require_project("p1", ctx))
    assert project["id"] == "p1"
    assert "notes" not in project
    assert "created_by" not in project


def test_validate_portal_token_org_hides_notes_and_status(monkeypatch):
    token = "plaintext-portal-token"
    now = datetime.now(timezone.utc)
    token_doc = {
        "id": "tok1",
        "token_digest": token_digest(token),
        "contact_id": "c1",
        "expires_at": (now + timedelta(days=1)).isoformat(),
        "last_used_at": now.isoformat(),  # recent → skip the throttled write
        "revoked_at": None,
    }
    fake_db = SimpleNamespace(
        portal_tokens=_Collection([token_doc]),
        partner_contacts=_Collection(
            [{"id": "c1", "partner_org_id": "org1", "name": "Pat", "deleted_at": None}]
        ),
        partner_orgs=_Collection([_INTERNAL_ORG]),
    )
    monkeypatch.setattr(portal_auth, "db", fake_db)

    ctx = asyncio.run(portal_auth.validate_portal_token(token))

    assert ctx["partner_org_id"] == "org1"
    assert ctx["org"]["id"] == "org1"
    assert ctx["org"]["name"] == "Acme Partner"  # still returned
    assert "notes" not in ctx["org"]
    assert "status" not in ctx["org"]
