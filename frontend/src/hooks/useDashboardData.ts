import useSWR, { mutate as globalMutate } from 'swr';
import { useState, useCallback } from 'react';
import { locationsAPI, employeesAPI, classesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';
import type { Location, Employee, ClassType, Schedule, DashboardStats, ActivityLog } from '../lib/types';

function extractItems<T>(res: any): T[] {
  const data = res.data?.items ?? res.data;
  const result = Array.isArray(data) ? data : [];
  if (import.meta.env.DEV && result.length === 0 && res.data) {
    // Dev-only diagnostic: surface API responses that look list-shaped
    // but come back as `{}` or similar. Kept out of production builds so
    // we don't leak response shapes (including email addresses) to users'
    // browser consoles.
    console.warn(
      '[extractItems] empty array from response of type',
      typeof res.data,
    );
  }
  return result;
}

const swrOptions = {
  revalidateOnFocus: false,
  // Bumped from 2s to 15s so rapid route changes (Calendar → Kanban → Map)
  // don't re-hit the API; SWR's in-memory cache covers the gap and the data
  // is denormalised server-side anyway.
  dedupingInterval: 15000,
  errorRetryCount: 5,
  revalidateOnReconnect: true,
};

// SWR cache keys for the route-gated endpoints, hoisted to constants so
// the useSWR key, the onError label, and the invalidateGated key all
// read from a single source.
const ACTIVITIES_KEY = 'activities';
const WORKLOAD_KEY = 'workload';

/** Shape of the optional `schedules` date-range filter. Both ends are
 *  inclusive ISO `YYYY-MM-DD` strings (matching the backend contract in
 *  `schedule_crud.py`). `null` or `undefined` means "no window" and
 *  preserves the original unbounded behaviour used by Kanban/Map.
 */
export interface ScheduleWindow {
  dateFrom: string;
  dateTo: string;
}

/** SWR key matcher for any `schedules` cache entry, regardless of the
 *  active window. Used by callers that want to invalidate the schedule
 *  cache without knowing which window is currently active (e.g. a
 *  schedule-save mutation).
 */
export const isSchedulesSwrKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === 'schedules';

export interface UseDashboardDataOptions {
  /** Fetch `/stats` and `/activities` (needed by Insights + Dashboard home). */
  needActivity?: boolean;
  /** Fetch `/workload` (only Insights → Workload tab consumes this). */
  needWorkload?: boolean;
  /** Bound the schedules fetch to a date range. `null`/`undefined` keeps
   *  the old unbounded behaviour — callers that don't pass a window get
   *  identical semantics to before this option existed. */
  scheduleWindow?: ScheduleWindow | null;
}

export function useDashboardData(options: UseDashboardDataOptions = {}) {
  const { needActivity = false, needWorkload = false, scheduleWindow = null } = options;
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  const onError = (key: string) => (err: any) => {
    console.error(`[useDashboardData] Failed to fetch ${key}:`, err?.message || err);
    setFetchErrors(prev => ({ ...prev, [key]: err?.message || 'Failed to load' }));
  };

  // The schedules key is an array so (a) SWR differentiates cache
  // entries per-window and (b) callers elsewhere can invalidate every
  // windowed variant via the `isSchedulesSwrKey` predicate without
  // having to know which window is currently active.
  const schedulesKey: readonly [string, string | null, string | null] = [
    'schedules',
    scheduleWindow?.dateFrom ?? null,
    scheduleWindow?.dateTo ?? null,
  ];
  const fetchSchedulesList = () => {
    const params = scheduleWindow
      ? { date_from: scheduleWindow.dateFrom, date_to: scheduleWindow.dateTo }
      : undefined;
    return schedulesAPI.getAll(params).then(extractItems<Schedule>);
  };

  const { data: locations = [], mutate: mutateLocations } = useSWR<Location[]>('locations', () => locationsAPI.getAll().then(extractItems<Location>), { ...swrOptions, onError: onError('locations') });
  const { data: employees = [], mutate: mutateEmployees } = useSWR<Employee[]>('employees', () => employeesAPI.getAll().then(extractItems<Employee>), { ...swrOptions, onError: onError('employees') });
  const { data: classes = [], mutate: mutateClasses } = useSWR<ClassType[]>('classes', () => classesAPI.getAll().then(extractItems<ClassType>), { ...swrOptions, onError: onError('classes') });
  const { data: schedules = [] } = useSWR<Schedule[]>(schedulesKey, fetchSchedulesList, { ...swrOptions, onError: onError('schedules') });

  // `fetchSchedules` is handed to every page via the outlet context and
  // used by calendar-side writes (relocate, bulk actions, schedule-form
  // save) to invalidate the schedules cache. Because the SWR key is
  // windowed, `mutateSchedules` only refreshes the *currently active*
  // window — so a calendar edit would leave Kanban/Map (which use the
  // unbounded `['schedules', null, null]` cache) stale until their next
  // mount. Routing every invalidation through the predicate mutate
  // covers every window uniformly. The predicate form accepts the same
  // `data` (value or updater) and `opts` (revalidate flag) args as the
  // keyed form, so existing optimistic-update call sites keep working.
  const fetchSchedules = useCallback(
    (optimisticData?: unknown, options?: { revalidate?: boolean }) =>
      globalMutate(isSchedulesSwrKey, optimisticData as any, options),
    []
  );
  // `stats` drives the sidebar counters on every route, so keep it unconditional.
  const { data: stats = { total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 }, mutate: mutateStats } = useSWR<DashboardStats>('stats', () => dashboardAPI.getStats().then(res => res.data.data || res.data), { ...swrOptions, onError: onError('stats') });
  // `activities` + `workload` are route-gated: passing `null` as the SWR key
  // skips the fetch entirely until the route opts in. Cached data is
  // preserved across toggles by SWR's global cache.
  const { data: activities = [], mutate: mutateActivities } = useSWR<ActivityLog[]>(needActivity ? ACTIVITIES_KEY : null, () => activityAPI.getAll(50).then(extractItems<ActivityLog>), { ...swrOptions, onError: onError(ACTIVITIES_KEY) });
  const { data: workloadData = [], mutate: mutateWorkload } = useSWR<Record<string, unknown>[]>(needWorkload ? WORKLOAD_KEY : null, () => workloadAPI.getAll().then(extractItems<Record<string, unknown>>), { ...swrOptions, onError: onError(WORKLOAD_KEY) });

  // Invalidate a route-gated cache without forcing an immediate refetch.
  // When the tab that consumes the cache isn't mounted (flag is false),
  // we still want to drop the stale value so the next visit sees fresh
  // data — but we don't pay for the refetch right now.
  const invalidateGated = useCallback(async (key: string, isActive: boolean, mutateFn: () => Promise<unknown>) => {
    if (isActive) {
      await mutateFn();
    } else {
      await globalMutate(key, undefined, { revalidate: false });
    }
  }, []);

  const handleClassRefresh = useCallback(() => {
    // Class edits and deletes denormalize class_name/class_color/class_id
    // onto every matching schedule (via sync_class_snapshot_background on
    // update, and a direct db.schedules.update_many on delete). Workload
    // aggregations read those same fields. The classes/schedules/stats
    // caches back the sidebar counters and are always consumed, so they
    // always revalidate. `activities` and `workload` are route-gated —
    // only refetch them if the consuming tab is actually mounted, else
    // just invalidate so the next visit sees fresh data.
    mutateClasses();
    fetchSchedules();
    mutateStats();
    invalidateGated('activities', needActivity, mutateActivities);
    invalidateGated('workload', needWorkload, mutateWorkload);
  }, [mutateClasses, fetchSchedules, mutateStats, mutateActivities, mutateWorkload, needActivity, needWorkload, invalidateGated]);

  const handleScheduleSaved = useCallback(() => {
    fetchSchedules();
    mutateStats();
    invalidateGated('activities', needActivity, mutateActivities);
    invalidateGated('workload', needWorkload, mutateWorkload);
  }, [fetchSchedules, mutateStats, mutateActivities, mutateWorkload, needActivity, needWorkload, invalidateGated]);

  return {
    locations: Array.isArray(locations) ? locations : [],
    employees: Array.isArray(employees) ? employees : [],
    classes: Array.isArray(classes) ? classes : [],
    schedules: Array.isArray(schedules) ? schedules : [],
    stats: stats || {} as DashboardStats,
    activities: Array.isArray(activities) ? activities : [],
    workloadData: Array.isArray(workloadData) ? workloadData : [],
    fetchErrors,
    fetchLocations: mutateLocations,
    fetchEmployees: mutateEmployees,
    fetchClasses: mutateClasses,
    fetchSchedules,
    fetchStats: mutateStats,
    fetchActivities: mutateActivities,
    fetchWorkload: mutateWorkload,
    handleClassRefresh,
    handleScheduleSaved,
  };
}
