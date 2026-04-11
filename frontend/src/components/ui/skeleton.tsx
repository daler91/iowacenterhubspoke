import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
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
 */

interface SkeletonVariantProps {
  readonly rows?: number;
  readonly className?: string;
}

/** Stack of row skeletons — good default for list views (managers). */
function SkeletonList({ rows = 6, className }: SkeletonVariantProps) {
  return (
    <div className={cn("space-y-3", className)} data-testid="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={`skeleton-row-${i}`}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 flex items-center gap-4"
        >
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** Grid of card skeletons — good for dashboards. */
function SkeletonCards({ rows = 4, className }: SkeletonVariantProps) {
  return (
    <div
      className={cn(
        "grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      data-testid="skeleton-cards"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={`skeleton-card-${i}`}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 space-y-3"
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
  return (
    <div className={cn("space-y-2", className)} data-testid="skeleton-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={`skeleton-r-${i}`} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Chart skeleton — good for analytics/report views. */
function SkeletonChart({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 space-y-4",
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
