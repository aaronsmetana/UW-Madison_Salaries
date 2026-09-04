import { test, expect, type Page } from '@playwright/test';

// The command palette's whole reason to exist is a keyboard path to search, so every guard here
// drives it by keyboard. Three of these cover bugs found by hand while building it: Mantine's Modal
// does not close on Escape when its content is a Popover.Target, the shortcut has to survive focus
// sitting in another text field, and a shortcut label that names the wrong key is worse than none.

const DIALOG = '.mantine-Modal-content';

async function ready(page: Page) {
  await page.goto('./reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 60_000 });
}

test('mod+K opens the palette and puts the cursor in the search box', async ({ page }) => {
  await ready(page);
  await expect(page.locator(DIALOG)).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');

  await expect(page.locator(DIALOG)).toBeVisible();
  await expect(page.getByPlaceholder('Search a person…')).toBeFocused();
});

test('Escape closes it and hands focus back', async ({ page }) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: /^Search — / });
  await trigger.click();
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the shortcut still fires while a text field has focus', async ({ page }) => {
  await ready(page);
  // /reports leads with its own person search; a palette that dies inside an input is a palette that
  // fails exactly when someone is typing in the wrong box, which is the case it exists for.
  await page.getByPlaceholder('Search an employee by name…').click();
  await page.keyboard.type('smith');

  await page.keyboard.press('ControlOrMeta+k');

  await expect(page.locator(DIALOG)).toBeVisible();
});

test('every sidebar destination is reachable from the palette', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();

  for (const label of ['People', 'Titles', 'Divisions', 'Compare', 'Reports', 'Screening', 'About the data']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

test('picking a person navigates and closes the palette', async ({ page }) => {
  // The reason the palette exists. Everything else in this file guards the shell around it.
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search a person…').fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await hit.click();

  await expect(page).toHaveURL(/\/person\//);
  await expect(page.locator(DIALOG)).toHaveCount(0);
});

test('a destination navigates and closes the palette', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator(DIALOG).getByRole('button', { name: 'Screening', exact: true }).click();

  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(page).toHaveURL(/\/screening$/);
});

test('the trigger names the key that actually works', async ({ page }) => {
  await ready(page);
  const label = await page.getByRole('button', { name: /^Search — / }).getAttribute('aria-label');
  // Playwright reports the platform it drives; the chip has to agree with it, or the hint is a lie.
  const mac = process.platform === 'darwin';
  expect(label).toBe(mac ? 'Search — ⌘K' : 'Search — Ctrl K');
});
