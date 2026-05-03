import { useMemo, useState } from 'react';

type VirtualizedListProps<T> = {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  ariaLabel?: string;
  role?: string;
  announceRange?: boolean;
  className?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export default function VirtualizedList<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  ariaLabel,
  role = 'list',
  announceRange = true,
  className,
  renderItem,
}: Readonly<VirtualizedListProps<T>>) {
  const [scrollTop, setScrollTop] = useState(0);
  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const visibleItems = useMemo(() => items.slice(startIndex, endIndex), [items, startIndex, endIndex]);

  return (
    <div>
      {announceRange && (
        <p className="sr-only" aria-live="polite">
          Showing rows {items.length === 0 ? 0 : startIndex + 1} to {endIndex} of {items.length}
        </p>
      )}
      <div
        role={role}
        aria-label={ariaLabel}
        className={className}
        style={{ height, overflowY: 'auto' }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${startIndex * itemHeight}px)` }}>
            {visibleItems.map((item, offset) => renderItem(item, startIndex + offset))}
          </div>
        </div>
      </div>
    </div>
  );
}
