import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb';

interface BreadcrumbSegment {
  label: string;
  path?: string;
}

interface PageBreadcrumbProps {
  readonly segments: BreadcrumbSegment[];
}

export function PageBreadcrumb({ segments }: PageBreadcrumbProps) {
  return (
    <Breadcrumb className="mb-3">
      <BreadcrumbList>
        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          return (
            <BreadcrumbItem key={segment.label}>
              {i > 0 && <BreadcrumbSeparator />}
              {isLast || !segment.path ? (
                <BreadcrumbPage className="text-xs">{segment.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={segment.path} className="text-xs">
                    {segment.label}
                  </Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
