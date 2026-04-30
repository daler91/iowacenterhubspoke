# HubSpoke — Scheduling Platform

A full-stack scheduling platform for managing employee class assignments across multiple satellite locations. The "hub and spoke" model uses Des Moines as the central hub, with employees traveling to surrounding Iowa cities.

## Features

- **Calendar Scheduling** — Drag-and-drop weekly/daily/monthly calendar with 30-minute snap intervals
- **Drive Time Calculation** — Google Distance Matrix API integration with Haversine fallback estimates
- **Town-to-Town Travel** — Automatic detection and visualization when employees visit multiple cities in one day
- **Conflict Detection** — Real-time conflict checking including drive time buffers and Outlook calendar integration
- **Recurrence** — Weekly, biweekly, and custom recurrence patterns with bulk schedule generation
- **Role-Based Access** — Admin, scheduler, editor, and viewer roles with invitation-based onboarding
- **Analytics & Forecasting** — Trend analysis, drive optimization suggestions, and linear regression forecasting
- **Reports** — Weekly summary reports with PDF export, workload breakdowns by employee and class
- **CSV Import/Export** — Bulk schedule management via CSV files
- **Activity Logging** — Structured audit trail of all schedule operations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Radix UI |
| **Backend** | Python 3.11, FastAPI, Motor (async MongoDB driver) |
| **Database** | MongoDB 7 |
| **Cache/Queue** | Redis 7, arq (async task queue) |
| **Auth** | JWT (HTTP-only cookies), bcrypt, CSRF double-submit |
| **Maps** | Google Distance Matrix API (optional) |
| **Deployment** | Docker, Railway |

## Project Structure

```
├── backend/
│   ├── server.py              # FastAPI app, middleware, startup
│   ├── database.py            # MongoDB connection
│   ├── core/
│   │   ├── auth.py            # JWT, password hashing, RBAC
│   │   ├── rate_limit.py      # SlowAPI rate limiting
│   │   ├── constants.py       # Shared constants
│   │   ├── logger.py          # Structured JSON logging
│   │   └── queue.py           # Redis/arq job queue
│   ├── models/
│   │   └── schemas.py         # Pydantic request/response models
│   ├── routers/
│   │   ├── auth.py            # Register, login, logout, invitations
│   │   ├── schedules.py       # Schedule router (combines sub-routers)
│   │   ├── schedule_crud.py   # Schedule CRUD + relocate
│   │   ├── schedule_bulk.py   # Bulk operations
│   │   ├── schedule_import.py # CSV import/export
│   │   ├── schedule_conflicts.py # Conflict checking + travel chain
│   │   ├── locations.py       # Location CRUD + drive time endpoints
│   │   ├── employees.py       # Employee CRUD + stats
│   │   ├── classes.py         # Class type CRUD + stats
│   │   ├── users.py           # User management (admin)
│   │   ├── reports.py         # Dashboard stats, workload, weekly summary
│   │   ├── analytics.py       # Trends, forecast, drive optimization
│   │   └── system.py          # Config, activity logs, notifications
│   └── services/
│       ├── drive_time.py      # Drive time caching + Google API
│       ├── activity.py        # Activity log service
│       └── schedule_utils.py  # Conflict detection, recurrence, helpers
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Router setup, protected routes
│   │   ├── components/        # UI components (calendar, forms, managers)
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # API client, auth context, utilities
│   │   └── pages/             # Login, Dashboard
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.js
├── Dockerfile                 # Multi-stage production build
├── docker-compose.yml         # Local development stack
└── railway.json               # Railway deployment config
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- MongoDB 7+
- Redis 7+ (optional — falls back to synchronous processing)

### Local Development (Docker)

```bash
# Start all services (MongoDB, Redis, backend, worker, frontend)
docker-compose up

# Frontend: http://localhost:5173
# Backend API: http://localhost:8080/api/v1
# API Docs: http://localhost:8080/docs
```

### Manual Setup

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Required
export MONGO_URL=mongodb://localhost:27017
export DB_NAME=iowa_center_hub
export JWT_SECRET=$(openssl rand -hex 32)

# Optional
export GOOGLE_MAPS_API_KEY=your_key_here
export REDIS_URL=redis://localhost:6379

uvicorn server:app --reload --port 8080
```

**Frontend:**

