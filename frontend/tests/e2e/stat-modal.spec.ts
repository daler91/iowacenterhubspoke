import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const MIN_COMFORTABLE_MODAL_HEIGHT = 560;

async function horizontalOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

async function openTeamStatModal(page: Page) {
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('calendar-stats-strip')).toBeVisible();
  await page.getByRole('button', { name: /team/i }).click();
  await expect(page.getByTestId('stat-modal')).toBeVisible();
}

test('calendar stat modal opens at a comfortable desktop size', async ({ page }) => {
  await openTeamStatModal(page);

  const modalBox = await page.getByTestId('stat-modal').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox?.height).toBeGreaterThanOrEqual(MIN_COMFORTABLE_MODAL_HEIGHT);

  await expect(page.getByTestId('stat-modal-scroll-area')).toBeVisible();
});

test('mobile: calendar stat modal fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await openTeamStatModal(page);

  expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1);
});
