import { act, renderHook } from '@testing-library/react';
import { useTaskCommentActions } from './useTaskCommentActions';
import { projectTasksAPI } from '../lib/coordination-api';

jest.mock('../lib/coordination-api', () => ({ projectTasksAPI: { postComment: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useTaskCommentActions', () => {
  it('posts comment and refreshes', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (projectTasksAPI.postComment as jest.Mock).mockResolvedValue({ data: { id: 'c1' } });
    const { result } = renderHook(() => useTaskCommentActions('p1', 't1', refresh));
    await act(async () => {
      const id = await result.current.submitComment({ body: 'Hello', mentions: [], parentCommentId: null });
      expect(id).toBe('c1');
    });
    expect(projectTasksAPI.postComment).toHaveBeenCalledWith('p1', 't1', 'Hello', undefined, []);
    expect(refresh).toHaveBeenCalled();
  });

  it('forwards a reply parent id', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (projectTasksAPI.postComment as jest.Mock).mockResolvedValue({ data: { id: 'c2' } });
    const { result } = renderHook(() => useTaskCommentActions('p1', 't1', refresh));
    await act(async () => {
      await result.current.submitComment({ body: 'Reply', mentions: [], parentCommentId: 'c1' });
    });
    expect(projectTasksAPI.postComment).toHaveBeenCalledWith('p1', 't1', 'Reply', 'c1', []);
  });

  it('rethrows post failures so caller can preserve draft state', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const boom = new Error('network');
    (projectTasksAPI.postComment as jest.Mock).mockRejectedValue(boom);
    const { result } = renderHook(() => useTaskCommentActions('p1', 't1', refresh));
    await act(async () => {
      await expect(
        result.current.submitComment({ body: 'Hello', mentions: [], parentCommentId: null }),
      ).rejects.toThrow('network');
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
