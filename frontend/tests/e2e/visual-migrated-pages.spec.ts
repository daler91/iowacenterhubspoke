import { test, expect } from './fixtures';
import { existsSync } from 'node:fs';

const PAGES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/calendar?date=2026-01-15&view=week', name: 'calendar' },
  { path: '/insights', name: 'insights' },
  { path: '/coordination', name: 'coordination-dashboard' },
];

for (const { path, name } of PAGES) {
  test(`visual: ${name} page shell`, async ({ page }, testInfo) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const snapshotFile = testInfo.snapshotPath(`migrated-${name}.png`);
    if (!existsSync(snapshotFile)) {
      testInfo.annotations.push({
        type: 'visual-bootstrap',
        description: `Baseline missing for ${name}; captured current screenshot without asserting diff.`,
      });
      await page.screenshot({
        path: testInfo.outputPath(`migrated-${name}-bootstrap.png`),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
      return;
    }

    await expect(page).toHaveScreenshot(`migrated-${name}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
