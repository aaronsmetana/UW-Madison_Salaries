import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, usd, latestSnapshot } from './oracle';

/**
 * The one search box (src/components/SearchBox.tsx): people, titles and divisions in labelled groups
 * where the page can go to all three, and people alone in the pickers that can only take a person.
 * Expected values from SQL written here.
 */

const AARON = 'aaronsmetana|2014-10-15';

async function homeSearch(page: Page, text: string) {
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill(text);
  return box;
}

/** Titles (or divisions) in the latest snapshot whose name holds every word, the most people first. */
async function largest(col: 'job_code' | 'school', words: string[]) {
  const snap = await latestSnapshot();
  const like = words.map((w) => `lower(${col === 'job_code' ? 'title' : 'school'}) LIKE '%${w}%'`).join(' AND ');
  return oracle<{ k: string; n: number; med: number }>(
    `WITH pe AS (SELECT ${col} k, person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
                 WHERE snapshot_id = '${snap}' AND ${col} IS NOT NULL AND ${like} GROUP BY 1, 2)
     SELECT k, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med FROM pe GROUP BY k ORDER BY n DESC, k`
  );
}

test('"system engineer" offers the largest System Engineer title, and Enter opens its page', async ({ page }) => {
  const [top] = await largest('job_code', ['system', 'engineer']);
  const box = await homeSearch(page, 'system engineer');
  const first = page.locator('[data-group="titles"] [role="option"]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(first.locator('.code-pill')).toHaveText(top.k);
  // The figures the title page will state: people, at their pay in the title.
  await expect(first).toContainText(`${top.n} people · median ${usd(top.med)}`);
  // Enter waits for people, who are searched first; none are called "system engineer".
  await expect(page.locator('.search-status')).toHaveCount(0, { timeout: 60_000 });
  await box.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/paycheck\\?code=${top.k}$`));
});

test('"medicine" offers the largest medical division, and a click opens it', async ({ page }) => {
  const [top] = await largest('school', ['medicine']);
  await homeSearch(page, 'medicine');
  const first = page.locator('[data-group="divisions"] [role="option"]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(first).toContainText(top.k);
  await expect(first).toContainText(`${top.n.toLocaleString('en-US')} people · median ${usd(top.med)}`);
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/school/${encodeURIComponent(top.k).replace(/[()]/g, '\\$&')}$`));
});

test('titles and divisions answer while the database is still loading', async ({ page }) => {
  // The parquet never arrives: whatever shows came from the search index.
  await page.route('**/*.parquet*', () => {});
  await homeSearch(page, 'system engineer');
  await expect(page.locator('[data-group="titles"] [role="option"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-group="people"] .search-status')).toHaveText('Searching people…');
  await expect(page.locator('[role="option"][data-kind="person"]')).toHaveCount(0);
});

test('people come first, above a title that matches too', async ({ page }) => {
  const [lock] = await largest('job_code', ['smith']);
  expect(lock, 'a title contains "smith", so the order is a real check').toBeTruthy();
  await homeSearch(page, 'smith');
  await expect(page.locator('[role="option"][data-kind="person"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-group="titles"] .code-pill').first()).toHaveText(lock.k);
  await expect(page.getByRole('option').first()).toHaveAttribute('data-kind', 'person');
});

test('a grouped list shows six people and says when more match', async ({ page }) => {
  await homeSearch(page, 'smith');
  const people = page.locator('[role="option"][data-kind="person"]');
  await expect(people.first()).toBeVisible({ timeout: 60_000 });
  await expect(people).toHaveCount(6);
  await expect(page.locator('[data-group="people"] .search-status')).toHaveText(/More people match/);
});

test('people still here are listed before people who have left', async ({ page }) => {
  const snap = await latestSnapshot();
  const [cur] = await oracle<{ n: number }>(
    `SELECT count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND lower(first_name || ' ' || last_name) LIKE '%smith%'`
  );
  expect(cur.n, 'more people still here match than the list shows').toBeGreaterThan(6);
  await homeSearch(page, 'smith');
  const people = page.locator('[role="option"][data-kind="person"]');
  await expect(people.first()).toBeVisible({ timeout: 60_000 });
  expect(await people.count()).toBeGreaterThan(1);
  await expect(people.filter({ hasText: 'Former' })).toHaveCount(0);
});

