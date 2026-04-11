import { devices, type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Mobile viewport smoke tests. Uses the Pixel 5 device preset (a
 * chromium-based mobile profile) so the suite runs on the same
 * browser as the rest of the e2e tests — `iPhone 12` would require
 * installing webkit separately.
 */

// Shared constant so Sonar doesn't flag the literal as duplicated.
const NETWORK_IDLE = 'networkidle' as const;

test.use({ ...devices['Pixel 5'] });

async function horizontalOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

test('mobile: /calendar fits within viewport (no horizontal scroll)', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState(NETWORK_IDLE);
  // Tolerate 1px rounding.
  expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1);
});

test('mobile: sidebar is off-canvas by default and opens via hamburger', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState(NETWORK_IDLE);

  // The sidebar always has the static `md:translate-x-0` class for the
  // desktop layout, so a plain `/translate-x-0/` regex would pass even
  // when the mobile drawer is closed. The reliable signal is whether
  // the `-translate-x-full` off-canvas class is present.
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toHaveClass(/-translate-x-full/);

  await page.getByRole('button', { name: /open navigation menu/i }).click();
  await expect(sidebar).not.toHaveClass(/-translate-x-full/);
});

test('mobile: /portal/:token renders without horizontal scroll', async ({ page }) => {
  await page.goto('/portal/test-token');
  await page.waitForLoadState(NETWORK_IDLE);
  expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1);
});
