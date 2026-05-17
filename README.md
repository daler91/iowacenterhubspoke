# HubSpoke - Scheduling + Coordination Platform

HubSpoke is a full-stack app used by Iowa Center teams to schedule classes,
coordinate partner projects, and provide partner-facing portal access.

This README is the maintainer entrypoint. Treat the docs under `docs/` as the
canonical runbooks for deeper operational, migration, security, and architecture
details.

## Features (implemented)

- **Scheduling calendar** with conflict checks, recurrence support, imports,
  exports, bulk operations, and drive-time awareness.
- **Travel/drive-time handling** with Google Maps integration and fallback
  calculations.
- **Role-based access** for internal users plus invitation, approval, password
  reset, refresh-token, and CSRF-protected session flows.
- **Coordination module** for partners, projects, tasks, documents, task
  attachments, comments/messages, event outcomes, and promotion checklists.
- **Partner portal** with bearer-token magic-link auth, partner-scoped
  dashboards, tasks, task detail, attachment preview/download, messages,
  documents, notifications, and settings.
- **Notifications + email flows** for reminders, digests, invitations, password
  reset, and portal magic links.
- **Exports/reporting endpoints** and activity logging.

Historical roadmap ideas and audits live under `docs/archive/`; feature claims
here are limited to modules currently present in `backend/`, `frontend/src/`,
and active docs.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.5, Vite 7, Tailwind CSS 3, Radix UI |
| Backend API | FastAPI 0.125, Python 3.11, Motor/PyMongo |
| Data | MongoDB 7 |
| Queue/async jobs | Redis + arq worker |
| Auth | JWT, refresh-token storage, CSRF double-submit, token digests for reset/portal lookup |
| Observability/privacy | Sentry with scrubbers, consent-gated PostHog, structured JSON logging |
| Deployment | Docker / Docker Compose, Railway, GitHub Actions CI |

## Project Structure (current)

