import { test, expect, type Page } from '@playwright/test';
import { HOME_STATS, people, spots } from './homeDots';

/**
 * Floors (mockup 3a): the landing graph's second view — everyone in $10k bands stacked from the bottom up, under $30k
 * to $200k or more, each band a block of squares as wide as the others and wrapping into rows, sorted by salary from
 * its bottom row up, its name at the left and its people at the right. Switching between the views moves each person
 * from one place to the other, staggered, over about 2.2 s, while the views' own labels cross-fade. Who is where is
 * checked against the data through the indexing the search's marks use (homeDots `spots`), the bands restated here.
 */

const CAP = HOME_STATS.bin_cap;
const num = (n: number) => n.toLocaleString('en-US');
const floorOf = (pay: number) => (pay < 30_000 ? 0 : pay >= 200_000 ? 18 : Math.floor((pay - 30_000) / 10_000) + 1);
const LABELS = ['Under $30k', ...Array.from({ length: 17 }, (_, k) => `$${30 + k * 10}–${40 + k * 10}k`), '$200k+'];

type Field = 'main' | 'pile';
const field = (page: Page) => page.locator('.strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
const views = (page: Page) => page.getByRole('radiogroup', { name: 'View' });
const hook = (page: Page, name: 'squarePlaces' | 'squareSlots' | 'squareNow', f: Field) =>
  field(page).evaluate((el, a) => (el as unknown as Record<string, (f: string) => number[]>)[a.name](a.f), { name, f });

async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
async function toFloors(page: Page) {
  await views(page).getByText('Floors').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
}
/** Everyone on the graph by their square: their floor and pay. */
async function byIndex() {
  const at = await spots();
  const out: Record<Field, { floor: number; pay: number }[]> = { main: [], pile: [] };
  for (const p of await people()) {
    const s = at.get(p.person_key);
    if (s) out[s.field][s.index] = { floor: floorOf(p.pay), pay: p.pay };
  }
  return out;
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

test('Floors lays everyone out in $10k bands from the bottom up, each sorted by salary, its band at its left and its people at its right', async ({ page }) => {
  await home(page);
  await expect(views(page).getByRole('radio', { name: 'Histogram' })).toBeChecked();
  await toFloors(page);
  await expect(views(page).getByRole('radio', { name: 'Floors' })).toBeChecked();
  const who = await byIndex();
  const per = Number(await field(page).getAttribute('data-per')), pitch = Number(await field(page).getAttribute('data-pitch'));
  // Each floor's squares, by their place: rows from the bottom, then across.
  const floors = Array.from({ length: 19 }, () => [] as { x: number; y: number; pay: number }[]);
  for (const f of ['main', 'pile'] as const) {
    const pts = await hook(page, 'squarePlaces', f);
    who[f].forEach((p, i) => floors[p.floor].push({ x: pts[2 * i], y: pts[2 * i + 1], pay: p.pay }));
  }
  const left = Math.min(...floors.flat().map((s) => s.x));
  for (let f = 0; f < 19; f++) {
    const sq = floors[f];
    expect(sq.length, `${LABELS[f]}: no one`).toBeGreaterThan(0);
    // Every floor starts at the same left edge, as many a row as the others.
    expect(Math.min(...sq.map((s) => s.x)), `${LABELS[f]}'s left edge`).toBeCloseTo(left, 5);
    expect(Math.max(...sq.map((s) => s.x)) - left).toBeLessThan(per * pitch);
    // Above the floor below it, every one of its squares.
    if (f) expect(Math.max(...sq.map((s) => s.y)), `${LABELS[f]} reaches into ${LABELS[f - 1]}`).toBeLessThan(Math.min(...floors[f - 1].map((s) => s.y)));
    // By salary from the bottom row up, left to right — to the $100 the page's counts know a pay by.
    const order = [...sq].sort((a, b) => b.y - a.y || a.x - b.x).map((s) => Math.floor(s.pay / 100));
    expect(order, `${LABELS[f]} is not sorted by salary`).toEqual([...order].sort((a, b) => a - b));
  }
  // Each band's name and people, the median's band marked.
  const rows = await page.locator('.strata-floor').evaluateAll((els) => els.map((e) => ({
    label: e.querySelector('.strata-floor-label')!.firstChild!.textContent, count: e.querySelector('.strata-floor-count')!.textContent, median: e.hasAttribute('data-median'),
  })));
  expect(rows.map((r) => r.label)).toEqual(LABELS);
  expect(rows.map((r) => r.count)).toEqual(floors.map((sq) => num(sq.length)));
  expect(rows.map((r, f) => (r.median ? f : -1)).filter((f) => f >= 0)).toEqual([floorOf(HOME_STATS.p50)]);
  // The histogram's own labels are gone, the pile's way in with them; nothing is past the plot.
  await expect(page.locator('.strata-axis')).toBeHidden();
  await expect(page.locator('.strata-pin').first()).toBeHidden();
  const box = (await plot(page).boundingBox())!;
  const labels = await page.locator('.strata-floor-label').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom }; }));
  for (const l of labels) { expect(l.t).toBeGreaterThanOrEqual(box.y - 0.5); expect(l.b).toBeLessThanOrEqual(box.y + box.height + 0.5); }
  for (let k = 1; k < labels.length; k++) expect(labels[k].b, `${LABELS[k]} lies on ${LABELS[k - 1]}`).toBeLessThanOrEqual(labels[k - 1].t + 0.5);
});

