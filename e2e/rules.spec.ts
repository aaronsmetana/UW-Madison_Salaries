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

/** A continuing raise, stated here independently of src/lib: one paid appointment on each side of
 *  consecutive canonical snapshots (the pre-TTC twin dropped), same job code and FTE, and a pay basis
 *  that is the same quantity — unknown on either side counts, Annual → 12 Month is a relabel, and
 *  Academic → 9 Month (the Sep 2025 reporting change) is not a raise. On the full-time rate. */
const RAISES = `WITH snaps AS (SELECT snapshot_id, CAST(min(snapshot_date) AS VARCHAR) d,
                               row_number() OVER (ORDER BY min(snapshot_date), snapshot_id) i
                        FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1),
     one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(coalesce(nullif(fte, 0), 1)) f,
                    lower(any_value(comp_basis)) b, any_value(salary) pay
             FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING count(*) = 1),
     cr AS (SELECT a.snapshot_id fr, sa.d dfr, sb.d dto, a.person_key, a.job, b.pay / a.pay - 1 r
            FROM one a JOIN snaps sa USING (snapshot_id)
            JOIN one b ON b.person_key = a.person_key AND b.job = a.job AND b.f = a.f
            JOIN snaps sb ON sb.snapshot_id = b.snapshot_id AND sb.i = sa.i + 1
            WHERE a.job IS NOT NULL
              AND (a.b IS NULL OR b.b IS NULL OR a.b = b.b OR (a.b = 'annual' AND b.b = '12 month')))`;

/** Compound step rates and express them per year of the time the steps span. */
function perYear(steps: { dfr: string; dto: string; r: number }[]): number {
  const growth = steps.reduce((g, s) => g * (1 + s.r), 1);
  const years = steps.reduce((y, s) => y + (Date.parse(s.dto) - Date.parse(s.dfr)), 0) / (365.25 * 864e5);
  return (Math.pow(growth, 1 / years) - 1) * 100;
}

/** A person on 9-month pay across the Sep 2025 reporting change, alone in both snapshots. */
async function nineMonthPerson(): Promise<string> {
  const [p] = await oracle<{ pk: string }>(
    `WITH one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(comp_basis) basis FROM $SAL
                  WHERE salary > 0 GROUP BY ALL HAVING count(*) = 1)
     SELECT a.person_key pk FROM one a JOIN one b USING (person_key)
     WHERE a.snapshot_id = '2025-04' AND b.snapshot_id = '2025-09' AND a.job = b.job
       AND a.basis = 'Academic' AND b.basis = '9 Month' ORDER BY pk LIMIT 1`
  );
  return p.pk;
}

/** Every overlap among a chart's labels, chips, title-change markers and axis ticks, by name. */
async function labelCollisions(page: Page, root: string) {
  return page.locator(root).evaluate((el) => {
    type B = { t: string; l: number; r: number; top: number; b: number };
    const boxes = (sel: string): B[] =>
      [...el.querySelectorAll(sel)]
        .map((e) => {
          const b = e.getBoundingClientRect();
          return { t: (e.textContent || '').trim() || sel, l: b.left, r: b.right, top: b.top, b: b.bottom };
        })
        .filter((b) => b.r > b.l);
    const hit = (a: B, b: B) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.top < b.b - 0.5 && b.top < a.b - 0.5;
    const pairs = (xs: B[], ys: B[], same: boolean) =>
      xs.flatMap((a, i) => ys.flatMap((b, j) => ((!same || j > i) && hit(a, b) ? [`${a.t} × ${b.t}`] : [])));
    const chips = boxes('.yoy-chip');
    const eras = boxes('.trend-era-label');
    const halos = boxes('.title-change-halo');
    const ticks = boxes('.recharts-xAxis .recharts-cartesian-axis-tick-value');
    return {
      overlaps: [...pairs(chips, chips, true), ...pairs(chips, halos, false), ...pairs(eras, eras, true), ...pairs(eras, chips, false), ...pairs(ticks, ticks, true)],
      chips: chips.length,
      halos: halos.length,
      eras: eras.map((e) => e.t),
    };
  });
}

