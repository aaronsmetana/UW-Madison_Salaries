import { test, expect, type Page } from '@playwright/test';

/**
 * A page shows the settings its numbers use (G2): every page whose figures read the pay measure — full-time
 * rate or actual pay — says which it is and can change it there, not only the pages with the control bar.
 * Titles, Raises and Reports read it without showing it. A comparison within one title opens on the full-time
 * rate (the Titles page, Divisions' Titles tab), everything else on actual pay. There is no Base pay: the
 * source fills it in one snapshot of eleven.
 */

const measure = (page: Page) => page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: 'Full-time rate' }) }).first();

for (const [name, path, opens] of [
  ['Titles', './titles?code=FA020', 'Full-time rate'],
  ['Raises', './raises', 'Actual pay'],
  ['a person’s report', `./person/${encodeURIComponent('aaronsmetana|2014-10-15')}?tab=report`, 'Actual pay'],
  ['Reports, a raise case', './raise-case?type=comparison', 'Actual pay'],
  ['Compare', './compare', 'Actual pay'],
  ['a division', `./school/${encodeURIComponent('School of Education')}`, 'Actual pay'],
] as const) {
  test(`${name} shows the pay measure its figures use`, async ({ page }) => {
    await page.goto(path);
    await expect(measure(page)).toBeVisible({ timeout: 60_000 });
    for (const m of ['Full-time rate', 'Actual pay']) await expect(measure(page).getByRole('radio', { name: m })).toBeAttached();
    await expect(measure(page).getByRole('radio', { name: 'Base pay' })).toHaveCount(0);
    await expect(measure(page).getByRole('radio', { name: opens ?? 'Actual pay' })).toBeChecked();
  });
}

test('changing the measure on Titles changes its figures, and the page keeps it in its address', async ({ page }) => {
  await page.goto('./titles?code=FA020');
  // The title's median, in its stat cell (or card).
  const median = page.locator('.stat-cell, [data-stat-card]', { hasText: /^Median (full-time rate|actual pay) · this title/ }).first();
  await expect(median).toContainText('$', { timeout: 60_000 });
  const rate = await median.innerText();
  await measure(page).getByText('Actual pay', { exact: true }).click();
  await expect(measure(page).getByRole('radio', { name: 'Actual pay' })).toBeChecked();
  await expect(median).not.toHaveText(rate, { timeout: 30_000 });
  // In the address, as every setting of a view is: a copied link, or a reload, keeps it.
  await expect(page).toHaveURL(/metric=fte/);
  await page.reload();
  await expect(measure(page).getByRole('radio', { name: 'Actual pay' })).toBeChecked({ timeout: 30_000 });
});

test("Divisions' Titles tab opens on the full-time rate, and an old Base pay link on the page's own measure", async ({ page }) => {
  await page.goto('./divisions?tab=titles');
  await expect(measure(page).getByRole('radio', { name: 'Full-time rate' })).toBeChecked({ timeout: 60_000 });
  await page.goto('./divisions?tab=schools&metric=base');
  await expect(measure(page).getByRole('radio', { name: 'Actual pay' })).toBeChecked({ timeout: 60_000 });
  await page.goto('./titles?code=FA020&metric=base');
  await expect(measure(page).getByRole('radio', { name: 'Full-time rate' })).toBeChecked({ timeout: 60_000 });
});