```bash
cd frontend
yarn install
yarn start
# Opens at http://localhost:5173
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URL` | Yes | — | MongoDB connection string |
| `DB_NAME` | No | `iowa_center_hub` | Database name |
| `JWT_SECRET` | **Production** | Random (dev) | Secret for JWT signing. **Must be set in production.** |
| `CSRF_SECRET` | No | `JWT_SECRET` | CSRF token HMAC secret |
| `GOOGLE_MAPS_API_KEY` | No | — | Enables Google Distance Matrix for accurate drive times |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for job queue and rate limiting |
| `CORS_ORIGINS` | No | Local dev origins | Comma-separated allowed origins. Use `https://www.theiowacenter-hub.org` in production. |
| `SENTRY_DSN` | No | — | Sentry error tracking |
| `ENVIRONMENT` | No | `development` | `production` or `development` |
| `VITE_GOOGLE_MAPS_API_KEY` | No | — | Frontend Google Maps key |
| `EMAIL_FROM` | No | `noreply@iowacenter.org` | Sender address for all outbound email |
| `SMTP_HOST` | No | — | SMTP server. Leave empty to log-only in dev. See Email configuration below. |
| `SMTP_PORT` | No | `587` | SMTP port (STARTTLS) |
| `SMTP_USER` | No | — | SMTP username (`resend` for Resend) |
| `SMTP_PASSWORD` | No | — | SMTP password (Resend API key) |
| `APP_URL` | **Production** | Dev server URL | Public base URL used in emailed magic links. Use `https://www.theiowacenter-hub.org` in production. |

## Email configuration (Resend)

The app sends email for task reminders, partner-portal magic links, user invitations, registration/approval notifications, and password resets. It talks to any SMTP provider via `aiosmtplib`; **Resend** is the recommended default because of its generous free tier (100 emails/day, 3,000/month) and simple API-key-as-password setup.

### 1. Create a Resend account and verify your domain

1. Sign up at [resend.com](https://resend.com).
2. In the dashboard, go to **Domains** → **Add Domain** and enter your sending domain (e.g. `iowacenter.org`).
3. Resend shows a set of DNS records (SPF TXT + DKIM CNAMEs). Add them to your DNS provider and wait for Resend to mark the domain as **Verified**.
4. Go to **API Keys** → **Create API Key** (Full Access). Copy the key — it's shown only once and starts with `re_`.

### 2. Fill in `backend/.env`

```
EMAIL_FROM=noreply@iowacenter.org     # must be on the verified domain
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend                      # literal string "resend"
SMTP_PASSWORD=re_xxxxxxxxxxxxxxxxxxxx # the API key you copied
CORS_ORIGINS=https://www.theiowacenter-hub.org
APP_URL=https://www.theiowacenter-hub.org # public base URL for magic links
```

Restart the backend and worker after changing these. On Railway, set
`APP_URL` and `CORS_ORIGINS` on every service that can generate email
links, including both the web and worker services:

```bash
docker-compose restart backend worker
```

For Railway custom domains, `www.theiowacenter-hub.org` must stay attached
to the web service because that is the working public app domain. If the
apex domain `theiowacenter-hub.org` still returns Railway's fallback
response, do not use it in `APP_URL`; partner portal links will fail before
the app can serve `/portal/:token`.

### 3. Verify it works

Trigger any email-producing flow — e.g. invite a partner contact from the Partner Profile page — and check:

- Backend logs for `Email sent to …: <subject>`
- The **Emails** activity log in the Resend dashboard for the delivery

### Dev mode behaviour

- When `SMTP_HOST` is empty or `localhost`, `send_email` logs `Email (dev mode): …` instead of opening an SMTP connection. Useful for local dev with no provider.
- When `ENVIRONMENT=production` *and* `SMTP_HOST` is unset, `send_email` logs a **warning** on every call — silent drops in prod are exactly how incidents happen, so we surface them.

### Using another SMTP provider

Resend isn't special — the code only uses plain SMTP. To switch, change the four `SMTP_*` values in `backend/.env`. Common alternatives: SendGrid (`smtp.sendgrid.net`, user `apikey`), AWS SES (`email-smtp.<region>.amazonaws.com` + IAM SMTP credentials), Mailgun (`smtp.mailgun.org`), Gmail (`smtp.gmail.com` + app password, 500/day cap).

## API Overview

All endpoints are under `/api/v1`. Interactive docs at `/docs` (Swagger UI) and `/redoc`.

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/auth` | Register, login, logout, invitations |
| Schedules | `/schedules` | CRUD, bulk ops, import/export, conflicts |
| Locations | `/locations` | Location CRUD, drive time lookups |
| Employees | `/employees` | Employee CRUD, stats |
| Classes | `/classes` | Class type CRUD, stats |
| Users | `/users` | Admin user management |
| Reports | `/dashboard`, `/reports`, `/workload` | Stats and summaries |
| Analytics | `/analytics` | Trends, forecast, drive optimization |
| System | `/system`, `/activity-logs`, `/notifications` | Config and logs |
| Health | `/health` | Liveness check (MongoDB + Redis status) |

## Deployment

The app is configured for **Railway** with a multi-stage Docker build:

1. Stage 1: Builds the React frontend with Vite
2. Stage 2: Serves the FastAPI backend with the built frontend as static files

```bash
# Production build
docker build -t iowa-center .
docker run -p 8080:8080 \
  -e MONGO_URL=mongodb://... \
  -e JWT_SECRET=... \
  iowa-center
```

The repo also keeps a `Procfile` for Heroku-style buildpack platforms
(legacy / fallback). Railway uses `Dockerfile` per `railway.json`; the
Procfile mirrors the same uvicorn flags so a buildpack deploy preserves
the graceful-shutdown behaviour. If you only ever deploy via Docker,
the Procfile is harmless and can be ignored.

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/migrations.md`](docs/migrations.md) | Auto-applying schema migration runner — operator notes, idempotency contract, how to add a new migration. |
| [`docs/repository-pattern.md`](docs/repository-pattern.md) | `SoftDeleteRepository` migration recipe for converting routers off raw `{"deleted_at": None}` queries. |
| [`docs/tech-debt-followups.md`](docs/tech-debt-followups.md) | Tracker for the remaining items from the April 2026 tech-debt remediation. |
| [`docs/OUTLOOK_SETUP.md`](docs/OUTLOOK_SETUP.md) | Outlook calendar OAuth setup. |
| [`docs/archive/`](docs/archive/) | Archived ad-hoc audits and historical reviews. Kept for context only — see the live docs above for current state. |


