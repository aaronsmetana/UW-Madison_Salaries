import { test, expect, type Page } from '@playwright/test';

/**
 * A page shows the settings its numbers use (G2): every page whose figures read the pay measure — full-time
 * rate, actual pay or base pay — says which it is and can change it there, not only the pages with the control
 * bar. Titles, Raises and Reports read it without showing it.
 */

const measure = (page: Page) => page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: 'Full-time rate' }) }).first();

for (const [name, path] of [
  ['Titles', './paycheck?code=FA020'],
  ['Raises', './raises'],
  ['a person’s report', `./person/${encodeURIComponent('aaronsmetana|2014-10-15')}?tab=report`],
  ['Reports, a raise case', './reports?type=comparison'],
  ['Compare', './compare'],
  ['a division', `./school/${encodeURIComponent('School of Education')}`],
] as const) {
  test(`${name} shows the pay measure its figures use`, async ({ page }) => {
    await page.goto(path);
    await expect(measure(page)).toBeVisible({ timeout: 60_000 });
    for (const m of ['Full-time rate', 'Actual pay', 'Base pay']) await expect(measure(page).getByRole('radio', { name: m })).toBeAttached();
    await expect(measure(page).getByRole('radio', { name: 'Actual pay' })).toBeChecked();
  });
}

test('changing the measure on Titles changes its figures, and the page keeps it in its address', async ({ page }) => {
  await page.goto('./paycheck?code=FA020');
  // The title's median, in its stat cell (or card).
  const median = page.locator('.stat-cell, [data-stat-card]', { hasText: /^Median salary · this title/ }).first();
  await expect(median).toContainText('$', { timeout: 60_000 });
  const actual = await median.innerText();
  await measure(page).getByText('Full-time rate', { exact: true }).click();
  await expect(measure(page).getByRole('radio', { name: 'Full-time rate' })).toBeChecked();
  await expect(median).not.toHaveText(actual, { timeout: 30_000 });
  // In the address, as every setting of a view is: a copied link, or a reload, keeps it.
  await expect(page).toHaveURL(/metric=full/);
  await page.reload();
  await expect(measure(page).getByRole('radio', { name: 'Full-time rate' })).toBeChecked({ timeout: 30_000 });
});
