import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot } from './oracle';
import { samplePixels } from './glass';

/**
 * A page's headline figures, as the person-page redesign drew them: one card, each figure a cell, the cells
 * parted by hairlines (StatRow). They were a row of separate bordered cards on every page that had figures,
 * with a teal rail down the lead one.
 */

const AARON = 'aaronsmetana|2014-10-15';
const SMPH = 'School of Medicine and Public Health';
const PAGES: [string, string][] = [
  ['person', `./person/${encodeURIComponent(AARON)}`],
  ['title', './paycheck?code=IT040'],
  ['Divisions', './explore'],
  ['Divisions, changes', './explore?tab=changes'],
  ['Divisions, cohorts', './explore?tab=cohorts'],
  ['a division', `./school/${encodeURIComponent(SMPH)}`],
  ['one-person report', `./reports?type=person&person=${encodeURIComponent(AARON)}`],
];

for (const [name, route] of PAGES) {
  test(`${name}: the figures are one card of cells, with a hairline between two cells`, async ({ page }) => {
    await page.goto(route);
    const row = page.locator('.stat-row').first();
    await expect(row, name).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('[data-stat-card]'), `${name}: a figure in a card of its own`).toHaveCount(0);
    // Read off the screen, so in view: the page's header may run to two lines and put the row below the fold.
    await row.scrollIntoViewIfNeeded();
    // Between the first two cells of the first row, a divider a reader can see; at the row's start, none.
    const g = await row.evaluate((r) => {
      const [a, b] = [...r.children].map((c) => c.getBoundingClientRect());
      return { a: { x: a.left, y: a.top, h: a.height }, b: { x: b.left, y: b.top } };
    });
    expect(Math.abs(g.a.y - g.b.y), `${name}: the first two cells are not side by side`).toBeLessThan(2);
    const [between, inside] = await samplePixels(page, [
      { x: Math.round(g.b.x - 1), y: Math.round(g.a.y + g.a.h / 2) },
      { x: Math.round(g.b.x + 4), y: Math.round(g.a.y + g.a.h / 2) },
    ]);
    const diff = Math.max(...between.map((v, i) => Math.abs(v - inside[i])));
    expect(diff, `${name}: no divider between two cells`).toBeGreaterThan(6);
  });
}

/**
 * The person's "Paid more than": the share, the spread it sits in (the lowest and highest pays at the ends, the
 * middle 50% and the median), and the person's own mark at their pay. Their growth beside typical raises', both
 * bars against the larger.
 */
test("the person's place in the spread is marked where their pay is, and the growth bars are to scale", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const mark = page.locator('.person-figures .spread-mark');
  await expect(mark).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const m = await mark.evaluate((el) => {
    const r = (s: string) => el.querySelector(s)!.getBoundingClientRect();
    const plot = r('.spread-mark-plot'), band = r('.spread-mark-band'), med = r('.spread-mark-median'), self = r('.spread-mark-self');
    const ends = [...el.querySelectorAll('.spread-mark-ends span')].map((s) => s.textContent);
    return { plot: [plot.left, plot.right], band: [band.left, band.right], med: med.left + med.width / 2, self: self.left + self.width / 2, ends };
  });
  // Read from the page's own words: its pay, the spread's ends and median.
  const figures = await page.locator('.person-figures').innerText();
  const pay = Number(/\$([\d,]+)/.exec(figures)![1].replace(/,/g, ''));
  const k = (t: string | null) => Number(/\$([\d.]+)k/.exec(t ?? '')![1]) * 1000;
  const [lo, hi] = [k(m.ends[0]), k(m.ends[1])];
  const at = (v: number) => m.plot[0] + ((v - lo) / (hi - lo)) * (m.plot[1] - m.plot[0]);
  // The ends are named to the thousand, so the mark is held to that much.
  expect(Math.abs(m.self - at(pay)), "the person's mark is not at their pay").toBeLessThanOrEqual(((m.plot[1] - m.plot[0]) * 1000) / (hi - lo) + 1);
  expect(m.med, 'the median is outside the middle 50%').toBeGreaterThanOrEqual(m.band[0] - 0.5);
  expect(m.med).toBeLessThanOrEqual(m.band[1] + 0.5);

  const bars = await page.locator('.person-figures .growth-bar-row').evaluateAll((rows) => rows.map((r) => ({
    w: r.querySelector('.growth-bar-fill')!.getBoundingClientRect().width,
    track: r.querySelector('.growth-bar-track')!.getBoundingClientRect().width,
    v: Number(r.querySelector('.growth-bar-value')!.textContent!.replace(/[+%−]/g, '')),
  })));
  expect(bars.length).toBe(2);
  const most = Math.max(...bars.map((b) => Math.abs(b.v)));
  for (const b of bars) expect(Math.abs(b.w - (b.track * Math.abs(b.v)) / most), `a bar of ${b.v}% is drawn ${b.w}px of ${b.track}px`).toBeLessThanOrEqual(1.5);
});

test('a title of one says so, where there is no share to state', async ({ page }) => {
  const snap = await latestSnapshot();
  const [p] = await oracle<{ pk: string }>(
    `WITH t AS (SELECT job_code FROM $SAL WHERE snapshot_id = '${snap}' AND job_code IS NOT NULL GROUP BY 1 HAVING count(DISTINCT person_key) = 1),
          one AS (SELECT person_key FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1 HAVING count(*) = 1)
     SELECT s.person_key pk FROM $SAL s JOIN t USING (job_code) WHERE s.snapshot_id = '${snap}' AND s.person_key IN (SELECT person_key FROM one) ORDER BY 1 LIMIT 1`,
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const cell = page.locator('.person-figures .stat-cell').nth(1);
  await expect(cell).toContainText(/The only .+ at UW\./, { timeout: 60_000 });
  await expect(cell.locator('.spread-mark')).toHaveCount(0);
});
