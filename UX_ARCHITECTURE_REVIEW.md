# UX Architecture Review — Iowa Center Hub & Spoke

> **Reviewer:** UX Architect &nbsp;·&nbsp; **Date:** 2026-04-11 &nbsp;·&nbsp; **Scope:** Current-state review of the React frontend, post-Tier-3 BA/UX work

## Context

The Iowa Center Hub & Spoke is a React 19 + Tailwind + Radix/Shadcn + FastAPI scheduling and partner-coordination platform. A prior BA/UX assessment (`BA_PROCESS_UX_ASSESSMENT.md`) already shipped three tiers of improvements (commits `99d7925`, `eab880e`, `062bae6`), so this review audits the **current** state, not the pre-assessment baseline. Prior BA findings are treated as done and are not restated here.

**Goal:** give the team a single, actionable, architect-level read on what is still weak in the UX — before we pile on more features — and the minimum set of foundation pieces that will stop the drift from widening.

**Method:** three parallel reconnaissance passes (IA/navigation, design system, accessibility/responsive) plus direct reads of the highest-signal files (`Sidebar.tsx`, `ui/button.tsx`, `index.css`, `coordination/PromotionChecklist.tsx`, `design_guidelines.json`), followed by a synthesis pass.

---

## Executive Summary

The product has a capable design system underneath — Inter/Manrope, Radix primitives, HSL tokens that resolve to the Hub Indigo / Spoke Teal / Warning Amber palette — but **enforcement is low**. Three architectural omissions explain most of the friction:

1. **No shared `PageShell` / `PageHeader` primitive.** Every page hand-rolls its own title/subtitle/action header, which cascades into inconsistent breadcrumbs, spacing, loading states, and error handling.
2. **Palette bypass.** 151 occurrences of raw `bg-blue-*/purple-*/red-*` across 40 files drift away from the brand tokens, worst inside the coordination module.
3. **Accessibility gaps on icon-only controls.** Only ~17 `aria-label`/`sr-only` usages across 300+ component files. The Sidebar collapse, mobile hamburger, theme toggle, and logout buttons all ship unlabeled.

Secondary but high-impact: the partner portal (`components/portal/*`) has **no responsive breakpoints at all** — critical because partners live on phones. `Skeleton` exists but has zero consumers. `ErrorBoundary` wraps exactly one Suspense fallback, leaving routes unprotected.

Remediation is high-leverage: **five Tier-A foundation pieces unlock roughly 70% of the downstream polish** and stop new drift from landing.

---

## Findings by Theme

### a. Information Architecture & Navigation — Med

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| a1 | Two kanban boards share the same column labels (Upcoming / In Progress / Completed) for different semantics: delivery status vs. project phase | High | `frontend/src/components/KanbanBoard.tsx`, `frontend/src/components/coordination/ProjectBoard.tsx` |
| a2 | No shared `PageShell`/`PageHeader` — every page hand-rolls title, subtitle, and primary action | **High** | ~15 pages under `frontend/src/components/` and `frontend/src/pages/` |
| a3 | Breadcrumbs land on 5 detail pages only (EmployeeProfile, LocationProfile, ClassProfile, ProjectDetail, PartnerProfile); all top-level managers and dashboards lack them | Med | managers + `InsightsPage.tsx` + `pages/CommunityDashboard.tsx` |
| a4 | `DashboardPage` uses `<Outlet />` with no route-context plumbing (title / actions / status), forcing each page to reimplement the shell | Med | `frontend/src/pages/DashboardPage.tsx:58-104` |
| a5 | Sidebar has 4 sections × 12 items. Labels like "Schedule Tracker" (kanban) vs "Projects" (kanban) remain the highest learnability risk | Med | `frontend/src/components/Sidebar.tsx:13-50` |

