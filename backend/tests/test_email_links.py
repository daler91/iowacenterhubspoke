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
