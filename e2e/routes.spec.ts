import { test, expect } from '@playwright/test';

/**
 * The routes are named as the navigation names them (G1): Titles at /titles, Divisions at /divisions with its
 * Retention tab at ?tab=retention, the raise case at /raise-case. A shared link from before goes to the new
 * address, query and all, so no bookmark breaks.
 */
for (const [from, to] of [
  ['./paycheck?code=FA020', /\/titles\?code=FA020$/],
  ['./explore?tab=cohorts&school=School+of+Pharmacy', /\/divisions\?tab=retention&school=School\+of\+Pharmacy$/],
  ['./explore', /\/divisions$/],
  ['./reports?type=comparison', /\/raise-case\?type=comparison$/],
  ['./title/FA020', /\/titles\?code=FA020$/],
] as const) {
  test(`an old address goes to its new one: ${from}`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(to, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  });
}

test("each place's address and heading are its name in the navigation", async ({ page }) => {
  for (const [name, path] of [['Titles', '/titles'], ['Divisions', '/divisions'], ['Raise case', '/raise-case']] as const) {
    await page.goto('./');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, { timeout: 60_000 });
  }
});
