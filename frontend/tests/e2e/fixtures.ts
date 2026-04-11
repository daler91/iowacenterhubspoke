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

// Minimal PartnerOrg + PartnerContact for the portal verify response.
const FAKE_ORG = {
  id: 'org_test_1',
  name: 'Test Partner Org',
  community: 'Test Community',
  venue_details: {},
  co_branding: '',
  status: 'active',
  notes: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const FAKE_CONTACT = {
  id: 'contact_test_1',
  partner_org_id: 'org_test_1',
  name: 'Test Contact',
  email: 'contact@example.com',
  phone: '',
  role: 'primary',
  is_primary: true,
  created_at: '2026-01-01T00:00:00Z',
};

/**
 * Resolve the mock response body for a given API path. Returns an empty
 * array by default — most list-like endpoints in this app tolerate
 * either `[]` or `{items: []}`, and empty object lookups return
 * `undefined` without throwing.
 */
function resolveMock(path: string): unknown {
  // Auth
  if (path === '/auth/me') return FAKE_USER;
  if (path === '/auth/logout') return { ok: true };

  // Coordination — full shapes so the pages actually render
  if (path === '/projects/dashboard') return EMPTY_COORDINATION_DASHBOARD;
  if (path === '/projects/board') return EMPTY_BOARD;
  if (path === '/coordination/partner-health') return { partners: [] };
  if (path === '/coordination/summary') return {};
  if (path === '/coordination/by-community') return [];

  // Portal — full shapes so PortalDashboard renders instead of
  // "Access Denied"
  if (path.startsWith('/portal/auth/verify/')) {
    return { org: FAKE_ORG, contact: FAKE_CONTACT };
  }
  if (path === '/portal/dashboard') {
    return {
      upcoming_classes: 0,
      open_tasks: 0,
      overdue_tasks: 0,
      classes_hosted: 0,
      projects: [],
    };
  }

  // System + dashboard stats — object shapes
  if (path === '/system/config') return { hub_lat: 41.5868, hub_lng: -93.6250 };
  if (path === '/dashboard/stats') {
    return {
      total_schedules: 0,
      upcoming_schedules: 0,
      total_locations: 0,
      total_employees: 0,
    };
  }

  // Activity + workload + notifications — object wrappers
  if (path === '/activity-logs') return { items: [] };
  if (path === '/workload') return { employees: [] };

  // Analytics + reports — keyed object shapes
  if (path.startsWith('/analytics/trends')) return { series: [] };
  if (path.startsWith('/analytics/forecast')) return { forecast: [] };
  if (path.startsWith('/analytics/drive-optimization')) return { routes: [] };
  if (path.startsWith('/reports/weekly-summary')) return { totals: {}, rows: [] };

  // Default: empty list. Covers /locations, /employees, /classes,
  // /schedules, /users, /users/invitations, /notifications, /projects,
  // /partner-orgs, /project-templates, /portal/projects, etc.
  return [];
}

/**
 * Override the default `page` fixture so every test gets a pre-mocked
 * Page with all `/api/v1/**` requests intercepted and a fake CSRF
 * cookie in place.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
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

    await use(page);
  },
});

export { expect } from '@playwright/test';