```text
.
|-- backend/
|   |-- server.py                 # FastAPI app assembly, middleware, routers, health, static serving
|   |-- app_factory.py            # Startup/lifespan composition helpers
|   |-- worker.py                 # arq worker settings, heartbeat, and remaining bulk jobs
|   |-- database.py               # Mongo connection and db handle
|   |-- startup/                  # Startup migrations, boot indexes, seeds
|   |-- migrations/               # Versioned migration scripts and runner
|   |-- jobs/                     # Extracted calendar, notification, reminder, and schedule job modules
|   |-- core/                     # Auth, logging, upload limits, token digest/vault, repository, pagination
|   |-- models/                   # Pydantic schemas
|   |-- services/                 # Domain services
|   `-- routers/
|       |-- auth.py
|       |-- schedules.py          # Aggregates schedule_* route modules
|       |-- schedule_*.py         # CRUD/create/bulk/import/conflict helpers
|       |-- projects.py project_*.py partner_orgs.py
|       |-- exports.py webhooks.py notification_preferences.py system.py
|       `-- portal/               # Partner portal router package split
|           |-- auth.py dashboard.py tasks.py messages.py documents.py
|           `-- _shared.py
|-- frontend/
|   |-- src/
|   |   |-- index.tsx             # Sentry/PostHog bootstrap and stale-chunk recovery
|   |   |-- App.tsx               # Route registration
|   |   |-- components/
|   |   |   |-- portal/           # Partner portal UI
|   |   |   |-- coordination/     # Internal coordination UI
|   |   |   |-- analytics/
|   |   |   `-- ui/               # Shared primitives
|   |   |-- hooks/
|   |   |-- lib/                  # API/auth/date/error/consent utilities
|   |   `-- pages/
|   `-- package.json
|-- docs/                         # Canonical maintainer docs
|-- Dockerfile / Dockerfile.dev
|-- docker-compose.yml
|-- docker-compose.prod.yml
|-- railway.json
`-- .github/workflows/ci.yml
```

## Runtime Flow

1. **API startup (`backend/server.py` + `backend/app_factory.py`)**
   - Loads env/config, logging, optional Sentry with `before_send` scrubbing.
   - Mounts `/api/v1` routers, including the split `routers/portal/*` package.
   - Runs the startup sequence: idempotent DB migrations, critical boot-time
     indexes, secondary-index drift repair, Redis setup, and bootstrap seeds.

2. **Worker startup (`backend/worker.py`)**
   - `arq worker.WorkerSettings` processes email, reminder/digest, webhook,
     calendar, denormalization, and bulk schedule jobs.
   - Emits a Redis heartbeat key used by `/api/v1/health` to report worker
     degradation separately from API/Mongo/Redis status.

3. **Frontend runtime (`frontend/src`)**
   - Vite serves the React SPA locally via `npm start`.
   - `frontend/src/lib/api.ts` centralizes axios, CSRF, refresh-token handling,
     and portal bearer-token 401 behavior.
   - `frontend/src/lib/coordination-api.ts` owns coordination and portal API
     wrappers, including blob download/preview helpers.

4. **Compose local dev (`docker-compose.yml`)**
   - Starts Mongo, Redis, backend, worker, and frontend as one stack.

## Getting Started

### Prerequisites

- Node.js 20+ for the frontend (CI uses Node 20; Vite 7 expects a current Node).
- Python 3.11+.
- MongoDB 7.
- Redis 7 for worker-backed features.

### Local development (Docker Compose)

```bash
docker-compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080/api/v1`
- API docs: `http://localhost:8080/docs`

### Manual setup

#### Backend API

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export MONGO_URL=mongodb://localhost:27017
export DB_NAME=iowa_center_hub
export JWT_SECRET=$(openssl rand -hex 32)

# Optional / feature-gated
export REDIS_URL=redis://localhost:6379
export GOOGLE_MAPS_API_KEY=your_key_here

uvicorn server:app --reload --host 127.0.0.1 --port 8080
```

#### Worker

```bash
cd backend
source venv/bin/activate
arq worker.WorkerSettings
```

#### Frontend

```bash
cd frontend
npm install
npm start
```

## Scripts + Package Managers

- Root `package.json` is tooling-only (`npm run seed` for demo data).
- Frontend uses npm scripts from `frontend/package.json`: `start`, `build`,
  `preview`, `test`, `test:e2e`, `check-testids`, `lint`, `lint:fix`,
  and `typecheck`.
- Backend is Python-managed with `pip`, `uvicorn`, `arq`, `pytest`, `flake8`,
  and security/type tools in CI.

## Environment Variables

Core runtime/deploy variables:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URL` | Yes | Mongo connection string used by API and worker. |
| `DB_NAME` | No | Defaults to `iowa_center_hub`. |
| `JWT_SECRET` | Yes in production | Token signing secret; fallback is for single-process dev only. |
| `TOKEN_DIGEST_SECRET` | Optional | HMAC secret for lookup-only reset/portal token digests; falls back to `JWT_SECRET`. |
| `TOKEN_ENCRYPTION_KEY` | Required when OAuth is enabled in production | Fernet key for OAuth/webhook token storage. |
| `CSRF_SECRET` | Recommended | Falls back to JWT secret if unset. |
| `REDIS_URL` | Required for worker-backed features | Used by arq, runtime queues, caches, and worker heartbeat. |
| `ENVIRONMENT` | Recommended | Use `production` in deployed envs for stricter behavior/logging. |
| `CORS_ORIGINS` | Production required | Comma-separated allowed origins; startup rejects wildcards/invalid entries. |
| `APP_URL` | Production required | Canonical public URL for generated links. |
| `GOOGLE_MAPS_API_KEY` | Optional | Enables Google Distance Matrix path. |
| `SENTRY_DSN` | Optional | Enables backend Sentry with payload scrubbing. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | Required for real email sending | If SMTP is unset, dev-mode logging behavior applies. |
| `UPLOAD_DIR` | Optional | Upload storage path; container entrypoint prepares/chowns this directory. |
| `MAX_UPLOAD_BYTES` | Optional | Defaults to 10 MB and is enforced by streaming upload helpers. |
| `VITE_BACKEND_URL` | Optional | Frontend API base URL; leave empty for same-origin deploys. |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional | Browser-exposed Maps key. |
| `VITE_SENTRY_DSN` | Optional | Frontend Sentry DSN. |
| `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` | Optional | Analytics key/host; loaded only after explicit consent. |

See `.env.example` and the docs linked below before changing deploy config.

## Canonical Maintainer Docs

- [`docs/migrations.md`](docs/migrations.md) - migration runner behavior,
  adding migrations, and deployment sequencing.
- [`docs/repository-pattern.md`](docs/repository-pattern.md) - soft-delete
  repository migration guide.
- [`docs/tech-debt-followups.md`](docs/tech-debt-followups.md) - current
  remediation tracker.
- [`docs/portal_permission_matrix.md`](docs/portal_permission_matrix.md) -
  partner portal permission and scoping rules.
- [`docs/observability-scrubbing-checklist.md`](docs/observability-scrubbing-checklist.md) -
  Sentry/logging privacy verification.
- [`docs/endpoint_scalability.md`](docs/endpoint_scalability.md) - endpoint
  scaling assumptions and caps.
- [`docs/OUTLOOK_SETUP.md`](docs/OUTLOOK_SETUP.md) - Outlook OAuth setup.

Historical analyses in [`docs/archive/`](docs/archive/) are useful context but
are not canonical runbooks.

## Deployment + CI Notes

- `Dockerfile` is the production image used by Railway (`railway.json`).
- Both Dockerfiles define `/api/v1/health` health checks.
- `Dockerfile.dev` only enables `uvicorn --reload` when `UVICORN_RELOAD=1`.
- `docker-compose.prod.yml` includes a worker heartbeat health check.
- GitHub Actions runs backend tests, frontend tests/build/lint/e2e,
  dependency scanning (`pip-audit`, `npm audit`), secret scanning (`gitleaks`),
  and non-blocking type checks while legacy TypeScript/mypy baselines are paid
  down.

## Contributor Status

Use this section as the quick status board before starting implementation work.

### Recently improved

- Partner portal router remains split under `backend/routers/portal/`.
- Portal child resources are scoped by partner org, project, task, and
  partner-visible task ownership before returning comments or attachments.
- Portal task attachment preview/download routes now match the frontend API
  contract and serve sanitized basename paths from `UPLOAD_DIR`.
- Password reset and portal magic-link tokens are stored as HMAC digests for new
  rows, with temporary legacy raw-token fallback until old tokens expire.
- Soft-deleted shared documents and outcomes are excluded from portal downloads
  and exports.
- Upload paths use streaming/capped helpers instead of unbounded file reads.
- Sentry/PostHog privacy controls, Docker health checks, worker heartbeat, and
  CI security gates are present.

### Active deferred areas

From `docs/tech-debt-followups.md`, these remain active:

- Migrate remaining routers to `SoftDeleteRepository`.
- Reduce TypeScript debt until `npm run typecheck` can become blocking in CI.
- Decompose oversized frontend components (`UserManager`, `LocationManager`,
  and coordination/portal surfaces as needed).
- Add list virtualization for large rendered lists.
- Tighten schedule form payload typing and API signatures.
- Hard-remove the legacy `/api/*` mount after production hit count reaches zero.
- Replace the in-process password-change cache for multi-worker deployments.
- Complete the deferred portal transport redesign when ready; current portal
  URLs and bearer-token/sessionStorage flow remain intentionally unchanged.

### Where to extend safely

- **Repository/data-access work**: use
  `backend/core/repository.py::SoftDeleteRepository` and
  `docs/repository-pattern.md`.
- **Portal features**: keep feature-specific modules in
  `backend/routers/portal/` and shared portal helpers in `_shared.py` or
  `backend/core/portal_auth.py`.
- **Pagination and list endpoints**: use `backend/core/pagination.py`.
- **Uploads**: use `backend/core/upload.py` helpers and sanitized basename
  reads for downloads.
- **Schema changes**: use the migration runner documented in
  `docs/migrations.md`.
- **Frontend portal behavior**: preserve the bearer-token API shape unless a
  dedicated auth-transport redesign is in scope.

### Do not reintroduce

- Direct use of deprecated `travel_override_minutes`.
- New code paths that depend on the legacy `/api/*` mount.
- New raw soft-delete filters where a repository abstraction is already used.
- Re-growth of partner portal into one monolithic router file.
- Raw reset/portal token storage for new rows.
- Silent portal empty states that hide failed loads.

## License

Private - Iowa Center internal use.
