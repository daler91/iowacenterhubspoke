import { useState, useCallback, useMemo } from 'react';

export default function useSelectionMode() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleItem = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;

  return useMemo(() => ({
    selectionMode,
    selectedIds,
    selectedCount,
    toggleSelectionMode,
    toggleItem,
    selectAll,
    deselectAll,
    isSelected,
    clearSelection,
  }), [selectionMode, selectedIds, selectedCount, toggleSelectionMode, toggleItem, selectAll, deselectAll, isSelected, clearSelection]);
}
