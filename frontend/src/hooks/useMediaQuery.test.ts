import { renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  let originalMatchMedia;

  beforeAll(() => {
    originalMatchMedia = globalThis.matchMedia;
  });

  afterAll(() => {
    globalThis.matchMedia = originalMatchMedia;
  });

  function mockMatchMedia(initialMatches = true) {
    const addEventListener = jest.fn();
    const removeEventListener = jest.fn();
    globalThis.matchMedia = jest.fn().mockImplementation(query => ({
      matches: initialMatches,
      media: query,
      onchange: null,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener,
      removeEventListener,
      dispatchEvent: jest.fn(),
    }));
    return { addEventListener, removeEventListener };
  }

  it('should return true if media query matches', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(result.current).toBe(true);
  });

  it('should register a "change" listener on the MediaQueryList (not "resize")', () => {
    const { addEventListener } = mockMatchMedia(true);
    renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener.mock.calls[0][0]).toBe('change');
  });

  it('should remove the same "change" listener on unmount', () => {
    const { addEventListener, removeEventListener } = mockMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    const registeredListener = addEventListener.mock.calls[0][1];
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', registeredListener);
  });

  it('should not re-register the listener when matches flips (matches is not in deps)', () => {
    const { addEventListener } = mockMatchMedia(false);
    const { rerender } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    // Simulate the listener being called with a change event (triggers setMatches -> rerender)
    const listener = addEventListener.mock.calls[0][1];
    listener({ matches: true });
    rerender();
    // The effect should not have re-run; exactly one registration across the lifecycle.
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });
});
