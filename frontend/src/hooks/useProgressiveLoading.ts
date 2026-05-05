import { useEffect, useState } from 'react';

type UseProgressiveLoadingArgs = {
  totalCount: number;
  initialBatchSize?: number;
  batchSize?: number;
  loadThreshold?: number;
};

export function useProgressiveLoading({
  totalCount,
  initialBatchSize = 60,
  batchSize = 60,
  loadThreshold = 0.7,
}: Readonly<UseProgressiveLoadingArgs>) {
  const [loadedCount, setLoadedCount] = useState(Math.min(totalCount, initialBatchSize));

  useEffect(() => {
    setLoadedCount(Math.min(totalCount, initialBatchSize));
  }, [totalCount, initialBatchSize]);

  const onViewportProgress = (progress: number) => {
    if (progress < loadThreshold || loadedCount >= totalCount) return;
    setLoadedCount((prev) => Math.min(totalCount, prev + batchSize));
  };

  return {
    loadedCount,
    onViewportProgress,
  };
}
