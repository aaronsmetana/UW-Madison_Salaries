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
  // An ABSOLUTE cap, and deliberately not `maxDiffPixelRatio`. The ratio version was tried at 0.01
  // and hid real changes: on a sparse page — the empty Titles view, the 404, the departments table —
  // the token pass moved hairlines, card corners and 11px labels, which together came to under 1% of
  // a mostly-white full-page shot, so three pages reported "unchanged" while all three had changed.
  // A ratio scales the blind spot with the page; an absolute count does not.
  //
  // This started at 250, on the reasoning that no design change worth catching could land under it.
  // That was wrong, and the command palette proved it: adding a 126x30 button to the header of every
  // page moved *no* baseline. A `variant="default"` button sits on a background it nearly matches, so
  // the only pixels that actually differ are its 1px border and a few glyphs — and Playwright's
  // per-pixel `threshold` discards the antialiased edges of even those. A visible, global, permanent
  // piece of UI came in under a cap sized for a two-pixel scroll wobble.
  //
  // The lesson is that a diff budget has to be sized against the *ink* a change moves, not its area.
  // 20 is the tight default: comfortably above run-to-run antialiasing on a static page, and an order
  // of magnitude below the border of the smallest control anyone would add on purpose.
  //
  // `CHART_NOISE` below is the exception, scoped to the two pages that earn it rather than applied to
  // all forty-two images — which is what let a global 250 hide the palette button on every page.
  maxDiffPixels: 20,
} as const;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-mantine-color-scheme', t);
    try { localStorage.setItem('mantine-color-scheme-value', t); } catch { /* ignore */ }
  }, theme);
}

/**
 * Let a viewport or theme change land: re-layout, webfont metrics, and any in-flight query.
 *
 * The loading bar is the reason this is not just a sleep. `.global-loading-bar` is a fixed 3px strip
 * that renders while any query is in flight, and under reduced motion it renders at full width rather
 * than as a moving sliver — so a shot taken while a query happened to be running differed from the
 * baseline by a bright band across the top of the page and nothing else. It was the only thing
 * separating two otherwise identical Home screenshots. Waiting for it to clear is also the honest
 * definition of "the page has settled".
 */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // Force one re-layout after the webfont has actually applied. Recharts decides how many x-axis
  // ticks fit by *measuring* rendered label widths, and it makes that decision once — so if the
  // decision was made against the fallback face, a different tick set gets baked in and stays. The
  // app's metric-overridden fallbacks narrow the swap but do not erase it (app.css puts the residual
  // at ~2%), which is enough to flip a tick in or out. That produced a Person diff in the axis labels
  // and the table headers on a commit that only touched the router.
  //
  // A one-pixel viewport nudge makes ResponsiveContainer re-measure with the final metrics.
  const vp = page.viewportSize();
  if (vp) {
    await page.setViewportSize({ width: vp.width + 1, height: vp.height });
    await page.setViewportSize(vp);
  }
  await expect(page.locator('.global-loading-bar')).toHaveCount(0, { timeout: 60_000 });
  // Re-run the app's own "centre the subject row" scroll, now that layout is final.
  //
  // Person's peer table centres the highlighted row on mount (Person.tsx) by measuring `rowRect.top`.
  // That measurement happens when the peer data arrives, which is before the webfont has finished
  // settling and before the re-layout above — so the position it computes is a pixel or two off, and
  // in a 1,251-row table a pixel or two of drift lands the scroll on a different row. The screenshot
  // then shows a different slice of the table every run: a ~20,000-pixel diff on a commit that only
  // touched the router.
  //
  // Resetting the scroll to zero is not enough, because the app's effect can still fire afterwards
  // and re-centre from the stale measurement. Reproducing the same calculation against settled
  // layout is deterministic, and keeps the subject row — and its `.row-this` treatment — in frame.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.mantine-ScrollArea-viewport').forEach((vp) => { vp.scrollTop = 0; });
    const row = document.querySelector('.row-this');
    const vp = row?.closest<HTMLElement>('.mantine-ScrollArea-viewport');
    if (row && vp) {
      const r = row.getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      vp.scrollTop += r.top - v.top - vp.clientHeight / 2 + r.height / 2;
    }
  });
  // Park the pointer off-canvas. Playwright leaves the mouse wherever the last click put it, and a
  // viewport change reflows the page underneath it — so on the title page, switching to 375px slid a
  // sortable column header under the cursor and baked its hover state into the mobile baseline on
  // some runs and not others. 103 pixels of pure pointer position, on a page whose charts were
  // already masked. A screenshot suite has to own the mouse as much as it owns the clock.
  await page.mouse.move(-10, -10);
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
/**
 * Recharts geometry does not settle to the pixel: bar heights and axis ticks come from a measured
 * container, and consecutive runs of an unchanged page land 60-90 antialiased pixels apart along the
 * edges. Where a bar is clipped by the fold it is far worse — a one-pixel shift moves the clip line
 * across a solid fill and rewrites 2,181 pixels at once, measured on Person.
 *
 * `.hist-plot` is masked alongside `.recharts-wrapper` because `SalaryHistogram` has two render
 * paths and only one of them is Recharts: below a threshold it draws a stack of absolutely-positioned
 * divs, one per person. Masking only the Recharts selector left the title page still flaking.
 *
 * Masking the plots rather than widening the budget. A tolerance big enough to absorb that would have
 * to be larger than most real changes, and it would apply to the whole image; a mask costs only the
 * plot area and leaves every heading, card, label and control on those pages under exact comparison.
 * The charts themselves are not unguarded — `smoke.spec.ts` asserts the distribution renders its
 * curve and that its quartile labels never overlap, at both widths.
 */
