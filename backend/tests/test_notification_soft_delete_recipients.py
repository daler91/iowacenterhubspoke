"""Regression tests: notification recipient lookups must skip soft-deleted
internal users.

Users are soft-deleted by setting ``deleted_at`` while ``status`` stays
``approved``. The partner-contact side of the notification pipeline always
filtered ``deleted_at: None``; the internal-user side did not, so offboarded
staff kept receiving project fan-outs, task-assignment notices, and digests.
These pin the filter on every internal-user lookup.
"""

import asyncio
import os
import sys
from unittest.mock import MagicMock

sys.path.append(os.path.abspath("backend"))
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

from services import notification_events, notification_prefs  # noqa: E402


def _matches(row, query):
    # Mirrors Mongo semantics for the filters under test: {deleted_at: None}
    # matches rows whose field is null or absent; a set timestamp excludes them.
    for key, value in query.items():
        if isinstance(value, dict) and "$in" in value:
            if row.get(key) not in value["$in"]:
                return False
        elif row.get(key) != value:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        await asyncio.sleep(0)
        return list(self.rows)


class _Users:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        return _Cursor([r for r in self.rows if _matches(r, query)])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for r in self.rows:
            if _matches(r, query):
                return r
        return None


class _Empty:
    async def find_one(self, *_a, **_k):
        await asyncio.sleep(0)
        return None


_ACTIVE = {"id": "u-active", "name": "Active Admin", "email": "active@x.com",
           "role": "admin", "status": "approved", "deleted_at": None}
_DELETED = {"id": "u-gone", "name": "Gone Editor", "email": "gone@x.com",
            "role": "editor", "status": "approved",
            "deleted_at": "2026-01-01T00:00:00+00:00"}


def _patch_users(monkeypatch, module, rows):
    fake_db = MagicMock()
    fake_db.users = _Users(rows)
    fake_db.partner_contacts = _Empty()
    monkeypatch.setattr(module, "db", fake_db)


def test_load_internal_principals_excludes_soft_deleted(monkeypatch):
    _patch_users(monkeypatch, notification_prefs, [_ACTIVE, _DELETED])
    principals = asyncio.run(notification_prefs._load_internal_principals(set()))
    ids = {p.id for p in principals}
    assert ids == {"u-active"}


def test_list_admin_principals_excludes_soft_deleted(monkeypatch):
    deleted_admin = {**_DELETED, "role": "admin"}
    _patch_users(monkeypatch, notification_prefs, [_ACTIVE, deleted_admin])
    principals = asyncio.run(notification_prefs.list_admin_principals())
    assert {p.id for p in principals} == {"u-active"}


def test_find_principal_by_email_skips_soft_deleted(monkeypatch):
    _patch_users(monkeypatch, notification_prefs, [_DELETED])
    principal = asyncio.run(notification_prefs.find_principal_by_email("gone@x.com"))
    assert principal is None


def test_load_principal_internal_skips_soft_deleted(monkeypatch):
    _patch_users(monkeypatch, notification_prefs, [_DELETED])
    principal = asyncio.run(notification_prefs.load_principal("internal", "u-gone"))
    assert principal is None


def test_resolve_internal_user_by_name_skips_soft_deleted(monkeypatch):
    _patch_users(monkeypatch, notification_events, [_DELETED])
    principal = asyncio.run(
        notification_events._resolve_internal_user_by_name("Gone Editor")
    )
    assert principal is None
