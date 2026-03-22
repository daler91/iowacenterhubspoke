import { useState, useCallback, useEffect } from 'react';
import { locationsAPI, employeesAPI, classesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';

export function useDashboardData() {
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [stats, setStats] = useState({});
  const [activities, setActivities] = useState([]);
  const [workloadData, setWorkloadData] = useState([]);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await locationsAPI.getAll();
      setLocations(res.data);
    } catch (err) { console.error('Failed to fetch locations', err); }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await employeesAPI.getAll();
      setEmployees(res.data);
    } catch (err) { console.error('Failed to fetch employees', err); }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const res = await classesAPI.getAll();
      setClasses(res.data);
    } catch (err) { console.error('Failed to fetch classes', err); }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await schedulesAPI.getAll();
      setSchedules(res.data);
    } catch (err) { console.error('Failed to fetch schedules', err); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await dashboardAPI.getStats();
      setStats(res.data);
    } catch (err) { console.error('Failed to fetch stats', err); }
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await activityAPI.getAll(50);
      setActivities(res.data);
    } catch (err) { console.error('Failed to fetch activities', err); }
  }, []);

  const fetchWorkload = useCallback(async () => {
    try {
      const res = await workloadAPI.getAll();
      setWorkloadData(res.data);
    } catch (err) { console.error('Failed to fetch workload', err); }
  }, []);

  useEffect(() => {
    fetchLocations();
    fetchEmployees();
    fetchClasses();
    fetchSchedules();
    fetchStats();
    fetchActivities();
    fetchWorkload();
  }, [fetchLocations, fetchEmployees, fetchClasses, fetchSchedules, fetchStats, fetchActivities, fetchWorkload]);

  const handleClassRefresh = useCallback(() => {
    fetchClasses();
    fetchSchedules();
    fetchActivities();
    fetchWorkload();
  }, [fetchActivities, fetchClasses, fetchSchedules, fetchWorkload]);

  const handleScheduleSaved = useCallback(() => {
    fetchSchedules();
    fetchStats();
    fetchActivities();
    fetchWorkload();
  }, [fetchSchedules, fetchStats, fetchActivities, fetchWorkload]);

  return {
    locations, 
    employees, 
    classes, 
    schedules, 
    stats, 
    activities, 
    workloadData,
    fetchLocations,
    fetchEmployees,
    fetchClasses,
    fetchSchedules,
    fetchStats,
    fetchActivities,
    fetchWorkload,
    handleClassRefresh,
    handleScheduleSaved
  };
}
