import { test, expect, type Page } from '@playwright/test';

/**
 * Visual baselines for every route, in both themes, at desktop and phone widths.
 *
 * Why this exists: the app's design tokens are global — one edit to `theme.ts` or the `:root` blocks
 * of `app.css` repaints all nine routes at once. Before this suite, "does that change break a page?"
 * could only be answered by opening pages and looking. Now it is a reviewable image diff.
 *
 * LOCAL ONLY — this file runs in its own Playwright project and `npm run e2e` (what CI runs) skips it.
 * CI is ubuntu-latest; baselines captured on macOS can never match Linux font rasterization, and
 * Playwright keys snapshots by platform, so every one would fail there as "snapshot missing".
 * Run it with `npm run e2e:visual`.
 *
 * Determinism comes from the app's own reduced-motion path, not from masking: `prefersReducedMotion`
 * (src/lib/motion.ts) makes `useCountUp`, `useMounted` and `useReveal` all start in their final state,
 * and stops `RotatingFact` cycling, so there is nothing left mid-tween to mask. The project sets
 * `reducedMotion: 'reduce'` so it applies from the first paint, before any component's initial state
 * is computed. `animations: 'disabled'` then covers the CSS layer.
 *
 * The rendered numbers come from `public/data/`, which is gitignored and rebuilt by `npm run data`
 * from the committed raw files — stable across runs, but a genuine data import WILL change these
 * images. That is correct, not a failure: re-baseline with `npm run e2e:visual -- --update-snapshots`.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

const SHOT = {
  fullPage: true,
  animations: 'disabled',
  // Recharts tweens its own SVG in JS, which `animations: 'disabled'` does not reach. Playwright
  // re-shoots until two consecutive frames are identical, so a generous timeout absorbs that rather
  // than a fixed sleep per chart.
  timeout: 25_000,
  // No `maxDiffPixelRatio`. It was set to 0.01 and it hid real changes: on a sparse page — the empty
  // Titles view, the 404, the departments table — the token pass moved hairlines, card corners and
  // 11px labels, which together came to under 1% of a mostly-white full-page shot, so three pages
  // reported "unchanged" while every one of them had in fact changed. Playwright's per-pixel
  // `threshold` (0.2 by default) already absorbs antialiasing noise, and running the suite twice
  // against one build produced zero diffs, so there is no flake left for a count tolerance to soak up.
} as const;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-mantine-color-scheme', t);
    try { localStorage.setItem('mantine-color-scheme-value', t); } catch { /* ignore */ }
  }, theme);
}

/** Let a viewport or theme change land: re-layout, webfont metrics, and any in-flight query. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(350);
}

/**
 * Three shots off one page load — the expensive part is booting DuckDB, and neither a theme swap nor
 * a viewport change needs a reload.
 *
 * `expect.soft`, because this suite exists to be *reviewed*. A hard assertion throws on the first
 * mismatch, so a token change that moved all three variants would only ever hand back the light
 * desktop image and abort before dark and mobile were even taken — exactly the two that most need
 * looking at. Soft assertions compare all three and still fail the test.
 */
async function shots(page: Page, name: string) {
  await page.setViewportSize(DESKTOP);
  await setTheme(page, 'light');
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-light-desktop.png`, SHOT);

  await setTheme(page, 'dark');
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-dark-desktop.png`, SHOT);

  await setTheme(page, 'light');
  await page.setViewportSize(MOBILE);
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-light-mobile.png`, SHOT);
}

/** A route that renders straight from its URL. */
const DIRECT: Array<[name: string, route: string]> = [
  ['home', './'],
  ['titles-empty', './paycheck'],
  ['divisions', './explore'],
  ['divisions-titles-tab', './explore?tab=titles'],
  ['compare-empty', './compare'],
  ['data-about', './data'],
  ['screening-empty', './screening'],
  ['reports-empty', './reports'],
  ['not-found', './this-route-does-not-exist'],
];

for (const [name, route] of DIRECT) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible({ timeout: 60_000 });
    // The shell paints before DuckDB has answered; wait for the first real figure so the baseline is
    // of the loaded page rather than of its skeletons.
    await page.getByText(/\$[\d,]+/).first().waitFor({ timeout: 60_000 }).catch(() => {});
    await shots(page, name);
  });
}

test('visual: person', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
  await shots(page, 'person');
});

test('visual: school', async ({ page }) => {
  await page.goto(`./school/${encodeURIComponent('School of Medicine and Public Health')}`);
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
  await shots(page, 'school');
});

test('visual: school departments tab', async ({ page }) => {
  await page.goto(`./school/${encodeURIComponent('School of Medicine and Public Health')}?tab=departments`);
  const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Total payroll' }) });
  await expect(table.locator('tbody tr td').first()).toBeVisible({ timeout: 60_000 });
  await shots(page, 'school-departments');
});

test('visual: titles with a title selected', async ({ page }) => {
  await page.goto('./paycheck');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeVisible({ timeout: 60_000 });
  await title.click();
  // Options are ordered by headcount, so "first" is stable across runs of the same data build.
  const first = page.getByRole('option').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
  await shots(page, 'titles-detail');
});

test('visual: reports with a subject', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  const search = page.getByPlaceholder('Search yourself by name to begin…');
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 60_000 });
  await shots(page, 'reports-subject');
});
