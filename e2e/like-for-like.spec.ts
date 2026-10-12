import { test, expect } from '@playwright/test';
import { oracle, PAY } from './oracle';

/**
 * From Sep 2025 the source reports 9-month pay at its 12-month equivalent (×11/9). A group's median growth
 * across that step is measured like for like: the later median restated to the earlier footing, 9-month pay
 * ÷ 11/9. Divisions with Faculty chosen read +40.8% Nov 2021 → Sep 2026, of which a +17.6% step at Sep 2025 was
 * the reporting change. Expected values from SQL written here.
 */

const FACULTY = `?filt=${encodeURIComponent(JSON.stringify({ employee_category: ['Faculty'] }))}`;
/** Each Faculty member's actual pay per snapshot, as reported and restated to the footing before Sep 2025. */
const PEOPLE = `WITH r AS (SELECT *, CASE WHEN CAST(snapshot_date AS DATE) >= DATE '2025-09-01' AND lower(trim(comp_basis)) = '9 month'
                                         THEN 9.0 / 11 ELSE 1.0 END k FROM $SAL WHERE employee_category = 'Faculty'),
     p AS (SELECT snapshot_id, any_value(snapshot_date) d,
                  coalesce(sum(${PAY}) FILTER (WHERE salary > 0 AND fte > 0), max(${PAY}) FILTER (WHERE salary > 0)) pay,
                  coalesce(sum(${PAY} * k) FILTER (WHERE salary > 0 AND fte > 0), max(${PAY} * k) FILTER (WHERE salary > 0)) pay_prior
           FROM r WHERE NOT ends_with(snapshot_id, '-pre') GROUP BY snapshot_id, person_key)
     SELECT snapshot_id id, CAST(min(d) AS VARCHAR) d, median(pay) FILTER (WHERE pay > 0) med, median(pay_prior) FILTER (WHERE pay_prior > 0) med_prior
     FROM p GROUP BY 1 ORDER BY 2`;

const sgn = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

test("Divisions' median growth across Sep 2025 is like for like, and says so", async ({ page }) => {
  const meds = await oracle<{ id: string; d: string; med: number; med_prior: number }>(PEOPLE);
  const first = meds[0], last = meds[meds.length - 1];
  const asReported = last.med / first.med - 1;
  const lfl = last.med_prior / first.med - 1;
  expect(asReported - lfl, 'the reporting change moves Faculty growth by at least 10 points').toBeGreaterThan(0.1);
  await page.goto(`./explore${FACULTY}`);
  const tile = page.locator('.mantine-Paper-root, [class*="stat"]').filter({ hasText: 'Median pay growth' }).first();
  await expect(tile).toContainText(sgn(lfl), { timeout: 60_000 });
  await expect(tile).not.toContainText(sgn(asReported));
  const tag = tile.locator('.growth-lfl');
  await expect(tag).toHaveText('like for like');
  await expect(tag).toHaveAccessibleDescription(`Like for like: the Sep 2025 change in how 9-month pay is reported (×11/9) taken out. As reported, ${sgn(asReported)}.`);
});

test("Divisions › Trends gives the Sep 2025 step like for like, and the others as reported", async ({ page }) => {
  const meds = await oracle<{ id: string; d: string; med: number; med_prior: number }>(PEOPLE);
  const i = meds.findIndex((m) => m.d >= '2025-09-01');
  const want = (meds[i].med_prior / meds[i - 1].med - 1) * 100;
  const next = (meds[i + 1].med / meds[i].med - 1) * 100;
  await page.goto(`./explore${FACULTY.replace('?', '?tab=trends&')}`);
  const table = page.locator('table', { has: page.locator('caption', { hasText: 'Median salary, headcount & renewable staff over time' }) });
  await expect(table.locator('tbody tr').nth(i)).toBeAttached({ timeout: 60_000 });
  const cell = async (k: number) => Number((await table.locator('tbody tr').nth(k + 1).locator('td').nth(2).textContent())!.replace('%', ''));
  // The table lists Nov 2021's twins: the canonical rows follow the Pre-TTC one.
  expect(Math.abs((await cell(i)) - want)).toBeLessThanOrEqual(0.051);
  expect(Math.abs((await cell(i + 1)) - next)).toBeLessThanOrEqual(0.051);
});