### b. Design System Coherence — High

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| b1 | 151 raw `bg-blue-*/text-blue-*/bg-purple-*/text-purple-*/bg-red-*` hits across 40 files bypass the brand token palette | **High** | `coordination/PromotionChecklist.tsx` (lines 129, 141, 158, 161), `coordination/ProjectDetail.tsx`, `coordination/PartnerProfile.tsx`, `coordination/OutcomeTracker.tsx`, `UserManager.tsx`, `PersonalSettings.tsx` |
| b2 | Three radii in the wild: `ui/button.tsx` uses `rounded-md`, `ui/card.tsx` uses `rounded-xl`, guideline target is `rounded-lg` | Med | `frontend/src/components/ui/button.tsx:8`, `frontend/src/components/ui/card.tsx` |
| b3 | ~34 raw `<button>` tags bypass the `Button` primitive — worst offender is the Sidebar itself (nav items, theme, logout, collapse) | **High** | `frontend/src/components/Sidebar.tsx:65,163,177,191,205`, `frontend/src/pages/DashboardPage.tsx:82-90` |
| b4 | Redundant inline `style={{ fontFamily: 'Manrope' }}` on `InsightsPage.tsx:36` despite global wiring in `index.css:73-75` | Low | `frontend/src/components/InsightsPage.tsx:36` |
| b5 | `data-testid` coverage ~65-70% despite guideline saying "ALL interactive elements MUST have data-testid" | Med | codebase-wide |

*Positive:* Typography ✓, Icons (Lucide only) ✓, Toast library (sonner only) ✓, Radix Dialog used correctly ✓.

### c. Accessibility — High

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| c1 | Only ~17 `aria-label`/`sr-only` usages across 300+ `.tsx` files | **High** | codebase-wide |
| c2 | Icon-only buttons unlabeled: sidebar collapse, mobile hamburger, theme toggle, logout, settings, dialog closes | **High** | `Sidebar.tsx:65,163,177,191,205`, `pages/DashboardPage.tsx:82-90` |
| c3 | Schedule form wizard children under `components/schedule-form/*` have inconsistent `<Label htmlFor>` wiring | Med | `frontend/src/components/schedule-form/*.tsx` |
| c4 | Zero `tabindex` results in codebase — custom calendar/kanban cells are likely not focusable from keyboard | Med | `CalendarWeek.tsx`, `CalendarDay.tsx`, `KanbanBoard.tsx`, `coordination/ProjectBoard.tsx` |
| c5 | Drag-and-drop relies on `@dnd-kit` keyboard sensors; no verified keyboard path for moving cards, no visible focus ring on draggables | Med | same as c4 |

### d. Responsive Design — High (portal)

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| d1 | Partner portal has **no** `sm:/md:/lg:` breakpoints, fixed max-width containers. Partners are mobile-first users. | **High** | `frontend/src/components/portal/PortalDashboard.tsx`, `portal/PortalLayout.tsx` |
| d2 | `useMediaQuery` exposes only one breakpoint (768px). No shared Tailwind-aligned breakpoint source. | Low | `frontend/src/hooks/useMediaQuery.ts` |
| d3 | Coordination kanban columns use `overflow-x-auto` — functional but cramped on phones | Med | `KanbanBoard.tsx`, `coordination/ProjectBoard.tsx` |

*Positive:* Mobile sidebar hamburger drawer works (`DashboardPage.tsx:60-78`). `MobileCalendar.tsx` is wired via the `isMobile` flag in `CalendarView.tsx`.

### e. Loading / Empty / Error State Architecture — High

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| e1 | `Skeleton` primitive exists but has **zero consumers** in the codebase | **High** | `frontend/src/components/ui/skeleton.tsx` |
| e2 | Every loading state is a centered spinner; no skeleton layouts anywhere | High | all managers, `DashboardPage.tsx:97-100` |
| e3 | `ErrorBoundary` wraps exactly one Suspense fallback at the shell level — no per-route boundary, so any render error blanks the app | **High** | `frontend/src/components/ErrorBoundary.tsx`, `pages/DashboardPage.tsx:96` |
| e4 | Empty states exist for CalendarView + KanbanBoard columns only; managers and `InsightsPage` have none | Med | managers, `InsightsPage.tsx` |

### f. Component Reuse & Consistency — Med

