import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

const ROUTE_MAP = {
  employee: 'employees',
  location: 'locations',
  class: 'classes',
};

export function EntityLink({ type, id, children, className }) {
  if (!id) return <span className={className}>{children}</span>;

  const basePath = ROUTE_MAP[type];
  if (!basePath) return <span className={className}>{children}</span>;

  return (
    <Link
      to={`/${basePath}/${id}`}
      className={cn(
        'hover:underline hover:text-indigo-600 transition-colors cursor-pointer',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </Link>
  );
}

