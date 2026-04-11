import { useMemo } from "react"
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-primary/10", className)}
      {...props} />
  );
}

/**
 * Pre-composed skeleton layouts used by PageShell.loading and feature pages.
 *
 * Keep these in sync with the real layouts so the loading state roughly
 * matches what appears when data is ready — that's the whole point of
 * skeletons vs a spinner. If you add a new common layout, add a matching
 * variant here rather than hand-rolling one in a feature file.
 *
 * Implementation note: each variant generates stable UUIDs for its row
 * keys instead of using array indices so `no-array-index-key` lint rules
 * stay happy. The UUIDs are memoized on `rows` so re-renders keep stable
 * keys as long as the count hasn't changed.
 */

interface SkeletonVariantProps {
  readonly rows?: number;
  readonly className?: string;
}

function useStableIds(count: number): string[] {
  return useMemo(
    () => Array.from({ length: count }, () => crypto.randomUUID()),
    [count],
  );
}

/** Stack of row skeletons — good default for list views (managers). */
function SkeletonList({ rows = 6, className }: SkeletonVariantProps) {
  const ids = useStableIds(rows);
  return (
    <div className={cn("space-y-3", className)} data-testid="skeleton-list">
      {ids.map((id) => (
        <div
          key={id}
          className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-4 flex items-center gap-4"
        >
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Grid of card skeletons — good for dashboards. */
function SkeletonCards({ rows = 4, className }: SkeletonVariantProps) {
  const ids = useStableIds(rows);
  return (
    <div
      className={cn(
        "grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      data-testid="skeleton-cards"
    >
      {ids.map((id) => (
        <div
          key={id}
          className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-6 space-y-3"
        >
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Table-row skeletons — good for tables (UserManager etc). */
function SkeletonRows({ rows = 5, className }: SkeletonVariantProps) {
  const ids = useStableIds(rows);
  return (
    <div className={cn("space-y-2", className)} data-testid="skeleton-rows">
      {ids.map((id) => (
        <Skeleton key={id} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Chart skeleton — good for analytics/report views. */
function SkeletonChart({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-6 space-y-4",
        className,
      )}
      data-testid="skeleton-chart"
    >
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-48 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export { Skeleton, SkeletonList, SkeletonCards, SkeletonRows, SkeletonChart }
