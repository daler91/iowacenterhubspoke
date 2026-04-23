import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PageBreadcrumb } from './page-breadcrumb';

interface BreadcrumbSegment {
  label: string;
  path?: string;
}

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly breadcrumbs?: BreadcrumbSegment[];
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * Standard page header. Title + subtitle + optional breadcrumbs + optional
 * actions aligned right. Every top-level route should use this (via
 * PageShell) so spacing, typography, and breadcrumb placement stay
 * consistent.
 *
 * Manrope is applied globally in index.css — do NOT set font-family inline.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', className)} data-testid="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <PageBreadcrumb segments={breadcrumbs} />
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground dark:text-white">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

export type { BreadcrumbSegment, PageHeaderProps };
