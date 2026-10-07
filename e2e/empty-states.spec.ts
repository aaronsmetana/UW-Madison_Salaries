import { test, expect } from '@playwright/test';

/**
 * An empty state says where the control it needs is, and is not a second way to it (G5): under the title
 * picker, a "Choose a title" button only repeated the picker. Each page that opens empty — Titles, a one-person
 * report, Screening, Compare — says "above", and its empty card holds no button.
 */
for (const [page_, path, heading] of [
  ['Titles', './paycheck', 'No title selected'],
  ['Reports', './reports', 'No employee selected'],
  ['Screening', './screening', 'No screen run yet'],
  ['Compare', './compare', 'Build a side-by-side comparison'],
] as const) {
  test(`${page_} opens empty with no button repeating the control above it`, async ({ page }) => {
    await page.goto(path);
    const card = page.locator('.mantine-Card-root', { has: page.getByRole('heading', { name: heading }) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('above');
    await expect(card.getByRole('button')).toHaveCount(0);
  });
}
