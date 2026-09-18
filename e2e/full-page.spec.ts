import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The landing graph full page (src/routes/Home.tsx `Distribution`): a button over the panel's corner
 * opens it over the whole window — over the header too — with the plot as tall as the window leaves;
 * the page under it does not scroll, the keyboard stays inside, and Escape or the button puts it back.
 * On a phone, full page, a finger's drag stirs the dots (there is nothing to scroll).
 */

async function settledHome(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}

const panel = (page: Page) => page.locator('.hero-dist');
/** The plot's height to the pixel: a box's height reads 374.99997 as often as 375. */
const plotHeight = (page: Page) => page.locator('.hero-dist-main').evaluate((el) => Math.round(el.getBoundingClientRect().height));

test('opens the graph full page over everything, as tall as the window, and puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await settledHome(page);
  expect(await plotHeight(page)).toBe(375);
  await page.getByRole('button', { name: 'Full page' }).click();

  const dialog = page.getByRole('dialog', { name: 'Pay distribution, full page' });
  await expect(dialog).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-full', 'on');
  // Wait out the growth before measuring the box it fills.
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
  const box = (await dialog.boundingBox())!;
  expect(Math.abs(box.x - 16), 'the panel does not fill the window').toBeLessThan(1);
  expect(Math.abs(box.y - 16)).toBeLessThan(1);
  expect(Math.abs(box.width - (1440 - 32))).toBeLessThan(1);
  expect(box.y + box.height, 'the panel runs off the window').toBeLessThanOrEqual(900 - 16 + 1);
  // Over the header: what is under the header's corner is the full page, not the page's chrome.
  expect(await page.evaluate(() => !!document.elementFromPoint(40, 20)?.closest('.hero-full')), 'the header is over the full page').toBe(true);
  // The plot takes the height, and its dots are laid out for the box they are drawn in.
  const h = await plotHeight(page);
  // Against the panel it sits in, and against the 375px it had on the page, rather than as a count of
  // pixels off the window. The plot gets what the window leaves after the panel's own furniture — the
  // controls, the axis, the legend, the caption — so a bare figure moves whenever that furniture changes
  // and says nothing either way about the plot growing.
  expect(h, 'the plot did not grow to the window').toBeGreaterThan(1.5 * 375);
  expect(h / box.height, 'the panel is mostly furniture').toBeGreaterThan(0.7);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  const fit = await page.evaluate(() => {
    const main = document.querySelector('.hero-dist-main')!.getBoundingClientRect();
    const dots = document.querySelector('.hero-dots') as HTMLElement;
    return { main: main.width, laid: Number(dots.dataset.width), tall: dots.getBoundingClientRect().height };
  });
  expect(Math.abs(fit.laid - fit.main), `dots laid out ${fit.laid}px wide in a ${fit.main}px plot`).toBeLessThan(0.5);
  expect(Math.round(fit.tall)).toBe(h);

  // The keyboard: focus lands on the way back out, and Tab never leaves the panel.
  await expect(page.getByRole('button', { name: 'Exit full page' })).toBeFocused();
  for (let k = 0; k < 12; k++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.hero-full')), `Tab ${k + 1} left the full page`).toBe(true);
  }
  // The page under it stays where it was. A wheel over the full page is kept there by its own
  // `overscroll-behavior` in Chromium; Safari on a phone scrolls a page behind a fixed layer unless the
  // page itself cannot scroll, which is what the lock on the root is for — and Chromium cannot show
  // that, so it is asserted as the lock.
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY), 'the page scrolled under the full page').toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'the page under the full page is not locked').toBe('hidden');
  const axe = await new AxeBuilder({ page }).include('.hero-full').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // And with results on the bar: chips are options in a listbox beside a combobox, and every kind of
  // chip gets scanned — people for one query, titles and a school for the other.
  const bar = page.locator('.hero-full .hero-dist-search input');
  for (const q of ['aaron', 'medicine']) {
    await bar.fill(q);
    await expect(page.locator('.hero-full [role="option"]').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(300);
    const scan = await new AxeBuilder({ page }).include('.hero-full').analyze();
    expect(scan.violations.map((v) => `${v.id}: ${v.nodes.length}`), `with "${q}" on the bar`).toEqual([]);
  }
  expect(await page.locator('.hero-full [role="option"][data-kind="division"]').count(), 'no school was ever on the bar to scan').toBeGreaterThan(0);
  await bar.fill('');

  // Escape: back in its place, focus on the button that opened it, and the page scrolls again.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-full', 'off');
  expect(await plotHeight(page)).toBe(375);
  await expect(page.getByRole('button', { name: 'Full page' })).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'the page stayed locked').toBe('visible');
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'the page no longer scrolls' }).toBeGreaterThan(0);

  // And the button puts it back too.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Full page' }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await plotHeight(page)).toBe(375);
});

