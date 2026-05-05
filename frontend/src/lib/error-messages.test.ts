import { describeApiError } from './error-messages';

describe('describeApiError', () => {
  it('falls back to status message when detail looks like an HTML gateway page', () => {
    const err = {
      response: {
        status: 502,
        data: { detail: '<!DOCTYPE html><html><body>Cloudflare 502</body></html>' },
      },
    };
    expect(describeApiError(err, 'fallback')).toBe('The service is temporarily unavailable. Please try again shortly.');
  });

  it('keeps plain-text details', () => {
    const err = { response: { status: 500, data: { detail: 'Database timeout' } } };
    expect(describeApiError(err, 'fallback')).toBe('Database timeout');
  });
});
