import { test, expect } from './fixtures';

/**
 * Keyboard navigation smoke tests.
 *
 * For a handful of representative routes, assert that:
 *   1. Tabbing from the top of the page moves focus through at least
 *      two distinct interactive elements (no keyboard trap, focusable
 *      content exists).
 *   2. The first focused element has a visible focus indicator — an
 *      outline or a box-shadow.
 */

const ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/kanban', name: 'kanban' },
  { path: '/coordination/board', name: 'project board' },
  { path: '/employees', name: 'employees' },
];

for (const { path, name } of ROUTES) {
  test(`keyboard: ${name} advances focus on Tab`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

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

    const distinctFocused = new Set(focusedTags.filter(t => t !== 'BODY'));
    expect(
      distinctFocused.size,
      `expected focus to advance through at least 2 interactive elements on ${path}`,
    ).toBeGreaterThanOrEqual(2);
  });

  test(`keyboard: ${name} focused element has a visible ring`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Tab');

    const hasRing = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const style = globalThis.getComputedStyle(el);
      const hasOutline = style.outlineStyle !== 'none' && style.outlineStyle !== '';
      const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      return hasOutline || hasBoxShadow;
    });

    expect(hasRing, `focused element on ${path} must have an outline or box-shadow ring`).toBe(true);
  });
}
