import { renderHook, act } from '@testing-library/react';
import useSWR from 'swr';
import { useDashboardData } from './useDashboardData';

// Mock the dependencies
jest.mock('swr');
jest.mock('../lib/api', () => ({
  locationsAPI: { getAll: jest.fn() },
  employeesAPI: { getAll: jest.fn() },
  classesAPI: { getAll: jest.fn() },
  schedulesAPI: { getAll: jest.fn() },
  dashboardAPI: { getStats: jest.fn() },
  activityAPI: { getAll: jest.fn() },
  workloadAPI: { getAll: jest.fn() },
}));

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
      switch (key) {
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
    const { result } = renderHook(() => useDashboardData());

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

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.locations).toEqual([]);
    expect(result.current.employees).toEqual([]);
    expect(result.current.classes).toEqual([]);
    expect(result.current.schedules).toEqual([]);
    expect(result.current.stats).toEqual({ total_employees: 0, total_locations: 0, total_schedules: 0, total_classes: 0, today_schedules: 0 });
    expect(result.current.activities).toEqual([]);
    expect(result.current.workloadData).toEqual([]);
  });

  it('should call the correct mutate functions in handleClassRefresh', () => {
    const { result } = renderHook(() => useDashboardData());

    act(() => {
      result.current.handleClassRefresh();
    });

    expect(mockMutate.mutateClasses).toHaveBeenCalled();
    expect(mockMutate.mutateSchedules).toHaveBeenCalled();
    expect(mockMutate.mutateActivities).toHaveBeenCalled();
    expect(mockMutate.mutateWorkload).toHaveBeenCalled();
    expect(mockMutate.mutateStats).toHaveBeenCalled();
    expect(mockMutate.mutateLocations).not.toHaveBeenCalled();
    expect(mockMutate.mutateEmployees).not.toHaveBeenCalled();
  });

  it('should call the correct mutate functions in handleScheduleSaved', () => {
    const { result } = renderHook(() => useDashboardData());

    act(() => {
      result.current.handleScheduleSaved();
    });

    expect(mockMutate.mutateSchedules).toHaveBeenCalled();
    expect(mockMutate.mutateStats).toHaveBeenCalled();
    expect(mockMutate.mutateActivities).toHaveBeenCalled();
    expect(mockMutate.mutateWorkload).toHaveBeenCalled();
    expect(mockMutate.mutateLocations).not.toHaveBeenCalled();
    expect(mockMutate.mutateEmployees).not.toHaveBeenCalled();
    expect(mockMutate.mutateClasses).not.toHaveBeenCalled();
  });
});
