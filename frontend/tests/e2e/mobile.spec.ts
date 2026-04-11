import { devices } from '@playwright/test';
import { test, expect, installApiMocks } from './fixtures';

/**
 * Mobile viewport smoke tests. Uses the iPhone 12 device preset to
 * verify that key pages render without horizontal scroll and that the
 * off-canvas sidebar opens on demand.
 */

test.use({ ...devices['iPhone 12'] });

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('mobile: /calendar fits within viewport (no horizontal scroll)', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // Tolerate 1px rounding; the body should not require horizontal
  // scrolling on a 390-wide iPhone 12 viewport.
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1);
});

test('mobile: sidebar is off-canvas by default and opens via hamburger', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  // The sidebar container should start translated off-screen. The
  // DashboardPage toggles `translate-x-0` / `-translate-x-full` based
  // on `mobileSidebarOpen` state.
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toHaveClass(/-translate-x-full/);

  // Click the hamburger button (aria-label="Open navigation menu").
  await page.getByRole('button', { name: /open navigation menu/i }).click();
  await expect(sidebar).toHaveClass(/translate-x-0/);
});

test('mobile: /portal/:token renders without horizontal scroll', async ({ page }) => {
  await page.goto('/portal/test-token');
  await page.waitForLoadState('networkidle');

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1);
});
