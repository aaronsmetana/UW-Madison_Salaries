import { test, expect } from '@playwright/test';
import { oracle, PAY } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * The group a person started with (src/components/StartingGroup.tsx): everyone who held their first
 * title in their first snapshot, followed to today. Expected values from SQL written here.
 */

const AARON = 'aaronsmetana|2014-10-15';

/** People whose full name is unique in the data. */
const UNIQUE_NAME = `(SELECT person_key FROM (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln FROM $SAL GROUP BY person_key)
   QUALIFY count(*) OVER (PARTITION BY lower(fn), lower(ln)) = 1)`;

/** A person's first snapshot and the job code of their primary appointment in it (highest FTE, then pay). */
async function firstTitle(pk: string) {
  const [f] = await oracle<{ snap: string; job: string }>(
    `SELECT snapshot_id snap, job_code job FROM $SAL WHERE person_key = '${pk}'
     ORDER BY snapshot_date, CASE WHEN snapshot_id LIKE '%-pre' THEN 0 ELSE 1 END, coalesce(nullif(fte, 0), 0) DESC, salary DESC LIMIT 1`
  );
  return f;
}

test('the starting group is everyone in your first title then, followed to now', async ({ page }) => {
  const f = await firstTitle(AARON);
  const rows = await oracle<{ snapshot_id: string; n: number; below: number }>(
    `WITH g AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${f.snap}' AND job_code = '${f.job}'),
          pp AS (SELECT s.snapshot_id, min(s.snapshot_date) d, s.person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay
                 FROM $SAL s JOIN g USING (person_key) GROUP BY 1, 3),
          me AS (SELECT snapshot_id, pay mine FROM pp WHERE person_key = '${AARON}')
     SELECT snapshot_id, count(*) FILTER (WHERE pay > 0) n, count(*) FILTER (WHERE pay > 0 AND pay < mine) below, any_value(d) d
     FROM pp JOIN me USING (snapshot_id) GROUP BY snapshot_id ORDER BY d, snapshot_id DESC`
  );
  const start = rows[0];
  const now = rows[rows.length - 1];
  const pct = (r: { n: number; below: number }) => Math.round((r.below / (r.n - 1)) * 100);

  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
  const caption = page.locator('.starting-group [data-start-n]');
  await expect(caption).toBeVisible({ timeout: 60_000 });
  expect({
    startN: Number(await caption.getAttribute('data-start-n')),
    nowN: Number(await caption.getAttribute('data-now-n')),
    startPct: Number(await caption.getAttribute('data-start-pct')),
    nowPct: Number(await caption.getAttribute('data-now-pct')),
  }).toEqual({ startN: start.n, nowN: now.n, startPct: pct(start), nowPct: pct(now) });
  await expect(caption).toContainText(`${start.n.toLocaleString('en-US')} people were INFORM PROCESS CONSLT in Nov 2021`);
});

test('a group that started with fewer than 10 people is not charted', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH firsts AS (SELECT person_key, arg_min(snapshot_id, snapshot_date) snap FROM $SAL GROUP BY person_key),
          one AS (SELECT f.person_key, f.snap, any_value(s.job_code) job FROM firsts f JOIN $SAL s ON s.person_key = f.person_key AND s.snapshot_id = f.snap
                  GROUP BY 1, 2 HAVING count(*) = 1),
          sizes AS (SELECT snapshot_id, job_code, count(DISTINCT person_key) n FROM $SAL GROUP BY 1, 2)
     SELECT one.person_key pk FROM one JOIN sizes ON sizes.snapshot_id = one.snap AND sizes.job_code = one.job
     WHERE sizes.n BETWEEN 3 AND 9 AND one.snap NOT LIKE '%-pre' AND one.snap NOT LIKE '%-post' AND one.person_key IN ${UNIQUE_NAME}
     ORDER BY pk LIMIT 1`
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=trends`);
  await expect(page.locator('.person-trend .recharts-line-dots').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('.starting-group')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the starting group's median clears 3:1 (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
    const line = page.locator('.starting-group .group-median path.recharts-line-curve');
    await expect(line).toBeAttached({ timeout: 60_000 });
    const card = parseColor(await page.locator('.starting-group').evaluate((e) => getComputedStyle(e).backgroundColor)).slice(0, 3);
    const [r, g, b, a] = parseColor(await line.evaluate((e) => getComputedStyle(e).stroke));
    expect(contrast(flatten([r, g, b, a], card), card)).toBeGreaterThanOrEqual(3);
  });
}
