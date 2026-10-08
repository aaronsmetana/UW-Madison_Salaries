import { test, expect, type Browser, type Page } from '@playwright/test';
import { HOME_STATS, people, spots } from './homeDots';
import { atCiPace, FRAME_MS } from './pace';

/**
 * The pile past the landing graph's cap (components/strata): a button, not a crowd to read — over it no lens,
 * but how many are there and what a click does. Clicked (or its label, from the keyboard), it unrolls: the
 * graph squeezes to its true share of an axis run out to the top salary, and each of the pile's people goes to
 * their own pay, where the lens names them. A click on the squeezed graph, its label again, or Escape folds it
 * back, every square to where it was. Pays come from the data, through the same indexing as the search's marks.
 */

const CAP = HOME_STATS.bin_cap;
const { categories } = HOME_STATS.pay_counts;
const OVER = categories.reduce((t, c) => t + c.over, 0);
const num = (n: number) => n.toLocaleString('en-US');
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

const field = (page: Page) => page.locator('.hero-dist:not([data-full="on"]) .strata-field, .hero-dist-full .strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
const toggle = (page: Page) => page.locator('.strata-pile-toggle').first();
const placesOf = (page: Page, f: 'main' | 'pile') =>
  field(page).evaluate((el, f) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces(f), f);

async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}

/** The pile's people by their square's index: each one's own pay. */
async function pilePays() {
  const at = await spots();
  const out: number[] = [];
  for (const p of await people()) { const s = at.get(p.person_key); if (s?.field === 'pile') out[s.index] = p.pay; }
  return out;
}
/** Somewhere over the pile, in the page's px. */
async function overPile(page: Page) {
  const box = (await plot(page).boundingBox())!;
  const left = Number(await field(page).getAttribute('data-pile-left'));
  return { x: box.x + (left + box.width) / 2, y: box.y + box.height - 12 };
}

test('the pile is a button: over it no lens, but how many are there and what a click does', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const total = (await people()).length;
  const at = await overPile(page);
  await page.mouse.move(at.x - 30, at.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(plot(page)).toHaveAttribute('data-over-pile', 'true');
  await expect(plot(page)).toHaveAttribute('data-lens', 'off');
  await expect(plot(page)).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.strata-pile-word')).toHaveText(
    `${num(OVER)} at ${fmtK(CAP)} or more · the top ${((OVER / total) * 100).toFixed(1)}% · click to see each at their own pay`,
  );
  await expect(page.locator('.strata-pile-ring')).toBeVisible();
  // Just short of it, the lens shows the pile's edge but never names one of them: they are read unrolled.
  const box = (await plot(page).boundingBox())!;
  const left = Number(await field(page).getAttribute('data-pile-left'));
  for (const dx of [7, 9, 12]) {
    await page.mouse.move(box.x + left - dx, at.y, { steps: 2 });
    await expect(plot(page)).toHaveAttribute('data-lens', 'on');
    await page.waitForTimeout(300);
    expect(await plot(page).getAttribute('data-pick') ?? '', `${dx}px short of the pile`).not.toMatch(/^pile:/);
  }
  // Off it, the lens is back and the word goes.
  await page.mouse.move(at.x - 400, at.y, { steps: 4 });
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  await expect(page.locator('.strata-pile-word')).toHaveCount(0);
});

