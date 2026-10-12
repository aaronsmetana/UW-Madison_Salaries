import { test, expect } from '@playwright/test';

/**
 * Getting around: a search on every page, a person page that shows itself while its data arrives, a release
 * note a reader can put away, and pages that say plainly when an address names nothing.
 */

test('every page but Home has a search in its header that opens the search; on a phone, an icon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./divisions');
  const header = page.locator('header');
  const button = header.getByRole('button', { name: /^Search people, titles and divisions/ });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(button).toContainText('Search');
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.goto('./');
  await expect(page.getByRole('combobox', { name: 'Search a person, title or division' })).toBeVisible({ timeout: 60_000 });
  await expect(header.getByRole('button', { name: /^Search people, titles and divisions/ })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./raises');
  const icon = header.getByRole('button', { name: 'Search people, titles and divisions' });
  await expect(icon).toBeVisible({ timeout: 60_000 });
  await expect(icon).not.toContainText('Search');
});

test('a person page shows its shape and how far the data has got while it loads', async ({ page }) => {
  // Held back a moment, so the page is caught waiting for it.
  await page.route('**/data/salaries.parquet', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  await page.goto(`./person/${encodeURIComponent('aaronsmetana|2014-10-15')}`);
  const skeleton = page.getByRole('status', { name: 'Loading this person' });
  await expect(skeleton).toBeVisible({ timeout: 30_000 });
  await expect(skeleton.locator('.load-progress')).toHaveText(/^(Starting the data engine…|Loading data · [\d.]+( of [\d.]+)? MB|Opening the data…|Loading this person…)$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Aaron Smetana' })).toBeVisible({ timeout: 60_000 });
  await expect(skeleton).toHaveCount(0);
});

test('the release note can be put away until the next release, and is not on the Data page', async ({ page }) => {
  await page.goto('./divisions');
  const tag = page.locator('.page-top .release-tag');
  await expect(tag).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Hide the note about the .+ data$/ }).click();
  await expect(tag).toHaveCount(0);
  await page.goto('./raises');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.page-top .release-tag')).toHaveCount(0);
  // Put away for an earlier release, it is back for this one.
  await page.evaluate(() => localStorage.setItem('release-tag-dismissed', 'release-tag-dismissed:January 1999'));
  await page.reload();
  await expect(page.locator('.page-top .release-tag')).toBeVisible({ timeout: 60_000 });
  await page.goto('./data');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.page-top .release-tag')).toHaveCount(0);
});

test('an unknown person, division, title or page says so, offers what it is like, and a search', async ({ page }) => {
  // Brett Van Ess's name under a hire date he never had: he is the one offered.
  await page.goto(`./person/${encodeURIComponent('brettvaness|1999-01-01')}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Person not found' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.not-found-suggestions')).toContainText('Brett Van Ess');
  await expect(page.locator('.not-found').getByRole('combobox')).toBeVisible();

  await page.goto(`./school/${encodeURIComponent('Scool of Pharmacy')}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Division not found' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.not-found-suggestions a').first()).toHaveText('School of Pharmacy');
  await expect(page.getByRole('heading', { name: 'Scool of Pharmacy' })).toHaveCount(0);
  await expect(page).toHaveTitle(/^Division not found/);

  await page.goto('./titles?code=ZZZ999');
  await expect(page.getByRole('heading', { name: 'Title code not found' })).toBeVisible({ timeout: 60_000 });

  await page.goto('./no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('combobox')).toBeVisible({ timeout: 30_000 });
});

test('offline before the data was ever saved, a person page says so rather than loading for good', async ({ page, context }) => {
  // The salary file never arrives; the person page's code does, on a first visit while online.
  await page.route('**/data/salaries.parquet', (r) => r.abort());
  await page.goto(`./person/${encodeURIComponent('aaronsmetana|2014-10-15')}`);
  await expect(page.getByText(/^Failed to load person/)).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  await page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); },
    new URL(page.url()).pathname.replace(/person\/.*$/, `person/${encodeURIComponent('brettvaness|2018-07-23')}`));
  await expect(page.locator('.load-progress')).toHaveText(/^You're offline, and the salary data isn't saved on this device yet/, { timeout: 30_000 });
  // And still, once the load has given up: not "Failed to load person: Failed to fetch".
  await page.waitForTimeout(6_000);
  await expect(page.getByText(/^Failed to load person/)).toHaveCount(0);
  await expect(page.locator('.load-progress')).toHaveText(/^You're offline/);
});

for (const width of [320, 360, 375]) {
  test(`on a ${width}px phone the bar holds the name on one line, the search and the theme, with nothing cut off`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./raises');
    await expect(page.locator('.app-name')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('header').getByRole('button', { name: 'Search people, titles and divisions' })).toBeVisible();
    const r = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.app-name')!);
      const bar = document.querySelector('.app-bar')!;
      return { lines: new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size, over: bar.scrollWidth - bar.clientWidth };
    });
    expect(r.lines, 'the name wraps').toBe(1);
    expect(r.over, 'the bar runs past the screen').toBeLessThanOrEqual(0);
  });
}
