# Partner Portal Permission Matrix

This matrix is the implementation-aligned source of truth for partner portal
permissions.

## Scope Rules

- Portal requests use bearer-token magic-link auth.
- New portal tokens are stored as HMAC digests (`token_digest`) using
  `TOKEN_DIGEST_SECRET` when present, otherwise `JWT_SECRET`; legacy raw-token
  lookup remains only for short-lived transition rows.
- A portal token resolves to one partner contact and one `partner_org_id`.
- Portal routes only return data for projects owned by that partner org.
- Partner-visible tasks are tasks whose `owner` is `partner` or `both`.
- Child task resources must pass the same project/org/task visibility checks as
  the parent task.

## Task Visibility / Mutation

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View project tasks | Yes | Only for projects in caller org and tasks with owner `partner` or `both`. |
| Bulk load project tasks | Yes | Project ids are auth-clamped server-side and grouped by `project_id`. |
| View task details | Yes | The requested task itself must be partner-visible before child data is returned. |
| Toggle complete/incomplete | Yes | Via `PATCH /portal/projects/{project_id}/tasks/{task_id}` with `completed` payload. |
| Change task status | Yes | Allowed statuses: `to_do`, `in_progress`, `completed`, `on_hold`. |
| Change task phase | Yes | Allowed phases: `planning`, `promotion`, `delivery`, `follow_up`. |
| Change due date | Yes | Must be ISO-8601; server normalizes to UTC ISO string before persistence. |
| Edit internal-only task flags | No | `spotlight`, `at_risk`, private/internal notes are internal-only fields. |

## Attachments (Task)

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| List attachments | Yes | Parent task must be partner-visible; attachment query is scoped by `task_id` and `project_id`. |
| Download attachment | Yes | `GET /portal/projects/{project_id}/tasks/{task_id}/attachments/{att_id}/download`; project/org/task scope checks apply. |
| Preview attachment | Yes | Same route with `inline=true`; frontend fetches the blob with bearer auth. |
| Upload attachment | Yes, conditional | UI allows upload when task owner is `partner` or `both`; backend stores under `UPLOAD_DIR`. |
| Delete attachment | No (portal) | Not exposed in partner portal API. |

Downloads serve sanitized basename paths from `UPLOAD_DIR`; arbitrary stored
paths must not be trusted.

## Comments / Messages

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View task comments | Yes | Parent task must be partner-visible; comment query is scoped by `task_id` and `project_id`. |
| Add task comment | Yes | Mentions are processed and notification preferences are respected. |
| View project message thread | Yes | Project must belong to caller org; messages with internal-only visibility are excluded. |
| Send project message | Yes | Sender type is partner; visibility is shared. |

## Documents (Project + Org)

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View/download project docs | Yes | Document must belong to the scoped project, be `visibility: shared`, and have `deleted_at: None`. |
| Preview project docs | Yes | Inline variant is supported for preview flows. |
| Upload project docs | Yes | Scoped to a partner-owned project. |
| View org-level shared docs | Yes | Must belong to the scoped partner org and shared visibility. |

## Notifications / Settings

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View inbox notifications | Yes | Token-scoped principal only. |
| Mark read / dismiss | Yes | Token-scoped principal only. |
| Edit own notification prefs | Yes | Portal principal only; no org-wide preference editing. |

## Frontend UX Contract

- Dashboard and project detail tabs must distinguish loading, error, retry, and
  true-empty states for tasks, documents, and messages.
- Task detail load failures must stop the spinner and show an inline retry.
- Rapid actions should be guarded while pending: task status/toggle/move,
  message send, uploads, previews, and downloads.
- Icon-only portal buttons must expose accessible names.

## Implementation References

- Token validation and digest lookup: `backend/core/portal_auth.py`,
  `backend/core/token_digest.py`
- Task scope checks and update validation: `backend/routers/portal/tasks.py`
- Project/document scope checks: `backend/routers/portal/documents.py`
- Message visibility and send semantics: `backend/routers/portal/messages.py`
- Dashboard/project task scoping: `backend/routers/portal/dashboard.py`
- Portal UI: `frontend/src/components/portal/PortalDashboard.tsx`,
  `PortalProjectDetail.tsx`, `PortalTaskDetailModal.tsx`