test('clicking the pile unrolls its people onto an axis to the top salary, each at their own pay, and a click on the graph folds them back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const pays = await pilePays();
  const top = Math.max(...pays);
  const before = { main: await placesOf(page, 'main'), pile: await placesOf(page, 'pile') };
  const at = await overPile(page);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(plot(page)).toHaveAttribute('data-tail', 'on');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  await expect(toggle(page)).toHaveText(`$${top / 1e6}M · fold back`);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.strata-tail-note')).toContainText(`The top salary, ${usd(top)}, is ${Math.round(top / CAP)}× the ${fmtK(CAP)} edge of the graph`);
  // The axis's scale, from its own $1M tick: px a dollar.
  const tick = page.locator('.strata-axis .hero-dist-tick', { hasText: /^\$1M$/ });
  const axis = (await page.locator('.strata-axis').boundingBox())!;
  const tb = (await tick.boundingBox())!;
  const scale = (tb.x + tb.width / 2 - axis.x) / 1e6;
  const pitch = Number(await field(page).getAttribute('data-pitch'));
  // Each of the pile's people at their own pay, to within a column of the lattice.
  const tail = await placesOf(page, 'pile');
  const off = pays.map((p, j) => ({ j, p, x: tail[2 * j], want: p * scale })).filter((t) => Math.abs(t.x - t.want) > pitch + 1);
  expect(off.slice(0, 5), 'people away from their own pay').toEqual([]);
  // The graph squeezed to its true share: everyone under the cap left of where the cap now falls.
  const main = await placesOf(page, 'main');
  let right = 0;
  for (let i = 0; i < main.length; i += 2) right = Math.max(right, main[i]);
  expect(right).toBeLessThan(CAP * scale + pitch);
  expect(right).toBeGreaterThan(CAP * scale * 0.9);
  // The top salary ringed at the far end.
  const jTop = pays.indexOf(top);
  const ring = page.locator('.strata-tail-top');
  expect(Math.abs(Number(await ring.getAttribute('cx')) - tail[2 * jTop])).toBeLessThan(0.5);
  expect(Math.abs(Number(await ring.getAttribute('cy')) - tail[2 * jTop + 1])).toBeLessThan(0.5);
  // A click on the squeezed graph folds them back, every square to where it was — straight off one of them, too:
  // moved and clicked in one go, before the lens put away there has had a frame to let go of them.
  const box = (await plot(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 20, { steps: 3 });
  await expect(page.locator('.strata-fold-word')).toBeVisible();
  const j = pays.findIndex((p) => p > 400_000 && p < 500_000);
  await page.mouse.move(box.x + tail[2 * j], box.y + tail[2 * j + 1] - 6, { steps: 3 });
  await expect(plot(page)).toHaveAttribute('data-pick', /^pile:\d+$/);
  await plot(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    const at = { bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: b.left + 20, clientY: b.bottom - 20 };
    for (const type of ['pointermove', 'pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { ...at, button: type === 'pointermove' ? -1 : 0 }));
  });
  await expect(plot(page)).toHaveAttribute('data-tail', 'off');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  expect({ main: await placesOf(page, 'main'), pile: await placesOf(page, 'pile') }, 'folded, squares out of place').toEqual(before);
});

test('unrolled, the lens names one of the pile with their own pay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const pays = await pilePays();
  await toggle(page).click();
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  const tail = await placesOf(page, 'pile');
  const box = (await plot(page).boundingBox())!;
  // Someone past $400k, with the lens just above them.
  const j = pays.findIndex((p) => p > 400_000 && p < 500_000);
  await page.mouse.move(box.x + tail[2 * j] - 10, box.y + tail[2 * j + 1] - 6);
  await page.mouse.move(box.x + tail[2 * j], box.y + tail[2 * j + 1] - 6, { steps: 3 });
  await expect(plot(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  await page.mouse.move(box.x + tail[2 * j] + 0.5, box.y + tail[2 * j + 1] - 6);
  await expect(plot(page)).toHaveAttribute('data-pick', /^pile:\d+$/, { timeout: 5_000 });
  const k = Number((await plot(page).getAttribute('data-pick'))!.split(':')[1]);
  await expect(page.locator('.strata-card-pay > span').first()).toHaveText(usd(pays[k]));
  expect(Math.abs(tail[2 * k] - tail[2 * j]), 'the lens named someone away from where it was pointed').toBeLessThan(10);
  await expect(page.locator('.strata-readout')).toContainText(/^\$\d+k · \d+ (person|people) within ±\$25k · /);
});

test('from the keyboard: the label unrolls the pile, the arrows walk its people by pay, and Escape folds it — before full page closes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const pays = await pilePays();
  const byPay = pays.map((p, j) => ({ p, j })).sort((a, b) => a.p - b.p || a.j - b.j).map((x) => x.j);
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(plot(page)).toHaveAttribute('data-tail', 'on');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  await expect(toggle(page)).toBeFocused();
  // Back to the plot: the lens on the lowest paid of them.
  await page.keyboard.press('Shift+Tab');
  await expect(plot(page)).toBeFocused();
  await expect(plot(page)).toHaveAttribute('data-pick', `pile:${byPay[0]}`);
  await page.keyboard.press('End');
  await expect(plot(page)).toHaveAttribute('data-pick', `pile:${byPay[byPay.length - 1]}`);
  await page.keyboard.press('ArrowLeft');
  await expect(plot(page)).toHaveAttribute('data-pick', `pile:${byPay[byPay.length - 2]}`);
  await page.keyboard.press('Escape');
  await expect(plot(page)).toHaveAttribute('data-tail', 'off');

  // Full page: Escape folds the pile first, and only then closes full page.
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist-full')).toBeVisible();
  await toggle(page).click();
  await expect(plot(page)).toHaveAttribute('data-tail', 'on');
  await page.keyboard.press('Escape');
  await expect(plot(page)).toHaveAttribute('data-tail', 'off');
  await expect(page.locator('.hero-dist-full')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hero-dist-full')).toHaveCount(0);
});

test('unrolling moves in frames inside the frame budget, and not at all under reduced motion', async ({ browser }) => {
  const run = async (b: Browser, reduce: boolean) => {
    const ctx = await b.newContext({ reducedMotion: reduce ? 'reduce' : 'no-preference', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (!reduce) await atCiPace(page);
    await home(page);
    const f0 = await page.evaluate(() => performance.getEntriesByName('strata-frame').length);
    await toggle(page).click();
    await expect(plot(page)).toHaveAttribute('data-tail', 'on');
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
    const frames = await page.evaluate((f0) => performance.getEntriesByName('strata-frame').slice(f0).map((e) => e.duration).sort((a, b) => a - b), f0);
    await ctx.close();
    return frames;
  };
  const moving = await run(browser, false);
  expect(moving.length).toBeGreaterThan(5);
  expect(moving[Math.floor(moving.length / 2)]).toBeLessThan(FRAME_MS);
  expect(await run(browser, true), 'squares moved under reduced motion').toEqual([]);
});

test('on a phone a tap on the pile unrolls it, and a tap on the squeezed graph folds it back', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await home(page);
  await plot(page).scrollIntoViewIfNeeded();
  const cdp = await ctx.newCDPSession(page);
  const tap = async (x: number, y: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const at = await overPile(page);
  await tap(at.x, at.y);
  await expect(plot(page)).toHaveAttribute('data-tail', 'on');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  await expect(page.locator('.strata-tail-note')).toBeVisible();
  const box = (await plot(page).boundingBox())!;
  await tap(box.x + 6, box.y + box.height - 10);
  await expect(plot(page)).toHaveAttribute('data-tail', 'off');
  await ctx.close();
});
