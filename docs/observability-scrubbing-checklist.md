# Observability scrubbing checklist (production)

Use this checklist before production deploys to ensure event payload scrubbing is always active.

## Required configuration

- `SENTRY_DSN` is set only in trusted environments.
- `ENVIRONMENT` is set to a concrete value (e.g. `production`).
- Do **not** set any env var or feature flag that bypasses `before_send` callbacks.
- Validate startup logs show Sentry initialized with `before_send=sentry_before_send`.

## Verification steps

- Trigger a non-prod test exception containing `Authorization`, `token`, `cookie`, and `email` keys.
- Confirm Sentry event payload displays `[REDACTED]` for those fields.
- Confirm `status_code`, `code_version`, and other known safe keys remain intact for debugging.

## Frontend analytics privacy baseline

- Keep analytics consent at `pending` by default.
- Initialize analytics only after explicit `granted` consent.
- Do not enable auto-capture features that collect user-identifying properties by default.
