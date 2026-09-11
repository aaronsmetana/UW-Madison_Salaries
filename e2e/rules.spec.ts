import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot, PAY, usd } from './oracle';

/**
 * The shared rules (src/lib), checked where a reader meets them. Each test names one rule; expected
 * values come from `oracle`, never from the app's own query builders.
 */

const SMPH = 'School of Medicine and Public Health';
const AARON = 'aaronsmetana|2014-10-15';

/** People whose full name is unique in the data, so a name search finds exactly them. */
const UNIQUE_NAME = `(SELECT person_key FROM (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln FROM $SAL GROUP BY person_key)
   QUALIFY count(*) OVER (PARTITION BY lower(fn), lower(ln)) = 1)`;

async function history(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}?tab=history`);
  await expect(page.locator('table.appt-history tbody tr').first()).toBeVisible({ timeout: 60_000 });
}

/** The Change cell of the history row whose snapshot label starts with `label`. */
function changeCell(page: Page, label: string) {
  return page
    .locator('table.appt-history tbody tr')
    .filter({ has: page.locator('td.appt-snapshot', { hasText: label }) })
    .locator('td')
    .nth(-3);
}

test.describe('R1 — a department is named inside its school', () => {
  test('a department link from a school page stays inside that school', async ({ page }) => {
    const snap = await latestSnapshot();
    const [o] = await oracle<{ n: number }>(
      `SELECT count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND school = '${SMPH}' AND department = 'Administration' AND salary > 0`
    );
    await page.goto(`./school/${encodeURIComponent(SMPH)}?tab=departments`);
    await page.getByRole('link', { name: 'Administration', exact: true }).first().click();
    await expect(page).toHaveURL(/school=School%20of%20Medicine.*dept=Administration|dept=Administration.*school=/);
    await expect(page.getByText(/1 of 1 divisions/)).toBeVisible({ timeout: 60_000 });
    const row = page.locator('tr', { has: page.getByRole('link', { name: SMPH, exact: true }) });
    await expect(row.locator('td').nth(1)).toContainText(o.n.toLocaleString('en-US'));
    await expect(page.getByLabel('Scope')).toContainText(`Administration · ${SMPH}`);
  });
});

test.describe('R8 — pay figures describe people', () => {
  test('the landing median is the median person, not the median appointment', async ({ page }) => {
    const snap = await latestSnapshot();
    const [o] = await oracle<{ med: number }>(
      `SELECT median(pay) med FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key) WHERE pay > 0`
    );
    await page.goto('./');
    await expect(page.getByText(`The median salary is ${usd(o.med)}.`)).toBeVisible({ timeout: 60_000 });
  });

  test("a division's median counts each person once, at their pay in that division", async ({ page }) => {
    const snap = await latestSnapshot();
    const school = 'School of Veterinary Medicine';
    const [o] = await oracle<{ med: number }>(
      `SELECT median(pay) med FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
         WHERE snapshot_id = '${snap}' AND school = '${school}' GROUP BY person_key) WHERE pay > 0`
    );
    await page.goto('./explore');
    const row = page.locator('tr', { has: page.getByRole('link', { name: school, exact: true }) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row.locator('td').nth(2)).toContainText(usd(o.med));
  });
});

test.describe('R2 — the 9-month reporting change is not a raise', () => {
  test('a 9-month history draws no change across Sep 2025', async ({ page }) => {
    const [p] = await oracle<{ pk: string }>(
      `WITH one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(comp_basis) basis FROM $SAL
                    WHERE salary > 0 GROUP BY ALL HAVING count(*) = 1)
       SELECT a.person_key pk FROM one a JOIN one b USING (person_key)
       WHERE a.snapshot_id = '2025-04' AND b.snapshot_id = '2025-09' AND a.job = b.job
         AND a.basis = 'Academic' AND b.basis = '9 Month' ORDER BY pk LIMIT 1`
    );
    await history(page, p.pk);
    const cell = changeCell(page, 'Sep 2025');
    await expect(cell).toContainText('9-month pay reported differently');
    await expect(cell).not.toContainText('%');
  });

  test("Changes' biggest raises from Apr to Sep 2025 hold no 9-month relabel", async ({ page }) => {
    const moved = new Set(
      (await oracle<{ fn: string; ln: string }>(
        `SELECT any_value(b.first_name) fn, any_value(b.last_name) ln FROM $SAL a JOIN $SAL b USING (person_key)
         WHERE a.snapshot_id = '2025-04' AND b.snapshot_id = '2025-09' AND a.comp_basis = 'Academic' AND b.comp_basis = '9 Month'
         GROUP BY person_key`
      )).map((r) => `${r.fn} ${r.ln}`.toLowerCase())
    );
    await page.goto('./explore?tab=changes');
    await page.getByRole('textbox', { name: 'From' }).click();
    await page.getByRole('option', { name: 'Apr 2025', exact: true }).click();
    await page.getByRole('textbox', { name: 'To' }).click();
    await page.getByRole('option', { name: 'Sep 2025', exact: true }).click();
    const raises = page.locator('.mantine-Card-root', { has: page.getByText('Biggest raises', { exact: true }) }).locator('tbody tr');
    await expect(raises.first()).toBeVisible({ timeout: 60_000 });
    const names = (await raises.locator('td').first().allInnerTexts()).map((t) => t.split('\n')[0].trim().toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => moved.has(n))).toEqual([]);
  });
});

test.describe('R3 — a title change is reported, and called a promotion only when the grade rose', () => {
  test('Aug 2022 reads +17.4% · promotion, with nothing clipped', async ({ page }) => {
    await history(page, AARON);
    const cell = changeCell(page, 'Aug 2022');
    await expect(cell).toContainText('+17.4%');
    const tag = cell.locator('[data-change-tag]');
    await expect(tag).toHaveText('promotion');
    const clipped = await tag.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  });

  test('a move at the same grade reads "title change"', async ({ page }) => {
    const [p] = await oracle<{ pk: string; lbl: string }>(
      `WITH snaps AS (SELECT snapshot_id, row_number() OVER (ORDER BY min(snapshot_date)) i FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY snapshot_id),
            one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(grade_number) g, any_value(grade_basis) gb,
                           any_value(snapshot_date) d
                    FROM $SAL GROUP BY ALL HAVING count(*) = 1)
       SELECT a.person_key pk, strftime(b.d, '%b %Y') lbl FROM one a JOIN snaps sa USING (snapshot_id)
       JOIN one b ON b.person_key = a.person_key JOIN snaps sb ON sb.snapshot_id = b.snapshot_id AND sb.i = sa.i + 1
       WHERE a.job <> b.job AND a.g = b.g AND a.gb = b.gb
         AND a.person_key NOT IN (SELECT person_key FROM $SAL GROUP BY person_key, snapshot_id HAVING count(*) > 1)
       ORDER BY pk LIMIT 1`
    );
    await history(page, p.pk);
    await expect(changeCell(page, p.lbl).locator('[data-change-tag]')).toHaveText('title change');
  });
});

test.describe('R4 — one tenure fit, peers only, with a tolerance', () => {
  test('your callout reads "On the tenure curve"', async ({ page }) => {
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    const callout = page.locator('.tenure-callout');
    await expect(callout).toBeVisible({ timeout: 60_000 });
    await expect(callout).toHaveAttribute('data-verdict', 'on');
    await expect(callout).toContainText('On the tenure curve.');
  });

  test('with fewer than 8 peers there is no line and no verdict', async ({ page }) => {
    const snap = await latestSnapshot();
    const [p] = await oracle<{ pk: string }>(
      `WITH t AS (SELECT job_code FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 AND date_of_hire IS NOT NULL
                  GROUP BY job_code HAVING count(DISTINCT person_key) = 8)
       SELECT min(person_key) pk FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = (SELECT min(job_code) FROM t)
         AND person_key IN ${UNIQUE_NAME}`
    );
    await page.goto(`./person/${encodeURIComponent(p.pk)}`);
    await expect(page.getByText(/at least 8 are needed/)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tenure-callout')).toHaveCount(0);
  });
});

test.describe('R4 — the brief says one thing about tenure', () => {
  async function brief(page: Page, name: string) {
    await page.goto('./reports?type=comparison');
    const start = page.getByPlaceholder('Search yourself by name to begin…');
    await expect(start).toBeVisible({ timeout: 60_000 });
    await start.fill(name);
    await page.getByRole('option').first().click();
    await page.getByText('Detailed review', { exact: true }).click();
    const callout = page.locator('.report-brief .tenure-callout');
    await expect(callout).toBeVisible({ timeout: 60_000 });
    return callout;
  }

  /** The property: the evidence claims a tenure shortfall exactly when the scatter says "below". */
  async function agree(page: Page, callout: import('@playwright/test').Locator) {
    const verdict = await callout.getAttribute('data-verdict');
    const claims = (await page.locator('.report-brief').innerText()).includes('below what tenure alone predicts');
    expect({ verdict, claims }).toEqual({ verdict, claims: verdict === 'below' });
    return verdict;
  }

  test('on the curve: the scatter and the evidence agree', async ({ page }) => {
    const callout = await brief(page, 'Aaron Smetana');
    await agree(page, callout);
  });

  // A modest shortfall (4–7% of pay): outside the 2% band, and inside any stricter bar the brief
  // could drift to. Someone far below the curve would clear every threshold and prove nothing.
  test('below the curve: the scatter and the evidence agree', async ({ page }) => {
    const snap = await latestSnapshot();
    const [p] = await oracle<{ fn: string; ln: string }>(
      `WITH pp AS (SELECT person_key, any_value(job_code) job, sum(${PAY}) FILTER (WHERE salary > 0) pay,
                          date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 t
                   FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key HAVING count(*) = 1),
            fit AS (SELECT job, regr_slope(pay, t) b, regr_intercept(pay, t) a FROM pp WHERE pay > 0 AND t IS NOT NULL
                    GROUP BY job HAVING count(*) >= 30)
       SELECT any_value(s.first_name) fn, any_value(s.last_name) ln FROM pp JOIN fit USING (job) JOIN $SAL s USING (person_key)
       WHERE pp.pay > 0 AND pp.pay BETWEEN 0.93 * (fit.a + fit.b * pp.t) AND 0.96 * (fit.a + fit.b * pp.t) AND s.snapshot_id = '${snap}'
         AND person_key IN ${UNIQUE_NAME}
       GROUP BY person_key ORDER BY person_key LIMIT 1`
    );
    const callout = await brief(page, `${p.fn} ${p.ln}`.toLowerCase());
    await expect(callout).toHaveAttribute('data-verdict', 'below');
    await agree(page, callout);
  });
});
