import { normalizeApiError } from './api-errors';

describe('normalizeApiError', () => {
  it('normalizes 409 conflicts payload', () => {
    const result = normalizeApiError({
      response: {
        status: 409,
        data: {
          detail: {
            message: 'Conflict',
            conflicts: [{ location: 'Studio A' }],
          },
        },
      },
    });

    expect(result.status).toBe(409);
    expect(result.conflicts).toEqual([{ location: 'Studio A' }]);
    expect(result.message).toBe('Something went wrong. Please try again.');
  });

  it('uses string detail as message', () => {
    const result = normalizeApiError({ response: { status: 500, data: { detail: 'Boom' } } }, 'Fallback');
    expect(result.message).toBe('Boom');
    expect(result.conflicts).toEqual([]);
  });
});
