import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * Raises in context (src/lib/raiseContext.ts): each continuing raise against that step's campus-wide
 * raises, the "if raises had been typical" line, and where the difference came from. Expected values
 * come from SQL written here, over the parquet the preview serves.
 */

const AARON = 'aaronsmetana|2014-10-15';

/** Continuing raises on ACTUAL pay, stated independently of the app and of scripts/lib/raise-steps.mjs. */
const RAISES = `WITH snaps AS (SELECT snapshot_id, CAST(min(snapshot_date) AS VARCHAR) d,
                               row_number() OVER (ORDER BY min(snapshot_date), snapshot_id) i
                        FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1),
     one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(coalesce(nullif(fte, 0), 1)) f,
                    lower(any_value(comp_basis)) b, any_value(${PAY}) pay
             FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING count(*) = 1),
     cr AS (SELECT a.snapshot_id fr, b.snapshot_id tt, sa.d dfr, sb.d dto, a.person_key, a.job, b.pay / a.pay - 1 r
            FROM one a JOIN snaps sa USING (snapshot_id)
            JOIN one b ON b.person_key = a.person_key AND b.job = a.job AND b.f = a.f
            JOIN snaps sb ON sb.snapshot_id = b.snapshot_id AND sb.i = sa.i + 1
            WHERE a.job IS NOT NULL AND a.pay > 0 AND b.pay > 0
              AND (a.b IS NULL OR b.b IS NULL OR a.b = b.b OR (a.b = 'annual' AND b.b = '12 month')))`;

const pct = (d: number) => (Math.abs(d) < 0.0005 ? '0%' : `${d > 0 ? '+' : '-'}${Math.abs(d * 100).toFixed(1)}%`);

async function changeCellText(page: Page, label: string) {
  const row = page.locator('table.appt-history tbody tr').filter({ has: page.locator('td.appt-snapshot', { hasText: label }) });
  return (await row.locator('td').nth(-3).innerText()).replace(/\s+/g, ' ').trim();
}

test('each continuing raise says how it compares with that step, campus-wide', async ({ page }) => {
  const steps = await oracle<{ tt: string; n: number; med: number; below: number; eq: number; mine: number }>(
    `${RAISES}, me AS (SELECT fr, r mine FROM cr WHERE person_key = '${AARON}')
     SELECT tt, count(*) n, median(r) med, any_value(mine) mine,
            count(*) FILTER (WHERE round(r * 1000) < round(mine * 1000)) below,
            count(*) FILTER (WHERE round(r * 1000) = round(mine * 1000)) eq
     FROM cr JOIN me USING (fr) GROUP BY tt`
  );
  const want = (tt: string) => {
    const s = steps.find((x) => x.tt === tt)!;
    const others = s.n - 1;
    const same = (s.eq - 1) / others;
    const lo = s.below / others;
    const vs = same >= 0.2 ? `the same as ${Math.round(same * 100)}%` : lo >= 0.5 ? `larger than ${Math.round(lo * 100)}%` : `smaller than ${Math.round((1 - lo - same) * 100)}%`;
    return `${vs} · typical ${pct(s.med)}`;
  };
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  await expect(page.locator('[data-raise-compare="yes"]').first()).toBeVisible({ timeout: 60_000 });
  // Apr 2024 (+15.0%) and Mar 2026 (+5.0%): the two raises that stand out, and a pay-plan step.
  for (const [label, tt] of [['Apr 2024', '2024-04'], ['Mar 2026', '2026-03'], ['Sep 2025', '2025-09']] as const) {
    expect(await changeCellText(page, label), label).toContain(want(tt));
  }
  // The promotion is not a raise and is not compared.
  expect(await changeCellText(page, 'Aug 2022')).not.toMatch(/larger than|smaller than|the same as/);
});

/** People whose full name is unique in the data. */
const UNIQUE_NAME = `(SELECT person_key FROM (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln FROM $SAL GROUP BY person_key)
   QUALIFY count(*) OVER (PARTITION BY lower(fn), lower(ln)) = 1)`;

