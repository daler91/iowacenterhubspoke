import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncio
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import HTTPException

sys.path.append(os.path.abspath("backend"))

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from core.token_digest import token_digest
from core import portal_auth
from routers.portal import auth as portal_auth_router


class _FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.update_calls = []

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    async def update_one(self, query, update):
        await asyncio.sleep(0)
        self.update_calls.append((query, update))


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, _length=None, **_kwargs):
        await asyncio.sleep(0)
        return list(self.rows)


def _matches(row, query):
    return all(row.get(key) == value for key, value in query.items())


def _project(row, projection):
    out = dict(row)
    if projection:
        for key, enabled in projection.items():
            if enabled == 0:
                out.pop(key, None)
    return out


def test_verify_response_never_includes_token_material():
    out = asyncio.run(portal_auth_router.verify_token({"contact": {"id": "c1"}, "org": {"id": "o1"}}))
    assert out["valid"] is True
    assert "token" not in out
    assert "access_token" not in out


def test_verify_route_is_not_path_token_based_anymore():
    verify_paths = [r.path for r in portal_auth_router.router.routes if getattr(r, "name", "") == "verify_token"]
    assert "/portal/auth/verify" in verify_paths
    assert "/portal/auth/verify/{token}" not in verify_paths


def test_bearer_dependency_rejects_missing_or_non_bearer_header():
    request = SimpleNamespace(headers={}, client=None)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_auth.get_portal_context_from_bearer(request=request, authorization=""))
    assert exc.value.status_code == 401

    with pytest.raises(HTTPException) as exc2:
        asyncio.run(portal_auth.get_portal_context_from_bearer(request=request, authorization="Basic abc"))
    assert exc2.value.status_code == 401


def test_bearer_dependency_uses_authorization_header_only(monkeypatch):
    seen = {}

    async def fake_validate(token: str, request=None):
        await asyncio.sleep(0)
        seen["token"] = token
        return {"contact": {"id": "c1"}, "org": {"id": "o1"}}

    monkeypatch.setattr(portal_auth, "validate_portal_token", fake_validate)
    request = SimpleNamespace(headers={"x-forwarded-for": "127.0.0.1"}, client=None)
    out = asyncio.run(portal_auth.get_portal_context_from_bearer(
        request=request,
        authorization="Bearer from-header-token",
    ))
    assert seen["token"] == "from-header-token"
    assert out["contact"]["id"] == "c1"


def test_validate_portal_token_accepts_digest_backed_rows(monkeypatch):
    expires = datetime.now(timezone.utc) + timedelta(days=1)
    portal_tokens = _FakeCollection(
        [{"id": "pt-1", "contact_id": "c1", "token_digest": token_digest("portal-token"), "expires_at": expires}]
    )
    fake_db = SimpleNamespace(
        portal_tokens=portal_tokens,
        partner_contacts=_FakeCollection([{"id": "c1", "partner_org_id": "org1", "deleted_at": None}]),
        partner_orgs=_FakeCollection([{"id": "org1", "deleted_at": None}]),
    )
    monkeypatch.setattr(portal_auth, "db", fake_db)

    out = asyncio.run(portal_auth.validate_portal_token("portal-token"))

    assert out["contact_id"] == "c1"
    assert out["partner_org_id"] == "org1"
    assert portal_tokens.update_calls[0][0] == {"id": "pt-1"}


def test_validate_portal_token_accepts_legacy_plaintext_rows(monkeypatch):
    expires = datetime.now(timezone.utc) + timedelta(days=1)
    portal_tokens = _FakeCollection(
        [{"id": "pt-legacy", "contact_id": "c1", "token": "legacy-token", "expires_at": expires}]
    )
    fake_db = SimpleNamespace(
        portal_tokens=portal_tokens,
        partner_contacts=_FakeCollection([{"id": "c1", "partner_org_id": "org1", "deleted_at": None}]),
        partner_orgs=_FakeCollection([{"id": "org1", "deleted_at": None}]),
    )
    monkeypatch.setattr(portal_auth, "db", fake_db)

    out = asyncio.run(portal_auth.validate_portal_token("legacy-token"))

    assert out["contact_id"] == "c1"
    assert out["partner_org_id"] == "org1"
    assert portal_tokens.update_calls[0][0] == {"id": "pt-legacy"}


def test_portal_token_admin_list_excludes_token_digest(monkeypatch):
    portal_tokens = SimpleNamespace(
        find=MagicMock(return_value=_Cursor([{"id": "pt-1"}])),
    )
    monkeypatch.setattr(portal_auth_router, "db", SimpleNamespace(portal_tokens=portal_tokens))

    out = asyncio.run(portal_auth_router.list_portal_tokens({"role": "admin"}))

    assert out == {"tokens": [{"id": "pt-1"}]}
    projection = portal_tokens.find.call_args.args[1]
    assert projection["token"] == 0
    assert projection["token_digest"] == 0
