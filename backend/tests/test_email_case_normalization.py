"""Regression: email casing must not lock a user out of their own account.

Registration used to store the address exactly as typed while the duplicate
check was case-insensitive and login/reset did exact-match lookups. The result
was a closed trap: a user who signed up as ``Bob@Example.com`` could not log in
as ``bob@example.com`` (401, and it counted toward the brute-force lockout),
could not re-register (the case-insensitive dup check found them), and could
not reset their password — the reset job's exact-match lookup missed, and the
deliberate anti-enumeration response made that miss invisible.

These tests pin every leg of that trap.
"""

import asyncio

import pytest
from fastapi import Response
from starlette.requests import Request

from core.emails import normalize_email
from routers import auth
from services import email_jobs


_PASSWORD = "Dummy_password_123"  # noqa: S105 — test-only placeholder


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
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

    async def delete_one(self, query):
        await asyncio.sleep(0)
        for idx, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(idx)
                return


def _apply_update(row, update):
    row.update(update.get("$set", {}))
    for key, delta in update.get("$inc", {}).items():
        row[key] = row.get(key, 0) + delta


def _matches(row, query):
    for key, value in query.items():
        # Regex queries (the case-insensitive dup check) match anything here;
        # these tests never depend on that branch discriminating.
        if isinstance(value, dict):
            continue
        if row.get(key) != value:
            return False
    return True


class FakeDB:
    def __init__(self, users=None):
        self.users = FakeCollection(users)
        self.login_failures = FakeCollection()
        self.refresh_tokens = FakeCollection()
        self.password_resets = FakeCollection()
        self.invitations = FakeCollection()


def _request(path="/api/v1/auth/login"):
    return Request({"type": "http", "method": "POST", "path": path, "headers": []})


def test_normalize_email_is_lowercase_and_stripped():
    assert normalize_email("  Bob@Example.COM ") == "bob@example.com"
    assert normalize_email(None) == ""
    assert normalize_email("") == ""


def test_login_succeeds_when_casing_differs_from_signup(monkeypatch):
    """The core lockout: stored lower-case, typed mixed-case."""
    db = FakeDB(users=[{
        "id": "u1", "email": "bob@example.com", "name": "Bob",
        "password_hash": "h", "role": "viewer", "status": "approved",
    }])
    monkeypatch.setattr(auth, "db", db)
    monkeypatch.setattr(
        auth, "verify_password",
        lambda p, h: asyncio.sleep(0, result=(p == _PASSWORD)),
    )

    result = asyncio.run(auth.login.__wrapped__(
        _request(),
        auth.UserLogin(email="Bob@Example.COM", password=_PASSWORD),
        Response(),
    ))

    assert result["user"]["id"] == "u1"
    assert result["user"]["email"] == "bob@example.com"


def test_failed_login_lockout_counter_is_case_insensitive(monkeypatch):
    """Otherwise an attacker could reset the counter by varying casing."""
    db = FakeDB(users=[])
    monkeypatch.setattr(auth, "db", db)
    monkeypatch.setattr(auth, "verify_password", lambda p, h: asyncio.sleep(0, result=False))

    for typed in ("bob@example.com", "BOB@example.com", "Bob@Example.Com"):
        with pytest.raises(Exception):
            asyncio.run(auth.login.__wrapped__(
                _request(), auth.UserLogin(email=typed, password=_PASSWORD), Response(),
            ))

    assert len(db.login_failures.rows) == 1, "casing variants must share one counter"
    assert db.login_failures.rows[0]["email"] == "bob@example.com"
    assert db.login_failures.rows[0]["count"] == 3


def test_register_stores_the_normalized_address(monkeypatch):
    db = FakeDB(users=[])
    monkeypatch.setattr(auth, "db", db)
    monkeypatch.setattr(auth, "hash_password", lambda p: asyncio.sleep(0, result="hashed"))
    monkeypatch.setattr(auth, "ADMIN_EMAILS", set())

    async def _no_notifications(_doc):
        await asyncio.sleep(0)

    monkeypatch.setattr(auth, "_send_pending_notifications", _no_notifications)

    asyncio.run(auth.register.__wrapped__(
        _request("/api/v1/auth/register"),
        auth.UserRegister(
            name="Bob", email="Bob@Example.COM",
            password=_PASSWORD, privacy_policy_accepted=True,
        ),
        Response(),
    ))

    assert db.users.rows[0]["email"] == "bob@example.com"


def test_password_reset_finds_user_despite_casing(monkeypatch):
    db = FakeDB(users=[{
        "id": "u1", "email": "bob@example.com", "name": "Bob", "deleted_at": None,
    }])
    monkeypatch.setattr(email_jobs, "db", db)

    sent = []

    async def _capture(**kwargs):
        await asyncio.sleep(0)
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_jobs, "send_password_reset", _capture)
    monkeypatch.setattr(email_jobs, "resolve_app_url", lambda: "https://example.test")

    asyncio.run(email_jobs.send_password_reset_email("BOB@Example.com"))

    assert len(sent) == 1, "reset email must be sent for a differently-cased address"
    assert db.password_resets.rows, "a reset token should have been stored"


def test_password_reset_skips_soft_deleted_users(monkeypatch):
    db = FakeDB(users=[{
        "id": "u1", "email": "bob@example.com", "name": "Bob",
        "deleted_at": "2026-01-01T00:00:00+00:00",
    }])
    monkeypatch.setattr(email_jobs, "db", db)

    sent = []

    async def _capture(**kwargs):
        await asyncio.sleep(0)
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_jobs, "send_password_reset", _capture)
    monkeypatch.setattr(email_jobs, "resolve_app_url", lambda: "https://example.test")

    asyncio.run(email_jobs.send_password_reset_email("bob@example.com"))

    assert sent == [], "a soft-deleted account must not be issued a reset token"
