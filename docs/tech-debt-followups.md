# Tech-debt follow-ups

The April 2026 tech-debt remediation effort closed the highest-impact
architecture and tooling issues but deliberately left several PR-sized
follow-ups. This document tracks the current maintainer-facing baseline.

## Open

### Migrate remaining routers onto `SoftDeleteRepository`

`backend/core/repository.py::SoftDeleteRepository` is in place and used by
`routers/locations.py` and `routers/classes.py`. Many other routers still issue
`{"deleted_at": None}` filters by hand. See `docs/repository-pattern.md` for the
migration recipe; each router should be a small, self-contained PR with
visibility/restore regression tests.

### Reduce frontend `tsc --noEmit` debt before making it blocking

`frontend/src/vite-env.d.ts`, typed API helpers, and typed portal surfaces are in
place, and CI runs `npm run typecheck` as a non-blocking step. The baseline still
has broad strict-mode debt, mostly implicit-any props in older `.tsx` files and
untyped Radix wrapper returns.

To make it blocking:

1. Sweep implicit-any errors in `src/components/Calendar*.tsx`,
   `src/components/coordination/*.tsx`, manager components, and shared UI
   wrappers.
2. Keep feature tests green while tightening types.
3. Remove `continue-on-error` from the frontend typecheck step in
   `.github/workflows/ci.yml`.

### Decompose the remaining oversized components

The calendar layout helpers have already moved to
`frontend/src/components/calendar/layout.ts`. Remaining high-value targets:

- `frontend/src/components/UserManager.tsx` - extract invite/status/role
  subcomponents.
- `frontend/src/components/LocationManager.tsx` - extract form/dialog and
  drive-time helper UI.
- Coordination and portal detail surfaces - extract hooks/presentational panels
  when future work touches them, rather than growing the existing files.

### Add list virtualization

`ActivityFeed.tsx`, `WeeklyReport.tsx`, and `UserManager.tsx` still render full
lists with `.map()`. A shared virtualized list/table shell should be introduced
before these surfaces are expected to handle large datasets.

### Tighten schedule form payload typing

`schedulesAPI.create` / `update` / `relocate` / `checkConflicts` /
`updateSeries` still accept broad schedule payload types because
`useScheduleForm.buildPayload` returns multiple recurrence shapes. Refactor the
payload builder to return a discriminated union aligned with backend
`ScheduleInput`, then tighten the API method signatures.

### Hard-remove the legacy `/api/*` mount

Phase 2 added `Deprecation: true` and `Sunset: Wed, 01 Jul 2026 00:00:00 GMT`
headers on the legacy `/api/*` router. Once production logs confirm zero legacy
hits over a release window, remove `legacy_router` and the legacy deprecation
middleware from `backend/server.py`.

### Replace the in-process password-change cache for multi-worker deploys

`backend/core/auth.py::_get_pwd_changed_ts` caches `password_changed_at` per
process. Same-worker invalidation is wired into change/reset flows, but sibling
workers can keep a stale cache entry until TTL expiry. Before scaling beyond a
single worker, move this to Redis invalidation or add a JWT `pwd_version` claim
checked against Redis.

### Finish the portal token transport redesign

Recent rounds hardened portal token storage and resource authorization while
keeping the existing `/portal/{token}` URL/sessionStorage flow intact. The
HttpOnly-cookie redesign remains deferred. When implemented, preserve the
current partner recovery UX and API authorization semantics.

## Recently improved

- Portal router split: the legacy monolithic portal router has been replaced by
  the `backend/routers/portal/` package.
- Critical portal leak fixes: partner-visible task checks now gate child
  comments/attachments, child-resource queries include `task_id` and
  `project_id`, and tasks outside the partner org/project are blocked.
- Soft-delete leaks: shared portal document downloads and outcome exports now
  exclude `deleted_at` rows.
- Token storage: new password-reset and portal-token rows store
  `token_digest`, with short-lived legacy raw-token lookup fallback until old
  tokens expire.
- Portal attachment route: partner task attachment preview/download now has a
  backend route matching the frontend API and serves sanitized basename paths.
- Portal UX: dashboard/project detail surfaces expose loading, error, retry,
  empty, and rapid-action pending states for tasks/documents/messages and task
  detail attachments.
- Upload hardening: project, task, and portal uploads use streaming helpers with
  `MAX_UPLOAD_BYTES` limits instead of unbounded reads.
- Observability/privacy: backend Sentry uses `core.sentry_scrub`, frontend
  Sentry strips sensitive headers, PostHog is consent-gated, and logout resets
  analytics identity.
- CI/security: GitHub Actions now includes dependency scanning, gitleaks,
  frontend audit, e2e checks, and non-blocking backend/frontend type checks.
- DevOps: Dockerfiles include health checks, `Dockerfile.dev` gates reload
  behind `UVICORN_RELOAD=1`, and the worker emits a Redis heartbeat used by
  health checks.

## Done in the April 2026 effort

- Phase 1 - CSV upload DoS guardrails, 401 redirect debounce,
  password-change cache invalidation, Redis lifespan, root-test cleanup,
  archived audits.
- Phase 2 - `core/pagination.py`, deprecated `travel_override_minutes`
  removal, migration runner, legacy `/api/` sunset headers.
- Phase 3a - `core/repository.py` (`SoftDeleteRepository`),
  `routers/locations.py` and `routers/classes.py` migrated, schedule CRUD
  helper extraction.
- Phase 3b - portal router split into the `backend/routers/portal/` package.
- Phase 4a - typed `frontend/src/lib/api.ts` / `frontend/src/lib/types.ts`,
  plus `frontend/src/vite-env.d.ts`.
- Phase 4b - shared calendar layout helpers and focused unit tests.
- Phase 5 - `.pre-commit-config.yaml`, `docs/migrations.md`,
  `docs/repository-pattern.md`, and this tracker.
