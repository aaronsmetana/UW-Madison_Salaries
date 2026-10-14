import { test, expect } from '@playwright/test';
import { oracle, PAY, PERSON_PAY, RATE, latestSnapshot, usd } from './oracle';

/**
 * Figures that drew or said something other than what they meant: a histogram whose median guide hid under
 * its tallest bar, median bars scaled from the lowest median, a retention chart that counted survivors as
 * retention, a search that stopped at 25 without a word, and percentiles for a title of two. Expected values
 * from SQL written here.
 */

const money = (t: string) => Number(t.replace(/[^\d.]/g, ''));

test("a title's histogram draws its median over the bars, and only the median", async ({ page }) => {
  await page.goto('./titles?code=OE009');
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
  await page.goto('./divisions?tab=schools');
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

  await page.goto('./divisions?tab=retention');
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
  await page.goto('./titles?code=OE009');
  const table = page.locator('table.pay-by-school');
  await expect(table.locator('tbody tr').first()).toBeAttached({ timeout: 60_000 });
  await expect(table.locator('tbody tr[data-few]')).toHaveCount(schools.filter((s) => s.n < 5).length);
  await expect(table.locator('tbody tr:not([data-few]) svg.mini-range')).toHaveCount(schools.filter((s) => s.n >= 5).length);
  await expect(table.locator('tbody tr[data-few] svg.mini-range')).toHaveCount(0);
});

/** Someone on one appointment in their first and latest snapshots, in the same job and not on a 9-month basis,
 *  whose FTE moved between them and whose rate and actual pay moved opposite ways. */
async function fteMover() {
  const [p] = await oracle<{ pk: string; f0: number; f1: number; r0: number; r1: number; a0: number; a1: number }>(
    `WITH s AS (SELECT person_key, snapshot_id, min(snapshot_date) d, count(*) FILTER (WHERE salary > 0) k,
                       any_value(fte) FILTER (WHERE salary > 0) f, any_value(salary) FILTER (WHERE salary > 0) r,
                       any_value(${PAY}) FILTER (WHERE salary > 0) a, any_value(job_code) FILTER (WHERE salary > 0) j,
                       bool_or(lower(comp_basis) IN ('academic', '9 month')) nine
                FROM $SAL WHERE NOT ends_with(snapshot_id, '-pre') GROUP BY 1, 2),
          e AS (SELECT person_key, arg_min(s, d) s0, arg_max(s, d) s1 FROM s GROUP BY 1 HAVING count(*) >= 3)
     SELECT person_key pk, s0.f f0, s1.f f1, s0.r r0, s1.r r1, s0.a a0, s1.a a1 FROM e
     WHERE s0.k = 1 AND s1.k = 1 AND s0.j = s1.j AND NOT coalesce(s0.nine OR s1.nine, false) AND s0.f > 0 AND s1.f > 0
       AND abs(s0.f - s1.f) > 0.1 AND sign(s1.r - s0.r) <> sign(s1.a - s0.a)
     ORDER BY 1 LIMIT 1`,
  );
  return p;
}

test('where the FTE moved, growth is the rate\'s, with the FTE and actual pay beside it', async ({ page }) => {
  const p = await fteMover();
  expect(p, 'someone whose FTE moved and whose rate and pay went opposite ways').toBeTruthy();
  const sgn = (x: number) => (Math.abs(x) < 0.0005 ? '0%' : `${x > 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(1)}%`);
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  await expect(page.locator('.person-figures [data-trend]')).toHaveText(sgn(p.r1 / p.r0 - 1), { timeout: 60_000 });
  await expect(page.locator('.person-figures .growth-fte')).toHaveText(
    `Full-time rate · FTE ${Math.round(p.f0 * 100)}% → ${Math.round(p.f1 * 100)}% · actual pay ${sgn(p.a1 / p.a0 - 1)}`,
  );
});

