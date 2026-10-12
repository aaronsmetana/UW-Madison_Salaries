import { test, expect } from '@playwright/test';
import { oracle, RATE, latestSnapshot, usd } from './oracle';

/**
 * Figures that drew or said something other than what they meant: a histogram whose median guide hid under
 * its tallest bar, median bars scaled from the lowest median, a retention chart that counted survivors as
 * retention, a search that stopped at 25 without a word, and percentiles for a title of two. Expected values
 * from SQL written here.
 */

const money = (t: string) => Number(t.replace(/[^\d.]/g, ''));

test("a title's histogram draws its median over the bars, and only the median", async ({ page }) => {
  await page.goto('./paycheck?code=OE009');
  const plot = page.locator('.hist-plot').first();
  await expect(plot.locator('.recharts-bar-rectangle').first()).toBeAttached({ timeout: 60_000 });
  const order = await plot.evaluate((el) => {
    const all = [...el.querySelectorAll('.recharts-bar-rectangle, .recharts-reference-line')];
    return {
      lines: el.querySelectorAll('.recharts-reference-line').length,
      lastBar: all.map((e) => e.classList.contains('recharts-bar-rectangle')).lastIndexOf(true),
      median: all.findIndex((e) => e.classList.contains('hist-median')),
    };
  });
  expect(order.lines, 'one guide, the median').toBe(1);
  expect(order.median, 'the median is painted after every bar').toBeGreaterThan(order.lastBar);
  await expect(plot.locator('.hist-median')).toContainText('median');
});

test("the schools' median bars are drawn from zero", async ({ page }) => {
  await page.goto('./explore?tab=schools');
  const rows = page.locator('.school-row');
  await expect(rows.nth(5)).toBeAttached({ timeout: 60_000 });
  const cells = await rows.evaluateAll((trs) => trs.map((tr) => {
    const td = tr.querySelectorAll('td')[2];
    const bar = td.querySelector('div > div') as HTMLElement | null;
    return { text: td.firstChild?.textContent ?? '', width: parseFloat(bar?.style.width ?? 'NaN') };
  }));
  const pts = cells.map((c) => ({ med: money(c.text), w: c.width })).filter((p) => p.med > 0 && p.w > 0);
  expect(pts.length).toBeGreaterThan(5);
  // From zero, every bar's length is in proportion to its median: one ratio for all of them.
  const k = pts[0].w / pts[0].med;
  for (const p of pts) expect(Math.abs(p.w / p.med / k - 1), `${p.med} at ${p.w}%`).toBeLessThan(0.01);
});

test('retention counts each cohort from where the data can see it', async ({ page }) => {
  const snaps = await oracle<{ id: string; d: string }>(
    `SELECT snapshot_id id, CAST(min(snapshot_date) AS VARCHAR) d FROM $SAL WHERE NOT ends_with(snapshot_id, '-pre') GROUP BY 1 ORDER BY 2`,
  );
  const first = snaps[0], last = snaps[snaps.length - 1];
  const firstYear = Number(first.d.slice(0, 4));
  const rows = await oracle<{ y: number; total: number; still: number; here: number; here_still: number }>(
    `WITH l AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${last.id}'),
          f AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${first.id}'),
          h AS (SELECT person_key, arg_max(hire_year, snapshot_date) y FROM $SAL WHERE hire_year IS NOT NULL GROUP BY 1)
     SELECT y, count(*) total, count(l.person_key) still, count(f.person_key) here,
            count(*) FILTER (WHERE f.person_key IS NOT NULL AND l.person_key IS NOT NULL) here_still
     FROM h LEFT JOIN l USING (person_key) LEFT JOIN f USING (person_key) WHERE y BETWEEN 1990 AND 2026 GROUP BY y ORDER BY y`,
  );
  const want = (hired: boolean) => rows
    .filter((r) => (hired ? r.y > firstYear : r.y <= firstYear) && (hired ? r.total : r.here) > 0)
    .map((r) => [String(r.y), String(Math.round((100 * (hired ? r.still : r.here_still)) / (hired ? r.total : r.here)))]);

  await page.goto('./explore?tab=cohorts');
  const table = page.locator('table', { has: page.locator('caption', { hasText: 'Retention by hire year' }) });
  const read = async () => (await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => td.textContent?.trim() ?? ''))));
  await expect(table.locator('tbody tr').first()).toBeAttached({ timeout: 60_000 });
  // By default only the years seen from hire: none from before the data begins.
  await expect.poll(read).toEqual(want(true));
  await page.getByText(/^Here in /).click();
  await expect.poll(read).toEqual(want(false));
});

