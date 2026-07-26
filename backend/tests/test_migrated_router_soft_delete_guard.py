"""Guard: a migrated router must not regrow hand-written soft-delete filters.

``SoftDeleteRepository`` injects ``deleted_at: None`` into every query so a
call site cannot forget it. That guarantee only holds while the router keeps
going through the repository — a raw ``db.<collection>.find({..., "deleted_at":
None})`` creeping back in is how a half-migrated router ends up carrying two
conventions and, eventually, one call site missing the filter.

The check is scoped to the specific collection each router migrated. Routers
routinely query *other* collections that have not been migrated yet — the
employees router reads ``db.schedules`` to block deleting an employee who
still has future work — and flagging those would make it impossible to lock
in any router touching more than one collection.
"""

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

# router file -> the collection whose access has been migrated to the repository
MIGRATED = {
    "backend/routers/project_docs.py": "documents",
    "backend/routers/employees.py": "employees",
}


def _raw_filter_pattern(collection: str) -> re.Pattern:
    return re.compile(
        rf"db\.{re.escape(collection)}\."
        r"(?:find|find_one|update_one|update_many|count_documents)"
        r"\([\s\S]{0,400}?\"deleted_at\"\s*:\s*None",
        re.MULTILINE,
    )


def test_no_new_raw_deleted_at_none_filters_in_migrated_routers():
    offenders = []
    for rel_path, collection in MIGRATED.items():
        text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
        match = _raw_filter_pattern(collection).search(text)
        if match:
            line = text.count("\n", 0, match.start()) + 1
            offenders.append(f"{rel_path}:{line} raw soft-delete filter on db.{collection}")

    assert offenders == [], (
        "Migrated routers must go through SoftDeleteRepository:\n  "
        + "\n  ".join(offenders)
    )


def test_guard_would_catch_a_regression():
    """Keeps the check from silently going vacuous if the pattern rots."""
    assert _raw_filter_pattern("employees").search(
        'rows = await db.employees.find({"id": x, "deleted_at": None}).to_list(10)'
    )
    # ...and does not fire on a different collection in the same file.
    assert not _raw_filter_pattern("employees").search(
        'n = await db.schedules.count_documents({"employee_ids": x, "deleted_at": None})'
    )


def test_migrated_routers_actually_instantiate_the_repository():
    for rel_path in MIGRATED:
        text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
        assert "SoftDeleteRepository(" in text, (
            f"{rel_path} is listed as migrated but never constructs a repository"
        )
