import { test, expect } from './fixtures';

const PAGES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/calendar', name: 'calendar' },
  { path: '/insights', name: 'insights' },
  { path: '/coordination', name: 'coordination-dashboard' },
];

for (const { path, name } of PAGES) {
  test(`visual: ${name} page shell`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`migrated-${name}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
