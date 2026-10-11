import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, PERSON_PAY, latestSnapshot, usd } from './oracle';

/**
 * A person's actual pay counts their salaried appointments. An hourly job's figure is its rate over a
 * full-time year, the hours never reported: held beside a salaried job it is not a second salary, and
 * someone holding only hourly jobs is paid at one rate, not at several full-time years. The person page
 * names a job it leaves out. Brett Van Ess directs Threat Intervention Services full time and works crowd
 * control by the hour; summed, he read as paid $224,464, up 149% since 2022. Expected values from SQL
 * written here (the oracle's `PERSON_PAY`).
 */

const BRETT = 'brettvaness|2018-07-23';

test('Brett Van Ess is paid his directorship, his crowd-control hours named and left out', async ({ page }) => {
  const steps = await oracle<{ snap: string; pay: number }>(
    `SELECT snapshot_id snap, ${PERSON_PAY} pay FROM $SAL WHERE person_key = '${BRETT}' AND NOT ends_with(snapshot_id, '-pre')
     GROUP BY 1 ORDER BY min(snapshot_date)`,
  );
  const first = steps[0], last = steps[steps.length - 1];
  const [{ hourly }] = await oracle<{ hourly: number | null }>(
    `SELECT sum(${PAY}) FILTER (WHERE salary > 0 AND fte = 0) hourly FROM $SAL WHERE person_key = '${BRETT}' AND snapshot_id = '${last.snap}'`,
  );
  expect(hourly, 'Brett no longer works crowd control by the hour').toBeGreaterThan(0);

  await page.goto(`./person/${encodeURIComponent(BRETT)}`);
  const figures = page.locator('.person-figures');
  await expect(figures.getByText(usd(last.pay), { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(figures).toContainText(`+${((last.pay / first.pay - 1) * 100).toFixed(1)}%`);
  await expect(figures).not.toContainText(usd(last.pay + hourly!));
  await expect(page.locator('.person-also')).toContainText('(hourly, $43.00/hr; hours not reported, not in actual pay)');

  // The History tab lists the hourly job at its own rate, and says it is not in the pay.
  await page.getByRole('tab', { name: 'History' }).click();
  const rows = page.locator('table.appt-history tbody tr');
  await expect(rows.filter({ hasText: 'Crowd Control Officer' }).first()).toContainText('not in actual pay', { timeout: 30_000 });
  await expect(rows.filter({ hasText: 'Threat Intervention' }).filter({ hasText: 'not in actual pay' })).toHaveCount(0);
});

/** In-app navigation, so DuckDB is not booted again for every page. */
async function goPerson(page: Page, key: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `${new URL(page.url()).pathname.replace(/person\/.*$/, '')}person/${encodeURIComponent(key)}`);
}

test('everyone holding an hourly job beside another is paid what the rule counts', async ({ page }) => {
  test.setTimeout(600_000);
  const snap = await latestSnapshot();
  // Every person with an hourly job and at least one other paid appointment: beside a salaried job (left
  // out) or beside other hourly ones (the best-paid alone). 133 people in Sep 2026.
  const people = await oracle<{ pk: string; pay: number; summed: number }>(
    `SELECT person_key pk, ${PERSON_PAY} pay, sum(${PAY}) FILTER (WHERE salary > 0) summed FROM $SAL WHERE snapshot_id = '${snap}'
     GROUP BY 1 HAVING count(*) FILTER (WHERE salary > 0 AND fte = 0) > 0 AND count(*) FILTER (WHERE salary > 0) > 1 ORDER BY 1`,
  );
  expect(people.length, 'people the rule changes').toBeGreaterThan(100);
  expect(people.every((p) => p.pay < p.summed), 'the rule leaves something out for each of them').toBe(true);
  await page.goto(`./person/${encodeURIComponent(people[0].pk)}`);
  for (const [i, p] of people.entries()) {
    if (i > 0) await goPerson(page, p.pk);
    await expect(page.locator('.person-figures').getByText(usd(p.pay), { exact: true }), p.pk).toBeVisible({ timeout: 60_000 });
  }
});