test('a people search says how many it leaves out, and lists them all when asked', async ({ page }) => {
  await page.goto('./people');
  const box = page.getByRole('combobox').first();
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill('smith');
  const more = page.locator('[role="option"][data-kind="more"]');
  await expect(more).toBeVisible({ timeout: 60_000 });
  const n = Number((/Show all ([\d,]+) people/.exec(await more.innerText()) ?? ['', '0'])[1].replace(/,/g, ''));
  expect(n, 'more Smiths than the list shows').toBeGreaterThan(25);
  await expect(more).toContainText(`25 of ${n.toLocaleString('en-US')} shown`);
  await more.click();
  await expect(page.locator('[role="option"][data-kind="person"]')).toHaveCount(n, { timeout: 60_000 });
  await expect(more).toHaveCount(0);
});

test('a title of fewer than five gives the others\' rates, not percentiles', async ({ page }) => {
  const snap = await latestSnapshot();
  // Someone with one paid appointment, in a title of three.
  const [p] = await oracle<{ pk: string; code: string }>(
    `WITH t AS (SELECT job_code FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1 HAVING count(DISTINCT person_key) = 3),
          one AS (SELECT person_key FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1 HAVING count(*) = 1)
     SELECT s.person_key pk, s.job_code code FROM $SAL s JOIN t USING (job_code) JOIN one USING (person_key)
     WHERE s.snapshot_id = '${snap}' AND s.salary > 0 ORDER BY 1 LIMIT 1`,
  );
  const others = await oracle<{ rate: number }>(
    `SELECT ${RATE} rate FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${p.code}' AND person_key <> '${p.pk}'
     GROUP BY person_key HAVING ${RATE} > 0 ORDER BY rate DESC`,
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const figures = page.locator('.person-figures');
  await expect(figures.locator('.few-others')).toHaveText(`The 2 others with this title: ${others.map((o) => usd(o.rate)).join(', ')}.`, { timeout: 60_000 });
  await expect(figures.locator('.spread-mark')).toHaveCount(0);
  await expect(figures).not.toContainText(/Rank \d/);
  await expect(page.locator('.few-list > *')).toHaveCount(3);
  await expect(page.locator('.peer-strip')).toHaveCount(0);
});

test("a title's schools of fewer than five are greyed, with no spread", async ({ page }) => {
  const snap = await latestSnapshot();
  const schools = await oracle<{ school: string; n: number }>(
    `SELECT school, count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = 'OE009' AND salary > 0 AND school IS NOT NULL GROUP BY 1`,
  );
  expect(schools.some((s) => s.n < 5) && schools.some((s) => s.n >= 5), 'Outreach Specialist has schools of both sizes').toBe(true);
  await page.goto('./paycheck?code=OE009');
  const table = page.locator('table.pay-by-school');
  await expect(table.locator('tbody tr').first()).toBeAttached({ timeout: 60_000 });
  await expect(table.locator('tbody tr[data-few]')).toHaveCount(schools.filter((s) => s.n < 5).length);
  await expect(table.locator('tbody tr:not([data-few]) svg.mini-range')).toHaveCount(schools.filter((s) => s.n >= 5).length);
  await expect(table.locator('tbody tr[data-few] svg.mini-range')).toHaveCount(0);
});
