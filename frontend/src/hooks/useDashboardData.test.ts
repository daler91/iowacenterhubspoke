import { renderHook, act } from '@testing-library/react';
import useSWR, { mutate as globalMutateMock } from 'swr';
import { useDashboardData, isSchedulesSwrKey } from './useDashboardData';
import { schedulesAPI } from '../lib/api';

// Mock the dependencies
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
  mutate: jest.fn(),
}));
jest.mock('../lib/api', () => ({
  locationsAPI: { getAll: jest.fn() },
  employeesAPI: { getAll: jest.fn() },
  classesAPI: { getAll: jest.fn() },
  schedulesAPI: { getAll: jest.fn() },
  dashboardAPI: { getStats: jest.fn() },
  activityAPI: { getAll: jest.fn() },
  workloadAPI: { getAll: jest.fn() },
}));

// Normalize the SWR key for the mock's switch: `schedules` moved from a
// string key to an array key (`['schedules', dateFrom, dateTo]`) so the
// hook can cache each window independently. Tests don't care about the
// specific window — they just want to look up "the schedules mock".
const normalizeKey = (key) => (Array.isArray(key) ? key[0] : key);

describe('useDashboardData', () => {
  let mockMutate;

  beforeEach(() => {
    mockMutate = {
      mutateLocations: jest.fn(),
      mutateEmployees: jest.fn(),
      mutateClasses: jest.fn(),
      mutateSchedules: jest.fn(),
      mutateStats: jest.fn(),
      mutateActivities: jest.fn(),
      mutateWorkload: jest.fn(),
    };

    useSWR.mockImplementation((key) => {
      switch (normalizeKey(key)) {
        case 'locations':
          return { data: [{ id: 1, name: 'Location 1' }], mutate: mockMutate.mutateLocations };
        case 'employees':
          return { data: [{ id: 1, name: 'Employee 1' }], mutate: mockMutate.mutateEmployees };
        case 'classes':
          return { data: [{ id: 1, name: 'Class 1' }], mutate: mockMutate.mutateClasses };
        case 'schedules':
          return { data: [{ id: 1, name: 'Schedule 1' }], mutate: mockMutate.mutateSchedules };
        case 'stats':
          return { data: { total_employees: 10, total_locations: 5, total_schedules: 20, today_schedules: 2 }, mutate: mockMutate.mutateStats };
        case 'activities':
          return { data: [{ id: 1, action: 'Created' }], mutate: mockMutate.mutateActivities };
        case 'workload':
          return { data: [{ employeeId: 1, hours: 40 }], mutate: mockMutate.mutateWorkload };
        default:
          return { data: undefined, mutate: jest.fn() };
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return default formatted data when useSWR returns valid data', () => {
    const { result } = renderHook(() => useDashboardData({ needActivity: true, needWorkload: true }));

    expect(result.current.locations).toEqual([{ id: 1, name: 'Location 1' }]);
    expect(result.current.employees).toEqual([{ id: 1, name: 'Employee 1' }]);
    expect(result.current.classes).toEqual([{ id: 1, name: 'Class 1' }]);
    expect(result.current.schedules).toEqual([{ id: 1, name: 'Schedule 1' }]);
    expect(result.current.stats).toEqual({ total_employees: 10, total_locations: 5, total_schedules: 20, today_schedules: 2 });
    expect(result.current.activities).toEqual([{ id: 1, action: 'Created' }]);
    expect(result.current.workloadData).toEqual([{ employeeId: 1, hours: 40 }]);
  });

  it('should return empty arrays/objects when useSWR returns undefined', () => {
    useSWR.mockImplementation((key) => {
      if (key === 'stats') return { data: undefined, mutate: jest.fn() };
      return { data: undefined, mutate: jest.fn() };
    });

    const { result } = renderHook(() => useDashboardData({ needActivity: true, needWorkload: true }));

    expect(result.current.locations).toEqual([]);
    expect(result.current.employees).toEqual([]);
    expect(result.current.classes).toEqual([]);
    expect(result.current.schedules).toEqual([]);
    expect(result.current.stats).toEqual({ total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 });
    expect(result.current.activities).toEqual([]);
    expect(result.current.workloadData).toEqual([]);
  });

  it('should call the correct mutate functions in handleClassRefresh', () => {
    const { result } = renderHook(() => useDashboardData({ needActivity: true, needWorkload: true }));

    act(() => {
      result.current.handleClassRefresh();
    });

    // Class update/delete denormalize class fields onto every matching
    // schedule (update runs sync_class_snapshot_background; delete runs a
    // direct db.schedules.update_many). Workload reads those same fields.
    // So all five caches must revalidate to avoid stale labels.
    expect(mockMutate.mutateClasses).toHaveBeenCalled();
    // Schedules now live under an array SWR key per-window — invalidation
    // goes through the global `mutate` with the `isSchedulesSwrKey`
    // predicate so every windowed variant is refreshed.
    expect(globalMutateMock).toHaveBeenCalledWith(isSchedulesSwrKey);
    expect(mockMutate.mutateActivities).toHaveBeenCalled();
    expect(mockMutate.mutateWorkload).toHaveBeenCalled();
    expect(mockMutate.mutateStats).toHaveBeenCalled();
    expect(mockMutate.mutateLocations).not.toHaveBeenCalled();
    expect(mockMutate.mutateEmployees).not.toHaveBeenCalled();
  });

  it('should call the correct mutate functions in handleScheduleSaved', () => {
    const { result } = renderHook(() => useDashboardData({ needActivity: true, needWorkload: true }));

    act(() => {
      result.current.handleScheduleSaved();
    });

    expect(globalMutateMock).toHaveBeenCalledWith(isSchedulesSwrKey);
    expect(mockMutate.mutateStats).toHaveBeenCalled();
    expect(mockMutate.mutateActivities).toHaveBeenCalled();
    expect(mockMutate.mutateWorkload).toHaveBeenCalled();
    expect(mockMutate.mutateLocations).not.toHaveBeenCalled();
    expect(mockMutate.mutateEmployees).not.toHaveBeenCalled();
    expect(mockMutate.mutateClasses).not.toHaveBeenCalled();
  });

  it('passes date_from/date_to to schedulesAPI.getAll when a window is supplied', () => {
    // Capture the fetcher passed for the schedules key and invoke it so
    // we can assert on the params handed to the API.
    schedulesAPI.getAll.mockResolvedValue({ data: [] });
    let scheduleFetcher;
    useSWR.mockImplementation((key, fetcher) => {
      if (Array.isArray(key) && key[0] === 'schedules') {
        scheduleFetcher = fetcher;
      }
      return { data: undefined, mutate: jest.fn() };
    });

    renderHook(() => useDashboardData({
      scheduleWindow: { dateFrom: '2024-01-01', dateTo: '2024-03-01' },
    }));

    expect(typeof scheduleFetcher).toBe('function');
    scheduleFetcher();
    expect(schedulesAPI.getAll).toHaveBeenCalledWith({
      date_from: '2024-01-01',
      date_to: '2024-03-01',
    });
  });

  it('calls schedulesAPI.getAll with no params when window is null', () => {
    schedulesAPI.getAll.mockResolvedValue({ data: [] });
    let scheduleFetcher;
    useSWR.mockImplementation((key, fetcher) => {
      if (Array.isArray(key) && key[0] === 'schedules') {
        scheduleFetcher = fetcher;
      }
      return { data: undefined, mutate: jest.fn() };
    });

    renderHook(() => useDashboardData({ scheduleWindow: null }));

    scheduleFetcher();
    expect(schedulesAPI.getAll).toHaveBeenCalledWith(undefined);
  });
});
