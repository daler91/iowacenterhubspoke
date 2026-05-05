"""Ordered migration registry.

Each entry is ``(id, callable)`` where ``callable`` is ``async def run(db)``.
The ID is stored in the ``schema_migrations`` collection on successful
application and must never be renamed — once shipped, the ID is the primary
key the runner uses to decide whether a migration has already been applied.

IDs are prefixed with a zero-padded sequence number so Python sort order and
intended execution order match.
"""

from typing import Awaitable, Callable, List, Tuple

from . import (
    add_task_status_fields,
    backfill_project_class_id,
    migrate_multi_employee,
    rename_class_type_to_event_format,
    manage_secondary_indexes,
)

MigrationFn = Callable[[object], Awaitable[int]]

MIGRATIONS: List[Tuple[str, MigrationFn]] = [
    ("001_multi_employee", migrate_multi_employee.run),
    ("002_rename_class_type_to_event_format", rename_class_type_to_event_format.run),
    ("003_add_task_status_fields", add_task_status_fields.run),
    ("004_backfill_project_class_id", backfill_project_class_id.run),
    ("005_manage_secondary_indexes", manage_secondary_indexes.run),
]