test('the typical line starts after the TTC relabel and ends where every step at the campus median would have taken you', async ({ page }) => {
  const meds = await oracle<{ med: number }>(`${RAISES} SELECT median(r) med FROM cr GROUP BY fr, dfr ORDER BY dfr`);
  // You, and someone in every snapshot whose FIRST step was far from that step's median — for you
  // the two coincide (+2.0% on a +2.0% step), so only the second can tell where the line starts.
  const [other] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, sum(${PAY}) pay, count(*) k, lower(any_value(comp_basis)) b FROM $SAL GROUP BY 1, 2),
          f AS (SELECT person_key FROM s WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1 HAVING count(*) = 9 AND max(k) = 1)
     SELECT a.person_key pk FROM s a JOIN s b USING (person_key)
     WHERE a.snapshot_id = '2021-11-post' AND b.snapshot_id = '2022-03' AND a.pay > 0
       AND abs(b.pay / a.pay - 1 - ${meds[0].med}) > 0.05
       AND person_key IN (SELECT person_key FROM f) AND person_key IN ${UNIQUE_NAME}
       AND person_key NOT IN (SELECT person_key FROM s WHERE b = '9 month')
     ORDER BY pk LIMIT 1`
  );
  for (const pk of [AARON, other.pk]) {
    const [start] = await oracle<{ pay: number }>(`SELECT sum(${PAY}) pay FROM $SAL WHERE person_key = '${pk}' AND snapshot_id = '2021-11-post'`);
    const typical = meds.reduce((t, m) => t * (1 + m.med), start.pay);
    await page.goto(`./person/${encodeURIComponent(pk)}?tab=trends`);
    const card = page.locator('.gap-breakdown');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const head = (await card.innerText()).replace(/\s+/g, ' ');
    const shown = Number(head.match(/if raises had been typical \$([\d,]+)/)![1].replace(/,/g, ''));
    expect(Math.abs(shown - typical), `${pk}: ${shown} vs ${Math.round(typical)}`).toBeLessThanOrEqual(1);
    await expect(page.locator('.person-trend .typical-line path.recharts-line-curve')).toBeAttached();
  }
});

test('the shares add up to the whole difference, and a promotion is where most of yours came from', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
  const card = page.locator('.gap-breakdown');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const money = (t: string) => {
    const m = t.match(/([+−-])?\$([\d,]+)\s*$/);
    return m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, '')) : 0;
  };
  const total = money(await card.locator('[data-gap-total]').innerText());
  const rows = (await card.locator('[data-gap-row="step"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const sum = rows.reduce((s, t) => s + money(t), 0);
  // Each figure is rounded to the dollar, so the rows may miss the total by a dollar per row.
  expect(Math.abs(sum - total)).toBeLessThanOrEqual(rows.length);
  expect(rows[0]).toMatch(/Aug 2022 · promotion/);
});

test("a 9-month member's breakdown names the reporting change on its own row", async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(comp_basis) basis FROM $SAL
                  WHERE salary > 0 GROUP BY ALL HAVING count(*) = 1)
     SELECT a.person_key pk FROM one a JOIN one b USING (person_key)
     WHERE a.snapshot_id = '2025-04' AND b.snapshot_id = '2025-09' AND a.job = b.job
       AND a.basis = 'Academic' AND b.basis = '9 Month' ORDER BY pk LIMIT 1`
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=trends`);
  const row = page.locator('.gap-breakdown [data-gap-row="reporting"]');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText('9-month pay reported differently');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the typical line clears 3:1 (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
    const line = page.locator('.person-trend .typical-line path.recharts-line-curve');
    await expect(line).toBeAttached({ timeout: 60_000 });
    const card = parseColor(await page.locator('.person-trend').evaluate((e) => getComputedStyle(e.closest('.mantine-Card-root')!).backgroundColor)).slice(0, 3);
    const [r, g, b, a] = parseColor(await line.evaluate((e) => getComputedStyle(e).stroke));
    expect(contrast(flatten([r, g, b, a], card), card)).toBeGreaterThanOrEqual(3);
  });
}

test('the printed report says the same about each raise, and draws the same typical line', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  await expect(page.locator('[data-raise-compare="yes"]').first()).toBeVisible({ timeout: 60_000 });
  const onPage = (await page.locator('table.appt-history [data-raise-compare="yes"]').allInnerTexts()).map((t) => t.trim());

  await page.goto(`./reports?type=person&person=${encodeURIComponent(AARON)}`);
  const report = page.locator('.print-area');
  await expect(report.locator('[data-raise-compare="yes"]').first()).toBeVisible({ timeout: 60_000 });
  const inReport = (await report.locator('[data-raise-compare="yes"]').allInnerTexts()).map((t) => t.trim());
  expect(inReport).toEqual(onPage);
  await expect(report.locator('.typical-line path.recharts-line-curve')).toBeAttached();
  await expect(report.locator('.gap-breakdown [data-gap-row="step"]').first()).toBeVisible();
});

test("the trend tooltip says the same about a raise, and adds the title's own typical raise", async ({ page }) => {
  const [t] = await oracle<{ n: number; med: number }>(
    `${RAISES} SELECT count(*) n, median(r) med FROM cr WHERE tt = '2023-10' AND job = 'IT040'`
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  await expect(page.locator('[data-raise-compare="yes"]').first()).toBeVisible({ timeout: 60_000 });
  // Oct 2023: the step where System Engineer IV's own median (~7%) and campus's (3.3%) part ways, so a
  // title figure that quietly fell back to campus would show.
  const cellText = await changeCellText(page, 'Oct 2023');
  const sentence = cellText.slice(cellText.search(/larger than|smaller than|the same as/));

  await page.getByRole('tab', { name: 'Salary trend' }).click();
  // Nov '21 pre, Nov '21 post, Mar '22, Aug '22, Oct '23 …
  const dot = page.locator('.person-trend .recharts-line-dots').first().locator('circle').nth(4);
  await expect(dot).toBeVisible({ timeout: 30_000 });
  await dot.hover();
  const tip = page.locator('.person-trend .recharts-tooltip-wrapper');
  await expect(tip).toContainText('October 2023');
  await expect(tip).toContainText(sentence);
  await expect(tip).toContainText(`for this title ${pct(t.med)} (${t.n.toLocaleString('en-US')} people)`);
});
