import { test, expect, type Page } from '@playwright/test';
import { oracle, PERSON_PAY, PAY } from './oracle';

/**
 * Divisions' Schools, Top earners and Titles tabs (D8, D10–D14, D16): wider spreads with an arrow only where a box
 * runs past the scale; each division's change in people and median over the page's period; the department under
 * its school; a combined row's appointments; rank movement in a column a screen reader reads; one way to leave
 * divisions out; and the category as a column of its own.
 */

test.use({ viewport: { width: 1440, height: 1000 } });
const SMPH = 'School of Medicine and Public Health';

async function tab(page: Page, name: string) {
  await page.goto(`./divisions?tab=${name}`);
  await expect(page.locator('table.fold-table tbody tr').first()).toBeVisible({ timeout: 60_000 });
}

test('a spread is 280px on one scale, and only a box past the scale is marked with an arrow', async ({ page }) => {
  for (const name of ['schools', 'titles']) {
    await tab(page, name);
    const glyphs = await page.locator('svg.mini-range').evaluateAll((ss) => ss.map((s) => ({
      w: s.getBoundingClientRect().width, p75: Number(s.getAttribute('data-p75')), hi: Number(s.getAttribute('data-scale-hi')),
      arrow: !!s.querySelector('.mini-range-over'),
    })));
    expect(glyphs.length).toBeGreaterThan(5);
    for (const g of glyphs) {
      expect(g.w).toBeGreaterThanOrEqual(279);
      expect(g.arrow, `${name}: arrow ${g.arrow ? 'on a box inside' : 'missing on a box past'} the scale`).toBe(g.p75 > g.hi);
    }
  }
});

test('each division’s change in people and median, over the page’s period', async ({ page }) => {
  const snaps = await oracle<{ id: string; d: string }>(`SELECT snapshot_id id, CAST(any_value(snapshot_date) AS VARCHAR) d FROM $SAL GROUP BY 1 ORDER BY d`);
  const latest = snaps[snaps.length - 1];
  const before = [...snaps].reverse().find((s) => s.d < latest.d)!;
  const [m] = await oracle<{ a: number; b: number; ma: number; mb: number }>(
    `WITH p AS (SELECT snapshot_id, person_key, ${PERSON_PAY} pay FROM $SAL WHERE school = '${SMPH}' AND snapshot_id IN ('${before.id}', '${latest.id}') GROUP BY 1, 2)
     SELECT count(*) FILTER (WHERE snapshot_id = '${before.id}' AND pay > 0) a, count(*) FILTER (WHERE snapshot_id = '${latest.id}' AND pay > 0) b,
            median(pay) FILTER (WHERE snapshot_id = '${before.id}' AND pay > 0) ma, median(pay) FILTER (WHERE snapshot_id = '${latest.id}' AND pay > 0) mb FROM p`
  );
  await tab(page, 'schools');
  const row = page.locator('tr.school-row', { hasText: SMPH });
  const d = m.b - m.a;
  await expect(row.locator('.school-dhc')).toHaveText(`${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toLocaleString('en-US')}`);
  const g = m.mb / m.ma - 1;
  await expect(row.locator('.school-dmed')).toHaveText(`${g >= 0 ? '+' : '−'}${Math.abs(g * 100).toFixed(1)}%`);
  // Sorted by the change in people, the largest rise leads.
  await page.getByRole('button', { name: /Δ people/ }).click();
  const deltas = (await page.locator('tr.school-row .school-dhc').allInnerTexts()).map((t) => (t.trim() === 'new' ? NaN : Number(t.replace('−', '-').replace(/[+,]/g, ''))));
  const known = deltas.filter((x) => !Number.isNaN(x));
  expect(known.length).toBeGreaterThan(5);
  expect(known, 'not in falling order').toEqual([...known].sort((x, y) => y - x));
  await expect(page.locator('.schools-change-note')).toContainText('the page');
});