// The phone is in here because the panel's furniture differs there: the controls float in the corner on
// a wide window, and the search box rides with them for nothing, but narrow they stand in the flow and
// the box takes a line of its own. The panel's full-page height is reckoned from the panel on the page,
// which has no box at all, so a line unaccounted for lands the grow half a line off its place — 23.8px
// of it, when the box first moved into the controls.
test('full page grows out of its place, and at once under Reduce Motion', async ({ browser }) => {
  for (const [reducedMotion, width, height] of [
    ['no-preference', 1440, 900], ['reduce', 1440, 900], ['no-preference', 375, 812],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, ...(width < 500 ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}) });
    const page = await ctx.newPage();
    await settledHome(page);
    const from = (await panel(page).boundingBox())!;
    // The panel's own animation and where it starts, read the moment it opens; then played out, for the
    // box it fills (a box read mid-animation is the moved one).
    await page.getByRole('button', { name: 'Full page' }).evaluate((b: HTMLButtonElement) => b.click());
    const start = await page.evaluate(() => {
      const el = document.querySelector('.hero-dist-full') as HTMLElement | null;
      const anims = el?.getAnimations() ?? [];
      const effect = anims[0]?.effect as KeyframeEffect | undefined;
      const frames = effect ? effect.getKeyframes() : [];
      const n = anims.length;
      anims.forEach((a) => a.finish());
      return { open: !!el, anims: n, first: frames[0] ? { transform: String(frames[0].transform), clip: String(frames[0].clipPath) } : null, to: el?.getBoundingClientRect().toJSON() };
    });
    expect(start.open).toBe(true);
    if (reducedMotion === 'reduce') {
      expect(start.anims, 'the panel animated under Reduce Motion').toBe(0);
    } else {
      expect(start.anims, 'the panel did not grow').toBeGreaterThan(0);
      // It starts centred over its box on the page, clipped to that box's size.
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(start.first!.transform)!;
      expect(Math.abs(start.to.x + start.to.width / 2 + Number(m[1]) - (from.x + from.width / 2)), `${width}px wide: it does not start over its place`).toBeLessThan(1);
      expect(Math.abs(start.to.y + start.to.height / 2 + Number(m[2]) - (from.y + from.height / 2)), `${width}px wide: it does not start over its place, vertically`).toBeLessThan(1);
      const c = /inset\(([\d.]+)px ([\d.]+)px/.exec(start.first!.clip)!;
      expect(Math.abs(start.to.width - 2 * Number(c[2]) - from.width), `${width}px wide: it does not start the size of its place`).toBeLessThan(1);
      expect(start.first!.transform, 'a scale skews what the panel measures while it grows').not.toMatch(/scale/);
    }
    await ctx.close();
  }
});

test('Escape in the command palette over the full page closes the palette, not the full page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await settledHome(page);
  await page.getByRole('button', { name: 'Full page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pay distribution, full page' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  const palette = page.getByRole('dialog', { name: 'Search and go' });
  await expect(palette).toBeVisible();
  // The palette is over the full page.
  const sb = (await palette.boundingBox())!;
  expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('.hero-full'), { x: sb.x + sb.width / 2, y: sb.y + 30 }), 'the full page is over the palette').toBe(false);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(dialog, 'Escape in the palette closed the full page').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('full page on a phone: a finger drags through the dots and stirs them, holds for the glass, and taps to burst', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await settledHome(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const frames = () => page.evaluate(() => performance.getEntriesByName('flight-frame').length);
  const main = page.locator('.hero-dist-main');

  // On the page first: a finger that moves over the plot scrolls, and throws nothing.
  await main.scrollIntoViewIfNeeded();
  let box = (await page.locator('.hero-dist-plot').boundingBox())!;
  const inPlaceH = box.height;
  const before = await frames();
  await touch('touchStart', box.x + box.width * 0.2, box.y + box.height * 0.8);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', box.x + box.width * (0.2 + 0.05 * k), box.y + box.height * 0.8 - 12 * k); await page.waitForTimeout(16); }
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(200);
  expect(await frames(), 'a finger dragging on the page stirred the dots').toBe(before);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Full page' }).click();
  await expect(panel(page)).toHaveAttribute('data-full', 'on');
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  box = (await page.locator('.hero-dist-plot').boundingBox())!;
  // Against the plot on the page rather than as a count of pixels: full page on a phone carries three
  // lines above the plot — the search box, its strip of results and the buttons — and the plot gets what
  // the window leaves. It was 463px with none of them and 415px with the box alone; it is 377px now, from
  // 275px on the page. A bare figure only ever measured that furniture, not whether the plot grew.
  expect(box.height / inPlaceH, `the plot did not grow on the phone: ${inPlaceH}px on the page, ${box.height}px full page`).toBeGreaterThan(1.3);
  const scrolled = () => page.evaluate(() => [window.scrollY, document.querySelector('.hero-full')!.scrollTop]);
  const at = await scrolled();

  // A drag: the dots move, nothing scrolls.
  const y = box.y + box.height * 0.85;
  const dragFrom = await frames();
  await touch('touchStart', box.x + box.width * 0.15, y);
  for (let k = 1; k <= 12; k++) { await touch('touchMove', box.x + box.width * (0.15 + 0.05 * k), y); await page.waitForTimeout(16); }
  expect(await scrolled(), 'the finger scrolled the full page').toEqual(at);
  expect(await frames(), 'a finger dragging full page did not stir the dots').toBeGreaterThan(dragFrom);
  expect(Number(await main.getAttribute('data-stir')), 'the drag was not measured').toBeGreaterThanOrEqual(0);
  await touch('touchEnd', 0, 0);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle', { timeout: 6000 });

  // A finger held still still brings up the glass.
  await touch('touchStart', box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.waitForTimeout(600);
  await expect(main).toHaveAttribute('data-lens', 'on');
  const held = await frames();
  await touch('touchEnd', 0, 0);
  await expect(main).toHaveAttribute('data-lens', 'off');
  await page.waitForTimeout(200);
  expect(await frames(), 'lifting the held finger threw the dots').toBe(held);

  // A tap still bursts.
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.8);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'moving');
  await ctx.close();
});