test("an hourly person's figure is called an annualized rate, with the hourly rate itself", async ({ page }) => {
  const snap = await latestSnapshot();
  const [p] = await oracle<{ pk: string; salary: number }>(
    `SELECT person_key pk, any_value(salary) salary FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
     GROUP BY 1 HAVING count(*) = 1 AND any_value(fte) = 0 ORDER BY 1 LIMIT 1`,
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const figures = page.locator('.person-figures');
  await expect(figures).toContainText('Annualized hourly rate', { timeout: 60_000 });
  await expect(figures).not.toContainText(/^Actual pay/i);
  await expect(figures.locator('.hourly-rate')).toHaveText(`$${(p.salary / 2080).toFixed(2)}/hr × 2,080 hours · hours worked are not in the records`);
});

test("a title's people give each one's FTE, a part-time one marked", async ({ page }) => {
  const snap = await latestSnapshot();
  // The largest title whose first page of people (the 25 best paid) holds someone part time.
  const [t] = await oracle<{ code: string }>(
    `WITH p AS (SELECT job_code, person_key, ${PERSON_PAY} pay, sum(fte) FILTER (WHERE salary > 0) fte FROM $SAL
                WHERE snapshot_id = '${snap}' GROUP BY 1, 2 HAVING ${PERSON_PAY} > 0),
          r AS (SELECT *, row_number() OVER (PARTITION BY job_code ORDER BY pay DESC) k, count(*) OVER (PARTITION BY job_code) n FROM p)
     SELECT job_code code FROM r WHERE k <= 25 AND n >= 40 GROUP BY 1 HAVING count(*) FILTER (WHERE fte > 0 AND fte < 0.95) > 0
     ORDER BY max(n) DESC, 1 LIMIT 1`,
  );
  const want = new Map((await oracle<{ pk: string; fte: number | null }>(
    `SELECT person_key pk, nullif(sum(fte) FILTER (WHERE salary > 0), 0) fte FROM $SAL
     WHERE snapshot_id = '${snap}' AND job_code = '${t.code}' GROUP BY 1`,
  )).map((r) => [r.pk, r.fte]));
  await page.goto(`./titles?code=${t.code}`);
  const rows = page.locator('.peer-row');
  await expect(rows.first()).toBeAttached({ timeout: 60_000 });
  const got = await rows.evaluateAll((trs) => trs.map((tr) => ({
    pk: decodeURIComponent((tr.querySelector('a[href*="/person/"]')?.getAttribute('href') ?? '').split('/person/')[1] ?? ''),
    fte: tr.querySelector('.fte-cell')?.textContent?.trim() ?? '',
  })));
  expect(got.length).toBeGreaterThan(5);
  for (const g of got) {
    const f = want.get(g.pk);
    expect(g.fte, g.pk).toBe(f == null ? 'hourly' : f.toFixed(2));
  }
  expect(got.some((g) => g.fte !== '1.00' && g.fte !== 'hourly'), 'a part-time row on the page').toBe(true);
});

test('figures are written one way: headline money to three figures, axes with separators, a true minus', async ({ page }) => {
  await page.goto('./divisions');
  const payroll = page.locator('[data-stat-card], .stat-cell').filter({ hasText: 'Total payroll' }).first();
  await expect(payroll).toContainText(/\$\d\.\d\dB/, { timeout: 60_000 });
  await expect(payroll.locator('[title^="$"]')).toHaveAttribute('title', /^\$\d{1,3}(,\d{3})+$/);
  await expect(payroll).not.toContainText(/\$\d{1,3}(,\d{3}){2,}/);
  await page.goto('./divisions?tab=changes');
  const tab = page.getByRole('tabpanel', { name: 'Changes' });
  // The payroll is its waterfall's labels now (D21): its tiles said the same figures again.
  const labels = tab.locator('#changes-payroll .recharts-label-list text');
  await expect(labels.first()).toBeVisible({ timeout: 60_000 });
  for (const t of await labels.allTextContents()) expect(t, 'a payroll step').toMatch(/^[+−]\$\d+(\.\d+)?[KMB]$/);
  const panel = await tab.innerText();
  expect(panel, 'a hyphen for a minus').not.toMatch(/(^|[\s(])-\$?\d/m);
  await page.goto('./divisions?tab=trends');
  const ticks = page.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value');
  await expect(ticks.first()).toBeVisible({ timeout: 60_000 });
  const big = (await ticks.allTextContents()).filter((t) => /^\d{4,}$/.test(t.replace(/[$k]/g, '')));
  expect(big, 'an axis count of four digits or more without a separator').toEqual([]);
  // A chart's data table in whole dollars, not "78,041.6".
  const table = page.locator('table', { has: page.locator('caption', { hasText: 'Median actual pay, headcount & renewable staff over time' }) });
  const medians = await table.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(medians.length).toBeGreaterThan(5);
  for (const m of medians) expect(m, 'a median with cents').toMatch(/^\d{1,3}(,\d{3})*$/);
});
