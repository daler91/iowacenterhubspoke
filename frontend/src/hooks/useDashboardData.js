import useSWR from 'swr';
import { useCallback } from 'react';
import { locationsAPI, employeesAPI, classesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';

export function useDashboardData() {
  const { data: locations = [], mutate: mutateLocations } = useSWR('locations', () => locationsAPI.getAll().then(res => res.data.items || res.data));
  const { data: employees = [], mutate: mutateEmployees } = useSWR('employees', () => employeesAPI.getAll().then(res => res.data.items || res.data));
  const { data: classes = [], mutate: mutateClasses } = useSWR('classes', () => classesAPI.getAll().then(res => res.data.items || res.data));
  const { data: schedules = [], mutate: mutateSchedules } = useSWR('schedules', () => schedulesAPI.getAll().then(res => res.data.items || res.data));
  const { data: stats = { total_employees: 0, total_locations: 0, total_schedules: 0, today_schedules: 0 }, mutate: mutateStats } = useSWR('stats', () => dashboardAPI.getStats().then(res => res.data));
  const { data: activities = [], mutate: mutateActivities } = useSWR('activities', () => activityAPI.getAll(50).then(res => res.data.items || res.data));
  const { data: workloadData = [], mutate: mutateWorkload } = useSWR('workload', () => workloadAPI.getAll().then(res => res.data.items || res.data));

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
    locations,
    employees,
    classes,
    schedules,
    stats,
    activities,
    workloadData,
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