test.describe('R5 — standing is one query, per person, the department inside its school', () => {
  test('your department pool is SMPH Administration, and your grade pool one schedule', async ({ page }) => {
    const snap = await latestSnapshot();
    const [o] = await oracle<{ dept: number; grade: number }>(
      `SELECT count(*) FILTER (WHERE in_dept) dept, count(*) FILTER (WHERE in_grade) grade FROM (
         SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay,
                bool_or(school = '${SMPH}' AND department = 'Administration') in_dept,
                bool_or(grade_number = 27 AND grade_basis = 'annual_12mo') in_grade
         FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key) WHERE pay > 0`
    );
    await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
    const dept = page.locator('.chart-plot', { hasText: `Administration · ${SMPH}` });
    await expect(dept).toContainText(`of ${o.dept.toLocaleString('en-US')}`, { timeout: 60_000 });
    await expect(page.locator('.chart-plot', { hasText: 'Salary grade 27 (12-month)' })).toContainText(`of ${o.grade.toLocaleString('en-US')}`);
  });

  /** Page and printed report, for you and for someone paid exactly what a quarter of their school is. */
  async function agreeOnStanding(page: Page, key: string, school: string) {
    await page.goto(`./person/${encodeURIComponent(key)}?tab=pay`);
    const bars = page.locator('.chart-plot');
    await expect(bars.first()).toContainText('pctile', { timeout: 60_000 });
    const texts = await bars.allInnerTexts();
    const pctOf = (first: (t: string) => boolean) => {
      const t = texts.find((x) => first(x.split('\n')[0].trim()));
      return Number(t?.match(/(\d+)(?:st|nd|rd|th)\s+pctile/)?.[1]);
    };
    const onPage = { uw: pctOf((l) => l === 'All UW–Madison'), school: pctOf((l) => l === school) };

    await page.goto(`./reports?type=person&person=${encodeURIComponent(key)}`);
    const report = page.locator('.print-area');
    await expect(report).toContainText(/standing/i, { timeout: 60_000 });
    await expect(report).toContainText(/more than \d+%/);
    const text = (await report.innerText()).replace(/\s+/g, ' ');
    const inReport = {
      uw: Number(text.match(/all-uw standing more than (\d+)%/i)?.[1]),
      school: Number(text.match(new RegExp(`within ${school.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} more than (\\d+)%`, 'i'))?.[1]),
    };
    expect(inReport).toEqual(onPage);
    return onPage;
  }

  test('the page and the printed report give you the same standing', async ({ page }) => {
    await agreeOnStanding(page, AARON, SMPH);
  });

  test('…and someone tied with a quarter of their school', async ({ page }) => {
    const snap = await latestSnapshot();
    const [p] = await oracle<{ pk: string; school: string; n_tie: number; n: number }>(
      `WITH pp AS (SELECT person_key, any_value(school) school, count(*) FILTER (WHERE salary > 0) k,
                          round(sum(${PAY}) FILTER (WHERE salary > 0)) pay FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1),
            sizes AS (SELECT school, count(*) n FROM pp WHERE pay > 0 GROUP BY school),
            t AS (SELECT school, pay, count(*) n_tie, min(person_key) FILTER (WHERE person_key IN ${UNIQUE_NAME}) pk
                  FROM pp WHERE k = 1 AND pay > 0 GROUP BY 1, 2)
       SELECT pk, school, n_tie, n FROM t JOIN sizes USING (school) WHERE pk IS NOT NULL AND n_tie >= 20 ORDER BY n_tie * 1.0 / n DESC LIMIT 1`
    );
    // Big enough that "paid the same or less, of everyone" and "paid less, of the others" part ways.
    expect(p.n_tie / p.n).toBeGreaterThan(0.1);
    await agreeOnStanding(page, p.pk, p.school);
  });
});

test.describe('R2 on the person page — raise presets describe raises, not promotions', () => {
  test('"Typical for this title" and "This person" are continuing raises, per year', async ({ page }) => {
    const [me] = await oracle<{ job: string; d0: string; d1: string }>(
      `SELECT arg_max(job_code, snapshot_date) job, CAST(min(snapshot_date) FILTER (WHERE snapshot_id NOT LIKE '%-pre') AS VARCHAR) d0,
              CAST(max(snapshot_date) AS VARCHAR) d1 FROM $SAL WHERE person_key = '${AARON}'`
    );
    const title = await oracle<{ dfr: string; dto: string; r: number }>(
      `${RAISES} SELECT dfr, dto, median(r) r FROM cr WHERE job = '${me.job}' AND dfr >= '${me.d0}' AND dto <= '${me.d1}'
         GROUP BY fr, dfr, dto HAVING count(*) >= 10 ORDER BY dfr`
    );
    const own = await oracle<{ dfr: string; dto: string; r: number }>(`${RAISES} SELECT dfr, dto, r FROM cr WHERE person_key = '${AARON}' ORDER BY dfr`);
    const want = { title: Math.round(perYear(title) * 10) / 10, own: Math.round(perYear(own) * 10) / 10 };

    await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
    const presets = page.locator('[data-raise-preset]');
    await expect(page.locator('[data-raise-preset="title"]')).toBeVisible({ timeout: 60_000 });
    const labels = await presets.allInnerTexts();
    expect(labels.filter((l) => /^My\b/.test(l)), 'no preset projects first-to-last growth').toEqual([]);
    const read = async (id: string) => Number((await page.locator(`[data-raise-preset="${id}"]`).innerText()).match(/≈([\d.]+)%/)?.[1]);
    expect({ title: await read('title'), own: await read('own') }).toEqual(want);
  });
});

