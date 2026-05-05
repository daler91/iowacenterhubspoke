import { useMemo, useState } from 'react';
import { useProgressiveLoading } from '../../hooks/useProgressiveLoading';

type VirtualizedWrapperProps<T> = {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  ariaLabel?: string;
  role?: string;
  announceRange?: boolean;
  className?: string;
  initialBatchSize?: number;
  batchSize?: number;
  loadThreshold?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export function VirtualizedWrapper<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  ariaLabel,
  role = 'list',
  announceRange = true,
  className,
  initialBatchSize = 60,
  batchSize = 60,
  loadThreshold = 0.7,
  renderItem,
}: Readonly<VirtualizedWrapperProps<T>>) {
  const [scrollTop, setScrollTop] = useState(0);
  const { loadedCount, onViewportProgress } = useProgressiveLoading({
    totalCount: items.length,
    initialBatchSize,
    batchSize,
    loadThreshold,
  });

  const progressiveItems = useMemo(() => items.slice(0, loadedCount), [items, loadedCount]);
  const totalHeight = progressiveItems.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const endIndex = Math.min(progressiveItems.length, startIndex + visibleCount);
  const visibleItems = useMemo(() => progressiveItems.slice(startIndex, endIndex), [progressiveItems, startIndex, endIndex]);

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
        onScroll={(e) => {
          const nextScrollTop = e.currentTarget.scrollTop;
          setScrollTop(nextScrollTop);
          const denominator = Math.max(1, totalHeight - height);
          onViewportProgress(Math.min(1, nextScrollTop / denominator));
        }}
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
