import { test, expect, type Page } from '@playwright/test';
import { parseColor, contrast } from './color';

/**
 * The Pay trend tab (P22–P29): fitted to the pay and the title median, the band clipped and its top named off the
 * chart; the typical path and the band as layers a reader adds; chips only for changes of 3% or more; a hover card
 * that follows the pointer clear of the title labels; the person's line louder than the reference in both
 * schemes; the difference from typical raises as a waterfall; one word for a title change; and the start
 * group's break explained.
 */

const AARON = 'aaronsmetana|2014-10-15';
test.use({ viewport: { width: 1440, height: 1000 } });

async function trend(page: Page) {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=trends`);
  await expect(page.locator('.person-trend .yoy-chip').first()).toBeVisible({ timeout: 60_000 });
}
const ticks = (page: Page) => page.locator('.person-trend .recharts-yAxis .recharts-cartesian-axis-tick-value').first()
  .locator('xpath=ancestor::*[contains(@class,"recharts-yAxis")]').locator('.recharts-cartesian-axis-tick-value').allTextContents();

test('the axis fits the pay and the median; the band is a layer, clipped, its top named off the chart', async ({ page }) => {
  await trend(page);
  const top = Math.max(...(await ticks(page)).map((t) => Number(t.replace(/[^\d]/g, ''))));
  expect(top, 'the axis still runs to the band').toBeLessThan(183_579);
  // Opens on the pay and the title median alone.
  await expect(page.locator('.person-trend .typical-line')).toHaveCount(0);
  await expect(page.locator('.person-trend .trend-band')).toHaveCount(0);
  await page.locator('.trend-show-band').click();
  await expect(page.locator('.person-trend .trend-band')).toHaveCount(1);
  await expect(page.locator('.trend-band-offchart')).toHaveText('↑ grade max $183,579');
  // Clipped: the band's shading stays inside the plot.
  const [band, grid] = await Promise.all([page.locator('.person-trend .trend-band path, .person-trend .trend-band rect').first().boundingBox(), page.locator('.person-trend .recharts-cartesian-grid').first().boundingBox()]);
  expect(band!.y).toBeGreaterThanOrEqual(grid!.y - 1);
  await page.locator('.trend-show-typical').click();
  await expect(page.locator('.person-trend .typical-line')).toHaveCount(1);
});

test('chips stand only for changes of 3% or more, and for a title change', async ({ page }) => {
  await trend(page);
  const vals = (await page.locator('.person-trend .yoy-chip').allTextContents()).map((t) => Math.abs(Number(t.replace(/[^\d.]/g, ''))));
  expect(vals.length).toBeGreaterThan(2);
  for (const v of vals) expect(v, `a chip for ${v}%`).toBeGreaterThanOrEqual(3);
});

test('the hover card follows the pointer, below it high up and above it low down, and clears the title labels', async ({ page }) => {
  await trend(page);
  const plot = (await page.locator('.person-trend .recharts-cartesian-grid').first().boundingBox())!;
  const labels = await page.locator('.person-trend .trend-era-label').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })));
  const tip = page.locator('.person-trend .recharts-tooltip-wrapper');
  // Near the plot's foot and near its top: a card that fits the plot at all has room above the one and below the
  // other. Fixed fractions assumed the card's height here; CI's fonts draw it about 60px taller.
  await page.mouse.move(plot.x + plot.width * 0.45, plot.y + plot.height / 2);
  await expect(tip).toBeVisible();
  await page.waitForTimeout(250);
  const h = (await tip.boundingBox())!.height;
  expect(h + 2 * 14 + 16, `a ${Math.round(h)}px card has no room in a ${Math.round(plot.height)}px plot`).toBeLessThanOrEqual(plot.height);
  for (const [y, where] of [[plot.y + plot.height - 8, 'above'], [plot.y + 8, 'below']] as const) {
    await page.mouse.move(plot.x + plot.width * 0.45, y);
    await expect(tip).toBeVisible();
    await page.waitForTimeout(250);
    const b = (await tip.boundingBox())!;
    if (where === 'above') expect(b.y + b.height, 'the card is not above the pointer').toBeLessThanOrEqual(y);
    else expect(b.y, 'the card is not below the pointer').toBeGreaterThanOrEqual(y);
    for (const l of labels) {
      const hit = b.x < l.right && l.left < b.x + b.width && b.y < l.bottom && l.top < b.y + b.height;
      expect(hit, 'the card covers a title label').toBe(false);
    }
  }
});

test("the person's line outshines the title median, in both schemes", async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await trend(page);
    const card = parseColor(await page.locator('.person-trend').evaluate((e) => getComputedStyle(e.closest('.mantine-Card-root')!).backgroundColor)).slice(0, 3);
    const ink = (v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const [self, ref] = await Promise.all([ink('--trend-self'), ink('--trend-ref')]);
    expect(contrast(parseColor(self), card), `${scheme}: the person's line is not the loudest`).toBeGreaterThan(contrast(parseColor(ref), card));
  }
});

test('the difference from typical raises is a waterfall from the typical figure to the actual one', async ({ page }) => {
  await trend(page);
  const g = page.locator('.gap-breakdown');
  await expect(g.locator('[data-gap-start]')).toContainText('If raises had been typical');
  await expect(g.locator('[data-gap-end]')).toContainText('Actual');
  // Each step starts where the one before it ended.
  const bars = await g.locator('[data-gap-row="step"] .gap-bar-step').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, up: getComputedStyle(b).backgroundColor }; }));
  expect(bars.length).toBeGreaterThan(1);
  const total = (sel: string) => g.locator(sel).locator('.gap-bar-total').evaluate((b) => b.getBoundingClientRect().right);
  const [start, end] = await Promise.all([total('[data-gap-start]'), total('[data-gap-end]')]);
  let at = start;
  for (const b of bars) {
    const from = Math.abs(b.l - at) < Math.abs(b.r - at) ? b.l : b.r;
    expect(Math.abs(from - at), 'a step does not start where the last ended').toBeLessThanOrEqual(1.5);
    at = from === b.l ? b.r : b.l;
  }
  expect(Math.abs(at - end), 'the steps do not end at the actual figure').toBeLessThanOrEqual(1.5);
});

test('a title change goes by one word: "Promotion" beside the title where the column says promotion', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  const row = page.locator('table.appt-history tbody tr', { hasText: 'Aug 2022' });
  await expect(row.locator('[data-title-tag]')).toHaveText('Promotion', { timeout: 60_000 });
  await expect(row.locator('[data-change-tag]')).toHaveText('promotion');
});

test("the start group's break is explained, and its bands are strong enough to read", async ({ page }) => {
  await trend(page);
  await expect(page.locator('.group-break-note')).toContainText('The break at Sep 2025');
  // Each band's rendered alpha (its colour's times the area's own opacity), above the 0.1 tint it was.
  const fills = await page.locator('.mantine-Card-root', { hasText: 'The group this person started with' }).locator('.recharts-area-area').evaluateAll((as) => as.map((a) => {
    const cs = getComputedStyle(a);
    return { fill: cs.fill, opacity: Number(cs.fillOpacity) * Number(cs.opacity) };
  }));
  expect(fills.length).toBeGreaterThanOrEqual(2);
  for (const f of fills) expect(parseColor(f.fill)[3] * f.opacity, `a band at ${f.fill}`).toBeGreaterThanOrEqual(0.15);
});
