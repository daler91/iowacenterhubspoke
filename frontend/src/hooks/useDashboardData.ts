import useSWR from 'swr';
import { useCallback } from 'react';
import { locationsAPI, employeesAPI, classesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';
import type { Location, Employee, ClassType, Schedule, DashboardStats, ActivityLog } from '../lib/types';

const swrOptions = { revalidateOnFocus: false, dedupingInterval: 2000 };

export function useDashboardData() {
  const { data: locations = [], mutate: mutateLocations } = useSWR<Location[]>('locations', () => locationsAPI.getAll().then(res => res.data.items || res.data), swrOptions);
  const { data: employees = [], mutate: mutateEmployees } = useSWR<Employee[]>('employees', () => employeesAPI.getAll().then(res => res.data.items || res.data), swrOptions);
  const { data: classes = [], mutate: mutateClasses } = useSWR<ClassType[]>('classes', () => classesAPI.getAll().then(res => res.data.items || res.data), swrOptions);
  const { data: schedules = [], mutate: mutateSchedules } = useSWR<Schedule[]>('schedules', () => schedulesAPI.getAll().then(res => res.data.items || res.data), swrOptions);
  const { data: stats = { total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 }, mutate: mutateStats } = useSWR<DashboardStats>('stats', () => dashboardAPI.getStats().then(res => res.data.data || res.data), swrOptions);
  const { data: activities = [], mutate: mutateActivities } = useSWR<ActivityLog[]>('activities', () => activityAPI.getAll(50).then(res => res.data.items || res.data), swrOptions);
  const { data: workloadData = [], mutate: mutateWorkload } = useSWR<Record<string, unknown>[]>('workload', () => workloadAPI.getAll().then(res => res.data.items || res.data), swrOptions);

  const handleClassRefresh = useCallback(() => {
    mutateClasses();
    mutateSchedules();
    mutateActivities();
    mutateWorkload();
  }, [mutateClasses, mutateSchedules, mutateActivities, mutateWorkload]);

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
