/**
 * Pure layout helpers shared by CalendarWeek and CalendarDay.
 *
 * These used to be duplicated verbatim between both components (the only
 * difference was the pixel-per-hour constant — 60 for day view, 40 for
 * week view in ``CALENDAR.PX_PER_HOUR_*``). Extracting them here lets
 * both components share the same overlap-layout algorithm and gives us
 * a testable surface for the algorithm that previously had zero coverage.
 */

import { CALENDAR } from '../../lib/constants';

const START_HOUR = CALENDAR.START_HOUR;
const SNAP_MINUTES = CALENDAR.SNAP_MINUTES;

export interface OverlapInfo {
  column: number;
  totalColumns: number;
}

interface TimedItem {
  id: string;
  start_time: string;
  end_time: string;
}

/** Convert a calendar hour (0-23) into a 12-hour label with AM/PM suffix. */
export function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Parse "HH:MM" into minutes since midnight. */
export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Invert ``timeToMinutes`` — zero-pad hours and minutes. */
export function minutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Build minutes-to-top and snap-y-to-minutes helpers bound to a specific
 * pixel-per-hour scale. ``CalendarWeek`` uses ``PX_PER_HOUR_WEEK`` and
 * ``CalendarDay`` uses ``PX_PER_HOUR_DAY``; both call this factory once at
 * module scope.
 */
export function createScaleHelpers(pxPerHour: number) {
  const minutesToTop = (minutes: number): number =>
    ((minutes - START_HOUR * 60) / 60) * pxPerHour;

  const snapYToMinutes = (y: number): number => {
    const rawMinutes = (y / pxPerHour) * 60;
    const snappedMinutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.max(0, START_HOUR * 60 + snappedMinutes);
  };

  return { minutesToTop, snapYToMinutes };
}

// ─── Overlap layout algorithm ───────────────────────────────────────────

type ColumnSlot = { id: string; endMin: number };

/**
 * First pass — pack items into the minimum number of columns such that no
 * column contains two overlapping intervals. Returns each item's column
 * index along with the column list itself (needed by ``countOverlapping``).
 */
function assignColumns(sorted: TimedItem[]): {
  columns: ColumnSlot[][];
  assignment: Record<string, number>;
} {
  const columns: ColumnSlot[][] = [];
  const assignment: Record<string, number> = {};

  for (const s of sorted) {
    const startMin = timeToMinutes(s.start_time);
    const col = columns.findIndex(c => (c.at(-1)?.endMin ?? Infinity) <= startMin);
    if (col >= 0) {
      columns[col].push({ id: s.id, endMin: timeToMinutes(s.end_time) });
      assignment[s.id] = col;
    } else {
      columns.push([{ id: s.id, endMin: timeToMinutes(s.end_time) }]);
      assignment[s.id] = columns.length - 1;
    }
  }
  return { columns, assignment };
}

/**
 * Second pass — for a given time window, count how many columns hold items
 * that overlap it. Used to compute the ``totalColumns`` each rendered block
 * should divide the day width by.
 */
function countOverlapping(
  columns: ColumnSlot[][],
  sStart: number,
  sEnd: number,
  sorted: TimedItem[],
): number {
  let count = 0;
  for (const col of columns) {
    const hasOverlap = col.some(item => {
      const match = sorted.find(x => x.id === item.id);
      if (!match) return false;
      const iStart = timeToMinutes(match.start_time);
      return iStart < sEnd && item.endMin > sStart;
    });
    if (hasOverlap) count++;
  }
  return count;
}

/**
 * For a list of schedule-like items, return a map of ``id → {column,
 * totalColumns}`` — enough for the component to compute each block's
 * ``left`` / ``width`` style. Single-item input always returns column 0
 * / totalColumns 1.
 */
export function computeOverlapLayout(
  schedules: TimedItem[],
): Record<string, OverlapInfo> {
  if (schedules.length <= 1) {
    const result: Record<string, OverlapInfo> = {};
    for (const s of schedules) result[s.id] = { column: 0, totalColumns: 1 };
    return result;
  }

  const sorted = [...schedules].sort((a, b) => {
    const diff = timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    return diff === 0 ? timeToMinutes(b.end_time) - timeToMinutes(a.end_time) : diff;
  });

  const { columns, assignment } = assignColumns(sorted);
  const result: Record<string, OverlapInfo> = {};

  for (const s of sorted) {
    const sStart = timeToMinutes(s.start_time);
    const sEnd = timeToMinutes(s.end_time);
    const maxOverlap = countOverlapping(columns, sStart, sEnd, sorted);
    result[s.id] = {
      column: assignment[s.id],
      totalColumns: Math.max(maxOverlap, 1),
    };
  }

  return result;
}
