import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { portalAPI } from '../lib/coordination-api';
import {
  usePortalSession,
  usePortalWorkspace,
  usePortalProjectWorkspace,
} from './usePortalData';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../lib/coordination-api', () => ({
  portalAPI: {
    verify: jest.fn(),
    workspace: jest.fn(),
    projectWorkspace: jest.fn(),
  },
}));

describe('usePortalData hooks', () => {
  const mockToken = 'mock-token';
  const mockProjectId = 'mock-project-id';
  let mockMutate: jest.Mock;

  beforeEach(() => {
    mockMutate = jest.fn();
    (useSWR as jest.Mock).mockReturnValue({
      data: { mockData: true },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('usePortalSession', () => {
    it('should use the correct SWR key and options when token is provided', () => {
      renderHook(() => usePortalSession(mockToken));

      expect(useSWR).toHaveBeenCalledWith(
        ['portal-session', mockToken],
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should use a null SWR key when token is empty', () => {
      renderHook(() => usePortalSession(''));

      expect(useSWR).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should call portalAPI.verify in the fetcher function', async () => {
      const mockResponse = { data: { valid: true } };
      (portalAPI.verify as jest.Mock).mockResolvedValue(mockResponse);

      renderHook(() => usePortalSession(mockToken));

      const fetcher = (useSWR as jest.Mock).mock.calls[0][1];
      const result = await fetcher();

      expect(portalAPI.verify).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual(mockResponse.data);
    });

    it('should return the correct structure', () => {
      const { result } = renderHook(() => usePortalSession(mockToken));

      expect(result.current).toEqual({
        session: { mockData: true },
        error: undefined,
        isLoading: false,
        mutateSession: mockMutate,
      });
    });
  });

  describe('usePortalWorkspace', () => {
    it('should use the correct SWR key and options when token is provided', () => {
      renderHook(() => usePortalWorkspace(mockToken));

      expect(useSWR).toHaveBeenCalledWith(
        ['portal-workspace', mockToken],
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should use a null SWR key when token is empty', () => {
      renderHook(() => usePortalWorkspace(''));

      expect(useSWR).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should call portalAPI.workspace in the fetcher function', async () => {
      const mockResponse = { data: { workspaceData: true } };
      (portalAPI.workspace as jest.Mock).mockResolvedValue(mockResponse);

      renderHook(() => usePortalWorkspace(mockToken));

      const fetcher = (useSWR as jest.Mock).mock.calls[0][1];
      const result = await fetcher();

      expect(portalAPI.workspace).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual(mockResponse.data);
    });

    it('should return the correct structure', () => {
      const { result } = renderHook(() => usePortalWorkspace(mockToken));

      expect(result.current).toEqual({
        workspace: { mockData: true },
        error: undefined,
        isLoading: false,
        mutateWorkspace: mockMutate,
      });
    });
  });

  describe('usePortalProjectWorkspace', () => {
    it('should use the correct SWR key and options when token and projectId are provided', () => {
      renderHook(() => usePortalProjectWorkspace(mockToken, mockProjectId));

      expect(useSWR).toHaveBeenCalledWith(
        ['portal-project-workspace', mockToken, mockProjectId],
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should use a null SWR key when token is empty', () => {
      renderHook(() => usePortalProjectWorkspace('', mockProjectId));

      expect(useSWR).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should use a null SWR key when projectId is empty', () => {
      renderHook(() => usePortalProjectWorkspace(mockToken, undefined));

      expect(useSWR).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { shouldRetryOnError: false }
      );
    });

    it('should call portalAPI.projectWorkspace in the fetcher function', async () => {
      const mockResponse = { data: { projectData: true } };
      (portalAPI.projectWorkspace as jest.Mock).mockResolvedValue(mockResponse);

      renderHook(() => usePortalProjectWorkspace(mockToken, mockProjectId));

      const fetcher = (useSWR as jest.Mock).mock.calls[0][1];
      const result = await fetcher();

      expect(portalAPI.projectWorkspace).toHaveBeenCalledWith(mockProjectId, mockToken);
      expect(result).toEqual(mockResponse.data);
    });

    it('should return the correct structure', () => {
      const { result } = renderHook(() => usePortalProjectWorkspace(mockToken, mockProjectId));

      expect(result.current).toEqual({
        projectWorkspace: { mockData: true },
        error: undefined,
        isLoading: false,
        mutateProjectWorkspace: mockMutate,
      });
    });
  });
});
