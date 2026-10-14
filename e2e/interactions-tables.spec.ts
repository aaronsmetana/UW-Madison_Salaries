import { test, expect, type Page } from '@playwright/test';
import { oracle, PERSON_PAY, latestSnapshot } from './oracle';

/**
 * Divisions' filters and tables, exercised (I1–I7): the Department filter grouped by school, each pick one school's
 * unit; one summary line naming every filter; the filters in the address as plain parameters; a school's
 * departments with the school's own columns, each opening the page scoped to it; Schools held to 25 people or more
 * to start; a long list a hundred rows a page; and Copy link saying so when it cannot copy.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

const rows = (page: Page) => page.locator('table.fold-table tbody tr.school-row');
async function schools(page: Page, query = '') {
  await page.goto(`./divisions?tab=schools${query}`);
  await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
}
const filtersButton = (page: Page) => page.getByRole('button', { name: 'Filters' }).first();

test('the Department filter is grouped by school, and a pick is that school’s unit alone', async ({ page }) => {
  const snap = await latestSnapshot();
  // A name two schools use, and one school's people under it.
  const [pick] = await oracle<{ school: string; n: number }>(
    `WITH p AS (SELECT person_key, school, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${snap}' AND department = 'Dean''s Office' GROUP BY person_key, school)
     SELECT school, count(*) FILTER (WHERE pay > 0) n FROM p GROUP BY school ORDER BY n DESC LIMIT 1`,
  );
  const [{ schools: users }] = await oracle<{ schools: number }>(
    `SELECT count(DISTINCT school) schools FROM $SAL WHERE snapshot_id = '${snap}' AND department = 'Dean''s Office'`,
  );
  expect(users, 'the name is one school’s alone, so grouping is untested').toBeGreaterThan(1);
  await schools(page);
  await filtersButton(page).click();
  const dept = page.getByRole('textbox', { name: 'Department' });
  await dept.click();
  await dept.fill("Dean's Office");
  // Each school's own, under the school's name.
  const group = page.locator('.mantine-MultiSelect-group', { has: page.locator('.mantine-MultiSelect-groupLabel', { hasText: new RegExp(`^${pick.school.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  await expect(group).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mantine-MultiSelect-groupLabel')).not.toHaveCount(0);
  expect(await page.locator('.mantine-MultiSelect-groupLabel').count()).toBeGreaterThan(1);
  await group.getByRole('option', { name: "Dean's Office" }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => new URL(page.url()).searchParams.getAll('unit')).toEqual([`${pick.school}|Dean's Office`]);
  await expect(page).not.toHaveURL(/filt=/);
  // Only that school, with that unit's people.
  await expect(rows(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(rows(page).first()).toContainText(pick.school);
  await expect(rows(page).first().locator('td').nth(1)).toHaveText(pick.n.toLocaleString('en-US'));
  // Its chip under the bar names the school too.
  await expect(page.locator('.mantine-Pill-root').filter({ hasText: `Dean's Office · ${pick.school}` })).toHaveCount(1);
});

test('the filters are plain parameters in the address, every one named in the view’s summary; an older link still opens', async ({ page }) => {
  await schools(page);
  await filtersButton(page).click();
  const cat = page.getByRole('textbox', { name: 'Category' });
  await cat.click();
  await page.getByRole('option', { name: 'Faculty', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/[?&]cat=Faculty(&|$)/);
  await expect(page).not.toHaveURL(/filt=/);
  await expect(page.locator('.view-summary').first()).toContainText('Faculty');
  // An older link's JSON: read, and the same view.
  await page.goto(`./divisions?tab=schools&filt=${encodeURIComponent(JSON.stringify({ employee_category: ['Faculty'] }))}`);
  await expect(page.locator('.view-summary').first()).toContainText('Faculty', { timeout: 60_000 });
  // Reset clears them all.
  await page.getByRole('button', { name: 'Reset' }).first().click();
  await expect(page).not.toHaveURL(/cat=|filt=/);
});

test('a school’s departments carry the school’s columns, and a press opens the page scoped to one, the view kept', async ({ page }) => {
  await schools(page, '&metric=full');
  const first = rows(page).first();
  const school = (await first.locator('td').first().locator('a').innerText()).trim();
  await first.getByRole('button', { name: /^Expand / }).click();
  const dept = page.locator('tr.dept-row').first();
  await expect(dept).toBeVisible({ timeout: 60_000 });
  await expect(dept.locator('.dept-dhc')).not.toBeEmpty();
  await expect(dept.locator('.dept-dmed')).not.toBeEmpty();
  await expect(dept.locator('svg.mini-range')).toHaveCount(1);
  const name = (await dept.locator('.dept-link').innerText()).trim();
  await dept.locator('td').nth(2).click();
  await expect(page).toHaveURL(new RegExp(`[?&]dept=`));
  const url = new URL(page.url());
  expect(url.searchParams.get('school')).toBe(school);
  expect(url.searchParams.get('dept')).toBe(name);
  expect(url.searchParams.get('tab')).toBe('schools');
  expect(url.searchParams.get('metric')).toBe('full');
});

test('Schools lists divisions of 25 people or more to start; All lists every one; scoped to one, no minimum', async ({ page }) => {
  await schools(page);
  const min = page.locator('.min-people');
  await expect(min.getByRole('button', { name: '≥25' })).toHaveAttribute('aria-pressed', 'true');
  const counts = async () => (await rows(page).locator('td:nth-child(2)').allInnerTexts()).map((t) => Number(t.replace(/[^\d]/g, '')));
  // Every division, past the first page of rows.
  const showAll = page.getByRole('button', { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  const at25 = await counts();
  expect(Math.min(...at25)).toBeGreaterThanOrEqual(25);
  await min.getByRole('button', { name: 'All' }).click();
  if (await showAll.count()) await showAll.click();
  await expect.poll(async () => (await counts()).length).toBeGreaterThan(at25.length);
  expect(Math.min(...(await counts()))).toBeLessThan(25);
  // One division: shown however small, and no minimum to set.
  const [small] = await oracle<{ school: string }>(
    `WITH p AS (SELECT person_key, school, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${await latestSnapshot()}' AND school IS NOT NULL GROUP BY person_key, school)
     SELECT school FROM p GROUP BY school HAVING count(*) FILTER (WHERE pay > 0) BETWEEN 1 AND 24 ORDER BY school LIMIT 1`,
  );
  await schools(page, `&school=${encodeURIComponent(small.school)}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.min-people')).toHaveCount(0);
});

test('a list past a hundred shows a hundred a page, with a pager that brings its top back into view', async ({ page }) => {
  await page.goto('./divisions?tab=titles');
  const titleRows = page.locator('table.fold-table tbody tr.peer-row');
  await expect(titleRows.first()).toBeVisible({ timeout: 60_000 });
  await expect(titleRows).toHaveCount(25);
  const show = page.getByRole('button', { name: /^Show all [\d,]+, 100 a page$/ });
  const total = Number((await show.innerText()).match(/Show all ([\d,]+)/)![1].replace(/,/g, ''));
  expect(total).toBeGreaterThan(200);
  await show.click();
  await expect(titleRows).toHaveCount(100);
  const pager = page.locator('.list-pager');
  await expect(pager.locator('.list-pager-range')).toHaveText(`Rows 1–100 of ${total.toLocaleString('en-US')}`);
  const firstOnOne = await titleRows.first().innerText();
  await pager.scrollIntoViewIfNeeded();
  await pager.getByRole('button', { name: '2', exact: true }).click();
  await expect(pager.locator('.list-pager-range')).toHaveText(`Rows 101–200 of ${total.toLocaleString('en-US')}`);
  await expect(titleRows).toHaveCount(100);
  expect(await titleRows.first().innerText()).not.toBe(firstOnOne);
  // The list's top in view again, under the header.
  const top = await page.locator('table.fold-table').first().evaluate((t) => t.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(400);
  // The last page holds the rest.
  const last = Math.ceil(total / 100);
  await pager.getByRole('button', { name: String(last), exact: true }).click();
  await expect(titleRows).toHaveCount(total - (last - 1) * 100);
});

test('Copy link, where the browser will not copy, says so and hands over the address selected', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await schools(page);
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  const pop = page.locator('.copy-link-manual');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Couldn’t copy — select and copy');
  const field = pop.getByRole('textbox', { name: 'The link to this view' });
  await expect(field).toHaveValue(page.url());
  await expect(field).toBeFocused();
  expect(await field.evaluate((e: HTMLInputElement) => e.selectionEnd! - e.selectionStart!)).toBe(page.url().length);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});
