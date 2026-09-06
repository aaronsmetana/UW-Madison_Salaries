import { test, expect } from '@playwright/test';

/**
 * Print guard.
 *
 * `print.css` isolates one `.print-area` so the equity-review brief prints as a standalone
 * white-paper. It did that by hiding `body *` unconditionally — while `.print-area` existed at
 * exactly two call sites. So eight of the ten routes printed a blank sheet, `/person` most visibly:
 * `PersonDashboard` documents itself as the print-friendly single-page report and prints correctly
 * via `/reports?type=person`, but printing the person page it was written for produced nothing.
 *
 * `visibility: hidden` is what made it invisible to everyone — the page still laid out, still
 * scrolled, still had a full DOM, and only a real print preview showed the empty page. Playwright's
 * visibility check reads exactly that, so these tests see what a reader's printer sees.
 */

const ROUTES = [
  ['home', './', /UW–Madison Salaries/],
  ['paycheck', './paycheck', /./],
  ['explore', './explore', /Divisions/],
  ['compare', './compare', /./],
  ['screening', './screening', /./],
  ['data', './data', /./],
  ['school', `./school/${encodeURIComponent('School of Medicine and Public Health')}`, /./],
] as const;

for (const [name, path, heading] of ROUTES) {
  test(`prints its content rather than a blank page: ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_000);
    await page.emulateMedia({ media: 'print' });

    const h1 = page.locator('h1').first();
    await expect(h1, `${name} has no h1 to print`).toHaveText(heading, { timeout: 30_000 });
    await expect(h1, `${name} prints a blank page — its heading is not visible in print`)
      .toBeVisible();

    // Something below the heading has to survive too: a page that printed only its title would
    // pass an h1-only check while still being useless.
    const body = page.locator('main p, main table, main .mantine-Card-root').first();
    await expect(body, `${name} prints its heading but no content`).toBeVisible();
  });

  test(`leaves the app chrome off the page: ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_000);
    await page.emulateMedia({ media: 'print' });

    for (const sel of ['.mantine-AppShell-navbar', '.mantine-AppShell-header', '.mantine-AppShell-footer']) {
      const el = page.locator(sel);
      if (await el.count()) {
        await expect(el.first(), `${name} prints ${sel} — app chrome belongs on screen, not on paper`)
          .toBeHidden();
      }
    }
  });
}

/**
 * `/person` gets its own case because it has no static URL and because it is the sharpest instance
 * of the bug: `PersonDashboard` calls itself the print-friendly single-page report, prints fine at
 * `/reports?type=person`, and printed nothing at all from the person page it describes.
 */
test('prints its content rather than a blank page: person', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page).toHaveURL(/\/person\//, { timeout: 30_000 });
  await expect(page.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });

  await page.emulateMedia({ media: 'print' });
  const h1 = page.locator('h1').first();
  await expect(h1, 'the person page prints a blank sheet').toBeVisible();
  await expect(
    page.locator('main .mantine-Card-root').first(),
    'the person page prints its name but none of the salary evidence under it',
  ).toBeVisible();
});

/**
 * The other half of the contract: a page that DOES declare a print region still prints only that
 * region. This is the behaviour the old blanket rule bought at the cost of the eight routes above,
 * and it is the reason the fix is scoped with `:has()` rather than deleted.
 */
test('a page that declares a print region still prints only that region', async ({ page }) => {
  await page.goto('./reports?type=comparison', { waitUntil: 'networkidle' });
  const startSearch = page.getByPlaceholder('Search yourself by name to begin…');
  await expect(startSearch).toBeVisible({ timeout: 60_000 });
  await startSearch.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  const brief = page.locator('.print-area');
  await expect(brief).toBeVisible({ timeout: 60_000 });
  await page.emulateMedia({ media: 'print' });

  // The brief prints...
  await expect(brief, 'the report brief itself must still print').toBeVisible();
  // ...and the interactive setup pane beside it does not.
  await expect(page.locator('.setup-panel'), 'the setup pane must never print').toBeHidden();
});
