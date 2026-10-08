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
  await expect(page.getByPlaceholder('Search people, titles or divisions…')).toBeFocused();
});

test('Escape closes it and hands focus back', async ({ page }) => {
  await ready(page);
  const field = page.getByPlaceholder('Search yourself by name to begin…');
  await field.click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(field).toBeFocused();
});

test('the shortcut still fires while a text field has focus', async ({ page }) => {
  await ready(page);
  // /reports leads with its own person search (the raise case's subject); a palette that dies inside an input
  // is a palette that fails exactly when someone is typing in the wrong box, which is the case it exists for.
  await page.getByPlaceholder('Search yourself by name to begin…').click();
  await page.keyboard.type('smith');

  await page.keyboard.press('ControlOrMeta+k');

  await expect(page.locator(DIALOG)).toBeVisible();
});

test('every sidebar destination is reachable from the palette', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();

  for (const label of ['Home', 'People', 'Titles', 'Divisions', 'Compare', 'Raises', 'Reports', 'Screening', 'About the data']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

test('picking a person navigates and closes the palette', async ({ page }) => {
  // The reason the palette exists. Everything else in this file guards the shell around it.
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search people, titles or divisions…').fill('Kenneth Poss');
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

/**
 * No search button in the header, on any page: the landing page's box is the search, People in the
 * sidebar leads to it, and the shortcut opens the palette anywhere. The button stood a few hundred
 * pixels from that box on the landing page, and a phone never showed it.
 */
test('the header has no search button on any page, and the shortcut opens the palette on each', async ({ page }) => {
  for (const [route, ready] of [
    ['./', '.hero-dist-main'],
    [`./person/${encodeURIComponent('aaronsmetana|2014-10-15')}`, '.peer-strip'],
    [`./school/${encodeURIComponent('School of Medicine and Public Health')}`, '.release-tag'],
    ['./reports', 'h1'],
  ] as const) {
    await page.goto(route);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.mantine-AppShell-header').getByRole('button', { name: /search/i }), route).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Search and go' }), route).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
  }
});

test('on a 720px screen the results stay on it, titles included', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search people, titles or divisions…').fill('smith');
  await expect(page.locator('[role="option"][data-kind="person"]').first()).toBeVisible({ timeout: 60_000 });
  const title = page.locator('[data-group="titles"] [role="option"]').first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(title).toBeInViewport({ ratio: 1 });
  const list = (await page.locator('.search-dropdown').boundingBox())!;
  expect(list.y + list.height, 'the results run past the bottom of the screen').toBeLessThanOrEqual(720);
  // Shorter still, the list scrolls inside the room it has rather than running off the screen.
  await page.setViewportSize({ width: 1280, height: 560 });
  await expect.poll(async () => { const b = (await page.locator('.search-dropdown').boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(560);
});
