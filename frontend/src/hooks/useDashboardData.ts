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

export interface UseDashboardDataOptions {
  /** Fetch `/stats` and `/activities` (needed by Insights + Dashboard home). */
  needActivity?: boolean;
  /** Fetch `/workload` (only Insights → Workload tab consumes this). */
  needWorkload?: boolean;
}

export function useDashboardData(options: UseDashboardDataOptions = {}) {
  const { needActivity = false, needWorkload = false } = options;
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  const onError = (key: string) => (err: any) => {
    console.error(`[useDashboardData] Failed to fetch ${key}:`, err?.message || err);
    setFetchErrors(prev => ({ ...prev, [key]: err?.message || 'Failed to load' }));
  };

  const { data: locations = [], mutate: mutateLocations } = useSWR<Location[]>('locations', () => locationsAPI.getAll().then(extractItems<Location>), { ...swrOptions, onError: onError('locations') });
  const { data: employees = [], mutate: mutateEmployees } = useSWR<Employee[]>('employees', () => employeesAPI.getAll().then(extractItems<Employee>), { ...swrOptions, onError: onError('employees') });
  const { data: classes = [], mutate: mutateClasses } = useSWR<ClassType[]>('classes', () => classesAPI.getAll().then(extractItems<ClassType>), { ...swrOptions, onError: onError('classes') });
  const { data: schedules = [], mutate: mutateSchedules } = useSWR<Schedule[]>('schedules', () => schedulesAPI.getAll().then(extractItems<Schedule>), { ...swrOptions, onError: onError('schedules') });
  // `stats` drives the sidebar counters on every route, so keep it unconditional.
  const { data: stats = { total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 }, mutate: mutateStats } = useSWR<DashboardStats>('stats', () => dashboardAPI.getStats().then(res => res.data.data || res.data), { ...swrOptions, onError: onError('stats') });
  // `activities` + `workload` are route-gated: passing `null` as the SWR key
  // skips the fetch entirely until the route opts in. Cached data is
  // preserved across toggles by SWR's global cache.
  const { data: activities = [], mutate: mutateActivities } = useSWR<ActivityLog[]>(needActivity ? 'activities' : null, () => activityAPI.getAll(50).then(extractItems<ActivityLog>), { ...swrOptions, onError: onError('activities') });
  const { data: workloadData = [], mutate: mutateWorkload } = useSWR<Record<string, unknown>[]>(needWorkload ? 'workload' : null, () => workloadAPI.getAll().then(extractItems<Record<string, unknown>>), { ...swrOptions, onError: onError('workload') });

  // Invalidate a route-gated cache without forcing an immediate refetch.
  // When the tab that consumes the cache isn't mounted (flag is false),
  // we still want to drop the stale value so the next visit sees fresh
  // data — but we don't pay for the refetch right now.
  const invalidateGated = useCallback((key: string, isActive: boolean, mutateFn: () => Promise<unknown>) => {
    if (isActive) {
      void mutateFn();
    } else {
      void globalMutate(key, undefined, { revalidate: false });
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
    mutateSchedules();
    mutateStats();
    invalidateGated('activities', needActivity, mutateActivities);
    invalidateGated('workload', needWorkload, mutateWorkload);
  }, [mutateClasses, mutateSchedules, mutateStats, mutateActivities, mutateWorkload, needActivity, needWorkload, invalidateGated]);

  const handleScheduleSaved = useCallback(() => {
    mutateSchedules();
    mutateStats();
    invalidateGated('activities', needActivity, mutateActivities);
    invalidateGated('workload', needWorkload, mutateWorkload);
  }, [mutateSchedules, mutateStats, mutateActivities, mutateWorkload, needActivity, needWorkload, invalidateGated]);

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
    fetchSchedules: mutateSchedules,
    fetchStats: mutateStats,
    fetchActivities: mutateActivities,
    fetchWorkload: mutateWorkload,
    handleClassRefresh,
    handleScheduleSaved,
  };
}
