import { test, expect } from '@playwright/test';

/**
 * Phone-width layout guard. Every route must fit the viewport: a page wider than the window scrolls the
 * whole app sideways, which reads as breakage and hides controls off the right edge. Wide content is
 * allowed — it just has to scroll inside its own container (`Table.ScrollContainer`, `overflowX: auto`)
 * rather than stretching the document.
 *
 * This caught four routes at once: Reports pushed 274px past a 375px screen (its mode switcher measured
 * 633px), Person 53px on all four tabs, and Explore/Compare 24px from the control bar's snapshot Select.
 */
const PHONE = { width: 375, height: 812 };

const ROUTES = [
  ['home', './'],
  ['paycheck', './paycheck'],
  ['explore', './explore'],
  ['compare', './compare'],
  ['reports', './reports'],
  ['screening', './screening'],
  ['data', './data'],
  ['school', `./school/${encodeURIComponent('School of Medicine and Public Health')}`],
] as const;

/** Document scroll width minus viewport width — 0 when nothing overflows the page. */
const pageOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, path] of ROUTES) {
  test(`no horizontal page overflow at ${PHONE.width}px: ${name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path, { waitUntil: 'networkidle' });
    // Settle rather than wait on content: this is a layout assertion, and a currency-text probe matches
    // hidden chart labels on some routes. networkidle covers the parquet/wasm fetches; the pause covers
    // the render they trigger.
    await page.waitForTimeout(2_500);
    expect(await pageOverflow(page), `${name} is wider than the viewport`).toBe(0);
  });
}

test(`no horizontal page overflow at ${PHONE.width}px: person`, async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.getByRole('heading', { name: 'Kenneth Poss' })).toBeVisible({ timeout: 60_000 });

  // The header actions sit beside the title on desktop and wrap below it here; check every tab, since
  // each renders its own charts and tables.
  for (const tab of await page.getByRole('tab').allTextContents()) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(800);
    expect(await pageOverflow(page), `person/${tab} is wider than the viewport`).toBe(0);
  }
});