## Contributor Status (April 2026 refactor)

Use this section as the quick status board before starting implementation work.

### Completed phases

The April 2026 remediation shipped in five phases:

- **Phase 1** — CSV upload DoS guardrails, 401 redirect debounce fixes, password-change cache invalidation wiring, Redis lifespan cleanup, test cleanup, archive hygiene.
- **Phase 2** — shared backend pagination utilities, removal of deprecated `travel_override_minutes`, migration runner, and `/api/*` legacy deprecation/sunset headers.
- **Phase 3a** — `SoftDeleteRepository` introduced and adopted in `locations`/`classes`; schedule CRUD helper extraction.
- **Phase 3b** — partner portal router split from a monolith into the `backend/routers/portal/` package.
- **Phase 4a/4b** — typed API/frontend model layer improvements, Vite env typing, calendar layout helper extraction + tests.
- **Phase 5** — baseline contributor docs and tooling (`docs/migrations.md`, `docs/repository-pattern.md`, pre-commit, follow-up tracker).

For detailed provenance, see `docs/tech-debt-followups.md`.

### Active deferred areas (still open)

From `docs/tech-debt-followups.md`, these are intentionally deferred and still active:

- Migrate the remaining routers to `SoftDeleteRepository`.
- Enable `tsc --noEmit` in CI once strict-mode TypeScript debt is reduced.
- Decompose oversized frontend components (`UserManager`, `LocationManager`).
- Add list virtualization for large rendered tables/lists.
- Tighten schedule form payload typing and API signatures.
- Hard-remove legacy `/api/` mount after production hit count reaches zero.
- Hard-remove in-process password-change cache approach for multi-worker deployments.

### Where to extend safely

Prefer these extension points to keep implementation consistent:

- **Repository/data-access work**: use `backend/core/repository.py::SoftDeleteRepository` and the migration recipe in `docs/repository-pattern.md` rather than reintroducing inline `{"deleted_at": None}` filters.
- **Portal features**: follow the `backend/routers/portal/` package split conventions (feature-specific module boundaries, shared helpers) instead of growing a single large router file.
- **Pagination and list endpoints**: use shared utilities in `backend/core/pagination.py` to keep response shape and validation behavior uniform.
- **Schema changes**: implement DB changes via the migration runner documented in `docs/migrations.md`.

### Do not reintroduce

- Direct use of deprecated `travel_override_minutes` fields.
- New code paths that depend on the legacy `/api/*` mount.
- New raw soft-delete filters when a repository abstraction exists.
- Re-growth of partner portal into one monolithic router file.

### Consistency cross-links

- Repository pattern guide: [`docs/repository-pattern.md`](docs/repository-pattern.md)
- Migration runner guide: [`docs/migrations.md`](docs/migrations.md)
- Tech debt tracker: [`docs/tech-debt-followups.md`](docs/tech-debt-followups.md)
- Architecture/context reviews: [`docs/archive/UX_ARCHITECTURE_REVIEW.md`](docs/archive/UX_ARCHITECTURE_REVIEW.md), [`docs/archive/PARTNER_PORTAL_CROSS_FUNCTIONAL_ANALYSIS_2026-04-29.md`](docs/archive/PARTNER_PORTAL_CROSS_FUNCTIONAL_ANALYSIS_2026-04-29.md)

## License

Private — Iowa Center internal use.
