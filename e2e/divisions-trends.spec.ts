import { test, expect, type Page } from '@playwright/test';
import { oracle, PERSON_PAY, main } from './oracle';

/**
 * Divisions › Trends (D17–D20): dollars from $0 or each line as an index of its first snapshot (the Log toggle
 * went); the median with its 10th–90th band, or a line for each employee category; a taller headcount panel; and
 * where the renewable line starts, said.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

const card = (page: Page) => page.locator('.mantine-Card-root', { hasText: 'and headcount over time' });
async function trends(page: Page) {
  await page.goto('./divisions?tab=trends');
  await expect(card(page).locator('.recharts-line-curve').first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(800);
}
/** The chart's table, last row (the latest snapshot), by column name. */
async function latestRow(page: Page) {
  const c = card(page);
  if (!(await c.locator('table').count())) await c.getByRole('button', { name: "Table of this chart's data" }).click();
  const heads = (await c.locator('table thead th').allInnerTexts()).map((h) => h.trim());
  const cells = await c.locator('table tbody tr').last().locator('td').allInnerTexts();
  return (name: string) => Number((cells[heads.indexOf(name)] ?? '').replace(/[^\d.]/g, ''));
}
const latestId = async () => (await oracle<{ id: string }>(`SELECT snapshot_id id FROM $SAL GROUP BY 1 ORDER BY any_value(snapshot_date) DESC LIMIT 1`))[0].id;

test('dollars from $0 with the middle 80% as a band, matching the people', async ({ page }) => {
  const snap = await latestId();
  const [q] = await oracle<{ p10: number; p90: number }>(
    `WITH p AS (SELECT person_key, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1)
     SELECT quantile_cont(pay, 0.1) FILTER (WHERE pay > 0) p10, quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90 FROM p`
  );
  await trends(page);
  const ticks = await card(page).locator('.recharts-yAxis').first().locator('.recharts-cartesian-axis-tick-value').allTextContents();
  expect(ticks).toContain('$0');
  await expect(card(page).locator('.trend-p10-band')).toHaveCount(1);
  await expect(card(page).getByText('Log', { exact: true })).toHaveCount(0);
  const cell = await latestRow(page);
  expect(Math.abs(cell('10th percentile') - q.p10)).toBeLessThanOrEqual(1);
  expect(Math.abs(cell('90th percentile') - q.p90)).toBeLessThanOrEqual(1);
  // The headcount panel is tall enough to read.
  const heights = await card(page).locator('.recharts-wrapper').evaluateAll((ws) => ws.map((w) => w.getBoundingClientRect().height));
  expect(heights[heights.length - 1]).toBeGreaterThanOrEqual(170);
  await expect(card(page).locator('.renew-note')).toHaveText('Ongoing (renewable) appointments are reported from Sep 2025, so that line starts there.');
});

test('as an index, each line runs from 100 at its first snapshot', async ({ page }) => {
  await trends(page);
  await card(page).getByText('Index', { exact: true }).click();
  const axis = card(page).locator('.recharts-yAxis').first();
  await expect(axis.locator('.recharts-label')).toContainText('= 100');
  const ticks = (await axis.locator('.recharts-cartesian-axis-tick-value').allTextContents()).map(Number);
  expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
  expect(Math.min(...ticks)).toBeLessThanOrEqual(100);
  expect(Math.max(...ticks)).toBeGreaterThan(100);
  // The first point sits on 100: the line's first dot at the y of 100 on the axis.
  const y100 = await axis.evaluate((a) => {
    // A tick's text sits at its value's y (its line is not drawn).
    const ts = [...a.querySelectorAll('.recharts-cartesian-axis-tick')].map((t) => ({ v: Number(t.textContent), y: Number(t.querySelector('text')!.getAttribute('y')) }));
    const [p, q] = [ts[0], ts[ts.length - 1]];
    return p.y + ((100 - p.v) / (q.v - p.v)) * (q.y - p.y);
  });
  const first = await card(page).locator('.recharts-line-dots').first().locator('circle').first().evaluate((c) => Number(c.getAttribute('cy')));
  expect(Math.abs(first - y100)).toBeLessThanOrEqual(1.5);
  // The table keeps dollars.
  const cell = await latestRow(page);
  expect(cell('Median actual pay')).toBeGreaterThan(1000);
});

test('by category: a line for each, named, and its median the people’s', async ({ page }) => {
  const snap = await latestId();
  const [f] = await oracle<{ med: number }>(
    `WITH p AS (SELECT person_key, ${PERSON_PAY} pay, ${main('employee_category')} c FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1)
     SELECT median(pay) FILTER (WHERE pay > 0) med FROM p WHERE c = 'Faculty'`
  );
  await trends(page);
  await card(page).getByText('By category', { exact: true }).click();
  await expect(card(page).locator('.trend-cat')).toHaveCount(5, { timeout: 60_000 });
  for (const name of ['Faculty', 'Academic Staff', 'University Staff', 'Employees in Training', 'Limited']) {
    await expect(card(page).locator('svg').getByText(name, { exact: true })).toBeVisible();
  }
  await expect(card(page).locator('.trend-p10-band')).toHaveCount(0);
  await expect(card(page).locator('.renew-note')).toContainText('University Staff and some trainees appear only as codes before Apr 2024');
  const cell = await latestRow(page);
  expect(Math.abs(cell('Faculty') - f.med)).toBeLessThanOrEqual(1);
  // Spelled "Employee-in-Training" in Apr 2025, the latest's name all the same: its line runs through.
  const c = card(page);
  const heads = (await c.locator('table thead th').allInnerTexts()).map((h) => h.trim());
  const apr = await c.locator('table tbody tr', { hasText: 'Apr 2025' }).locator('td').allInnerTexts();
  expect(apr[heads.indexOf('Employees in Training')]?.replace(/[^\d]/g, '')).not.toBe('');
});
