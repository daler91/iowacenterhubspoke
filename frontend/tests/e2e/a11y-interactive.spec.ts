import AxeBuilder from '@axe-core/playwright';
import type { AxeResults } from 'axe-core';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Axe scans for interactive surfaces that the initial-render
 * `a11y.spec.ts` can't reach: modal dialogs, dropdowns, and other UI
 * that only mounts after user interaction. Same `critical` +
 * `serious` failure gate as the base spec. Lower-severity violations
 * surface in the Playwright HTML report for triage without blocking
 * the build.
 */

const BLOCKING_IMPACTS: ReadonlyArray<'critical' | 'serious'> = ['critical', 'serious'];

function summariseViolations(results: AxeResults): string {
  return results.violations
    .map(v => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
    .join('\n');
}

function blockingViolations(results: AxeResults): AxeResults['violations'] {
  return results.violations.filter(v => BLOCKING_IMPACTS.includes(v.impact as 'critical' | 'serious'));
}

interface InteractiveSurface {
  readonly name: string;
  readonly testId: string;
  readonly open: (page: Page) => Promise<void>;
}

const SURFACES: ReadonlyArray<InteractiveSurface> = [
  {
    name: 'ScheduleForm wizard',
    testId: 'schedule-form-dialog',
    // Triggered via the global `N` hotkey (wired in Phase 7). Using the
    // hotkey keeps the test independent of sidebar DOM structure.
    open: async (page) => { await page.keyboard.press('n'); },
  },
  {
    name: 'NotificationsPanel dropdown',
    testId: 'notifications-dropdown',
    open: async (page) => { await page.getByTestId('notifications-bell').click(); },
  },
  {
    name: 'ShortcutCheatsheet modal',
    testId: 'shortcut-cheatsheet',
    open: async (page) => { await page.keyboard.press('?'); },
  },
];

for (const { name, testId, open } of SURFACES) {
  test(`a11y: ${name} has no critical or serious violations`, async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    await open(page);
    await page.getByTestId(testId).waitFor({ state: 'visible' });

    // `.include(...)` scopes the scan to the surface so we don't
    // double-report violations the base route spec already covers.
    const results = await new AxeBuilder({ page })
      .include(`[data-testid="${testId}"]`)
      .analyze();

    expect(
      blockingViolations(results),
      `${name} a11y violations:\n${summariseViolations(results)}`,
    ).toEqual([]);
  });
}
