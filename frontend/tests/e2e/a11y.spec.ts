import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

// Run these scans with reduced motion emulated.
//
// The app wraps its keyframes in `@media (prefers-reduced-motion: no-preference)`
// (see src/App.css), so this disables them at the source rather than papering
// over them with injected CSS. That matters for correctness, not just tidiness:
// `waitFor({ state: 'visible' })` resolves as soon as an element has a bounding
// box, which is the *start* of the 300ms `slideIn` opacity fade. Axe would then
// sample a partially-transparent foreground and compute a contrast ratio lower
// than the settled one — 4.17 vs the real value for `text-foreground/80`,
// tripping the serious-impact gate. It passed locally on one worker and failed
// intermittently in CI on two, which is exactly the shape of that race.
test.use({ reducedMotion: 'reduce' });


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
  { path: '/portal/test-token', name: 'partner portal home' },
  { path: '/portal/test-token/projects/project-1', name: 'partner project hub' },
];

for (const { path, name } of ROUTES) {
  test(`a11y: ${name} (${path}) has no critical or serious violations`, async ({ page }) => {
    await page.goto(path);
    // Wait for lazy-loaded chunks and async data to settle before scanning.
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).include('body').analyze();

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
