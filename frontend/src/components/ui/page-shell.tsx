import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, type BreadcrumbSegment } from './page-header';
import {
  SkeletonList,
  SkeletonCards,
  SkeletonRows,
  SkeletonChart,
} from './skeleton';
import { Button } from './button';

type LoadingVariant = 'list' | 'cards' | 'rows' | 'chart';

type PageShellStatus =
  | { kind: 'ready' }
  | { kind: 'loading'; variant?: LoadingVariant }
  | {
      kind: 'empty';
      title?: string;
      description?: string;
      action?: ReactNode;
      icon?: ReactNode;
    }
  | {
      kind: 'error';
      error?: Error | { message?: string } | null;
      onRetry?: () => void;
    };

interface PageShellProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly breadcrumbs?: BreadcrumbSegment[];
  readonly actions?: ReactNode;
  readonly status?: PageShellStatus;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly testId?: string;
}

/**
 * Canonical page wrapper. Every top-level route should render through this
 * so page spacing, headers, breadcrumbs, and load/empty/error states stay
 * consistent across the app.
 *
 * Prefer passing `status` over hand-rolling spinners or empty states in the
 * feature component. The goal is that a page body only renders the "ready"
 * content and lets PageShell own every other state.
 */
export function PageShell({
  title,
  subtitle,
  breadcrumbs,
  actions,
  status = { kind: 'ready' },
  className,
  children,
  testId,
}: PageShellProps) {
  return (
    <div
      className={cn('space-y-6 animate-slide-in', className)}
      data-testid={testId}
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        breadcrumbs={breadcrumbs}
        actions={actions}
      />
      <PageShellBody status={status}>{children}</PageShellBody>
    </div>
  );
}

function PageShellBody({
  status,
  children,
}: {
  readonly status: PageShellStatus;
  readonly children?: ReactNode;
}) {
  if (status.kind === 'loading') {
    return <PageShellLoading variant={status.variant ?? 'list'} />;
  }
  if (status.kind === 'empty') {
    return <PageShellEmpty {...status} />;
  }
  if (status.kind === 'error') {
    return <PageShellError {...status} />;
  }
  return <>{children}</>;
}

function PageShellLoading({ variant }: { readonly variant: LoadingVariant }) {
  switch (variant) {
    case 'cards':
      return <SkeletonCards />;
    case 'rows':
      return <SkeletonRows />;
    case 'chart':
      return <SkeletonChart />;
    case 'list':
    default:
      return <SkeletonList />;
  }
}

function PageShellEmpty({
  title,
  description,
  action,
  icon,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}) {
  return (
    <div
      className="text-center py-16 px-4 bg-white dark:bg-card rounded-lg border border-border"
      data-testid="page-shell-empty"
    >
      <div className="text-muted-foreground flex justify-center mb-4">
        {icon ?? <Inbox className="w-12 h-12" aria-hidden="true" />}
      </div>
      <p className="font-medium text-foreground">
        {title ?? 'Nothing here yet'}
      </p>
      {description && (
        <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1 max-w-md mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

function PageShellError({
  error,
  onRetry,
}: {
  readonly error?: Error | { message?: string } | null;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      className="p-6 border border-danger/30 bg-danger-soft rounded-lg"
      data-testid="page-shell-error"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="w-5 h-5 text-danger-strong shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">
            Something went wrong loading this page.
          </h2>
          <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1">
            {error?.message || 'An unexpected error occurred.'}
          </p>
          {onRetry && (
            <Button
              onClick={onRetry}
              variant="outline"
              size="sm"
              className="mt-4"
              data-testid="page-shell-retry"
            >
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { PageShellProps, PageShellStatus, LoadingVariant };
