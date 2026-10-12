import { test, expect } from '@playwright/test';

/**
 * Lines between snapshots are straight (G14): pay changes at a point in time, and a curve drew it easing
 * along between them — the Report's pay and Retention's net change were curved where the Pay trend
 * was not. And turnover is drawn a month at a time (G15): snapshots run 4 to 14 months apart, so raw
 * counts made the 14-month Aug 2022 → Oct 2023 step look like a hiring surge.
 */

const AARON = 'aaronsmetana|2014-10-15';

const PAGES: [string, string, string][] = [
  ['the person page', `./person/${encodeURIComponent(AARON)}?tab=trends`, 'Actual pay over time'],
  ['a person’s report', `./person/${encodeURIComponent(AARON)}?tab=report`, 'Actual pay over time'],
  ['Divisions › Trends', './divisions?tab=trends', 'Median actual pay over time'],
  ['Divisions › Retention', './divisions?tab=retention', 'Workforce turnover'],
  ['a division', `./school/${encodeURIComponent('School of Education')}?tab=dist`, 'Median actual pay over time'],
  ['Compare', './compare', 'Actual pay by snapshot'],
  ['a raise case', `./raise-case?type=comparison&subject=${encodeURIComponent(AARON)}`, 'Pay vs. title median over time'],
];

for (const [where, path, name] of PAGES) {
  test(`every line between snapshots is straight: ${where}`, async ({ page }) => {
    await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
      { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
      { type: 'title', id: 'FA020', label: 'Professor', colorIdx: 1 },
    ]));
    await page.goto(path);
    const chart = page.locator(`svg.recharts-surface[aria-label^="${name}."]`).first();
    await expect(chart.locator('.recharts-line-curve, .recharts-area-curve').first()).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const curves = await page.locator('.recharts-line-curve, .recharts-area-curve').evaluateAll((ps) =>
      ps.map((p) => p.getAttribute('d') ?? '').filter((d) => /[CcQqSsTt]/.test(d)).map((d) => d.slice(0, 60)));
    expect(curves, 'a line is drawn as a curve').toEqual([]);
  });
}

test('turnover is plotted a month at a time, and the table gives both the counts and the rates', async ({ page }) => {
  await page.goto('./divisions?tab=retention');
  const table = page.locator('table').filter({ has: page.locator('caption', { hasText: /^Workforce turnover$/ }) });
  await expect(table.locator('tbody tr').first()).toBeAttached({ timeout: 60_000 });
  const head = await table.locator('thead th').allTextContents();
  const col = (n: string) => { const i = head.indexOf(n); expect(i, `no "${n}" column in ${head.join(' | ')}`).toBeGreaterThanOrEqual(0); return i; };
  const [joined, left, months, joinedPM, leftPM] = ['Joined', 'Left', 'Months', 'Joined a month', 'Left a month'].map(col);
  const n = (s: string) => Number(s.replace(/,/g, '').replace('−', '-'));
  const rows = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')));
  expect(rows.length).toBeGreaterThanOrEqual(5);
  for (const r of rows) {
    expect(n(r[joinedPM]), `${r[0]}: joined a month`).toBe(Math.round(n(r[joined]) / n(r[months])));
    expect(n(r[leftPM]), `${r[0]}: left a month`).toBe(Math.round(n(r[left]) / n(r[months])));
  }
  // The bars stand at the rates: each joined bar's height against the tallest, as its rate against the highest.
  const bars = page.locator('.turnover .recharts-bar-rectangle path[fill="var(--mark-up)"]');
  await expect(bars).toHaveCount(rows.length);
  // Read once they have grown in: the bars rise from the axis, and a slow CI runner read them all at 0 (NaN).
  const read = () => bars.evaluateAll((ps) => ps.map((p) => Math.round(p.getBoundingClientRect().height * 10) / 10));
  let last = '';
  await expect.poll(async () => { const h = await read(); const k = h.join(','); const steady = k === last && Math.max(...h) > 0; last = k; return steady; },
    { timeout: 30_000, intervals: [250] }).toBe(true);
  const heights = await read();
  const rates = rows.map((r) => n(r[joined]) / n(r[months]));
  const [hMax, rMax] = [Math.max(...heights), Math.max(...rates)];
  rows.forEach((r, i) => expect(Math.abs(heights[i] / hMax - rates[i] / rMax), `${r[0]}: the joined bar is not at its rate`).toBeLessThanOrEqual(0.02));
  // The 14-month step is no longer the tallest.
  const long = rows.findIndex((r) => n(r[months]) >= 14);
  expect(long, 'no 14-month step to check').toBeGreaterThanOrEqual(0);
  expect(heights[long], 'the 14-month step still stands tallest').toBeLessThan(hMax);
});
