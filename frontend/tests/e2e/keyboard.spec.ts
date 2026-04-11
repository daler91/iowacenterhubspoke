import { test, expect, installApiMocks } from './fixtures';

/**
 * Keyboard navigation smoke tests.
 *
 * For a handful of representative routes, assert that:
 *   1. Tabbing from the top of the page moves focus through interactive
 *      elements (doesn't get stuck on the first focusable child).
 *   2. Focusable elements have a visible focus ring — we can't introspect
 *      `:focus-visible` pseudo-classes directly, but we can check that
 *      a focused element has a non-default outline/box-shadow that
 *      signals a ring.
 */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/kanban', name: 'kanban' },
  { path: '/coordination/board', name: 'project board' },
  { path: '/employees', name: 'employees' },
];

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

for (const { path, name } of ROUTES) {
  test(`keyboard: ${name} advances focus on Tab`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    // Press Tab a few times; record which element owns focus after each.
    const focusedTags: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'BODY';
        return el.tagName.toLowerCase();
      });
      focusedTags.push(tag);
    }

    // We expect focus to have landed on at least two distinct non-body
    // elements — if it gets stuck on <body>, the page has a keyboard trap
    // or no focusable content.
    const distinctFocused = new Set(focusedTags.filter(t => t !== 'BODY'));
    expect(
      distinctFocused.size,
      `expected focus to advance through at least 2 interactive elements on ${path}`,
    ).toBeGreaterThanOrEqual(2);
  });

  test(`keyboard: ${name} focused element has a visible ring`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    // Focus the first interactive element.
    await page.keyboard.press('Tab');

    const hasRing = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const style = globalThis.getComputedStyle(el);
      const outline = style.outlineStyle;
      const boxShadow = style.boxShadow;
      const hasOutline = outline !== 'none' && outline !== '';
      const hasBoxShadow = boxShadow !== 'none' && boxShadow !== '';
      return hasOutline || hasBoxShadow;
    });

    expect(hasRing, `focused element on ${path} must have an outline or box-shadow ring`).toBe(true);
  });
}
