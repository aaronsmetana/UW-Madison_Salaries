import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, usd, latestSnapshot } from './oracle';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// The landing box's suggestions: an empty box said nothing about what it takes, and a reader who did not
// know a name had nowhere to begin. Turned to while empty, it offers the most common titles and the
// largest divisions — the same starters the graph's full page offers — as ordinary rows.
const INDEX = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/search-index.json', import.meta.url)), 'utf8')) as {
  titles: [string, string | null, number, number | null][];
  divisions: [string, number, number | null][];
};
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TOP_TITLES = [...INDEX.titles].filter((t) => t[1]).sort((a, b) => b[2] - a[2] || byName(a[0], b[0])).slice(0, 3).map((t) => t[1]!);
const TOP_DIVISIONS = [...INDEX.divisions].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).slice(0, 3).map((d) => d[0]);
const landingBox = (page: Page) => page.getByRole('combobox', { name: 'Search a person, title or division' });

test('the empty box suggests where to start once the reader turns to it — never by itself at load', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const box = landingBox(page);
  await expect(box).toBeVisible({ timeout: 60_000 });
  // Autofocused at load, and that alone opens nothing and moves nothing.
  await expect(box).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-suggestions]')).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);

  // A press on the box: the most common titles, then the largest divisions.
  await box.click();
  const list = page.locator('[data-suggestions]');
  await expect(list).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  const names = (group: string) => list.locator(`[data-group="${group}"] [role="option"]`).evaluateAll((els) =>
    els.map((el) => (el.querySelector('p, .mantine-Text-root')?.textContent ?? '').trim()));
  expect(await names('titles')).toEqual(TOP_TITLES);
  expect(await names('divisions')).toEqual(TOP_DIVISIONS);

  // Escape puts them away and leaves the caret; an arrow brings them back, as a combobox's list does.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(box).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();

  // Typing replaces them with what matches; emptied by the reader, they come back. (The pointer is parked
  // off the list first: left where the press was, the page scrolls to make the list room and whichever row
  // slides under it takes the hover — the active row — as a real mouse's would.)
  await page.mouse.move(5, 5);
  await box.pressSequentially('smetana', { delay: 30 });
  await expect(list).toHaveCount(0);
  await expect(page.locator('[data-group="people"]')).toBeVisible({ timeout: 60_000 });
  await box.fill('');
  await expect(list).toBeVisible();

  // Picked, a suggestion is its page: the largest division's, here, three rows past the first title (the
  // list opens on its first row, as a typed one does).
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(list.locator('[data-group="divisions"] [role="option"]').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/school/${encodeURIComponent(TOP_DIVISIONS[0]).replace(/[()]/g, '\\$&')}$`));
});

test('an Escape that empties the box puts the list away rather than swapping in the suggestions', async ({ page }) => {
  const box = await homeSearch(page, 'smith');
  await expect(box).toHaveAttribute('aria-expanded', 'true', { timeout: 60_000 });
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-suggestions]')).toHaveCount(0);
});

// The query in the address: a search can be kept or sent, and Back from a person opened out of it comes
// back to it rather than to an empty box and an unmarked graph.
test('the search is kept in the address as it is typed, without adding to the history', async ({ page }) => {
  await page.goto('./');
  const box = landingBox(page);
  await expect(box).toBeVisible({ timeout: 60_000 });
  const before = await page.evaluate(() => history.length);
  await box.pressSequentially('smith', { delay: 40 });
  await expect(page).toHaveURL(/\?q=smith$/);
  expect(await page.evaluate(() => history.length), 'each keystroke became a step Back has to take').toBe(before);
  // Emptied, it goes from the address too.
  await box.press('Escape');
  await expect(page).not.toHaveURL(/q=/);
});

test('Back from a person picked in the search comes back to the search: its text, its marks, its list shut', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  const box = landingBox(page);
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.fill('smith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await expect(page).toHaveURL(/\?q=smith$/);
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/person\//, { timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\?q=smith$/);
  await expect(landingBox(page)).toHaveValue('smith', { timeout: 60_000 });
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await expect(landingBox(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a link to a search opens the page holding it — its marks on the graph, nothing opened, nothing moved', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./?q=smith');
  const box = landingBox(page);
  await expect(box).toHaveValue('smith', { timeout: 60_000 });
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await expect(box).not.toBeFocused();
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // Turned to, it is an ordinary search.
  await box.click();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  // And the graph's full page carries it, address and all.
  await page.keyboard.press('Escape');
  await box.fill('smith');
  await page.getByRole('button', { name: 'Full page' }).click();
  await expect(page.getByRole('dialog', { name: 'Pay distribution, full page' })).toBeVisible();
  await expect(page.locator('.hero-dist-full').getByRole('combobox')).toHaveValue('smith');
  await expect(page).toHaveURL(/\?q=smith$/);
});

test('on a phone the suggestions keep to the top half of the graph, as its results do', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('./');
  const box = landingBox(page);
  await expect(box).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-suggestions]')).toHaveCount(0);
  await box.tap();
  await expect(page.locator('[data-suggestions]')).toBeVisible();
  await page.waitForTimeout(300);
  const plot = (await page.locator('.hero-dist-main').boundingBox())!;
  const list = (await page.locator('.search-dropdown').boundingBox())!;
  expect(list.y + list.height, 'the suggestions reach past the middle of the plot').toBeLessThanOrEqual(plot.y + plot.height / 2 + 1);
  await ctx.close();
});
