import { test, expect, type Page } from '@playwright/test';

/**
 * A page's description fits every tab it has (G9): Divisions' described its first two tabs, and and Reports' must say
 * what it builds. Each tab's or mode's name is in the description.
 */

const description = async (page: Page) => (await page.locator('.page-description').first().innerText()).toLowerCase();

test('Divisions describes every one of its tabs', async ({ page }) => {
  await page.goto('./explore');
  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 60_000 });
  const tabs = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim().toLowerCase());
  expect(tabs.length).toBeGreaterThan(4);
  const text = await description(page);
  for (const t of tabs) expect(text, `the description says nothing of "${t}"`).toContain(t);
});

test('Reports describes the one thing it builds, a raise case', async ({ page }) => {
  await page.goto('./reports');
  await expect(page.locator('.page-description').first()).toBeVisible({ timeout: 60_000 });
  const text = await description(page);
  expect(text).toContain('raise case');
  expect(text, 'it describes a report it no longer makes').not.toContain('one person\'s pay');
});