| # | Finding | Severity | Primary Files |
|---|---|---|---|
| f1 | Dialog-based create/edit forms in Manager pages differ on label wiring, action placement, error display | Med | `ClassManager.tsx`, `EmployeeManager.tsx`, `LocationManager.tsx`, `UserManager.tsx` |
| f2 | No shared "StatusPill" / "RoleBadge" — the Sidebar role badge and multiple per-page status tags re-invent the same thing | Low | `Sidebar.tsx:156`, various |

---

## Prioritized Remediation Roadmap

### Tier A — Foundation (must land first; unblocks the rest)

| # | Deliverable | Target files |
|---|---|---|
| **A1** | Create `PageShell` + `PageHeader` primitives: accept `title`, `subtitle`, `breadcrumbs`, `actions`, and a discriminated `status: 'loading' \| 'empty' \| 'error' \| 'ready'` that renders the right child. | **new:** `components/ui/page-shell.tsx`, `components/ui/page-header.tsx`. Compose existing `components/ui/page-breadcrumb.tsx`. |
| **A2** | Add semantic color tokens in `tailwind.config` mapping to existing HSL vars (`hub`, `spoke`, `warn`, `info`, `progress`, `ownership-internal`, `ownership-partner`). Codemod pass replacing the top 6 offenders' raw `bg-blue-*/purple-*/red-*`. | `frontend/tailwind.config.*`, `frontend/src/index.css`, `coordination/PromotionChecklist.tsx`, `coordination/ProjectDetail.tsx`, `coordination/PartnerProfile.tsx`, `coordination/OutcomeTracker.tsx`, `UserManager.tsx`, `PersonalSettings.tsx` |
| **A3** | Roll out `Skeleton` via `PageShell.loading`. Provide `list`, `card`, `row`, `chart` variants. Replace spinners in all managers + `InsightsPage`. | `components/ui/skeleton.tsx` (reuse), all managers, `InsightsPage.tsx` |
| **A4** | Per-route `ErrorBoundary`: wrap each `<Route element>` in `App.tsx`, add a `resetKey` from `location.pathname` so errors clear on nav. Remove the shell-level wrap. | `frontend/src/App.tsx`, `components/ErrorBoundary.tsx`, `pages/DashboardPage.tsx:96` |
| **A5** | `aria-label` on every icon-only button; add `eslint-plugin-jsx-a11y` with `control-has-associated-label: error` to block regression. | `Sidebar.tsx:65,163,177,191,205`, `pages/DashboardPage.tsx:82-90`, `frontend/.eslintrc*` |

### Tier B — High-value polish

| # | Deliverable | Target files |
|---|---|---|
| **B1** | Differentiate the two kanban boards. Rename `ProjectBoard` columns to project phases (e.g., "Scoping / Active / Delivered / Follow-Up") and apply a distinct accent (teal vs indigo). Cross-link: a project card shows its schedule status, and vice versa. | `components/KanbanBoard.tsx`, `components/coordination/ProjectBoard.tsx` |
| **B2** | Add breadcrumbs to every top-level manager/dashboard through `PageShell.breadcrumbs`. | `ClassManager.tsx`, `EmployeeManager.tsx`, `LocationManager.tsx`, `UserManager.tsx`, `InsightsPage.tsx`, `pages/CommunityDashboard.tsx`, `coordination/ProjectBoard.tsx`, `coordination/PartnerManager.tsx` |
| **B3** | Partner portal responsive overhaul: fluid cards, stacked sections under 768, mobile top-bar with hamburger. | `portal/PortalDashboard.tsx`, `portal/PortalLayout.tsx` |
| **B4** | Schedule form wizard a11y pass: `<Label htmlFor>` on every input, `aria-describedby` for help/conflict text, focus management between wizard steps. | `components/schedule-form/*.tsx`, `components/ScheduleForm.tsx` |
| **B5** | Sidebar nav → `Button` primitive (`variant="ghost"`, active state via prop). Also replace theme/logout/collapse. | `components/Sidebar.tsx` |

### Tier C — Hygiene / lower risk

