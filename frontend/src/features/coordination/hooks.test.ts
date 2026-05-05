import { act, renderHook } from '@testing-library/react';
import { useTaskCommentActions } from './hooks';
import { coordinationFeatureApi } from './api';

jest.mock('./api', () => ({ coordinationFeatureApi: { postComment: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

describe('useTaskCommentActions', () => {
  it('posts comment and refreshes', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (coordinationFeatureApi.postComment as jest.Mock).mockResolvedValue({ data: { id: 'c1' } });
    const { result } = renderHook(() => useTaskCommentActions('p1', 't1', refresh));
    await act(async () => {
      const id = await result.current.submitComment({ body: 'Hello', mentions: [], parentCommentId: null });
      expect(id).toBe('c1');
    });
    expect(coordinationFeatureApi.postComment).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('rethrows post failures so caller can preserve draft state', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const boom = new Error('network');
    (coordinationFeatureApi.postComment as jest.Mock).mockRejectedValue(boom);
    const { result } = renderHook(() => useTaskCommentActions('p1', 't1', refresh));
    await act(async () => {
      await expect(
        result.current.submitComment({ body: 'Hello', mentions: [], parentCommentId: null }),
      ).rejects.toThrow('network');
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
