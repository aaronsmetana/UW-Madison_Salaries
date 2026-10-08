import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot } from './oracle';

/**
 * One person split in two by a hire date the source changed, or by a rehire (scripts/lib/identity): joined
 * back in the data build when the same name — no one else's in either snapshot — ends one snapshot and begins
 * the next in the same division, with the same title or department. Timothy Vertein, IT Manager in the School
 * of Medicine and Public Health, has hire date 2013-09-23 in Sep 2024 and 2017-05-08 from Apr 2025 on.
 */

const TIM = 'timothyvertein|2017-05-08';
const TIM_BEFORE = 'timothyvertein|2013-09-23';

test('no one is left split in two across back-to-back snapshots in the same job', async () => {
  // The rule, restated in SQL: each key by its highest-paid appointment at each snapshot date, where that
  // appointment is unambiguous (a tie between two could be read either way).
  const left = await oracle<{ a: string; b: string }>(
    `WITH snaps AS (SELECT d, dense_rank() OVER (ORDER BY d) r FROM (SELECT DISTINCT snapshot_date d FROM $SAL)),
     rs AS (SELECT s.person_key, split_part(s.person_key, '|', 1) nm, snaps.r, s.school, s.title, s.department, s.salary,
              max(s.salary) OVER (PARTITION BY s.person_key, snaps.r) top
            FROM $SAL s JOIN snaps ON s.snapshot_date = snaps.d),
     tops AS (SELECT person_key, nm, r, any_value(school) school, any_value(title) title, any_value(department) dept,
              count(DISTINCT (coalesce(school, ''), coalesce(title, ''), coalesce(department, ''))) kinds
            FROM rs WHERE salary IS NOT DISTINCT FROM top GROUP BY ALL),
     k AS (SELECT person_key, nm, min(r) r0, max(r) r1 FROM tops GROUP BY ALL),
     nk AS (SELECT nm, r, count(*) c FROM tops GROUP BY ALL)
     SELECT a.person_key a, b.person_key b
     FROM k a JOIN k b ON a.nm = b.nm AND b.r0 = a.r1 + 1
     JOIN tops x ON x.person_key = a.person_key AND x.r = a.r1 JOIN tops y ON y.person_key = b.person_key AND y.r = b.r0
     JOIN nk na ON na.nm = a.nm AND na.r = a.r1 JOIN nk nb ON nb.nm = b.nm AND nb.r = b.r0
     WHERE na.c = 1 AND nb.c = 1 AND x.kinds = 1 AND y.kinds = 1
       AND x.school = y.school AND (x.title = y.title OR x.dept = y.dept)
     ORDER BY a LIMIT 5`,
  );
  expect(left, 'one person under two keys, one ending as the other begins').toEqual([]);
});

test('Timothy Vertein is one person: once in search and still here, every snapshot on his page, hired as his latest record says', async ({ page }) => {
  const [{ n }] = await oracle<{ n: number }>(`SELECT count(DISTINCT snapshot_date) n FROM $SAL WHERE person_key = '${TIM}'`);
  expect(n, 'his Sep 2024 record is not his').toBe(5);
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill('timothy vertein');
  const him = page.locator('[data-group="people"] [role="option"]', { hasText: 'Timothy Vertein' });
  await expect(him.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.search-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(him).toHaveCount(1);
  await expect(him).toHaveAttribute('data-key', `p:${TIM}`);
  await expect(him).not.toContainText('Former');
  await expect(him).toContainText('Hired 2017');
  await page.goto(`./person/${encodeURIComponent(TIM)}?tab=history`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Timothy Vertein', { timeout: 60_000 });
  await expect(page.getByText('Since 2017', { exact: false }).first()).toBeAttached();
  await expect(page.getByRole('tabpanel', { name: 'History' })).toContainText('Sep 2024');
});

test('an address from before he was joined back leads to him, keeping its tab', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(TIM_BEFORE)}?tab=history`);
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(TIM).replace(/\|/g, '\\|')}\\?tab=history$`), { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Timothy Vertein');
  // And an address that was never anyone's still says so.
  await page.goto(`./person/${encodeURIComponent('nobodyatall|1900-01-01')}`);
  await expect(page.getByText('No records found for this person.')).toBeVisible({ timeout: 60_000 });
});

test('the hire-year cohorts count each person once, in the year their latest record gives', async ({ page }) => {
  const snap = await latestSnapshot();
  // Retained by hire year, each person once; and as it read when a person split in two counted in both years.
  const want = await oracle<{ y: number; ret: number; twice: number }>(
    `WITH latest AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${snap}'),
     hired AS (SELECT person_key, arg_max(hire_year, snapshot_date) y FROM $SAL WHERE hire_year IS NOT NULL GROUP BY 1),
     once AS (SELECT y, count(*) total, count(*) FILTER (WHERE l.person_key IS NOT NULL) still
              FROM hired LEFT JOIN latest l USING (person_key) WHERE y BETWEEN 1990 AND 2026 GROUP BY 1),
     every AS (SELECT s.hire_year y, count(DISTINCT s.person_key) total, count(DISTINCT s.person_key) FILTER (WHERE l.person_key IS NOT NULL) still
               FROM $SAL s LEFT JOIN latest l USING (person_key) WHERE s.hire_year BETWEEN 1990 AND 2026 GROUP BY 1)
     SELECT o.y, round(100.0 * o.still / o.total) ret, round(100.0 * e.still / e.total) twice FROM once o JOIN every e USING (y) ORDER BY y`,
  );
  expect(want.filter((w) => w.ret !== w.twice).length, 'counting twice reads the same, so this proves nothing').toBeGreaterThan(0);
  await page.goto('./explore?tab=cohorts');
  const table = page.locator('table', { has: page.locator('caption', { hasText: 'Retention by hire year' }) });
  await expect(table.locator('tbody tr')).toHaveCount(want.length, { timeout: 60_000 });
  const got = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')));
  expect(got.map((r) => [Number(r[0]), Number(r[1].replace(/[^\d.]/g, ''))])).toEqual(want.map((w) => [w.y, w.ret]));
});
