# Virtualization wrapper usage

Use `VirtualizedWrapper` (`src/components/ui/virtualized-wrapper.tsx`) for long
row/card collections to avoid rendering entire datasets at once.

- Set `itemHeight` to a stable row height.
- Set `height` to the viewport window.
- Pass semantic `role`/`ariaLabel` for accessibility.
- Keep keyboard-focusable controls inside each rendered row; virtualization preserves tab order for visible rows.

Applied in:
- `ActivityFeed.tsx`
- `WeeklyReport.tsx`
- `UserManager.tsx` (pending approvals section)

Highest-value remaining candidates, none virtualized yet:
`portal/PortalDashboard.tsx`, `coordination/ProjectBoard.tsx`, `KanbanBoard.tsx`.

> This file used to tell readers to use `VirtualizedList`, a near-duplicate
> component that nothing imported. It has been deleted; `VirtualizedWrapper` is
> the only wrapper.
