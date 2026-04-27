from unittest.mock import AsyncMock, MagicMock

import pytest

from services.email import resolve_app_url


def _clear_url_env(monkeypatch):
    for name in ("APP_URL", "CORS_ORIGINS", "RAILWAY_ENVIRONMENT"):
        monkeypatch.delenv(name, raising=False)


def test_resolve_app_url_uses_canonical_app_url(monkeypatch):
    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("APP_URL", "https://theiowacenter-hub.org/")
    monkeypatch.setenv("CORS_ORIGINS", "https://wrong.example")

    assert resolve_app_url() == "https://theiowacenter-hub.org"


def test_resolve_app_url_requires_explicit_app_url_in_production(monkeypatch):
    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://theiowacenter-hub.org")

    with pytest.raises(RuntimeError, match="APP_URL must be set in production"):
        resolve_app_url()


def test_resolve_app_url_treats_railway_as_production(monkeypatch):
    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")

    with pytest.raises(RuntimeError, match="APP_URL must be set in production"):
        resolve_app_url()


def test_resolve_app_url_allows_cors_fallback_in_dev(monkeypatch):
    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173",
    )

    assert resolve_app_url() == "http://localhost:3000"


def test_resolve_app_url_rejects_path_values(monkeypatch):
    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("APP_URL", "https://theiowacenter-hub.org/portal")

    with pytest.raises(RuntimeError, match="without a path"):
        resolve_app_url()


@pytest.mark.asyncio
async def test_direct_partner_invite_does_not_insert_token_without_app_url(
    monkeypatch,
):
    from routers import partner_orgs as partner_orgs_mod

    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")

    fake_db = MagicMock()
    fake_db.partner_orgs.find_one = AsyncMock(
        return_value={"id": "org-1", "name": "Auzmor"}
    )
    fake_db.partner_contacts.find_one = AsyncMock(
        return_value={
            "id": "contact-1",
            "partner_org_id": "org-1",
            "name": "Russ D",
            "email": "russ@example.com",
        }
    )
    fake_db.portal_tokens.insert_one = AsyncMock()
    monkeypatch.setattr(partner_orgs_mod, "db", fake_db)

    with pytest.raises(RuntimeError, match="APP_URL must be set in production"):
        await partner_orgs_mod.send_portal_invite(
            "org-1",
            "contact-1",
            {"name": "Scheduler"},
        )

    fake_db.portal_tokens.insert_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_partner_magic_link_job_does_not_insert_token_without_app_url(
    monkeypatch,
):
    from services import email_jobs

    _clear_url_env(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")

    fake_db = MagicMock()
    fake_db.partner_contacts.find_one = AsyncMock(
        return_value={
            "id": "contact-1",
            "partner_org_id": "org-1",
            "name": "Russ D",
            "email": "russ@example.com",
        }
    )
    fake_db.partner_orgs.find_one = AsyncMock(
        return_value={"id": "org-1", "name": "Auzmor"}
    )
    fake_db.portal_tokens.insert_one = AsyncMock()
    monkeypatch.setattr(email_jobs, "db", fake_db)

    await email_jobs.send_partner_magic_link_email("russ@example.com")

    fake_db.portal_tokens.insert_one.assert_not_awaited()
