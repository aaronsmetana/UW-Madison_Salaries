import { test, expect, type Page } from '@playwright/test';

/**
 * On a phone (375px): the peer strip's axis and its subject's name (M2), and a table row's second line (M3).
 *
 * The strip labelled two ticks ($125k and $150k) and set "Aaron · $116,491" among the dots, over the people beside
 * him; now it asks for at least four ticks and puts the name on a lane over the swarm, a leader down to the dot.
 * A row folded its school under the name and cut it at two lines ("College of Letters & Scienc…") while the width
 * under the pay sat empty; now the school, department and the difference have a line of their own, the row's width.
 */

const AARON = 'aaronsmetana|2014-10-15';
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true };

async function person(page: Page) {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('.peer-strip-you')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

test('the strip names at least three ticks, none more than half the axis apart, and the subject’s name sits over the swarm, clear of every dot', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await person(page);
  const strip = page.locator('.peer-strip').first();
  const ticks = await strip.locator('.strip-tick:not(:has(.peer-strip-pile-label))').evaluateAll((els) => els.map((e) => ({ x: e.getBoundingClientRect().left, t: e.textContent ?? '' })));
  expect(ticks.filter((t) => /^\$\d+k$/.test(t.t)).length, `ticks: ${ticks.map((t) => t.t).join(', ')}`).toBeGreaterThanOrEqual(3);
  // Round steps half the axis apart at most (M2: a phone's strip had two, $125k and $150k).
  const plotW = await strip.locator('.strip-tick').first().evaluate((e) => e.parentElement!.getBoundingClientRect().width);
  const xs = ticks.map((t) => t.x).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, k) => x - xs[k]);
  expect(gaps.length, `ticks ${ticks.map((t) => t.t).join(', ')}`).toBeGreaterThanOrEqual(2);
  expect(Math.max(...gaps.slice(1)) / plotW, `ticks ${ticks.map((t) => t.t).join(', ')} over ${Math.round(plotW)}px`).toBeLessThanOrEqual(0.5);
  const { you, dots, self } = await strip.evaluate((el) => {
    const you = el.querySelector('.peer-strip-you')!.getBoundingClientRect();
    const circles = [...el.querySelectorAll('svg circle')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 4 && r.width < 20);
    return { you: { top: you.top, bottom: you.bottom, left: you.left, right: you.right }, dots: circles.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })), self: circles.length };
  });
  expect(self).toBeGreaterThan(10);
  const over = dots.filter((d) => d.right > you.left && d.left < you.right && d.bottom > you.top && d.top < you.bottom);
  expect(over, 'the name lies over a dot').toEqual([]);
  // Over the swarm: no dot above the name's foot.
  expect(Math.min(...dots.map((d) => d.top))).toBeGreaterThanOrEqual(you.bottom - 1);
  await ctx.close();
});

for (const [where, path, row] of [
  ['a person’s peers', `./person/${encodeURIComponent(AARON)}`, 'tr.peer-row:not(.fold-row)'],
  ['a title’s people', './titles?code=FA020', 'tr.peer-row:not(.fold-row)'],
  ['top earners', './divisions?tab=earners', 'tr.earner-row'],
] as const) {
  test(`${where}: each row’s school has a line the table’s width under it, never cut short`, async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(path);
    const first = page.locator(row).first();
    await expect(first).toBeVisible({ timeout: 60_000 });
    const second = page.locator(`${row} + tr.fold-row`).first();
    await expect(second).toBeVisible();
    await expect(second).toContainText(/^#\d+ · /);
    const [a, b] = [(await first.boundingBox())!, (await second.boundingBox())!];
    // The second line spans the row, directly under it.
    expect(Math.abs(b.width - a.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - (a.y + a.height))).toBeLessThanOrEqual(1);
    // Nothing in it is clipped: every line of text whole.
    const clipped = await page.locator('tr.fold-row').evaluateAll((trs) => trs.slice(0, 20).filter((tr) => [...tr.querySelectorAll('*')].some((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis')).length);
    expect(clipped).toBe(0);
    // And no sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await ctx.close();
  });
}

test('on a wider screen there is no second line: the columns say it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('tr.peer-row').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('tr.fold-row')).toHaveCount(0);
});