test.describe('R6 — snapshots sit on a date axis', () => {
  test("your trend spaces snapshots by date, and keeps the TTC twins apart", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
    const dots = page.locator('.person-trend .recharts-line-dots').first().locator('circle');
    await expect(dots.first()).toBeVisible({ timeout: 60_000 });
    const xs = await dots.evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))));
    // [Nov '21 pre, Nov '21 post, Mar '22, Aug '22, Oct '23, …]
    const [pre, post, mar, aug, oct] = xs;
    expect(post - pre, 'the twins are two points').toBeGreaterThan(3);
    expect(post - pre, 'a same-day relabel is a sliver').toBeLessThan((oct - aug) / 10);
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
    const want = days('2022-08-01', '2023-10-01') / days('2022-03-01', '2022-08-01');
    expect((oct - aug) / (aug - mar)).toBeGreaterThan(want * 0.9);
    expect((oct - aug) / (aug - mar)).toBeLessThan(want * 1.1);
  });

  test('Divisions → Trends spaces snapshots by date', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./explore?tab=trends');
    const card = page.locator('.mantine-Card-root', { hasText: 'Median salary & headcount over time' });
    const dots = card.locator('.recharts-wrapper').first().locator('.recharts-line-dots').first().locator('circle');
    await expect(dots.first()).toBeVisible({ timeout: 60_000 });
    const xs = await dots.evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))));
    const [, , mar, aug, oct] = xs;
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
    const want = days('2022-08-01', '2023-10-01') / days('2022-03-01', '2022-08-01');
    expect((oct - aug) / (aug - mar)).toBeGreaterThan(want * 0.9);
    expect((oct - aug) / (aug - mar)).toBeLessThan(want * 1.1);
  });

  for (const [w, h] of [[1440, 900], [375, 812]] as const) {
    test(`at ${w}px nothing on your trend chart prints over anything else`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
      await expect(page.locator('.person-trend .yoy-chip').first()).toBeVisible({ timeout: 60_000 });
      const c = await labelCollisions(page, '.person-trend');
      expect(c.overlaps).toEqual([]);
      expect(c.chips, 'chips were drawn').toBeGreaterThan(2);
      expect(c.halos, 'title-change markers were drawn').toBe(2);
      // Every title is readable somewhere: on the chart, or listed under it.
      const listed = (await page.locator('.trend-era-list').count()) ? await page.locator('.trend-era-list').innerText() : '';
      for (const t of ['INFORM PROCESS CONSLT', 'IT Professional III', 'System Engineer IV']) {
        expect(c.eras.includes(t) || listed.includes(t), `"${t}" is shown`).toBe(true);
      }
    });
  }

  test('a 9-month history breaks at Sep 2025 instead of rising by 26%', async ({ page }) => {
    const pk = await nineMonthPerson();
    await page.goto(`./person/${encodeURIComponent(pk)}?tab=trends`);
    await expect(page.locator('.person-trend .yoy-chip').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-reporting-break]')).toContainText('Sep 2025');
    // textContent: a chip is SVG, which has no innerText.
    const chips = await page.locator('.person-trend .yoy-chip').allTextContents();
    expect(chips.filter((t) => Number(t.replace(/[^\d.-]/g, '')) >= 20), 'no chip reads the ×11/9 as a raise').toEqual([]);
  });
});

test.describe('The person page reports the reporting change and trims what repeats', () => {
  test("a 9-month member's growth card says how much of it is the reporting change", async ({ page }) => {
    const pk = await nineMonthPerson();
    const [o] = await oracle<{ p0: number; p1: number }>(
      `WITH p AS (SELECT snapshot_date d, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL WHERE person_key = '${pk}' GROUP BY snapshot_id, snapshot_date)
       SELECT arg_min(pay, d) p0, arg_max(pay, d) p1 FROM p`
    );
    const without = ((o.p1 / o.p0) / (11 / 9) - 1) * 100;
    await page.goto(`./person/${encodeURIComponent(pk)}`);
    const note = page.locator('[data-reporting-note]');
    await expect(note).toBeVisible({ timeout: 60_000 });
    await expect(note).toContainText(`${without > 0 ? '+' : ''}${without.toFixed(1)}% without the Sep 2025 change`);
  });

  test('one Pay column when the rate is the pay on every row, and the school once', async ({ page }) => {
    await history(page, AARON);
    const heads = (await page.locator('table.appt-history thead th').allInnerTexts()).map((h) => h.trim().toLowerCase());
    expect(heads).toContain('pay');
    expect(heads).not.toContain('rate');
    await expect(page.locator('table.appt-history .appt-school', { hasText: SMPH })).toHaveCount(1);
  });
});
