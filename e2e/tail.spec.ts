import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, latestSnapshot, usd } from './oracle';

/**
 * The pile past the landing graph's $250k cap unrolls (routes/Home, lib/tail): clicked, the graph squeezes
 * to its share of an axis run out to the top salary, the pile's dots fly out from where they sit to their
 * own pay, a note gives the top salary as a multiple of the cap, and a click, Escape or a few seconds fold
 * it all back.
 */

const CAP = 250000;
/** The people over the cap, as the landing page counts them: their count, the lowest pay and the top one. */
async function overCap() {
  const snap = await latestSnapshot();
  const [r] = await oracle<{ n: number; lo: number; hi: number }>(
    `WITH p AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, max(pay) hi FROM p WHERE pay >= ${CAP}`,
  );
  return r;
}

/** The landing page at 1440x900 on a paused clock, the dots at rest. */
async function frozen(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.clock.install({ time: new Date('2026-09-12T12:00:00') });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.clock.pauseAt(new Date('2026-09-12T12:01:00'));
}

/** How much ink a field's canvas holds in the columns [x0, x1) (CSS px from its left edge): pixels over a
 *  faint alpha, as a count. */
const inkIn = (page: Page, sel: string, x0: number, x1: number) => page.locator(`${sel} canvas`).first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const from = Math.max(0, Math.floor(a.x0 * k)), to = Math.min(c.width, Math.ceil(a.x1 * k));
  if (to <= from) return 0;
  const d = c.getContext('2d')!.getImageData(from, 0, to - from, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++;
  return n;
}, { x0, x1 });
const picture = (page: Page, sel: string) => page.locator(`${sel} canvas`).first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
const panel = (page: Page) => page.locator('.hero-dist');

test('clicking the pile unrolls its people onto an axis to the top salary, each at their own pay, and a click folds them back', async ({ page }) => {
  const over = await overCap();
  await frozen(page);
  const main = (await page.locator('.hero-dots').boundingBox())!;
  const row = (await page.locator('.hero-dist-row').boundingBox())!;
  const pile = (await page.locator('.hero-dist-pile').boundingBox())!;
  const mainRest = await picture(page, '.hero-dots');
  expect(await inkIn(page, '.hero-dots', main.width * 0.3, main.width), 'the graph has dots across its width at rest').toBeGreaterThan(1000);

  await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height - 12);
  await page.mouse.down();
  await page.mouse.up();
  await expect(panel(page)).toHaveAttribute('data-tail', 'opening');
  const tail = page.locator('.hero-dots-tail');
  await expect(tail).toHaveAttribute('data-dots', String(over.n));
  // The pile's own dots give way to the unrolled field, which starts on them: at first every one of its
  // dots is where the pile was.
  await expect(page.locator('.hero-dots-over')).toHaveCSS('visibility', 'hidden');
  await page.clock.runFor(32);
  const pileAt = pile.x - row.x;
  expect(await inkIn(page, '.hero-dots-tail', pileAt - 2, row.width), 'the unrolled dots did not start on the pile').toBeGreaterThan(200);
  expect(await inkIn(page, '.hero-dots-tail', 0, pileAt - 40), 'the unrolled dots started away from the pile').toBe(0);

  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'open');
  const scale = (v: number) => ((v - 0) / (over.hi - 0)) * row.width;
  // Every one of them at or past the cap's place on the long axis, and the lowest at their own.
  expect(await inkIn(page, '.hero-dots-tail', 0, scale(CAP) - 4), 'an unrolled dot sits below the cap').toBe(0);
  expect(await inkIn(page, '.hero-dots-tail', scale(over.lo) - 4, scale(over.lo) + 8), 'nobody at the lowest pay over the cap').toBeGreaterThan(0);
  // The graph squeezed to its share of that axis: nothing drawn past the cap's place.
  expect(await inkIn(page, '.hero-dots', scale(CAP) + 6, main.width), 'the graph did not squeeze').toBe(0);
  // The top salary, named where it is: at the axis's far end.
  const top = page.locator('.hero-dist-tail-top');
  await expect(top).toContainText(usd(over.hi));
  const topBox = (await top.boundingBox())!;
  expect(Math.abs(topBox.x - (row.x + scale(over.hi))), 'the top salary is not at the end of the axis').toBeLessThan(6);
  await expect(page.locator('.hero-dist-tail-note')).toContainText(`${usd(over.hi)}, is ${Math.round(over.hi / CAP)}×`);
  await expect(page.locator('.hero-dist-tail-tick').filter({ hasText: '$1M' })).toHaveCount(1);
  await expect(page.locator('.hero-dist-tick').first()).toHaveCSS('opacity', '0');

  // A click anywhere on the graph folds it back, and the graph is as it was.
  await page.mouse.click(main.x + main.width * 0.5, main.y + main.height * 0.5);
  await expect(panel(page)).toHaveAttribute('data-tail', 'closing');
  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'off');
  await expect(tail).toHaveCount(0);
  await expect(page.locator('.hero-dots-over')).toHaveCSS('visibility', 'visible');
  await page.clock.runFor(100);
  expect((await picture(page, '.hero-dots')) === mainRest, 'the graph did not come back to its picture').toBe(true);
});

