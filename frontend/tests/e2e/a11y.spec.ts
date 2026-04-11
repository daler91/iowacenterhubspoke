import AxeBuilder from '@axe-core/playwright';
import { test, expect, installApiMocks } from './fixtures';

/**
 * Accessibility smoke tests. Walks each top-level protected route, runs
 * axe-core, and asserts that there are 0 violations classified as
 * `critical` or `serious`. Lower-severity violations are logged but
 * don't fail the build — they're tracked as follow-up work.
 *
 * Routes covered:
 *   - /calendar              (default landing page after login)
 *   - /kanban                (drag-drop board)
 *   - /insights              (analytics hub)
 *   - /map                   (map view)
 *   - /locations             (location manager)
 *   - /employees             (employee manager)
 *   - /classes               (class manager)
 *   - /coordination          (community dashboard)
 *   - /coordination/board    (project board)
 */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/kanban', name: 'kanban' },
  { path: '/insights', name: 'insights' },
  { path: '/map', name: 'map' },
  { path: '/locations', name: 'locations' },
  { path: '/employees', name: 'employees' },
  { path: '/classes', name: 'classes' },
  { path: '/coordination', name: 'coordination dashboard' },
  { path: '/coordination/board', name: 'coordination board' },
];

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

for (const { path, name } of ROUTES) {
  test(`a11y: ${name} (${path}) has no critical or serious violations`, async ({ page }) => {
    await page.goto(path);
    // Wait for the page to settle so lazy-loaded chunks and async data
    // are in the DOM before axe scans it.
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      // Only scan main content; the third-party next-themes ThemeProvider
      // injects a stub element that axe sometimes flags spuriously.
      .include('body')
      .analyze();

    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    if (blocking.length > 0) {
      // Emit a concise diff so CI logs show which rule failed where.
      for (const v of blocking) {
        console.error(`[a11y] ${v.id} (${v.impact}) — ${v.help}`);
        for (const node of v.nodes) {
          console.error(`  target: ${node.target.join(' ')}`);
        }
      }
    }

    expect(blocking, `expected 0 critical/serious a11y violations on ${path}`).toEqual([]);
  });
}
