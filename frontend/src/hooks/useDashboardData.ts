import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { locationsAPI, employeesAPI, classesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';
import type { Location, Employee, ClassType, Schedule, DashboardStats, ActivityLog } from '../lib/types';

function extractItems<T>(res: any): T[] {
  const data = res.data?.items ?? res.data;
  const result = Array.isArray(data) ? data : [];
  if (result.length === 0 && res.data) {
    console.warn('[extractItems] Returned empty array. Raw response data type:', typeof res.data, 'keys:', res.data && typeof res.data === 'object' ? Object.keys(res.data) : 'N/A', 'data:', JSON.stringify(res.data).slice(0, 200));
  }
  return result;
}

const swrOptions = {
  revalidateOnFocus: false,
  dedupingInterval: 2000,
  errorRetryCount: 5,
  revalidateOnReconnect: true,
};

export function useDashboardData() {
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  const onError = (key: string) => (err: any) => {
    console.error(`[useDashboardData] Failed to fetch ${key}:`, err?.message || err);
    setFetchErrors(prev => ({ ...prev, [key]: err?.message || 'Failed to load' }));
  };

  const { data: locations = [], mutate: mutateLocations } = useSWR<Location[]>('locations', () => locationsAPI.getAll().then(extractItems<Location>), { ...swrOptions, onError: onError('locations') });
  const { data: employees = [], mutate: mutateEmployees } = useSWR<Employee[]>('employees', () => employeesAPI.getAll().then(extractItems<Employee>), { ...swrOptions, onError: onError('employees') });
  const { data: classes = [], mutate: mutateClasses } = useSWR<ClassType[]>('classes', () => classesAPI.getAll().then(extractItems<ClassType>), { ...swrOptions, onError: onError('classes') });
  const { data: schedules = [], mutate: mutateSchedules } = useSWR<Schedule[]>('schedules', () => schedulesAPI.getAll().then(extractItems<Schedule>), { ...swrOptions, onError: onError('schedules') });
  const { data: stats = { total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 }, mutate: mutateStats } = useSWR<DashboardStats>('stats', () => dashboardAPI.getStats().then(res => res.data.data || res.data), { ...swrOptions, onError: onError('stats') });
  const { data: activities = [], mutate: mutateActivities } = useSWR<ActivityLog[]>('activities', () => activityAPI.getAll(50).then(extractItems<ActivityLog>), { ...swrOptions, onError: onError('activities') });
  const { data: workloadData = [], mutate: mutateWorkload } = useSWR<Record<string, unknown>[]>('workload', () => workloadAPI.getAll().then(extractItems<Record<string, unknown>>), { ...swrOptions, onError: onError('workload') });

  const handleClassRefresh = useCallback(() => {
    // Class edits and deletes denormalize class_name/class_color/class_id
    // onto every matching schedule (via sync_class_snapshot_background on
    // update, and a direct db.schedules.update_many on delete). Workload
    // aggregations read those same fields. So all five caches need to
    // revalidate — otherwise the dashboard keeps showing the old class
    // label until a hard refresh, since SWR has revalidateOnFocus disabled.
    mutateClasses();
    mutateSchedules();
    mutateStats();
    mutateActivities();
    mutateWorkload();
  }, [mutateClasses, mutateSchedules, mutateStats, mutateActivities, mutateWorkload]);

  const handleScheduleSaved = useCallback(() => {
    mutateSchedules();
    mutateStats();
    mutateActivities();
    mutateWorkload();
  }, [mutateSchedules, mutateStats, mutateActivities, mutateWorkload]);

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
