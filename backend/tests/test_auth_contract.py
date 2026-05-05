import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Response
from starlette.requests import Request

from routers import auth


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        self.rows.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                _apply_update(row, update)
                return
        if upsert:
            base = dict(query)
            _apply_update(base, update)
            self.rows.append(base)

    async def update_many(self, query, update):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                _apply_update(row, update)

    async def delete_one(self, query):
        await asyncio.sleep(0)
        for idx, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(idx)
                return

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                before = dict(row)
                _apply_update(row, update)
                # Match Mongo/PyMongo semantics: default returns pre-update;
                # explicit "after" returns post-update.
                if str(return_document).lower() in {"true", "after", "returndocument.after"}:
                    return _project(row, projection)
                return _project(before, projection)
        return None


class FakeDB:
    def __init__(self, users=None, refresh_tokens=None, password_resets=None, login_failures=None):
        self.users = FakeCollection(users)
        self.refresh_tokens = FakeCollection(refresh_tokens)
        self.password_resets = FakeCollection(password_resets)
        self.login_failures = FakeCollection(login_failures)


def _matches(row, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            continue
        if row.get(key) != value:
            return False
    return True


def _project(row, projection):
    if not projection:
        return dict(row)
    out = dict(row)
    for k, v in projection.items():
        if v == 0 and k in out:
            out.pop(k)
    return out


def _apply_update(row, update):
    for op, payload in update.items():
        if op == "$set":
            row.update(payload)
        elif op == "$inc":
            for k, v in payload.items():
                row[k] = row.get(k, 0) + v


def _req_with_cookie(name, value):
    return Request({"type": "http", "method": "POST", "path": "/api/auth", "headers": [(b"cookie", f"{name}={value}".encode())]})


import pytest


@pytest.mark.auth_contract
def test_login_refresh_replay_logout_and_response_contracts(monkeypatch):
    db = FakeDB(users=[{"id": "u1", "email": "u@example.com", "name": "User", "password_hash": "h", "role": "viewer", "status": "approved"}])
    monkeypatch.setattr(auth, "db", db)
    monkeypatch.setattr(auth, "verify_password", lambda p, h: asyncio.sleep(0, result=(p == "ok-passphrase")))  # noqa: S106

    login_res = asyncio.run(auth.login.__wrapped__(Request({"type": "http", "method": "POST", "path": "/api/auth/login", "headers": []}), auth.UserLogin(email="u@example.com", password="ok-passphrase"), Response()))  # noqa: S106
    assert set(login_res.keys()) == {"user"}
    assert set(login_res["user"].keys()) == {"id", "name", "email", "role"}

    issued = db.refresh_tokens.rows[0]
    monkeypatch.setattr(auth, "decode_refresh_token", lambda token: {"jti": issued["jti"], "user_id": "u1"})
    refresh_res = asyncio.run(auth.refresh_session.__wrapped__(_req_with_cookie("refresh_token", "r1"), Response()))
    assert refresh_res == {"refreshed": True}

    with pytest.raises(HTTPException) as replay_exc:
        asyncio.run(auth.refresh_session.__wrapped__(_req_with_cookie("refresh_token", "r1"), Response()))
    assert replay_exc.value.status_code == 401

    logout_res = asyncio.run(auth.logout.__wrapped__(_req_with_cookie("refresh_token", "r1"), Response()))
    assert logout_res == {"message": "Logged out successfully"}


@pytest.mark.auth_contract
def test_password_reset_change_and_multi_worker_cache_coherence(monkeypatch):
    now = datetime.now(timezone.utc)
    db = FakeDB(
        users=[{"id": "u1", "email": "u@example.com", "password_hash": "old", "status": "approved"}],
        password_resets=[{"token": "t1", "user_id": "u1", "used_at": None, "expires_at": now + timedelta(minutes=5)}],
    )
    monkeypatch.setattr(auth, "db", db)
    monkeypatch.setattr(auth, "hash_password", lambda p: asyncio.sleep(0, result=f"hashed:{p}"))

    invalidate_calls = []

    async def _invalidate(uid, **kwargs):
        await asyncio.sleep(0)
        invalidate_calls.append((uid, kwargs))

    monkeypatch.setattr(auth, "invalidate_pwd_cache", _invalidate)

    validate_res = asyncio.run(auth.validate_reset_token.__wrapped__(Request({"type": "http", "method": "GET", "path": "/api/auth/reset-password/t1", "headers": []}), "t1"))
    assert validate_res == {"valid": True}

    reset_res = asyncio.run(auth.reset_password.__wrapped__(Request({"type": "http", "method": "POST", "path": "/api/auth/reset-password", "headers": []}), auth.ResetPasswordRequest(token="t1", new_password="new-passphrase-123")))  # noqa: S106
    assert reset_res == {"message": "Password reset successful"}
    assert db.users.rows[0]["password_hash"] == "hashed:new-passphrase-123"
    assert invalidate_calls == [("u1", {"pwd_version": 1})]

    # simulate multi-worker cache coherence via explicit invalidation on password_change
    current = {"user_id": "u1", "email": "u@example.com", "name": "User", "role": "viewer"}
    monkeypatch.setattr(auth, "verify_password", lambda p, h: asyncio.sleep(0, result=(p == "new-passphrase-123")))  # noqa: S106
    change_res = asyncio.run(
        auth.change_password(
            auth.PasswordChange(current_password="new-passphrase-123", new_password="next-passphrase-123"),  # noqa: S106
            current,
            Response(),
        )
    )
    assert change_res == {
        "message": "Password changed successfully. All other sessions have been invalidated."
    }
    assert invalidate_calls == [("u1", {"pwd_version": 1}), ("u1", {"pwd_version": 2})]