test("the pile's label unrolls it from the keyboard; Escape folds it back, and so does a wait", async ({ page }) => {
  await frozen(page);
  // Named for the pile until it unrolls, then for folding back.
  const label = page.locator('.hero-dist-pile-toggle');
  await expect(label).toHaveAccessibleName(/at \$250k\+$/);
  await label.focus();
  await page.keyboard.press('Enter');
  await expect(label).toHaveAttribute('aria-expanded', 'true');
  await expect(label).toHaveAccessibleName(/fold back$/);
  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'open');
  await page.keyboard.press('Escape');
  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'off');
  // Full page's own Escape did not also fire: the page is where it was.
  await expect(panel(page)).toHaveAttribute('data-full', 'off');

  await page.getByRole('button', { name: /at \$250k\+$/ }).click();
  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'open');
  await page.clock.runFor(8000);
  await expect(panel(page)).toHaveAttribute('data-tail', 'closing');
  await page.clock.runFor(1600);
  await expect(panel(page)).toHaveAttribute('data-tail', 'off');
});

test('under Reduce Motion the pile unrolls and folds at once', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const over = await overCap();
  await page.getByRole('button', { name: /at \$250k\+$/ }).click();
  // No stage between: out at once (the motion's own 1.4s would be a wait with nothing moving).
  await expect(panel(page)).toHaveAttribute('data-tail', 'open', { timeout: 400 });
  const row = (await page.locator('.hero-dist-row').boundingBox())!;
  // Already at their places: the top earner's column has ink at once.
  await expect.poll(() => inkIn(page, '.hero-dots-tail', row.width * (over.hi / over.hi) - 6, row.width)).toBeGreaterThan(0);
  const main = (await page.locator('.hero-dots').boundingBox())!;
  expect(await inkIn(page, '.hero-dots', (CAP / over.hi) * row.width + 6, main.width)).toBe(0);
  await page.mouse.click(main.x + main.width / 2, main.y + main.height / 2);
  await expect(panel(page)).toHaveAttribute('data-tail', 'off', { timeout: 400 });
  await ctx.close();
});

test('the pile unrolls and folds in frames under 8ms at 2x', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // At about a CI runner's pace on a developer's machine (as dots.spec's frame budgets are).
  if (!process.env.CI) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 3 });
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  const frames = (name: string) => page.evaluate((n) => performance.getEntriesByName(n).map((e) => e.duration).sort((a, b) => a - b), name);
  await page.evaluate(() => performance.clearMeasures());
  await page.getByRole('button', { name: /at \$250k\+$/ }).click();
  await expect(panel(page)).toHaveAttribute('data-tail', 'open', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveAttribute('data-tail', 'off', { timeout: 10_000 });
  // Each field on its own: the graph's 21,000 squeezing, and the tail's 574 flying — a median over both
  // together is the cheap one's.
  for (const [name, what] of [['dot-frame', "the graph's"], ['tail-frame', "the tail's"]] as const) {
    const f = await frames(name);
    expect(f.length, `${what} dots never moved`).toBeGreaterThan(10);
    expect(f[Math.floor(f.length / 2)], `${what} unrolling frame, ms`).toBeLessThan(8);
  }
  await ctx.close();
});
