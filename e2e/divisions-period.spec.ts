import { test, expect, type Page } from '@playwright/test';
import { oracle, PERSON_PAY } from './oracle';

/**
 * Divisions' one period and its controls (D1–D6): the control bar's From and snapshot are the page's period, and the
 * figures, the median growth, Trends and Changes read it; the dollars are the bar's; Changes takes the page's scope;
 * the payroll names its measure; Reset only when something is set; on a phone, one button and a sheet, and the
 * figures a row that scrolls sideways.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

async function snaps() {
  return oracle<{ id: string; lbl: string; d: string }>(
    `SELECT snapshot_id id, any_value(snapshot_label) lbl, CAST(any_value(snapshot_date) AS VARCHAR) d FROM $SAL GROUP BY 1 ORDER BY d, id LIKE '%-post'`
  );
}
const bar = (page: Page) => page.locator('.mantine-Paper-root', { has: page.getByRole('textbox', { name: 'Snapshot', exact: true }) });
const tile = (page: Page, label: string) => page.locator('.stat-cell', { hasText: label }).first();

test('one period: the bar’s From and snapshot, read by the figures, the growth, Trends and Changes', async ({ page }) => {
  const all = await snaps();
  const latest = all[all.length - 1];
  const before = [...all].reverse().find((s) => s.d < latest.d)!;
  await page.goto('./divisions');
  const from = bar(page).getByRole('textbox', { name: 'From snapshot' });
  await expect(from).toHaveValue(before.lbl, { timeout: 60_000 });
  // No period of their own in the tiles.
  await expect(page.locator('.growth-pickers')).toHaveCount(0);
  await expect(tile(page, 'Median pay growth').locator('.growth-period')).toHaveText(new RegExp(`^${before.lbl.replace(/[()]/g, '\\$&')} → ${latest.lbl.replace(/[()]/g, '\\$&')}( · |$)`));
  await expect(tile(page, 'Headcount')).toContainText(`${before.lbl} → ${latest.lbl}`);
  // The growth is the period's: the median of everyone's actual pay at its two ends (no reporting change between).
  const [m] = await oracle<{ a: number; b: number }>(
    `WITH p AS (SELECT snapshot_id, person_key, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id IN ('${before.id}', '${latest.id}') GROUP BY 1, 2)
     SELECT median(pay) FILTER (WHERE snapshot_id = '${before.id}' AND pay > 0) a, median(pay) FILTER (WHERE snapshot_id = '${latest.id}' AND pay > 0) b FROM p`
  );
  const g = m.b / m.a - 1;
  await expect(tile(page, 'Median pay growth').locator('[data-figure="median-growth"]')).toHaveText(`${g >= 0 ? '+' : '−'}${Math.abs(g * 100).toFixed(1)}%`);
  // Choose another start: every reader follows, and the address keeps it.
  const start = all.find((s) => s.id.endsWith('-post'))!;
  await from.click();
  // Each snapshot by its one name (E17).
  await page.getByRole('option', { name: start.lbl, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`from=${start.id}`));
  // Across years, its reading after inflation beside it (E14).
  await expect(tile(page, 'Median pay growth').locator('.growth-period')).toHaveText(new RegExp(`^${start.lbl.replace(/[()]/g, '\\$&')} → ${latest.lbl.replace(/[()]/g, '\\$&')} · [+−-][\\d.]+% after inflation$`));
  await expect(tile(page, 'Headcount')).toContainText(`${start.lbl} → ${latest.lbl}`);
  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.locator('.changes-lead')).toContainText(`Between ${start.lbl} and ${latest.lbl}`, { timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveCount(0);
  // A quick range moves the page's period.
  await page.getByRole('button', { name: 'Latest pair' }).click();
  await expect(from).toHaveValue(before.lbl);
  await expect(page).not.toHaveURL(/from=/);
  await page.getByRole('tab', { name: 'Trends' }).click();
  await expect(page.locator('.trend-period')).toHaveCount(1, { timeout: 60_000 });
});

test('the dollars are the bar’s: the growth tile and Trends have no toggle of their own', async ({ page }) => {
  await page.goto('./divisions?tab=trends');
  const toggle = bar(page).getByText('2026 $', { exact: true });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.stat-row').getByText('Nominal', { exact: true })).toHaveCount(0);
  // Once the tab has drawn: its chart's shading is the last thing in.
  await expect(page.locator('.trend-period')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByRole('tabpanel').getByText('Nominal', { exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(tile(page, 'Median pay growth').locator('.growth-period')).toContainText('in 2026 dollars');
  await expect(page.getByText(/Shown in 2026 dollars/)).toBeVisible();
});

test('Changes reads the page’s scope, with no School or Department of its own', async ({ page }) => {
  const continuing = async () => Number(((await page.locator('.stat-cell', { hasText: 'Continuing' }).first().innerText()).match(/\d[\d,]*/)?.[0] ?? '0').replace(/,/g, ''));
  await page.goto('./divisions?tab=changes');
  await expect(page.locator('.changes-lead')).toBeVisible({ timeout: 60_000 });
  await expect.poll(continuing, { timeout: 60_000 }).toBeGreaterThan(0);
  const all = await continuing();
  await page.goto(`./divisions?tab=changes&school=${encodeURIComponent('College of Engineering')}`);
  await expect(page.locator('.changes-lead')).toContainText('in College of Engineering', { timeout: 60_000 });
  // Its figures are the division's, not all of UW's.
  await expect.poll(continuing, { timeout: 60_000 }).toBeLessThan(all / 5);
  await expect(page.getByRole('textbox', { name: 'School', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Department', exact: true })).toHaveCount(0);
});

test('the payroll says what it sums, and that the Pay setting leaves it be', async ({ page }) => {
  await page.goto('./divisions');
  const payroll = tile(page, 'Total payroll');
  await expect(payroll.locator('.payroll-measure')).toHaveText('actual pay, summed: each person at their FTE, under either Pay setting', { timeout: 60_000 });
  const figure = async () => (await payroll.locator('p').first().innerText()).trim();
  const a = await figure();
  await bar(page).getByText('Full-time rate', { exact: true }).click();
  await expect(page).toHaveURL(/metric=full/);
  await page.waitForTimeout(1500);
  expect(await figure()).toBe(a);
});

test('Reset shows only when something is set, and clears it all at once', async ({ page }) => {
  await page.goto('./divisions');
  await expect(bar(page).getByRole('textbox', { name: 'Snapshot', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(bar(page).getByRole('button', { name: 'Reset' })).toHaveCount(0);
  await page.goto(`./divisions?school=${encodeURIComponent('College of Engineering')}&metric=full&from=2025-04`);
  const reset = bar(page).getByRole('button', { name: 'Reset' });
  await expect(reset).toBeVisible({ timeout: 60_000 });
  await reset.click();
  await expect(page).not.toHaveURL(/school=|metric=|from=|snap=|filt=/);
  await expect(reset).toHaveCount(0);
});

test('on a phone: one View button and a sheet, and the figures scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./divisions');
  const view = page.locator('.control-sheet-button');
  await expect(view).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'Snapshot', exact: true })).toHaveCount(0);
  await view.click();
  const sheet = page.getByRole('dialog', { name: 'View' });
  await expect(sheet.getByRole('textbox', { name: 'Snapshot', exact: true })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'From snapshot' })).toBeVisible();
  await page.keyboard.press('Escape');
  const row = page.locator('.kpi-scroll .stat-row');
  await expect(row.locator('.stat-cell').nth(1)).toBeAttached({ timeout: 60_000 });
  const g = await row.evaluate((r) => ({ sw: r.scrollWidth, cw: r.clientWidth, first: r.children[0].getBoundingClientRect().width, h: r.getBoundingClientRect().height }));
  expect(g.sw, 'the figures do not scroll sideways').toBeGreaterThan(g.cw + 50);
  expect(g.first / g.cw).toBeGreaterThan(0.7);
  expect(g.h, 'the figures stack down the screen').toBeLessThan(260);
  // The button's word is whole, not cut to "Vi".
  const label = view.locator('.mantine-Button-label');
  expect(await label.evaluate((l) => l.scrollWidth <= l.clientWidth + 1 && l.getBoundingClientRect().width >= 24), 'the View button is squeezed').toBe(true);
});
