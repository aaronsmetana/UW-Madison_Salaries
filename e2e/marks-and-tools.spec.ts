import { test, expect } from '@playwright/test';
import { oracle } from './oracle';

/**
 * What a chart and a table say about themselves, and how a reader works them:
 * - a title paid by the hour says so beside its annualized median (G23);
 * - a histogram bar that filters is a button a keyboard reaches and presses (G21);
 * - a tab list that runs past a phone's edge fades out under a chevron (G25);
 * - the data's source is said once per page, and each chart's count and period are behind its About (G18);
 * - what a tab switch reveals is simply there, not drawn in (G8).
 */

const AARON = 'aaronsmetana|2014-10-15';

test("an hourly title is tagged where its median is, with the rate it stands for", async ({ page }) => {
  // Every title most of whose people are paid by the hour, from the data.
  const rows = await oracle<{ job_code: string; title: string; med: number }>(
    `WITH p AS (SELECT job_code, person_key, any_value(title) t, bool_and(coalesce(fte, 0) = 0) hr, sum(salary) pay
                FROM $SAL WHERE snapshot_id = (SELECT max(snapshot_id) FROM $SAL) AND salary > 0 GROUP BY 1, 2)
     SELECT job_code, any_value(t) title, median(pay) med FROM p GROUP BY 1
     HAVING avg(CASE WHEN hr THEN 1.0 ELSE 0.0 END) >= 0.5 ORDER BY count(*) DESC LIMIT 1`);
  const t = rows[0];
  expect(t, 'no hourly title in the data').toBeTruthy();
  await page.goto('./divisions?tab=titles');
  await page.getByPlaceholder(/search/i).first().fill(t.title);
  const row = page.locator('tbody tr', { has: page.locator(`a[href$="code=${t.job_code}"]`) });
  await expect(row.locator('.hourly-tag')).toContainText('Hourly · annualized', { timeout: 60_000 });
  const rate = `$${(t.med / 2080).toFixed(2)}/hr`;
  await expect(row.locator('.hourly-tag')).toContainText(rate);
  // And a salaried title is not tagged.
  await page.getByPlaceholder(/search/i).first().fill('Professor');
  await expect(page.locator('tbody tr', { has: page.locator('a[href$="code=FA020"]') }).locator('.hourly-tag')).toHaveCount(0);
  // On the title's own page, beside its median.
  await page.goto(`./titles?code=${t.job_code}`);
  await expect(page.locator('[data-stat-card], .stat-cell').filter({ hasText: /^Median/ }).first().locator('.hourly-tag')).toBeVisible({ timeout: 60_000 });
});

for (const [kind, code] of [['bars', 'FA020'], ['stacked bricks', 'IT040']] as const) {
  test(`a histogram bar that filters is a button: Tab to it, Enter, and the filter shows as a chip (${kind})`, async ({ page }) => {
    await page.goto(`./titles?code=${code}`);
    const bar = page.locator('.hist-pick').first();
    await expect(bar).toBeAttached({ timeout: 60_000 });
    // Once drawn: a bar still rising is redrawn when it lands, and focus with it.
    let last = '';
    await expect.poll(async () => {
      const k = (await page.locator('.hist-pick').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)))).join(',');
      const steady = k === last; last = k; return steady;
    }, { intervals: [200] }).toBe(true);
    await expect(bar).toHaveAttribute('role', 'button');
    await expect(bar).toHaveAttribute('tabindex', '0');
    const label = (await bar.getAttribute('aria-label'))!;
    expect(label).toMatch(/^Show the [\d,]+ (person|people) paid /);
    await bar.focus();
    expect(await bar.evaluate((b) => b === document.activeElement), 'the bar does not take focus').toBe(true);
    await page.keyboard.press('Enter');
    const clear = page.getByRole('button', { name: 'Clear salary range filter' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(clear).toHaveCount(0);
  });
}

test("a phone's tab list says it runs past the edge, and the chevron pages it along", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const wrap = page.locator('.tabs-overflow');
  await expect(wrap.getByRole('tab').first()).toBeVisible({ timeout: 60_000 });
  await expect(wrap).toHaveAttribute('data-more-end', 'true');
  await expect(wrap).not.toHaveAttribute('data-more-start', /.*/);
  const report = wrap.getByRole('tab', { name: 'Report' });
  const before = (await report.boundingBox())!;
  expect(before.x + before.width, 'Report already fits').toBeGreaterThan(375);
  await wrap.locator('.tabs-more-end').click();
  await expect.poll(async () => { const b = (await report.boundingBox())!; return b.x + b.width <= 375; }).toBe(true);
  await expect(wrap).toHaveAttribute('data-more-start', 'true');
  // At desktop width it all fits, and says nothing.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(wrap).not.toHaveAttribute('data-more-end', /.*/);
  await expect(wrap.locator('.tabs-more')).toHaveCount(0);
});

test("the source is said once a page; a chart's count and period are behind its About", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
  await expect(page.locator('.recharts-line-curve').first()).toBeAttached({ timeout: 60_000 });
  await expect(page.getByText('UW–Madison salary data (Wisconsin public record)')).toHaveCount(0);
  await expect(page.locator('footer, .mantine-AppShell-footer, [class*="footer"]').getByText(/open-records law/).first()).toBeVisible();
  const tools = page.locator('.chart-tools').locator('visible=true').first();
  await expect(tools.getByRole('button')).toHaveText(['About', 'CSV', 'Table']);
  await tools.getByRole('button', { name: 'About this chart' }).click();
  await expect(page.locator('.chart-source').first()).toHaveText(/^UW–Madison salary data \(Wisconsin public record\) · \d+ snapshots · .+/);
});

test('what a tab switch reveals is drawn at once; a page loaded on it may draw in', async ({ page }) => {
  await page.goto('./divisions?tab=schools');
  await expect(page.locator('.school-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Retention' }).click();
  const bars = page.locator('.turnover .recharts-bar-rectangle path');
  await expect(bars.first()).toBeAttached({ timeout: 60_000 });
  // The first frame the bars exist in is their last: two reads apart, the same heights, none at 0.
  const read = () => bars.evaluateAll((ps) => ps.map((p) => Math.round(p.getBoundingClientRect().height)));
  const a = await read();
  await page.waitForTimeout(120);
  const b = await read();
  expect(Math.min(...a), 'a bar was still rising').toBeGreaterThan(0);
  expect(b).toEqual(a);
  // The section rise is off too.
  expect(await page.locator('.tab-rise > *').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
});