| # | Deliverable | Target files |
|---|---|---|
| **C1** | Normalize radii: adopt `rounded-lg` as standard; update `button.tsx` and `card.tsx` | `components/ui/button.tsx:8`, `components/ui/card.tsx` |
| **C2** | `data-testid` coverage audit — add a lint rule for interactive elements | new lint rule |
| **C3** | `tabIndex={0}` + visible focus ring on draggable calendar/kanban cells; verify `@dnd-kit` `KeyboardSensor` is attached | `CalendarWeek.tsx`, `CalendarDay.tsx`, `KanbanBoard.tsx`, `coordination/ProjectBoard.tsx` |
| **C4** | Full keyboard + axe-core audit per route | all routes |
| **C5** | Remove redundant inline `style={{ fontFamily }}` | `InsightsPage.tsx:36` |
| **C6** | Extend `useMediaQuery` to expose Tailwind breakpoints (sm/md/lg/xl) from one shared source | `hooks/useMediaQuery.ts` |

---

## Reusable Existing Assets

| Asset | Path | Where it's under-used |
|---|---|---|
| `PageBreadcrumb` | `frontend/src/components/ui/page-breadcrumb.tsx` | A1, B2 — compose into `PageShell` |
| `Breadcrumb` primitive | `frontend/src/components/ui/breadcrumb.tsx` | underlying A1/B2 |
| `Skeleton` | `frontend/src/components/ui/skeleton.tsx` | A3 (currently zero consumers) |
| `ErrorBoundary` | `frontend/src/components/ErrorBoundary.tsx` | A4 (wrap per route, add reset key) |
| `Button` primitive | `frontend/src/components/ui/button.tsx` | B5 — Sidebar is the biggest violator |
| `Dialog`, `Label`, `Form` (Radix) | `frontend/src/components/ui/*` | B4 |
| `useMediaQuery` | `frontend/src/hooks/useMediaQuery.ts` | C6 |
| HSL theme vars | `frontend/src/index.css:1,69-75` | A2 — add Tailwind semantic tokens on top |
| `cn` util | `frontend/src/lib/utils` | all |

---

## Critical Files to Touch (Tier A top-5)

- `frontend/src/App.tsx` — per-route ErrorBoundary (A4)
- `frontend/src/pages/DashboardPage.tsx` — remove shell error wrap, add mobile-hamburger a11y (A4, A5)
- `frontend/src/components/Sidebar.tsx` — aria-labels on icon-only controls, convert to Button primitive (A5, B5)
- `frontend/src/components/ui/page-shell.tsx` **(new)** — central shell (A1, A3)
- `frontend/tailwind.config.*` + `frontend/src/index.css` — semantic color tokens (A2)

---

## Verification

| Method | What it catches | Target |
|---|---|---|
| Visual audit at 360 / 768 / 1280 / 1600 | PageShell consistency, portal responsive, radii drift | Every route renders the same header pattern |
| `axe-core` run per route (Playwright + `@axe-core/playwright`) | Missing labels, contrast, role violations | 0 critical, 0 serious |
| Keyboard-only walkthrough | Focus traps, drag-and-drop keyboard path, tab order | Every interactive element reachable + visibly focused |
| Chrome DevTools mobile (iPhone 12) on `/portal/:token` | Partner portal fit, kanban scroll | No horizontal body scroll on portal |
| Grep regression checks | Raw color drift (`bg-(blue\|purple)-`), raw `<button>` in feature dirs, icon buttons without aria-label | 0 matches in feature dirs after Tier A |
| Lighthouse Accessibility | Overall a11y regression | ≥ 95 on top 5 routes |
| Manual: create schedule → create project → partner portal flow | End-to-end breakage from refactors | No regressions |

---

## Out of Scope

Not addressed in this review (intentionally):

- Feature-level redesigns of existing managers
- New partner-portal features (threading, task history)
- Backend API shape changes
- The BA process gaps already tracked in `BA_PROCESS_UX_ASSESSMENT.md` Tier 1/2/3

---

## Next Action

On approval, implementation should begin with **Tier A (A1–A5) in order**. Tier A is designed to land as a single PR that touches the shell, tokens, lint rules, and primitives — so every subsequent Tier B/C PR benefits from the new foundation.
