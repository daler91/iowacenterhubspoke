/**
 * Tests the 401-redirect debounce logic in `api.ts`.
 *
 * Regression target: an earlier `let isRedirectingTo401 = false` flag was only
 * cleared on a *successful* response, so a 500 or network error that followed
 * a stray 401 would leave the guard latched and every subsequent 401 would be
 * swallowed silently. The fix is a timestamp-based debounce that auto-expires
 * after `REDIRECT_DEBOUNCE_MS` (3s).
 *
 * We exercise the pure decision helper `shouldRedirectOn401` directly so we
 * don't have to wrestle JSDOM's non-configurable `window.location` to test
 * the axios interceptor end-to-end.
 */

import { REDIRECT_DEBOUNCE_MS, isPublicAuthPath, shouldRedirectOn401 } from './api';

describe('isPublicAuthPath', () => {
  it.each([
    ['/login', true],
    ['/forgot-password', true],
    ['/reset-password', true],
    ['/reset-password/abc123', true],
    ['/dashboard', false],
    ['/schedules', false],
    ['/', false],
    ['/login-help', false], // startsWith('login') but not a /login/ subpath
  ])('%s → %s', (path, expected) => {
    expect(isPublicAuthPath(path)).toBe(expected);
  });
});

describe('shouldRedirectOn401', () => {
  const DEBOUNCE = REDIRECT_DEBOUNCE_MS;

  it('redirects on the very first 401 on an app route', () => {
    expect(shouldRedirectOn401('/dashboard', 1_000_000, 0)).toBe(true);
  });

  it('does not redirect when already on a public auth route', () => {
    expect(shouldRedirectOn401('/login', 1_000_000, 0)).toBe(false);
    expect(shouldRedirectOn401('/forgot-password', 1_000_000, 0)).toBe(false);
    expect(shouldRedirectOn401('/reset-password/tok', 1_000_000, 0)).toBe(false);
  });

  it('suppresses repeat redirects within the debounce window', () => {
    const t0 = 1_000_000;
    // First 401 at t0 — should redirect.
    expect(shouldRedirectOn401('/dashboard', t0, 0)).toBe(true);
    // Second 401 at t0+500ms with lastRedirectAt=t0 — still inside debounce.
    expect(shouldRedirectOn401('/dashboard', t0 + 500, t0)).toBe(false);
    // At the exact edge (t0 + DEBOUNCE) we re-allow the redirect.
    expect(shouldRedirectOn401('/dashboard', t0 + DEBOUNCE, t0)).toBe(true);
  });

  it('REGRESSION: a 500 between two 401s does not clear the guard early', () => {
    // The old boolean guard was only cleared by a *successful* response, so
    // in a (401, 500, 401) sequence the second 401 was silently swallowed.
    // The new debounce-based guard still suppresses until the window elapses
    // — and crucially, once it does elapse, the subsequent 401 DOES redirect.
    const t0 = 1_000_000;
    expect(shouldRedirectOn401('/dashboard', t0, 0)).toBe(true);
    // Intervening 500 at t0+100 doesn't touch the interceptor's decision for
    // a following 401 within the window.
    expect(shouldRedirectOn401('/dashboard', t0 + 500, t0)).toBe(false);
    // After the debounce elapses, a new 401 redirects again. Under the old
    // boolean guard this call would have returned false forever.
    expect(shouldRedirectOn401('/dashboard', t0 + DEBOUNCE + 1, t0)).toBe(true);
  });

  it('does not redirect on a public auth route even after the debounce window', () => {
    expect(shouldRedirectOn401('/login', 1_000_000 + 10 * DEBOUNCE, 0)).toBe(false);
  });
});
