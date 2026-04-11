import { devices } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Mobile viewport smoke tests. Uses the iPhone 12 device preset to
 * verify that key pages render without horizontal scroll and that the
 * off-canvas sidebar opens on demand.
 */

test.use({ ...devices['iPhone 12'] });

async function getOverflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

test('mobile: /calendar fits within viewport (no horizontal scroll)', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  // Tolerate 1px rounding.
  expect(await getOverflow(page)).toBeLessThanOrEqual(1);
});

test('mobile: sidebar is off-canvas by default and opens via hamburger', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toHaveClass(/-translate-x-full/);

  await page.getByRole('button', { name: /open navigation menu/i }).click();
  await expect(sidebar).toHaveClass(/translate-x-0/);
});

test('mobile: /portal/:token renders without horizontal scroll', async ({ page }) => {
  await page.goto('/portal/test-token');
  await page.waitForLoadState('networkidle');
  expect(await getOverflow(page)).toBeLessThanOrEqual(1);
});
