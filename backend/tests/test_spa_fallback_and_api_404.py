"""The SPA catch-all must not swallow unmatched API paths — or exist at all
when there is no built frontend.

Two regressions this pins:

1. ``@app.get("/{full_path:path}")`` sits after ``api_router``, so anything
   under ``/api/`` reaching it matched no endpoint. It used to answer with
   ``index.html`` and HTTP 200, which makes a typo'd or removed API route look
   like a success to clients and to monitoring.

2. The route must only be registered when a built frontend is present. A
   catch-all partial-matches every unmatched path, and Starlette answers a
   partial match with 405 instead of falling through to its trailing-slash
   redirect — so registering it in an API-only deployment turns
   ``POST /api/v1/schedules`` (which redirects to ``/schedules/``) into a 405.
   It previously avoided this by accident, being defined inside a branch that
   only ran for one of the two static layouts.
"""

import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")


def _build_app_with_static(tmp_path: Path) -> FastAPI:
    """Recreate the server's fallback wiring against a fake build dir."""
    static_root = tmp_path / "static"
    (static_root / "assets").mkdir(parents=True)
    (static_root / "index.html").write_text("<!doctype html><title>app</title>")
    (static_root / "assets" / "main-abc123.js").write_text("console.log(1)")

    app = FastAPI()

    @app.get("/api/v1/ping")
    async def _ping():
        return {"ok": True}

    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    allowed = {
        p.relative_to(static_root).as_posix(): str(p)
        for p in static_root.rglob("*") if p.is_file()
    }
    index_html = str(static_root / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_frontend(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(allowed.get(full_path, index_html))

    return app


@pytest.fixture()
def client(tmp_path):
    with TestClient(_build_app_with_static(tmp_path)) as c:
        yield c


def test_unmatched_api_path_returns_json_404_not_index_html(client):
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert "text/html" not in res.headers.get("content-type", "")


def test_unmatched_api_post_is_not_answered_with_html(client):
    res = client.post("/api/v1/nope", json={})
    assert res.status_code in {404, 405}
    assert "<!doctype html>" not in res.text.lower()


def test_real_api_route_still_works(client):
    assert client.get("/api/v1/ping").json() == {"ok": True}


def test_unknown_app_route_still_serves_the_spa(client):
    """Client-side routes must keep falling back to index.html."""
    res = client.get("/coordination/projects/whatever")
    assert res.status_code == 200
    assert "<!doctype html>" in res.text.lower()


def test_real_asset_is_served_over_the_fallback(client):
    res = client.get("/assets/main-abc123.js")
    assert res.status_code == 200
    assert "console.log" in res.text


def test_fallback_is_not_registered_without_a_built_frontend():
    """The live app: no backend/static/index.html in a source checkout."""
    import server

    if server._SERVE_FRONTEND:
        pytest.skip("a built frontend is present in this checkout")

    catch_all = [
        r for r in server.app.routes
        if getattr(r, "path", "") == "/{full_path:path}"
    ]
    assert catch_all == [], (
        "SPA catch-all must not be registered without a build — it "
        "partial-matches every path and turns trailing-slash redirects into 405s"
    )
