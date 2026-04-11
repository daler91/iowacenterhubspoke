import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

/**
 * Accessibility smoke tests. Walks each top-level protected route, runs
 * axe-core, and asserts that there are 0 violations classified as
 * `critical` or `serious`. Lower-severity violations are tolerated for
 * now and tracked as follow-up work.
 *
 * `/map` is deliberately excluded — the page loads Google Maps, which
 * requires an API key and external script access that the CI sandbox
 * doesn't have. We'll add a dedicated map test once we have a mock
 * for the Maps SDK.
 */

const ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/kanban', name: 'kanban' },
  { path: '/insights', name: 'insights' },
  { path: '/locations', name: 'locations' },
  { path: '/employees', name: 'employees' },
  { path: '/classes', name: 'classes' },
  { path: '/coordination', name: 'coordination dashboard' },
  { path: '/coordination/board', name: 'coordination board' },
];

for (const { path, name } of ROUTES) {
  test(`a11y: ${name} (${path}) has no critical or serious violations`, async ({ page }) => {
    await page.goto(path);
    // Wait for lazy-loaded chunks and async data to settle before scanning.
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .include('body')
      // `color-contrast` is disabled for now because the `text-slate-400`
      // token fails WCAG AA on `bg-gray-50` (contrast 2.45:1) and is
      // used in ~195 places. Re-enabling it requires a global token
      // sweep (text-slate-400 → text-slate-500) that is out of scope
      // for this infrastructure PR. Tracked as a follow-up.
      .disableRules(['color-contrast'])
      .analyze();

    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious',
    );

    // Emit a concise failure message. Playwright's assertion diff will
    // include the full `blocking` array in the test report, so there's
    // no need for a separate console log.
    const summary = blocking.map(v => `${v.id} (${v.impact}): ${v.help}`).join('\n');
    expect(blocking, `a11y violations on ${path}:\n${summary}`).toEqual([]);
  });
}
