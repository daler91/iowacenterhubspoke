# Partner Portal Permission Matrix

This matrix is the implementation-aligned source of truth for partner portal permissions.

## Scope Rules

- Portal access is magic-link scoped to a **single `partner_org_id`** via portal token auth.
- Portal routes only return data for projects owned by that partner org.
- Partner-visible tasks are tasks with `owner in ["partner", "both"]`.

## Task Visibility / Mutation

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View project tasks | Yes | Only for projects in caller org and tasks with owner `partner` or `both`. |
| Toggle complete/incomplete | Yes | Via `PATCH /portal/projects/{project_id}/tasks/{task_id}` with `completed` payload. |
| Change task status | Yes | Allowed statuses: `to_do`, `in_progress`, `completed`, `on_hold`. |
| Change task phase | Yes | Allowed phases: `planning`, `promotion`, `delivery`, `follow_up`. |
| Change due date | Yes | Must be ISO-8601; server normalizes to UTC ISO string before persistence. |
| Edit internal-only task flags | No | `spotlight`, `at_risk`, private/internal notes are internal-only fields. |
| View task details | Yes | Includes attachments/comments for allowed task/project scope. |

## Attachments (Task)

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View/download attachment | Yes | Task/project scope checks apply. |
| Preview attachment | Yes | Uses inline download endpoint variant. |
| Upload attachment | Yes, conditional | UI allows upload when task owner is `partner` or `both`. |
| Delete attachment | No (portal) | Not exposed in partner portal API. |

## Comments / Messages

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| Add task comment | Yes | Mentions are processed and notification prefs respected. |
| View task comments | Yes | Scoped to allowed project/task. |
| View project message thread | Yes | Messages with `visibility != internal`. |
| Send project message | Yes | Partner sender type; visibility is shared. |

## Documents (Project + Org)

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View/download project docs | Yes | Must belong to scoped project. |
| Preview project docs | Yes | Inline variant supported for preview flows. |
| Upload project docs | Yes | Scoped to partner-owned project. |
| View org-level shared docs | Yes | Must belong to scoped partner org and shared visibility. |

## Notifications / Settings

| Capability | Allowed? | Constraints / Notes |
|---|---|---|
| View inbox notifications | Yes | Token-scoped principal only. |
| Mark read / dismiss | Yes | Token-scoped principal only. |
| Edit own notification prefs | Yes | Portal principal only; no org-wide preference editing. |

## Implementation References

- Task scope checks and update validation: `backend/routers/portal/tasks.py`
- Project/document scope checks: `backend/routers/portal/documents.py`
- Message visibility and send semantics: `backend/routers/portal/messages.py`
- Dashboard/project task scoping: `backend/routers/portal/dashboard.py`
- Portal UI upload gate (`owner === partner || both`): `frontend/src/components/portal/PortalTaskDetailModal.tsx`
