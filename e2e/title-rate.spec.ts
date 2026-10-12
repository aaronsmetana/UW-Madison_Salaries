import { test, expect } from '@playwright/test';
import { oracle, PAY, RATE, latestSnapshot, usd } from './oracle';

/**
 * The person page compares everyone with a title at their full-time rate in it (src/lib/queries.ts
 * `TITLE_RATE`), not their actual pay: a half-time appointment's actual pay is half its rate, and plotted as
 * pay it sat at the bottom of its title for working part time — 2,331 people and titles in Sep 2026. The
 * Actual pay figure stays actual pay. Expected values from SQL written here (the oracle's `RATE`).
 */

/** Someone on one half-time appointment, in a title of 40 to 400, whose share of the others below them is
 *  20 points or more higher by rate than by actual pay: plotted at pay, they would read as underpaid. */
async function partTimer() {
  const snap = await latestSnapshot();
  const [p] = await oracle<{ pk: string; fn: string; code: string; rate: number; pay: number; pct: number }>(
    `WITH pp AS (SELECT person_key, job_code, ${RATE} rate, sum(${PAY}) FILTER (WHERE salary > 0) pay
                 FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1, 2 HAVING ${RATE} > 0),
          one AS (SELECT person_key FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1
                  HAVING count(*) = 1 AND any_value(fte) BETWEEN 0.4 AND 0.6),
          big AS (SELECT job_code, count(*) n FROM pp GROUP BY 1 HAVING count(*) BETWEEN 40 AND 400),
          c AS (SELECT s.person_key pk, s.job_code code, s.rate, s.pay, big.n,
                  (SELECT count(*) FROM pp o WHERE o.job_code = s.job_code AND o.rate < s.rate) br,
                  (SELECT count(*) FROM pp o WHERE o.job_code = s.job_code AND o.pay < s.pay) bp
                FROM pp s JOIN one USING (person_key) JOIN big USING (job_code))
     SELECT pk, code, rate, pay, round(br / (n - 1) * 100) pct,
            (SELECT trim(any_value(first_name)) FROM $SAL WHERE person_key = pk AND snapshot_id = '${snap}') fn
     FROM c WHERE round(br / (n - 1) * 100) - round(bp / (n - 1) * 100) >= 20 ORDER BY pk LIMIT 1`,
  );
  return p;
}

test('a part-time appointment is placed in its title at its full-time rate, its actual pay given beside it', async ({ page }) => {
  const p = await partTimer();
  expect(p, 'someone half time whose rate and pay place them differently').toBeTruthy();
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const figures = page.locator('.person-figures');
  await expect(figures).toContainText(usd(p.pay), { timeout: 60_000 });
  await expect(figures).toContainText(`${p.pct}%`);
  await expect(page.locator('.peer-finding')).toContainText(`${p.fn}’s full-time rate is higher than ${p.pct}% of the`);
  await expect(page.locator('.peer-strip-you')).toContainText(usd(p.rate));
  await expect(page.locator('.peer-rate-note')).toHaveText(
    `Marked at ${usd(p.rate)}, ${p.fn}’s full-time rate in this title. Their actual pay is ${usd(p.pay)}.`,
  );

  // What tenure predicts is fitted to the others' rates, and the subject is measured at theirs.
  const snap = await latestSnapshot();
  const [fit] = await oracle<{ expected: number }>(
    `WITH pp AS (SELECT person_key, ${RATE} y,
                   greatest(0, date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25) x
                 FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${p.code}' GROUP BY 1)
     SELECT regr_intercept(y, x) + regr_slope(y, x) * (SELECT x FROM pp WHERE person_key = '${p.pk}') expected
     FROM pp WHERE person_key <> '${p.pk}' AND y > 0 AND x IS NOT NULL`,
  );
  const cells = await page.locator('.tenure-strip .tenure-cell').allInnerTexts();
  const money = (t: string) => Number(t.match(/\$([\d,]+)/)![1].replace(/,/g, ''));
  expect(Math.abs(money(cells[1]) - fit.expected), cells[1]).toBeLessThanOrEqual(1);
  expect(cells[2]).toMatch(new RegExp(`^Full-time rate\\s+\\${usd(p.rate)}$`));
});

