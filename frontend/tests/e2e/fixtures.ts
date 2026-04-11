import { test as base, type Page, type Route } from '@playwright/test';

/**
 * A Playwright fixture that intercepts every `/api/v1/**` request and
 * responds with deterministic, minimal mock data. This lets the e2e suite
 * run against the local Vite dev server **without** a backend — specs
 * focus on accessibility, keyboard, and responsive concerns that don't
 * need real data.
 *
 * Consumers import `test` from this file instead of `@playwright/test`:
 *
 *     import { test, expect } from './fixtures';
 *
 * The `page` fixture is already mocked when your spec receives it, so
 * you can navigate straight to a protected route like `/calendar` and
 * the app will render as the fake scheduler user.
 */

const FAKE_USER = {
  user_id: 'user_test_1',
  name: 'Test Scheduler',
  email: 'test@example.com',
  role: 'scheduler',
};

const EMPTY_LIST: unknown[] = [];

/**
 * Maps a URL pathname (after the `/api/v1` prefix) to a JSON response
 * body. Order matters: the first matching prefix wins. Anything not in
 * this table falls back to `{}` so the frontend sees a successful but
 * empty response rather than a 404 that could trigger error UI.
 */
const MOCK_ROUTES: Array<{ match: (path: string, method: string) => boolean; body: unknown }> = [
  // Auth
  { match: (p, m) => p === '/auth/me' && m === 'GET', body: FAKE_USER },
  { match: (p, m) => p === '/auth/logout' && m === 'POST', body: { ok: true } },

  // Reference data — all empty lists so no real rows need to render
  { match: (p, m) => p.startsWith('/locations') && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p.startsWith('/employees') && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p.startsWith('/classes') && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p.startsWith('/schedules') && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/users' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/users/invitations' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/notifications' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/activity-logs' && m === 'GET', body: { items: [] } },
  { match: (p, m) => p === '/workload' && m === 'GET', body: { employees: [] } },
  { match: (p, m) => p === '/dashboard/stats' && m === 'GET', body: {
    total_schedules: 0,
    upcoming_schedules: 0,
    total_locations: 0,
    total_employees: 0,
  } },
  { match: (p, m) => p === '/system/config' && m === 'GET', body: { hub_lat: 41.5868, hub_lng: -93.6250 } },

  // Analytics
  { match: (p, m) => p.startsWith('/analytics/trends') && m === 'GET', body: { series: [] } },
  { match: (p, m) => p.startsWith('/analytics/forecast') && m === 'GET', body: { forecast: [] } },
  { match: (p, m) => p.startsWith('/analytics/drive-optimization') && m === 'GET', body: { routes: [] } },
  { match: (p, m) => p.startsWith('/reports/weekly-summary') && m === 'GET', body: { totals: {}, rows: [] } },

  // Coordination
  { match: (p, m) => p === '/coordination/projects' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/coordination/partners' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p === '/coordination/webhooks' && m === 'GET', body: EMPTY_LIST },
  { match: (p, m) => p.startsWith('/coordination') && m === 'GET', body: EMPTY_LIST },

  // Portal (unauthenticated token-based route)
  { match: (p, m) => p.startsWith('/portal/') && m === 'GET', body: {
    partner: { name: 'Test Partner' },
    projects: [],
    events: [],
  } },
];

function resolveMock(path: string, method: string): unknown {
  for (const entry of MOCK_ROUTES) {
    if (entry.match(path, method)) return entry.body;
  }
  // Fallback: empty object. Prevents the app from treating the route as
  // a 404 and rendering an error banner.
  return {};
}

export async function installApiMocks(page: Page): Promise<void> {
  // Set a fake csrf cookie so mutating request interceptors in the app
  // don't bail out. The value is never validated server-side because
  // we intercept everything.
  await page.context().addCookies([
    {
      name: 'csrf_token',
      value: 'test-csrf-token',
      url: 'http://localhost:3000',
    },
  ]);

  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    const method = request.method();
    const body = resolveMock(path, method);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export const test = base.extend<{ mockedPage: Page }>({
  mockedPage: async ({ page }, use) => {
    await installApiMocks(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