test('switching views moves everyone over about 2.2 s, into the floors from the bottom up; back again, all are where they were', async ({ page }) => {
  await home(page);
  const before = await hook(page, 'squarePlaces', 'main');
  const who = await byIndex();
  await page.evaluate(() => {
    const w = window as unknown as { log: [string, number][] };
    w.log = [];
    const f = document.querySelector('.strata-field') as HTMLElement;
    new MutationObserver(() => w.log.push([f.dataset.settled!, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
  });
  await views(page).getByText('Floors').click();
  // Part way: the people bound for the lowest floors further on their way than those bound for the highest.
  await page.waitForTimeout(700);
  const now = await hook(page, 'squareNow', 'main');
  const after = await field(page).evaluate((el) => new Promise<number[]>((done) => {
    const wait = () => (el.getAttribute('data-settled') === 'true' ? done((el as unknown as { squarePlaces: (f: string) => number[] }).squarePlaces('main')) : requestAnimationFrame(wait));
    wait();
  }));
  const share = (i: number) => {
    const d = Math.hypot(after[2 * i] - before[2 * i], after[2 * i + 1] - before[2 * i + 1]);
    return d < 1 ? null : Math.hypot(now[2 * i] - before[2 * i], now[2 * i + 1] - before[2 * i + 1]) / d;
  };
  const mean = (fs: number[]) => {
    const v = who.main.flatMap((p, i) => (fs.includes(p.floor) ? [share(i)] : [])).filter((x): x is number => x != null);
    return v.reduce((t, x) => t + x, 0) / v.length;
  };
  const low = mean([0, 1, 2]), high = mean([15, 16, 17]);
  expect(low, `bottom floors ${low.toFixed(2)} of the way, top ${high.toFixed(2)}`).toBeGreaterThan(high + 0.2);
  const log = await page.evaluate(() => (window as unknown as { log: [string, number][] }).log);
  const start = log.find(([s]) => s === 'false')![1], end = log.filter(([s]) => s === 'true').pop()![1];
  expect(end - start, 'the switch took').toBeGreaterThan(1800);
  expect(end - start, 'the switch took').toBeLessThan(3500);
  // And back.
  await views(page).getByText('Histogram').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'hist');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  expect(await hook(page, 'squarePlaces', 'main')).toEqual(before);
  await expect(page.locator('.strata-axis')).toBeVisible();
  await expect(page.locator('.strata-floor-labels')).toBeHidden();
});

test('under reduced motion the switch is simply there', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await home(page);
  await views(page).getByText('Floors').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
  expect(await hook(page, 'squareNow', 'main')).toEqual(await hook(page, 'squarePlaces', 'main'));
  await ctx.close();
});

test('in Floors the lens reads the floor under it, and the keyboard walks floor by floor', async ({ page }) => {
  await home(page);
  await toFloors(page);
  const who = await byIndex();
  const counts = Array(19).fill(0);
  for (const f of ['main', 'pile'] as const) for (const p of who[f]) counts[p.floor]++;
  const total = counts.reduce((t, n) => t + n, 0);
  const said = (f: number) => {
    const below = counts.slice(0, f).reduce((t, n) => t + n, 0);
    return `${LABELS[f]} · ${num(counts[f])} people · ${Math.min(99, Math.max(1, Math.round(((below + counts[f] / 2) / total) * 100)))}% paid less`;
  };
  // Over the $70–80k floor's people.
  const pts = await hook(page, 'squarePlaces', 'main');
  const i = who.main.findIndex((p) => p.floor === 5);
  const box = (await plot(page).boundingBox())!;
  await page.mouse.move(box.x + pts[2 * i] + 40, box.y + pts[2 * i + 1]);
  await expect(page.locator('.strata-readout')).toHaveText(said(5));
  // The keyboard: in at the median's floor, up and down a floor at a time, End to the top.
  await page.mouse.move(box.x + box.width / 2, box.y - 80);
  await page.locator('.strata-legend-item').last().focus();
  await page.keyboard.press('Tab');
  await expect(plot(page)).toBeFocused();
  const med = floorOf(HOME_STATS.p50);
  const pay = (f: number) => String(f ? 20_000 + f * 10_000 : 0);
  await expect(plot(page)).toHaveAttribute('aria-valuenow', pay(med));
  await page.keyboard.press('ArrowUp');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', pay(med + 1));
  await expect(plot(page)).toHaveAttribute('aria-valuetext', said(med + 1));
  await page.keyboard.press('End');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', pay(18));
  await expect(plot(page)).toHaveAttribute('aria-valuetext', said(18));
});

test('the floors hold through a filter and a step to another snapshot', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await toFloors(page);
  const before = await hook(page, 'squarePlaces', 'main');
  // A type picked out lights its people where they stand: no one moves.
  await page.getByRole('button', { name: /^Faculty/ }).click();
  await expect(field(page)).toHaveAttribute('data-lit', /^\d+:/);
  await page.waitForTimeout(300);
  expect(await hook(page, 'squarePlaces', 'main')).toEqual(before);
  await page.getByRole('button', { name: /^Faculty/ }).click();
  // Another snapshot: still the floors, everyone in their band then.
  await page.locator('.strata-track-dot').nth(5).click();
  await expect(page.locator('.strata-timeline')).toHaveAttribute('data-snap', '2024-04', { timeout: 60_000 });
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
  const counts = await page.locator('.strata-floor-count').allTextContents();
  const n = counts.reduce((t, c) => t + Number(c.replace(/,/g, '')), 0);
  const squares = (await plot(page).getAttribute('data-squares'))!.split(':').map(Number);
  expect(n).toBe(squares[0] + squares[1]);
  expect(CAP).toBe(250_000);
});

test('on a phone every floor and its label fit the plot', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await home(page);
  await views(page).getByText('Floors').click();
  await expect(plot(page)).toHaveAttribute('data-view', 'floors');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  const box = (await plot(page).boundingBox())!;
  const els = await page.locator('.strata-floor-label, .strata-floor-count').evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  for (const e of els) {
    expect(e.t).toBeGreaterThanOrEqual(box.y - 0.5);
    expect(e.b).toBeLessThanOrEqual(box.y + box.height + 0.5);
    expect(e.l).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(e.r).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  await ctx.close();
});
