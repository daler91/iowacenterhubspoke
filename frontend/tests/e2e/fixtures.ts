import { test as base, type Route } from '@playwright/test';

/**
 * Playwright fixture that intercepts every `/api/v1/**` request and
 * responds with deterministic, minimal mock data. Lets the e2e suite
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
 * the app will render as a fake scheduler user.
 */

const FAKE_USER = {
  user_id: 'user_test_1',
  name: 'Test Scheduler',
  email: 'test@example.com',
  role: 'scheduler',
};

// Minimal DashboardMetrics shape with empty arrays so CommunityDashboard
// doesn't throw on `.communities.map()` / `.upcoming_projects.map()`.
const EMPTY_COORDINATION_DASHBOARD = {
  classes_delivered: 0,
  total_attendance: 0,
  warm_leads: 0,
  active_partners: 0,
  upcoming_classes: 0,
  overdue_alert_count: 0,
  orphan_completed_schedules: 0,
  class_breakdown: [],
  communities: [],
  upcoming_projects: [],
};

// Minimal BoardData shape: keep all phase columns present so
// ProjectBoard can `Object.values(columns).flat()` without crashing.
const EMPTY_BOARD = {
  columns: {
    intake: [],
    scoping: [],
    scheduled: [],
    promotion: [],
    delivery: [],
    wrap_up: [],
    complete: [],
  },
};

// Fixed timestamp so all test fixtures share one literal (keeps the
// mock data stable and avoids Sonar S1192 duplication flags).
const FIXED_DATE = '2026-01-01T00:00:00Z';
const TEST_ORG_ID = 'org_test_1';

// Minimal PartnerOrg + PartnerContact for the portal verify response.
const FAKE_ORG = {
  id: TEST_ORG_ID,
  name: 'Test Partner Org',
  community: 'Test Community',
  venue_details: {},
  co_branding: '',
  status: 'active',
  notes: '',
  created_at: FIXED_DATE,
  updated_at: FIXED_DATE,
};
const FAKE_CONTACT = {
  id: 'contact_test_1',
  partner_org_id: TEST_ORG_ID,
  name: 'Test Contact',
  email: 'contact@example.com',
  phone: '',
  role: 'primary',
  is_primary: true,
  created_at: FIXED_DATE,
};

/**
 * Exact-path → body map for endpoints that need a specific response.
 * Using a lookup table keeps `resolveMock` below Sonar's cognitive
 * complexity threshold (S3776) that a long `if` chain would blow.
 */
const EXACT_RESPONSES: Record<string, unknown> = {
  '/auth/me': FAKE_USER,
  '/auth/logout': { ok: true },
  '/projects/dashboard': EMPTY_COORDINATION_DASHBOARD,
  '/projects/board': EMPTY_BOARD,
  '/coordination/partner-health': { partners: [] },
  '/coordination/summary': {},
  '/coordination/by-community': [],
  '/portal/dashboard': {
    upcoming_classes: 0,
    open_tasks: 0,
    overdue_tasks: 0,
    classes_hosted: 0,
    projects: [],
  },
  '/system/config': { hub_lat: 41.5868, hub_lng: -93.625 },
  '/dashboard/stats': {
    total_schedules: 0,
    upcoming_schedules: 0,
    total_locations: 0,
    total_employees: 0,
  },
  '/activity-logs': { items: [] },
  '/workload': { employees: [] },
};

/**
 * Prefix → body map for endpoints whose URL carries path parameters
 * (e.g. `/portal/auth/verify/:token`) or query-style suffixes.
 */
const PREFIX_RESPONSES: ReadonlyArray<readonly [string, unknown]> = [
  ['/portal/auth/verify/', { org: FAKE_ORG, contact: FAKE_CONTACT }],
  ['/analytics/trends', { series: [] }],
  ['/analytics/forecast', { forecast: [] }],
  ['/analytics/drive-optimization', { routes: [] }],
  ['/reports/weekly-summary', { totals: {}, rows: [] }],
];

/**
 * Resolve the mock response body for a given API path. Returns an
 * empty array by default — most list-like endpoints tolerate `[]`
 * (they feed through the `extractItems` helper in
 * `hooks/useCoordinationData.ts`) and empty-object property lookups
 * return `undefined` without throwing.
 */
function resolveMock(path: string): unknown {
  const exact = EXACT_RESPONSES[path];
  if (exact !== undefined) return exact;
  for (const [prefix, body] of PREFIX_RESPONSES) {
    if (path.startsWith(prefix)) return body;
  }
  return [];
}

/**
 * Override the default `page` fixture so every test gets a pre-mocked
 * Page with all `/api/v1/**` requests intercepted and a fake CSRF
 * cookie in place.
 */
// Playwright's fixture callback convention names this second parameter
// `use`. Sonar's `react-hooks/rules-of-hooks` rule misreads that as a
// React Hook call and flags it; renaming to `provide` sidesteps the
// false positive without changing Playwright semantics (the parameter
// is positional).
export const test = base.extend({
  page: async ({ page }, provide) => {
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
      const body = resolveMock(path);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    await provide(page);
  },
});

export { expect } from '@playwright/test';
