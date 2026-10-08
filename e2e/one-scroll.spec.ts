import { test, expect, type Page } from '@playwright/test';

/**
 * One vertical scroll per page (G11): a list shows its first rows and the rest on "Show all", rather than
 * keeping a scroll box of its own inside the page, where the rows past its foot were a scroll inside a scroll
 * away. The first 25 (a hundred ran the Titles page to 9,000px). The raise case's setup, kept beside the brief as it scrolls, is the one exception, and says so.
 */

/** Every element inside the page that scrolls up and down on its own. */
const ownScrolls = (page: Page) => page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => {
  const cs = getComputedStyle(e);
  return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 40 && !e.closest('[data-own-scroll]');
}).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 3).join('.')} (${e.clientHeight} of ${e.scrollHeight}px)`));

for (const [name, path, ready] of [
  ['Divisions: schools', './explore?tab=schools', 'table tbody tr'],
  ['Divisions: top earners', './explore?tab=earners', 'table tbody tr'],
  ['Divisions: titles', './explore?tab=titles', 'table tbody tr'],
  ['Titles', './paycheck?code=FA020', '.peer-row'],
  ['a division', `./school/${encodeURIComponent('School of Education')}?tab=departments`, 'table tbody tr >> visible=true'],
  ['Raises', './raises', '.raise-above-table tbody tr'],
  ['Screening', `./screening?sch=${encodeURIComponent('School of Medicine and Public Health')}&run=1`, 'table tbody tr'],
  ['Data', './data', '.data-snap-table tbody tr'],
] as const) {
  test(`one vertical scroll, the page's own: ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    expect(await ownScrolls(page)).toEqual([]);
  });
}

test('a long list shows its first 25, and "Show all" the rest', async ({ page }) => {
  await page.goto('./paycheck?code=FA020');
  const rows = page.locator('.peer-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const foot = page.locator('.show-all').first();
  await expect(foot).toContainText(/^Showing 25 of ([\d,]+)/);
  const total = Number((await foot.innerText()).match(/of ([\d,]+)/)![1].replace(/,/g, ''));
  expect(total).toBeGreaterThan(25);
  await expect(rows).toHaveCount(25);
  await foot.getByRole('button', { name: /^Show all/ }).click();
  await expect(rows).toHaveCount(total);
  await expect(page.locator('.show-all')).toHaveCount(0);
  expect(await ownScrolls(page)).toEqual([]);
});
