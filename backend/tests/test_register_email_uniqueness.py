"""Regression tests: users.email must be unique and a lost race is a clean 400.

Registration is a case-insensitive check-then-insert. Without a DB constraint,
two concurrent registrations for the same address both pass the existence check
and both insert, creating duplicate accounts. A unique index on users.email
closes the race; register() must translate the resulting DuplicateKeyError into
the same 400 the up-front check returns rather than a 500.
"""

import asyncio
import os
import secrets
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Response
from pymongo.errors import DuplicateKeyError
from starlette.requests import Request

sys.path.append(os.path.abspath("backend"))
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

from routers import auth  # noqa: E402
from startup import indexes as indexes_module  # noqa: E402

_PASSWORD = f"Aa1-{secrets.token_urlsafe(16)}"


def _request(path="/api/v1/auth/register"):
    return Request({"type": "http", "method": "POST", "path": path, "headers": []})


class _EmptyCollection:
    async def find_one(self, *_a, **_k):
        await asyncio.sleep(0)
        return None


class _RaceLosingUsers(_EmptyCollection):
    async def insert_one(self, _doc):
        await asyncio.sleep(0)
        raise DuplicateKeyError("E11000 duplicate key error: users_email_unique")


def test_register_race_returns_400_not_500(monkeypatch):
    fake_db = SimpleNamespace(users=_RaceLosingUsers(), invitations=_EmptyCollection())
    monkeypatch.setattr(auth, "db", fake_db)
    monkeypatch.setattr(auth, "ADMIN_EMAILS", set())
    monkeypatch.setattr(auth, "hash_password", lambda p: asyncio.sleep(0, result="hashed"))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.register.__wrapped__(
            _request(),
            auth.UserRegister(
                name="Bob", email="bob@example.com",
                password=_PASSWORD, privacy_policy_accepted=True,
            ),
            Response(),
        ))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Email already registered"


# ── index presence ─────────────────────────────────────────────────────

class _RecordingCollection:
    def __init__(self, recorder, name):
        self._rec = recorder
        self._name = name

    async def create_index(self, keys, **kwargs):
        await asyncio.sleep(0)
        self._rec.append((self._name, keys, kwargs))

    async def drop_index(self, _name):
        await asyncio.sleep(0)

    async def index_information(self):
        await asyncio.sleep(0)
        # Report the drift sentinels present so the secondary-index repair
        # no-ops; token-digest indexes are absent so they get created.
        return {
            "employee_ids_1_deleted_at_1_date_1": {},
            "key_1": {},
            "principal_kind_1_principal_id_1_type_key_1_channel_1_dedup_key_1": {},
        }


class _RecordingDB:
    def __init__(self):
        self.__dict__["_rec"] = []
        self.__dict__["_colls"] = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        colls = self.__dict__["_colls"]
        if name not in colls:
            colls[name] = _RecordingCollection(self.__dict__["_rec"], name)
        return colls[name]


def test_ensure_indexes_creates_unique_users_email_index():
    db = _RecordingDB()
    logger = SimpleNamespace(info=lambda *a, **k: None,
                             warning=lambda *a, **k: None,
                             error=lambda *a, **k: None)

    asyncio.run(indexes_module.ensure_indexes(db, logger))

    email_indexes = [
        (keys, kwargs)
        for (coll, keys, kwargs) in db.__dict__["_rec"]
        if coll == "users" and keys == "email"
    ]
    assert email_indexes, "expected a users.email index to be created"
    _, kwargs = email_indexes[0]
    assert kwargs.get("unique") is True
    assert kwargs.get("partialFilterExpression") == {
        "email": {"$exists": True, "$type": "string"}
    }
