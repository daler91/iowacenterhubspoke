"""Static guardrails for insecure patterns and endpoint performance budgets."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"


def _read(rel: str) -> str:
    return (BACKEND_ROOT / rel).read_text(encoding="utf-8")


def test_no_url_token_auth_usage_in_routers_or_services():
    """Prevent token-in-URL auth regressions (query/path/header misuse)."""
    offenders: list[str] = []
    needles = (
        "access_token=",
        "token=",
        "auth_token=",
    )
    for rel in ("routers", "services"):
        for path in (BACKEND_ROOT / rel).rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            if any(n in text for n in needles) and "Authorization" not in text:
                offenders.append(str(path.relative_to(REPO_ROOT)))
    assert not offenders, f"Potential URL token auth patterns found: {offenders}"


def test_no_full_buffer_file_reads_in_upload_or_webhook_paths():
    """Guard against memory-spike regressions from whole-body reads."""
    upload_text = _read("core/upload.py")
    assert "await file.read()" not in upload_text


def test_project_board_and_schedule_list_have_pagination_budgets():
    """Lock endpoint limits so accidental budget inflation fails CI."""
    projects = _read("routers/projects.py")
    schedules = _read("routers/schedule_crud.py")

    assert "BOARD_PHASE_LIMIT_MAX" in projects
    assert ".limit(limit + 1)" in projects
    assert "_SCHEDULE_LIST_LIMIT_MAX = 200" in schedules
    assert ".limit(pagination.limit)" in schedules
