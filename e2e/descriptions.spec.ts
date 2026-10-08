import { test, expect, type Page } from '@playwright/test';

/**
 * A page's description fits every tab it has (G9): Divisions' described its first two tabs, and Reports' only the
 * raise case, over the one-person report too. Each tab's or mode's name is in the description.
 */

const description = async (page: Page) => (await page.locator('.page-description').first().innerText()).toLowerCase();

test('Divisions describes every one of its tabs', async ({ page }) => {
  await page.goto('./explore');
  const tabs = (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim().toLowerCase());
  expect(tabs.length).toBeGreaterThan(4);
  const text = await description(page);
  for (const t of tabs) expect(text, `the description says nothing of "${t}"`).toContain(t);
});

test('Reports describes both of its reports', async ({ page }) => {
  await page.goto('./reports');
  const modes = (await page.getByRole('radiogroup').first().getByRole('radio').evaluateAll((rs) => rs.map((r) => (r.closest('label, .mantine-SegmentedControl-control')?.textContent ?? r.getAttribute('value') ?? ''))))
    .map((t) => t.split(':')[0].trim().toLowerCase()).filter(Boolean);
  expect(modes).toEqual(['one person', 'raise case']);
  const text = await description(page);
  for (const m of modes) expect(text, `the description says nothing of "${m}"`).toContain(m);
});
