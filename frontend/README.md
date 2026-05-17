# HubSpoke Frontend

React 19 + TypeScript + Vite 7 frontend for the HubSpoke scheduling and
partner-coordination platform.

## Stack

- **React 19** with TypeScript 5.5.
- **Vite 7** for dev server and production builds.
- **Tailwind CSS 3** plus shared UI primitives in `src/components/ui`.
- **Radix UI / shadcn-style primitives** for accessible base interactions.
- **SWR** for cached reads and retry behavior.
- **React Hook Form + Zod** for form handling where adopted.
- **React Router 7** for URL routing.
- **Jest + Testing Library** for component/unit tests.
- **Playwright + axe-core** for browser/e2e accessibility checks.
- **Recharts**, **@dnd-kit**, **TipTap**, and map/Sentry/PostHog integrations
  where feature surfaces require them.

## Scripts

Run from `frontend/`:

| Script | Purpose |
|---|---|
| `npm start` | Starts the Vite dev server at `http://localhost:5173`. |
| `npm run build` | Builds the production bundle to `dist/`. |
| `npm run preview` | Serves the built bundle locally. |
| `npm test` | Runs Jest with `--passWithNoTests`. |
| `npm run test:e2e` | Runs Playwright specs under `tests/e2e/`. |
| `npm run check-testids` | Runs the local test-id guard script. |
| `npm run lint` | Runs ESLint over `src`. |
| `npm run lint:fix` | Runs ESLint with autofix. |
| `npm run typecheck` | Runs `tsc --noEmit`; currently known-red repo-wide and non-blocking in CI. |

## Project Structure

```text
src/
  App.tsx                     # Route registration and route boundaries
  index.tsx                   # Sentry, analytics consent, stale-chunk recovery, React mount
  components/
    portal/                   # Partner portal dashboard, project detail, task detail, notifications
    coordination/             # Internal partner/project/task coordination UI
    analytics/                # Reporting/analytics tabs
    ui/                       # Shared primitives
  hooks/                      # Data and interaction hooks
  lib/
    api.ts                    # Axios base client, CSRF, refresh-token, portal 401 rules
    coordination-api.ts       # Coordination and portal API wrappers
    consent.ts                # Analytics consent and PostHog lifecycle
    date-format.ts            # Calendar/date-only display helpers
    error-messages.ts         # Human-facing API error mapping
  pages/                      # Top-level pages such as login/privacy/dashboard
  tests/e2e/                  # Playwright specs
```

## API + Auth Notes

- Internal app requests use `src/lib/api.ts`, which handles CSRF and
  refresh-token retry behavior.
- Partner portal requests are bearer-token based and must not fall through to
  the internal cookie-refresh/login redirect path.
- `src/lib/coordination-api.ts` owns portal blob download/preview helpers for
  documents and task attachments.
- Portal dashboard and project detail surfaces should show explicit loading,
  error, retry, and empty states instead of converting failures into empty
  lists.

## Environment Variables

Only `VITE_*` variables are exposed to browser code:

- `VITE_BACKEND_URL` - backend API URL; leave empty for same-origin deploys.
- `VITE_GOOGLE_MAPS_API_KEY` - browser Maps key.
- `VITE_SENTRY_DSN` - frontend Sentry DSN.
- `VITE_POSTHOG_KEY` - PostHog key; analytics stays disabled without consent.
- `VITE_POSTHOG_HOST` - PostHog host, defaulting to `https://us.i.posthog.com`.

Legacy `REACT_APP_*` fallbacks exist in a few integration paths, but new code
should use `VITE_*`.

## Maintainer Checks

- Focused portal UI tests:

  ```bash
  npm test -- --runInBand PortalDashboard PortalTaskDetailModal PortalProjectDetail
  ```

- Full frontend Jest suite:

  ```bash
  npm test
  ```

- Browser/e2e accessibility checks:

  ```bash
  npm run test:e2e
  ```

- TypeScript baseline:

  ```bash
  npm run typecheck
  ```

  This is intentionally non-blocking in CI until the legacy strict-mode debt is
  paid down; do not claim a green typecheck unless the command actually passes.
