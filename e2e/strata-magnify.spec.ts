import { test, expect, type Page } from '@playwright/test';
import { HOME_STATS, people, spots } from './homeDots';

/**
 * Magnify (mockup 3a): a click on the histogram zooms in on that spot — a $30k window, six $5k columns across the
 * plot, with much larger squares — over about 1.3 s; a drag pans the window, and a strip over the plot shows the
 * whole distribution with the window on it, a press or a drag there moving it. Magnified, the square under the
 * pointer is ringed and named, a click follows them, and Full view (or Escape) zooms back out. Who is where is
 * checked against the data through the indexing the search's marks use (homeDots `spots`).
 */

const COL = 5000;
const num = (n: number) => n.toLocaleString('en-US');
const field = (page: Page) => page.locator('.strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
const magnify = (page: Page) => page.locator('.strata-magnify');
const places = (page: Page, f: 'main' | 'pile' = 'main') =>
  field(page).evaluate((el, f) => (el as unknown as { squarePlaces: (f: string) => number[] }).squarePlaces(f), f);
const attr = async (page: Page, name: string) => Number(await field(page).getAttribute(name));

async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
/** A click on the histogram over column `c`, low over its bar. */
async function clickColumn(page: Page, c: number) {
  const box = (await plot(page).boundingBox())!, colW = await attr(page, 'data-col-w');
  await page.mouse.click(box.x + (c + 0.5) * colW, box.y + box.height - 12);
}
/** Everyone's $5k column, by their square. */
async function columns() {
  const at = await spots();
  const main: number[] = [];
  for (const p of await people()) { const s = at.get(p.person_key); if (s?.field === 'main') main[s.index] = Math.floor(p.pay / COL); }
  return main;
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

test('a click on the histogram magnifies that spot: six $5k columns across the plot, larger squares, each named and counted; Full view zooms out', async ({ page }) => {
  await home(page);
  // A square's width: on a 1x screen the histogram's bars are solid runs of single-pixel columns.
  const before = await places(page), sq = await attr(page, 'data-sq-w');
  await expect(magnify(page)).toHaveText('Magnify');
  await clickColumn(page, 18);
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  // Centred on the column clicked: $90–95k in the middle of a $30k window.
  const left = (18 + 0.5) * COL - 3 * COL;
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(left));
  await expect(magnify(page)).toHaveText('Full view');
  expect(await attr(page, 'data-sq-w'), 'the squares are no larger').toBeGreaterThan(2 * sq);
  // Six columns to the plot, each one's people in its own sixth of it, from the window's left edge.
  const box = (await plot(page).boundingBox())!, colW = await attr(page, 'data-col-w');
  expect(colW).toBeCloseTo(box.width / 6, 3);
  const cols = await columns(), pts = await places(page);
  const ox = (left / COL) * colW;
  for (let i = 0; i < cols.length; i += 37) {
    const x = pts[2 * i] + ox;
    expect(Math.floor(x / colW), `square ${i} is not in its $5k column`).toBe(Math.min(49, cols[i]));
  }
  // The columns in view named under the plot and counted over their bars.
  const rows = await people();
  const count = (c: number) => rows.filter((p) => p.pay < 250_000 && Math.floor(p.pay / COL) === c).length;
  for (const c of [16, 17, 18, 19, 20]) {
    await expect(page.locator(`.strata-mag-tick[data-col="${c}"]`)).toHaveText(`$${c * 5}–${c * 5 + 5}k`);
    await expect(page.locator(`.strata-mag-count[data-col="${c}"]`)).toHaveText(num(count(c)));
  }
  // The histogram's own labels gone while magnified.
  await expect(page.locator('.strata-pin').first()).toBeHidden();
  // And back.
  await magnify(page).click();
  await expect(plot(page)).toHaveAttribute('data-view', 'hist');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  expect(await places(page)).toEqual(before);
  await expect(magnify(page)).toHaveText('Magnify');
});

test('zooming in and out takes about 1.3 s, everyone together', async ({ page }) => {
  await home(page);
  await page.evaluate(() => {
    const w = window as unknown as { log: [string, number][] };
    w.log = [];
    const f = document.querySelector('.strata-field') as HTMLElement;
    new MutationObserver(() => w.log.push([f.dataset.settled!, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
  });
  for (const go of [() => magnify(page).click(), () => magnify(page).click()]) {
    await page.evaluate(() => { (window as unknown as { log: unknown[] }).log.length = 0; });
    await go();
    await page.waitForFunction(() => { const l = (window as unknown as { log: [string, number][] }).log; return l.length >= 2 && l[l.length - 1][0] === 'true'; }, null, { timeout: 10_000 });
    const log = await page.evaluate(() => (window as unknown as { log: [string, number][] }).log);
    const took = log[log.length - 1][1] - log.find(([s]) => s === 'false')![1];
    expect(took, 'the zoom took').toBeGreaterThan(1100);
    expect(took, 'the zoom took').toBeLessThan(2200);
  }
});

test('magnified, a drag pans the window, and a press on the strip moves it there; the squares simply follow', async ({ page }) => {
  await home(page);
  await clickColumn(page, 18);
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  const box = (await plot(page).boundingBox())!, colW = await attr(page, 'data-col-w');
  const at = async () => Number(await plot(page).getAttribute('aria-valuenow'));
  const start = await at();
  // Dragged two columns to the left: the window two columns on.
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7 - 2 * colW, box.y + box.height * 0.8, { steps: 8 });
  // Where they are drawn this moment is where they rest: the window moves under the pointer, nothing glides after it.
  const now = await field(page).evaluate((el) => (el as unknown as { squareNow: (f: string) => number[] }).squareNow('main'));
  expect(now, 'the squares are still on their way').toEqual(await places(page));
  await page.mouse.up();
  expect(Math.abs((await at()) - (start + 2 * COL)), 'the window did not follow the drag').toBeLessThan(200);
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  // The strip: every column's bar, the window outlined over its own; a press at $150k centres it there.
  const strip = page.locator('.strata-strip');
  await expect(strip.locator('.strata-strip-bar')).toHaveCount(51);
  const bw = box.width / 51;
  const win = Number(await strip.locator('.strata-strip-window').getAttribute('x'));
  expect(Math.abs(win - ((await at()) / COL) * bw)).toBeLessThan(1);
  await expect(strip.locator('.strata-strip-bar[data-in]')).toHaveCount(7);
  const sb = (await strip.boundingBox())!;
  await page.mouse.click(sb.x + (150_000 / COL) * bw, sb.y + 30);
  expect(Math.abs((await at()) - (150_000 - 3 * COL))).toBeLessThan(200);
  await expect(field(page)).toHaveAttribute('data-settled', 'true');
});

test('magnified, the square under the pointer is ringed and named; a click follows them; Escape lets go, then zooms out', async ({ page }) => {
  await home(page);
  await clickColumn(page, 18);
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  const box = (await plot(page).boundingBox())!, pts = await places(page);
  const cols = await columns();
  const i = cols.findIndex((c, k) => c === 18 && pts[2 * k + 1] > 0 && pts[2 * k] > 0 && pts[2 * k] < box.width);
  await page.mouse.move(box.x + pts[2 * i], box.y + pts[2 * i + 1]);
  await expect(plot(page)).toHaveAttribute('data-pick', `main:${i}`);
  await expect(page.locator('.strata-card-name')).toBeVisible({ timeout: 60_000 });
  await page.mouse.click(box.x + pts[2 * i], box.y + pts[2 * i + 1]);
  await expect(plot(page)).toHaveAttribute('data-follow', /\|/, { timeout: 60_000 });
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  await page.keyboard.press('Escape');
  await expect(plot(page)).not.toHaveAttribute('data-follow', /./);
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  await page.keyboard.press('Escape');
  await expect(plot(page)).toHaveAttribute('data-view', 'hist');
});

test('magnified, the arrow keys pan the window a column at a time, Home and End to the ends', async ({ page }) => {
  await home(page);
  await magnify(page).click();
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  // In at the median's column.
  const left = Math.max(0, (Math.floor(HOME_STATS.p50 / COL) + 0.5) * COL - 3 * COL);
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(left));
  await plot(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(left + COL));
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(left - 4 * COL));
  await page.keyboard.press('End');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(225_000));
  await expect(plot(page)).toHaveAttribute('aria-valuetext', /^\$225k–\$250k\+ magnified/);
  await expect(page.locator('.strata-mag-tick[data-col="50"]')).toHaveText('$250k+');
  await page.keyboard.press('Home');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', '0');
});

test('from the floors, Magnify goes straight in at the median, and Floors from there back out to them', async ({ page }) => {
  await home(page);
  await page.getByRole('radiogroup', { name: 'View' }).getByText('Floors').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
  await magnify(page).click();
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  await expect(page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Histogram' })).toBeChecked();
  await page.getByRole('radiogroup', { name: 'View' }).getByText('Floors').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
});

test('on a phone a tap on the histogram magnifies, and the zoom-out button brings it back', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await home(page);
  await plot(page).scrollIntoViewIfNeeded();
  const box = (await plot(page).boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height - 10);
  await expect(plot(page)).toHaveAttribute('data-view', 'magnify');
  await page.getByRole('button', { name: 'Full view' }).click();
  await expect(plot(page)).toHaveAttribute('data-view', 'hist');
  await ctx.close();
});
