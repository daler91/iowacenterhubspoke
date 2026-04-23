import AxeBuilder from '@axe-core/playwright';
import type { AxeResults } from 'axe-core';
import { test, expect } from './fixtures';

/**
 * Axe scans for interactive surfaces that the initial-render
 * `a11y.spec.ts` can't reach: modal dialogs, dropdowns, and other UI
 * that only mounts after user interaction. Keeps the same
 * critical+serious failure gate as the base spec. Moderate+minor
 * violations are summarised in the console but not fail the build —
 * they'll show up in the Playwright HTML report for triage.
 */

const BLOCKING_IMPACTS: ReadonlyArray<'critical' | 'serious'> = ['critical', 'serious'];

function summariseViolations(results: AxeResults): string {
  return results.violations
    .map(v => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
    .join('\n');
}

function blocking(results: AxeResults): AxeResults['violations'] {
  return results.violations.filter(v => BLOCKING_IMPACTS.includes(v.impact as 'critical' | 'serious'));
}

test('a11y: ScheduleForm wizard has no critical or serious violations', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  // The wizard opens via the `N` hotkey (see DashboardPage / useHotkey).
  // That's the most surface-agnostic path — no sidebar DOM lookup needed.
  await page.keyboard.press('n');
  await page.getByTestId('schedule-form-dialog').waitFor({ state: 'visible' });

  // Restrict the scan to the dialog so we don't re-report violations the
  // base route spec already covers.
  const results = await new AxeBuilder({ page })
    .include('[data-testid="schedule-form-dialog"]')
    .analyze();

  const offenders = blocking(results);
  expect(
    offenders,
    `ScheduleForm dialog a11y violations:\n${summariseViolations(results)}`,
  ).toEqual([]);
});

test('a11y: NotificationsPanel dropdown has no critical or serious violations', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('notifications-bell').click();
  await page.getByTestId('notifications-dropdown').waitFor({ state: 'visible' });

  const results = await new AxeBuilder({ page })
    .include('[data-testid="notifications-dropdown"]')
    .analyze();

  const offenders = blocking(results);
  expect(
    offenders,
    `NotificationsPanel a11y violations:\n${summariseViolations(results)}`,
  ).toEqual([]);
});

test('a11y: keyboard-shortcut cheatsheet has no critical or serious violations', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('?');
  await page.getByTestId('shortcut-cheatsheet').waitFor({ state: 'visible' });

  const results = await new AxeBuilder({ page })
    .include('[data-testid="shortcut-cheatsheet"]')
    .analyze();

  const offenders = blocking(results);
  expect(
    offenders,
    `ShortcutCheatsheet a11y violations:\n${summariseViolations(results)}`,
  ).toEqual([]);
});
