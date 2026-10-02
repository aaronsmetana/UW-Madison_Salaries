import { test, expect } from '@playwright/test';

/**
 * People (`/people`): where a person's page belongs — its trail starts here and the bar lights it there. Finding
 * someone by name, the people this browser looked at last (most recent first, kept in this browser only), and
 * the people in the compare set. Home is the landing graph; this is where one person is looked for.
 */
const AARON = 'aaronsmetana|2014-10-15';

test('People finds a person by name, and the bar lights it on their page', async ({ page }) => {
  await page.goto('./people');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('People');
  await expect(page.locator('.app-nav-link[aria-current="page"]')).toHaveText('People');
  const search = page.getByRole('combobox').first();
  await search.fill('Aaron Smetana');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aaron Smetana', { timeout: 60_000 });
  await expect(page.locator('.app-nav-link[aria-current="page"]')).toHaveText('People');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'People' })).toHaveAttribute('href', /\/people$/);
});

test('People lists the people this browser opened, most recent first, and the compare set', async ({ page }) => {
  await page.goto('./people');
  await expect(page.getByText('The people you open will be listed here.')).toBeVisible();
  for (const key of [AARON, 'kennethposs|2024-07-01']) {
    await page.goto(`./person/${encodeURIComponent(key)}`);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('People', { timeout: 60_000 });
    await expect(page.locator('.person-head')).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole('button', { name: 'Add to compare', pressed: false }).click();
  await page.goto('./people');
  const recent = page.locator('.people-recent .people-card');
  await expect(recent).toHaveCount(2);
  await expect(recent.first()).toContainText('Kenneth Poss');
  await expect(recent.nth(1)).toContainText('Aaron Smetana');
  await expect(recent.nth(1)).toHaveAttribute('href', new RegExp(encodeURIComponent(AARON).replace(/\|/g, '\\|') + '$'));
  await expect(page.locator('.people-set .people-card')).toHaveText(['Kenneth Poss']);
});
