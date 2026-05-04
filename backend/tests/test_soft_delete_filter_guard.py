import re
from pathlib import Path

INLINE_FILTER_BUDGET = {
    Path('routers/partner_orgs.py'): 0,
    Path('routers/project_docs.py'): 0,
    # Legacy bulk mutations still use direct collection writes. Budget locks
    # the current count so no new inline duplication can be introduced.
    Path('routers/schedule_bulk.py'): 8,
}

INLINE_FILTER_PATTERN = re.compile(
    r"(?:find|find_one|update_one|update_many|count_documents)\s*\(\s*\{[^\)]*['\"]deleted_at['\"]\s*:\s*None",
    re.DOTALL,
)


def test_no_new_inline_deleted_at_none_filters_in_migrated_routers():
    offenders = []
    for path, budget in INLINE_FILTER_BUDGET.items():
        text = path.read_text(encoding='utf-8')
        found = len(INLINE_FILTER_PATTERN.findall(text))
        if found > budget:
            offenders.append(f"{path} ({found}>{budget})")
    assert not offenders, f"Inline active soft-delete filter budget exceeded: {offenders}"
