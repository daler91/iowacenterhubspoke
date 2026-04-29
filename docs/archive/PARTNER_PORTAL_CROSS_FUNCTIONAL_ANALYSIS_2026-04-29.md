# Partner Portal Analysis (Tech + Product)
_Date: 2026-04-29_

## Executive summary
The Partner Portal is a focused, token-authenticated external surface that already solves core partner jobs-to-be-done (see upcoming classes, complete tasks, share docs, and message staff). The implementation is pragmatic and generally safe, with clear ownership checks, limited visibility for shared artifacts, and usable UX fallbacks for expired links.

However, direct user feedback shows **critical day-to-day usability gaps** in the current experience:
- Tasks are not opening into a full-detail experience for users.
- Tasks are not shown in a Kanban-style workflow view.
- Messaging and `@` notifications are perceived as unreliable.
- The UI does not clearly break work out by project.

Those four issues are now the highest-priority product/engineering focus.

## What is happening now (observed behavior + user feedback)

### 1) Access model: magic-link token + session persistence
- The portal route accepts a URL token (`/portal/:token`) and stores it in `sessionStorage` for continuity during navigation.
- On mount, frontend verifies token via `/portal/auth/verify/:token`, then fetches `/portal/dashboard`.
- Invalid or expired token routes to a recovery flow that requests a fresh link by email.

**Implication:** low-friction access, but session-based token persistence remains exposed to XSS risk in principle (tradeoff accepted for UX simplicity).

### 2) Dashboard and core objects
- Dashboard API returns org/contact identity + summary counters + up to 10 upcoming projects.
- Backend computes open/overdue task counts with parallel count queries to reduce latency impact.

**Implication:** design favors fast first paint for external users; caps are deliberate and keep payloads bounded.

### 3) Tasks: backend capability exists, but UX is not meeting expectation
- Backend exposes both task list and task detail endpoints (`/portal/projects/{project_id}/tasks` and `/portal/projects/{project_id}/tasks/{task_id}`).
- Frontend currently emphasizes an overview list pattern (task name/date/owner/completion), and user feedback indicates the detail path is not surfaced or not obvious enough.
- Bulk loading endpoint (`/portal/projects/tasks/bulk`) improved network scale, but not necessarily task-management ergonomics.

**User-reported impact:** partners cannot reliably open tasks to see all details; workflow feels shallow.

### 4) No Kanban workflow in portal task UI
- Current task interaction appears list-centric.
- There is no board-based visual grouping by status/phase/owner as expected by users.

**User-reported impact:** hard to triage and prioritize quickly.

### 5) Messaging and @mentions trust gap
- Backend includes messaging + mention normalization and notification hooks.
- User feedback indicates messaging and/or `@` notifications “don’t seem to work” in practice.

**User-reported impact:** communication confidence is low; users may move conversation off-platform.

### 6) Project breakout clarity is insufficient
- Data model is project-linked, but UX does not appear to present a strong project-first grouping in all key workflows.

**User-reported impact:** users struggle to isolate workstreams per project.

## Cross-functional assessment

### Product perspective
**Working well**
- Core portal domains exist (tasks/docs/messages).
- Recovery flow for expired links is explicit and non-leaky.
- Undo affordance on task completion reduces accidental permanent changes.

**Top product gaps (based on direct user feedback)**
1. **Task detail discoverability/availability is inadequate.**
2. **No Kanban mode for task operations.**
3. **Messaging and mention reliability is not trusted by users.**
4. **Project breakout is not explicit enough in portal navigation and content layouts.**

### Engineering perspective
**Strengths**
- Ownership checks are consistently enforced (`partner_org_id`, `deleted_at`, visibility filters).
- Bulk task endpoint includes explicit authz clamping and per-project slice protection.
- Async concurrency used where beneficial (task counts).

**Technical risks tied to the reported issues**
1. **Frontend state/view coupling may hide detail endpoints.** The API supports detail, but UX path may be weak.
2. **Notification observability is insufficient.** Without per-message/per-mention event tracing, it’s hard to prove whether failures are in creation, fanout, delivery, or UX display.
3. **Mixed interaction model (overview-heavy, detail-light)** can make system feel incomplete even when APIs exist.
4. **Project grouping needs explicit IA support** (tabs/filters/sections), not only backend relational linkage.

### Operations / Support perspective
- The current UX can generate repeated support tickets around: “Can’t open task details”, “No board view”, and “Mentions not notifying.”
- These are high-friction issues because they affect daily workflow and communication trust.

## Updated priority recommendations

### P0 (next sprint) — fix user trust and core usability
1. **Task detail access fix**
   - Make task rows explicitly clickable and open a detail drawer/modal/page.
   - Ensure every task item has a deterministic path to full description, attachments, comments, and activity.
2. **Project breakout in all primary tabs**
   - Add a persistent project selector/grouping pattern for Tasks, Messages, and Documents.
   - Default to “All projects” + per-project filter.
3. **Messaging/@mention reliability hardening**
   - Add end-to-end instrumentation: message created -> mentions parsed -> notification events queued -> delivered/failed -> recipient unread state updated.
   - Show sender-side confirmation (“Mention notifications sent to X recipients”).
4. **Rapid QA matrix**
   - Validate flows for at least: single-project partner, multi-project partner, no-members edge case, and notification prefs disabled.

### P1 (1–2 sprints) — improve planning UX
1. **Kanban view for tasks**
   - Group by status/phase (To Do / In Progress / Blocked / Done or equivalent).
   - Keep list and Kanban as toggle views.
2. **Message channel/thread model clarity**
   - Replace implicit channel fallback with explicit thread/topic selection.
3. **Consistency pass on pagination/caps**
   - Align tasks/messages/docs contract behavior.

### P2 (quarter) — resilience and scale polish
1. **External reliability SLOs** for portal APIs (p95 latency, error budgets).
2. **Audit trail improvements** for partner actions (who toggled task, who uploaded what, when).
3. **Progressive enhancement for large orgs** (incremental loading, caching strategy, retry UX).

## Suggested KPI dashboard for leadership
- Task detail open rate (% task rows that transition into detail views).
- Kanban adoption rate vs list view.
- Mention delivery success rate (event queued -> recipient visible notification).
- Message failure rate + median retry success time.
- % active orgs using per-project filtering.
- Time-to-first-meaningful portal render.

## Bottom line
The portal has solid backend building blocks, but user feedback indicates that key workflow expectations are not being met at the UX layer right now. The immediate objective should be to restore confidence by shipping **task-detail access, project breakout clarity, and verified messaging/@mention reliability**, then layer in Kanban as the next planning UX upgrade.
