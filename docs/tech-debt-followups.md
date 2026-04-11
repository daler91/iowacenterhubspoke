# Tech-debt follow-ups

The April 2026 tech-debt remediation effort (commits prefixed `Tech-debt
Phase 1` through `Phase 5` on the `claude/analyze-tech-debt-WADVP`
branch) closed the highest-impact issues but deliberately left a
handful of items as scoped follow-ups so the change batches stayed
PR-sized. This doc tracks them.

## Open

### Migrate the remaining 22 routers onto `SoftDeleteRepository`

`backend/core/repository.py::SoftDeleteRepository` is in place and used
by `routers/locations.py` and `routers/classes.py`. The other 22
routers still issue `{"deleted_at": None}` filters by hand. See
`docs/repository-pattern.md` for the migration recipe — each router is
a small, self-contained PR.

### Tighten frontend `tsc --noEmit` in CI

Phase 4 introduced typed interfaces in `frontend/src/lib/types.ts` and
`api.ts` and added `frontend/src/vite-env.d.ts` so `import.meta.env`
type-checks. The codebase still has ~1700 latent strict-mode TypeScript
errors (mostly implicit-any in older `.tsx` files and Radix UI return
types). `tsc --noEmit` is therefore NOT gated in CI yet because doing
so would instantly turn the signal red.

To wire it up:
1. Sweep the implicit-any errors in `src/components/Calendar*.tsx`,
   `src/components/coordination/*.tsx`, and the manager components.
   Many can be fixed by typing the props of inline component
   declarations (`function FooBlock({ schedule, canEdit, ... })`).
2. Add `cd frontend && npx tsc --noEmit` as a step in the
   `frontend` job in `.github/workflows/ci.yml`, after `npm ci` and
   before `npm test`.

### Decompose the remaining oversized components

Phase 4b extracted `computeOverlapLayout` and friends to
`components/calendar/layout.ts`, dropping `CalendarWeek.tsx` from 557 →
471 lines and `CalendarDay.tsx` from 414 → 342 lines. The other
oversized components (>400 LOC) are:

- `components/UserManager.tsx` — extract `InviteUserDialog` and
  `RoleSelect` sub-components.
- `components/LocationManager.tsx` — extract `LocationFormDialog`.

### List virtualization

`ActivityFeed.tsx`, `WeeklyReport.tsx`, and `UserManager.tsx` render
all rows with `.map()`. For >50-row datasets this gets janky. A small
`react-window` wrapper (`components/VirtualizedList.tsx`) would cover
all three.

### Schedule form payload typing

`schedulesAPI.create` / `update` / `relocate` / `checkConflicts` /
`updateSeries` accept `ScheduleRequestPayload = Record<string, unknown>`
because `useScheduleForm.buildPayload` returns a union of two recurrence
shapes that can't cleanly be assigned to a strict `ScheduleInput`. The
right fix is to refactor `buildPayload` to return a discriminated union
typed against `ScheduleInput`, then tighten the API method signatures.

### Hard-remove the legacy `/api/` mount

Phase 2 added `Deprecation: true` and `Sunset: Wed, 01 Jul 2026
00:00:00 GMT` headers on the legacy `/api/*` router (alongside a
log-once-per-path warning). Once production logs confirm zero legacy
hits over a release window, remove `legacy_router` and the
`legacy_api_deprecation_middleware` from `backend/server.py`.

### Hard-remove the in-process password-change cache (multi-process)

`backend/core/auth.py::_get_pwd_changed_ts` caches the
`password_changed_at` lookup for 5 minutes per process. Phase 1 wired
`invalidate_pwd_cache(user_id)` into the change/reset password flows so
the **same** worker that issued the rotation drops its cache. In a
multi-worker deployment, OTHER workers can still serve a stale cache
entry for up to 5 minutes. The right fix when the deployment grows past
a single Uvicorn worker:

- Move the cache to Redis with a `DEL user:{id}:pwd_changed_at` on
  password change, OR
- Add a `pwd_version` claim to JWTs and compare against a cached value
  in Redis.

Either approach is invisible to clients.

## Done in this effort

- ✅ Phase 1 — CSV upload DoS, 401 redirect debounce, password-change
  cache invalidation, Redis lifespan, root-test cleanup, archived
  audits.
- ✅ Phase 2 — `core/pagination.py`, deprecated
  `travel_override_minutes` removal, migration runner, legacy `/api/`
  sunset headers.
- ✅ Phase 3a — `core/repository.py` (`SoftDeleteRepository`),
  `routers/locations.py` and `routers/classes.py` migrated, schedule
  helper extraction (`schedule_crud.py`: 585 → 471).
- ✅ Phase 3b — `routers/partner_portal.py` (478 lines) split into the
  `routers/portal/` package.
- ✅ Phase 4a — Typed `frontend/src/lib/api.ts` /
  `frontend/src/lib/types.ts`, added `frontend/src/vite-env.d.ts`.
- ✅ Phase 4b — `frontend/src/components/calendar/layout.ts` shared
  helpers + 20 unit tests; `@types/jest` devDep.
- ✅ Phase 5 — `.pre-commit-config.yaml`, `docs/migrations.md`,
  `docs/repository-pattern.md`, this tracker.
