import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import {
  useProjects,
  useProject,
  useProjectBoard,
  useCommunityDashboard,
  useProjectTasks,
  usePartnerOrgs,
  usePartnerOrg,
  usePartnerContacts,
  usePartnerProjects,
} from './useCoordinationData';
import { projectsAPI, partnerOrgsAPI, projectTasksAPI } from '../lib/coordination-api';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../lib/coordination-api', () => ({
  projectsAPI: {
    getAll: jest.fn(),
    getOne: jest.fn(),
    getBoard: jest.fn(),
    getDashboard: jest.fn(),
  },
  partnerOrgsAPI: {
    getAll: jest.fn(),
    getOne: jest.fn(),
    getContacts: jest.fn(),
    getProjects: jest.fn(),
  },
  projectTasksAPI: {
    getAll: jest.fn(),
  },
}));

describe('useCoordinationData hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSWR as jest.Mock).mockReturnValue({
      data: undefined,
      mutate: jest.fn(),
      error: undefined,
      isLoading: false,
    });
  });

  describe('canonical function and parameter handling', () => {
    it('sorts keys to generate a consistent cache key', () => {
      renderHook(() => useProjects({ b: 2, a: 1 }));
      expect(useSWR).toHaveBeenCalledWith(
        ['projects', '{"a":1,"b":2}'],
        expect.any(Function)
      );

      (useSWR as jest.Mock).mockClear();

      renderHook(() => useProjects({ a: 1, b: 2 }));
      expect(useSWR).toHaveBeenCalledWith(
        ['projects', '{"a":1,"b":2}'],
        expect.any(Function)
      );
    });

    it('handles undefined params correctly', () => {
      renderHook(() => useProjects());
      expect(useSWR).toHaveBeenCalledWith(
        'projects',
        expect.any(Function)
      );
    });
  });

  describe('extractItems behavior', () => {
    it('extracts from { data: { items: [...] } }', async () => {
      let fetcher: (() => Promise<unknown>) | undefined;
      (useSWR as jest.Mock).mockImplementation((key, fn) => {
        if (key === 'projects') fetcher = fn;
        return { data: undefined };
      });

      renderHook(() => useProjects());
      expect(fetcher).toBeDefined();

      const mockResponse = { data: { items: [{ id: 1 }] } };
      (projectsAPI.getAll as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetcher!();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('extracts from { data: [...] }', async () => {
      let fetcher: (() => Promise<unknown>) | undefined;
      (useSWR as jest.Mock).mockImplementation((key, fn) => {
        if (key === 'projects') fetcher = fn;
        return { data: undefined };
      });

      renderHook(() => useProjects());
      expect(fetcher).toBeDefined();

      const mockResponse = { data: [{ id: 1 }] };
      (projectsAPI.getAll as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetcher!();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('returns empty array if data is not an array', async () => {
      let fetcher: (() => Promise<unknown>) | undefined;
      (useSWR as jest.Mock).mockImplementation((key, fn) => {
        if (key === 'projects') fetcher = fn;
        return { data: undefined };
      });

      renderHook(() => useProjects());

      (projectsAPI.getAll as jest.Mock).mockResolvedValue({ data: null });
      const result1 = await fetcher!();
      expect(result1).toEqual([]);

      (projectsAPI.getAll as jest.Mock).mockResolvedValue({ data: { items: null } });
      const result2 = await fetcher!();
      expect(result2).toEqual([]);
    });
  });

  describe('hook return values and SWR calls', () => {
    it('useProjects returns expected shape', () => {
      (useSWR as jest.Mock).mockReturnValue({
        data: [{ id: 'p1' }],
        mutate: jest.fn(),
        error: null,
        isLoading: false,
      });
      const { result } = renderHook(() => useProjects());
      expect(result.current.projects).toEqual([{ id: 'p1' }]);
      expect(result.current.mutateProjects).toBeDefined();
    });

    it('useProject queries by id', () => {
      renderHook(() => useProject('p1'));
      expect(useSWR).toHaveBeenCalledWith('project-p1', expect.any(Function));
    });

    it('useProject returns null key if no id provided', () => {
      renderHook(() => useProject(undefined));
      expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function));
    });

    it('useProjectBoard queries board with canonical params', () => {
      renderHook(() => useProjectBoard({ status: 'active' }));
      expect(useSWR).toHaveBeenCalledWith(['project-board', '{"status":"active"}'], expect.any(Function));
    });

    it('useCommunityDashboard queries dashboard', () => {
      renderHook(() => useCommunityDashboard());
      expect(useSWR).toHaveBeenCalledWith('community-dashboard', expect.any(Function));
    });

    it('useProjectTasks queries tasks for project', () => {
      renderHook(() => useProjectTasks('p1'));
      expect(useSWR).toHaveBeenCalledWith('tasks-p1', expect.any(Function));
    });

    it('usePartnerOrgs queries partner orgs with params', () => {
      renderHook(() => usePartnerOrgs({ community: 'test' }));
      expect(useSWR).toHaveBeenCalledWith(['partner-orgs', '{"community":"test"}'], expect.any(Function));
    });

    it('usePartnerOrg queries by id', () => {
      renderHook(() => usePartnerOrg('org1'));
      expect(useSWR).toHaveBeenCalledWith('partner-org-org1', expect.any(Function));
    });

    it('usePartnerContacts queries contacts by org id', () => {
      renderHook(() => usePartnerContacts('org1'));
      expect(useSWR).toHaveBeenCalledWith('partner-org-org1-contacts', expect.any(Function));
    });

    it('usePartnerProjects queries projects by org id and limit', () => {
      renderHook(() => usePartnerProjects('org1', 10));
      expect(useSWR).toHaveBeenCalledWith('partner-org-org1-projects-10', expect.any(Function));
    });
  });
});
