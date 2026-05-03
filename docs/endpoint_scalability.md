# Endpoint scalability assumptions

## `/projects/board`
- Per-phase rows are explicitly clamped to `1..200` via `_BOARD_PHASE_LIMIT_MAX`.
- Query model: one bounded query per non-complete phase, plus one `distinct` facet query, plus one task-stats aggregation.
- Payload fallback behavior: each phase includes at most `phase_limit` rows and a `phase_truncated` boolean so clients can progressively fetch more with a larger limit.

## `/schedules`
- Request `limit` is hard-clamped to `1..200` (`_SCHEDULE_LIST_LIMIT_MAX`).
- Response now includes `has_more` for incremental “load more” UX.
- Linked-project enrichment is bounded by `_LINKED_PROJECTS_LIMIT=2000`, with warning logs when truncation is hit.

## `/schedules/check-conflicts`
- Employee fanout is hard-capped to `50` (`_CONFLICT_EMPLOYEE_LIMIT_MAX`) to prevent unbounded conflict checks.
- Work scales approximately with checked employees (internal + external checks per employee plus travel/town checks), with query-count and timing metrics logged for observability.