test("a person's row carries their pay path and their pay now, and the pay is in its name", async ({ page }) => {
  const snaps = await oracle<{ pay: number }>(
    `SELECT sum(${PAY}) FILTER (WHERE salary > 0) pay, min(snapshot_date) d FROM $SAL WHERE person_key = '${AARON}'
     GROUP BY snapshot_id HAVING sum(${PAY}) FILTER (WHERE salary > 0) > 0 ORDER BY d, snapshot_id DESC`
  );
  await homeSearch(page, 'smetana');
  const row = page.getByRole('option', { name: /Aaron Smetana/ });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.locator('svg.sparkline')).toHaveAttribute('data-points', String(snaps.length));
  await expect(row).toHaveAccessibleName(new RegExp(usd(snaps[snaps.length - 1].pay).replace('$', '\\$')));
});

test("a 9-month member's pay path breaks where the reporting changed", async ({ page }) => {
  const [p] = await oracle<{ nm: string }>(
    `WITH one AS (SELECT person_key FROM $SAL GROUP BY person_key HAVING count(*) = count(DISTINCT snapshot_id)),
          names AS (SELECT person_key, arg_max(first_name || ' ' || last_name, snapshot_date) nm FROM $SAL GROUP BY 1),
          uniq AS (SELECT * FROM names QUALIFY count(*) OVER (PARTITION BY lower(nm)) = 1)
     SELECT uniq.nm FROM uniq JOIN one USING (person_key)
     WHERE person_key IN (SELECT person_key FROM $SAL WHERE snapshot_id = '2025-04' AND comp_basis = 'Academic' AND salary > 0)
       AND person_key IN (SELECT person_key FROM $SAL WHERE snapshot_id = '2025-09' AND comp_basis = '9 Month' AND salary > 0)
       AND person_key IN (SELECT person_key FROM $SAL WHERE snapshot_id = '2024-09' AND comp_basis = 'Academic' AND salary > 0)
     ORDER BY uniq.nm LIMIT 1`
  );
  await homeSearch(page, p.nm);
  const spark = page.getByRole('option', { name: new RegExp(p.nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).locator('svg.sparkline');
  await expect(spark).toBeVisible({ timeout: 60_000 });
  await expect(spark).toHaveAttribute('data-segments', '2');
});

test('pickers that take only a person show people alone, with no groups', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  const subject = page.getByPlaceholder('Search yourself by name to begin…');
  await expect(subject).toBeVisible({ timeout: 60_000 });
  await subject.fill('smith');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 60_000 });
  // Give the index time to have answered, had this box asked for it.
  await page.waitForTimeout(1000);
  await expect(page.locator('[role="listbox"] [role="group"]')).toHaveCount(0);
  await expect(page.locator('[role="option"]:not([data-kind="person"])')).toHaveCount(0);

  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await page.getByRole('button', { name: 'Compare with…' }).click();
  const compare = page.getByPlaceholder('Search a person to compare…');
  await compare.fill('smith');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('[role="listbox"] [role="group"]')).toHaveCount(0);
  await expect(page.locator('[role="option"]:not([data-kind="person"])')).toHaveCount(0);
});

test('Enter pressed before people have loaded opens the person once they do', async ({ page }) => {
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  // Straight away: the database is still loading, so people are still being searched.
  await box.fill('smetana');
  await expect(page.locator('[data-group="people"] .search-status')).toBeVisible({ timeout: 10_000 });
  await box.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(AARON)}$`), { timeout: 60_000 });
});

test('on a phone the placeholder fits its box', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  const { text, fits } = await box.evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { text: el.placeholder, fits: ctx.measureText(el.placeholder).width <= room };
  });
  expect(fits, `"${text}" is cut off`).toBe(true);
});
