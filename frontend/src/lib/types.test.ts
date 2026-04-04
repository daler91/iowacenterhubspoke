import { extractErrorMessage } from './types';

describe('extractErrorMessage', () => {
  it('extracts detail from axios-style error', () => {
    const err = { response: { data: { detail: 'Not found' } } };
    expect(extractErrorMessage(err, 'fallback')).toBe('Not found');
  });

  it('returns fallback when no response', () => {
    expect(extractErrorMessage(new Error('oops'), 'fallback')).toBe('fallback');
  });

  it('returns fallback when detail is not a string', () => {
    const err = { response: { data: { detail: { message: 'complex' } } } };
    expect(extractErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns fallback for null error', () => {
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('returns fallback for undefined error', () => {
    expect(extractErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
