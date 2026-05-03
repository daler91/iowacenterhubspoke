# Virtualization wrapper usage

Use `VirtualizedList` for long row/card collections to avoid rendering entire datasets at once.

- Set `itemHeight` to a stable row height.
- Set `height` to the viewport window.
- Pass semantic `role`/`ariaLabel` for accessibility.
- Keep keyboard-focusable controls inside each rendered row; virtualization preserves tab order for visible rows.

Applied in:
- `ActivityFeed.tsx`
- `WeeklyReport.tsx`
- `UserManager.tsx` (pending approvals section)