const CHARTS = (page: Page) => [page.locator('.recharts-wrapper'), page.locator('.hist-plot')];

/**
 * One shot earns a wider budget, and only after the diff was decoded pixel by pixel rather than
 * guessed at: on the title page at 375px, the sortable header row of "People with this title" —
 * `SALARY`, `NAME` and their sort glyphs — re-rasterises at a sub-pixel horizontal offset between
 * runs. The glyphs are identical; rendering them half a pixel over changes their antialiasing. It is
 * confined to ten pixel rows (1581-1590) and never touches the body rows below, which is the
 * signature of a sticky header on its own compositing layer, not of a layout change.
 *
 * Playwright scores it 69-103. 150 clears that with headroom and still sits far below anything with
 * content in it — the palette button that started this whole exercise would have been caught at any
 * budget under about 200 on a mobile shot, and this is the only image in the suite above 20.
 */
const STICKY_HEADER_JITTER = 150;

async function shots(
  page: Page,
  name: string,
  opts: { fullPage?: boolean; mask?: ReturnType<typeof CHARTS>; maxDiffPixels?: number } = {}
) {
  await page.setViewportSize(DESKTOP);
  await setTheme(page, 'light');
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-light-desktop.png`, { ...SHOT, ...opts });

  await setTheme(page, 'dark');
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-dark-desktop.png`, { ...SHOT, ...opts });

  await setTheme(page, 'light');
  await page.setViewportSize(MOBILE);
  await settle(page);
  await expect.soft(page).toHaveScreenshot(`${name}-light-mobile.png`, { ...SHOT, ...opts });
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
  // Viewport-only, not full-page — the one test in this file that is.
  //
  // Person is the densest page in the app and has two regions that will not settle to the pixel: a
  // 1,251-point Recharts scatter, and a 1,251-row peer table in a 460px scroll box that centres the
  // subject row by measuring its position on mount. A pixel of layout drift lands that scroll on a
  // different row, so the shot captures a different slice of the table. Re-running the centring
  // against settled layout (see `settle`) helped and did not fix it; across six runs it still moved
  // on three, once by 22,000 pixels.
  //
  // Both live below the fold, and neither is what this suite is for. What it is for — the header,
  // the hero, the stat cards, the tab bar, the card treatment and the headings — is all above it and
  // is stable. Shooting the viewport keeps that under exact comparison instead of letting one scroll
  // box make the whole page unreadable as a diff.
  await shots(page, 'person', { fullPage: false, mask: CHARTS(page) });
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
  await shots(page, 'titles-detail', { mask: CHARTS(page), maxDiffPixels: STICKY_HEADER_JITTER });
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
