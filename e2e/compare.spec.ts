import { test, expect } from '@playwright/test';

test('adding a person in Compare renders a chart', async ({ page }) => {
  await page.goto('./compare');
  const search = page.getByPlaceholder('Search a person by name…');
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 });
});
