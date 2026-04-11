import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Keyboard navigation smoke tests.
 *
 * For a handful of representative routes, assert that:
 *   1. Tabbing from the top of the page advances focus through at
 *      least two **distinct** elements (we track element identity by
 *      `outerHTML` snapshot, because a naive `tagName` check would
 *      report `{'button'}` for a button-heavy sidebar and always
 *      fail — see Codex P1 feedback).
 *   2. The first focused element has a visible focus indicator —
 *      either a non-`none` outline or a non-`none` box-shadow.
 */

const ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/kanban', name: 'kanban' },
  { path: '/coordination/board', name: 'project board' },
  { path: '/employees', name: 'employees' },
];

const TAB_PRESSES = 6;

/**
 * Return a short identity string for the currently-focused element —
 * either `'BODY'` (nothing meaningful focused) or a prefix of the
 * element's `outerHTML`. Different buttons in the same component will
 * have different labels / aria attributes, so their outerHTML snapshots
 * will differ even though they share the same tag.
 */
async function focusedIdentity(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    return el.outerHTML.slice(0, 200);
  });
}

for (const { path, name } of ROUTES) {
  test(`keyboard: ${name} advances focus to distinct elements on Tab`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const identities: string[] = [];
    for (let i = 0; i < TAB_PRESSES; i += 1) {
      await page.keyboard.press('Tab');
      identities.push(await focusedIdentity(page));
    }

    const nonBody = identities.filter(id => id !== 'BODY');
    const distinct = new Set(nonBody);

    expect(
      distinct.size,
      `expected at least 2 distinct focused elements on ${path}, got: ${[...distinct].length} unique, sample: ${nonBody[0]?.slice(0, 80)}`,
    ).toBeGreaterThanOrEqual(2);
  });

  test(`keyboard: ${name} focused element has a visible ring`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Tab');

    const hasRing = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const style = globalThis.getComputedStyle(el);
      const hasOutline = style.outlineStyle !== 'none' && style.outlineStyle !== '';
      const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      return hasOutline || hasBoxShadow;
    });

    expect(hasRing, `focused element on ${path} must have an outline or box-shadow ring`).toBe(true);
  });
}
