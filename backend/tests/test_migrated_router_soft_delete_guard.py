import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

MIGRATED_ROUTERS = [
    REPO_ROOT / "backend/routers/project_docs.py",
]

RAW_FILTER_PATTERN = re.compile(
    r"db\.\w+\.(?:find|find_one|update_one|count_documents)\([\s\S]*?\"deleted_at\"\s*:\s*None",
    re.MULTILINE,
)


def test_no_new_raw_deleted_at_none_filters_in_migrated_routers():
    offenders = []
    for router in MIGRATED_ROUTERS:
        text = router.read_text(encoding="utf-8")
        if RAW_FILTER_PATTERN.search(text):
            offenders.append(str(router.relative_to(REPO_ROOT)))
    assert offenders == [], f"Found raw soft-delete filters in migrated routers: {offenders}"