test('two appointments in one title count once, at the rate between them, and the list ranks by rate', async ({ page }) => {
  const snap = await latestSnapshot();
  // Someone whose only paid appointments are two salaried ones in the same title at different rates.
  const [p] = await oracle<{ pk: string; code: string; rate: number; sum: number }>(
    `SELECT person_key pk, any_value(job_code) code, ${RATE} rate, sum(salary) sum FROM $SAL
     WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1
     HAVING count(*) = 2 AND count(DISTINCT job_code) = 1 AND min(fte) > 0 AND min(salary) <> max(salary)
     ORDER BY 1 LIMIT 1`,
  );
  expect(p, 'someone with two appointments in one title').toBeTruthy();
  const all = await oracle<{ rate: number }>(
    `SELECT ${RATE} rate FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${p.code}' GROUP BY person_key
     HAVING ${RATE} > 0 ORDER BY rate DESC`,
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const table = page.locator('table.peer-table');
  const rateCell = (row: ReturnType<typeof table.locator>) => row.locator('td').nth(4);
  await expect(rateCell(table.locator('tr.row-this'))).toHaveText(usd(p.rate), { timeout: 60_000 });
  expect(usd(p.rate)).not.toBe(usd(p.sum));
  // The page of the list that is showing, each row at its rank's rate.
  const shown = await table.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent ?? '')));
  expect(shown.length).toBeGreaterThan(1);
  expect(shown.map((c) => c[4])).toEqual(shown.map((c) => usd(all[Number(c[0]) - 1].rate)));
});

test("Pay & standing's title row and the Report tab compare within the title at the full-time rate too", async ({ page }) => {
  const p = await partTimer();
  const snap = await latestSnapshot();
  const rates = await oracle<{ pk: string; rate: number }>(
    `SELECT person_key pk, ${RATE} rate FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${p.code}' GROUP BY 1 HAVING ${RATE} > 0`,
  );
  const rank = rates.filter((r) => r.rate > p.rate).length + 1;
  const [{ title }] = await oracle<{ title: string }>(`SELECT any_value(title) title FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${p.pk}' AND job_code = '${p.code}'`);
  await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=pay`);
  // The Overview's share, the same pool on the same measure.
  await expect(page.locator('.chart-plot', { hasText: title }).first()).toContainText(`more than ${p.pct}%`, { timeout: 60_000 });
  await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=report`);
  await expect(page.locator('.print-area')).toContainText(`ranks #${rank} of ${rates.length} by full-time rate`, { timeout: 60_000 });
});

test('Screening ranks at the full-time rate and gives a part-timer\'s FTE beside it', async ({ page }) => {
  const snap = await latestSnapshot();
  const school = 'School of Pharmacy';
  const part = await oracle<{ nm: string; rate: number; fte: number }>(
    `SELECT trim(any_value(first_name)) || ' ' || trim(any_value(last_name)) nm, ${RATE} rate, sum(fte) FILTER (WHERE salary > 0) fte
     FROM $SAL WHERE snapshot_id = '${snap}' AND school = '${school}' GROUP BY person_key
     HAVING ${RATE} > 0 AND sum(fte) FILTER (WHERE salary > 0) > 0 AND abs(sum(fte) FILTER (WHERE salary > 0) - 1) > 0.005`,
  );
  expect(part.length, 'part-timers in the school').toBeGreaterThan(0);
  await page.goto(`./screening?run=1&sch=${encodeURIComponent(school)}`);
  await expect(page.getByRole('button', { name: 'Sort by Full-time rate' })).toBeVisible({ timeout: 60_000 });
  const rows = page.locator('tbody tr', { has: page.locator('.screen-fte') });
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const cells = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')));
  for (const c of cells) {
    const who = part.filter((x) => x.nm.toLowerCase() === c[0].toLowerCase());
    expect(who.length, c[0]).toBeGreaterThan(0);
    expect(who.some((w) => c[4] === `${usd(w.rate)}FTE ${w.fte.toFixed(2)}`), `${c[0]}: ${c[4]}`).toBe(true);
  }
});