test('a division’s median change across Sep 2025 is like for like', async ({ page }) => {
  // College of Letters & Science, half Faculty: its 9-month pay, reported ×11/9 from Sep 2025, restated to the
  // footing before for the change across.
  const LS = 'College of Letters & Science';
  const [m] = await oracle<{ a: number; b: number }>(
    `WITH r AS (SELECT *, CASE WHEN snapshot_id = '2025-09' AND lower(trim(comp_basis)) = '9 month' THEN 9.0 / 11 ELSE 1.0 END k
                FROM $SAL WHERE school = '${LS}' AND snapshot_id IN ('2025-04', '2025-09')),
          p AS (SELECT snapshot_id, person_key,
                  coalesce(sum(${PAY} * k) FILTER (WHERE salary > 0 AND fte > 0), max(${PAY} * k) FILTER (WHERE salary > 0)) pay
                FROM r GROUP BY 1, 2)
     SELECT median(pay) FILTER (WHERE snapshot_id = '2025-04' AND pay > 0) a, median(pay) FILTER (WHERE snapshot_id = '2025-09' AND pay > 0) b FROM p`
  );
  await page.goto('./divisions?snap=2025-09&from=2025-04');
  const row = page.locator('tr.school-row', { hasText: LS });
  const g = m.b / m.a - 1;
  await expect(row.locator('.school-dmed')).toHaveText(`${g >= 0 ? '+' : '−'}${Math.abs(g * 100).toFixed(1)}%`, { timeout: 60_000 });
});

test('Top earners: the department under its school, a combined row’s appointments, and rank movement in words', async ({ page }) => {
  await tab(page, 'earners');
  const rows = page.locator('tr.earner-row');
  // The department is the School column's second line, not the name's.
  const first = rows.first();
  await expect(first.locator('td').nth(2).locator('.earner-dept')).toHaveCount(0);
  await expect(first.locator('.earner-dept')).toHaveCount(1);
  // A row summing several appointments says how many, and lists them.
  const tag = page.locator('.appts-tag').first();
  await expect(tag).toBeVisible();
  const row = rows.filter({ has: tag }).first();
  const key = decodeURIComponent((await row.locator('a[href*="/person/"]').first().getAttribute('href'))!.split('/person/')[1]);
  const snap = (await oracle<{ id: string }>(`SELECT snapshot_id id FROM $SAL GROUP BY 1 ORDER BY any_value(snapshot_date) DESC LIMIT 1`))[0].id;
  const [{ n }] = await oracle<{ n: number }>(`SELECT count(*) n FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${key.replaceAll("'", "''")}' AND salary > 0 AND fte > 0`);
  await expect(tag).toHaveText(`${n} appts`);
  const described = await tag.evaluate((t) => document.getElementById(t.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
  expect(described.split('; ')).toHaveLength(n);
  // Rank movement is a column of its own, in words.
  await expect(page.getByRole('columnheader', { name: 'Δ rank' })).toBeVisible();
  const moves = await page.locator('td.rank-move').allTextContents();
  expect(moves.length).toBeGreaterThan(10);
  for (const m of moves) expect(m).toMatch(/(up \d+|down \d+|no change|new in the top) since /);
});

test('one way to leave divisions out, with Athletics a chip in it', async ({ page }) => {
  await tab(page, 'earners');
  await expect(page.getByRole('button', { name: 'Without Athletics' })).toHaveCount(0);
  await expect(page.locator('tr.earner-row[data-school="Intercollegiate Athletics"]').first()).toBeAttached();
  await page.locator('.exclude-group').getByText('Athletics', { exact: true }).click();
  await expect(page.locator('tr.earner-row[data-school="Intercollegiate Athletics"]')).toHaveCount(0, { timeout: 60_000 });
  // The picker shows it left out too: one control, two ways in.
  await expect(page.locator('.exclude-divisions')).toContainText('Intercollegiate Athletics');
});

test('the category is a column of its own, sorted and filtered', async ({ page }) => {
  await tab(page, 'titles');
  await expect(page.getByRole('columnheader', { name: /Category/ })).toBeVisible();
  // No category badge after a title any more.
  await expect(page.locator('table.fold-table tbody td:first-child .cat-tag:not(.hourly-tag)')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'University Staff', exact: true }).click();
  const cats = await page.locator('td.title-cat').allInnerTexts();
  expect(cats.length).toBeGreaterThan(10);
  expect(new Set(cats.map((c) => c.trim()))).toEqual(new Set(['University Staff']));
});
