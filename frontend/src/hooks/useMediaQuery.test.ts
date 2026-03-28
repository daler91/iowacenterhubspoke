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

  it('should return true if media query matches', () => {
    globalThis.matchMedia = jest.fn().mockImplementation(query => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(result.current).toBe(true);
  });
});
