import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, plotShape, barOverPlot } from './homeDots';

/**
 * Full page, what the search finds drops in a list under its box — eight people, then titles and schools —
 * and not in chips along the bar. The list lies over the graph, so it is only there while the box is in
 * use: it goes when the reader turns back to the graph, the query and the people it marked staying, and a
 * press that puts it away does nothing else. The plot never moves for it.
 */

const FULL_PAGE_PEOPLE = 8;

async function open(browser: Browser, o: { width?: number; height?: number; motion?: boolean; phone?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: o.width ?? 1440, height: o.height ?? 900 },
    reducedMotion: o.motion ? 'no-preference' : 'reduce',
    ...(o.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); sessionStorage.setItem('nav-peek', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
  return { ctx, page };
}
const box = (page: Page) => page.locator('.hero-dist-full .search-bar-field input');
const list = (page: Page) => page.locator('.hero-dist-full .search-bar-list');
const people = (page: Page) => list(page).locator('[role="option"][data-kind="person"]');
const marked = (page: Page) => page.locator('.hero-dist-full .hero-dots, .hero-dist-full .hero-dots-over').evaluateAll((els) =>
  els.reduce((t, e) => t + ((e as HTMLElement).dataset.marks?.split(' ').length ?? 0), 0));

/** The people the search lists for `q`, in its order: still here first, then by last name and first. */
async function listed(q: string) {
  const rows = await oracle<{ person_key: string }>(
    `SELECT person_key FROM (
       SELECT person_key, arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln, max(snapshot_date) last_date
       FROM $SAL WHERE lower(first_name || ' ' || last_name) LIKE '%${q}%' GROUP BY person_key)
     ORDER BY last_date < (SELECT max(snapshot_date) FROM $SAL), lower(ln), lower(fn), person_key`,
  );
  return rows.map((r) => r.person_key);
}

test('typing lists eight people under the box, in the search’s order, each with their pay and their title and school, and marks them', async ({ browser }) => {
  const want = await listed('aaron');
  expect(want.length, 'too few Aarons to fill the list').toBeGreaterThan(FULL_PAGE_PEOPLE);
  const { ctx, page } = await open(browser);
  await box(page).fill('aaron');
  await expect(people(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(people(page)).toHaveCount(FULL_PAGE_PEOPLE);
  expect(await people(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key))).toEqual(want.slice(0, FULL_PAGE_PEOPLE).map((k) => `p:${k}`));
  await expect(list(page).locator('[data-group="people"] .search-status')).toHaveText(/More people match/);
  // Nothing on the bar's own line while a query is typed: the starters are for an empty box.
  await expect(page.locator('.hero-dist-full .search-strip [role="option"]')).toHaveCount(0);
  // Each row: a name, a pay in thousands, and what they do and where, on a line under it.
  for (const row of await people(page).all()) {
    await expect(row.locator('.search-pay')).toHaveText(/^(last )?\$\d+k$/);
    await expect(row.locator('p, div').filter({ hasText: /·|Hired/ }).first()).toBeVisible();
  }
  // Every one of them marked who has a dot: the ones paid in the graph's snapshot.
  const shownKeys = want.slice(0, FULL_PAGE_PEOPLE);
  const [dotted] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${HOME_STATS.snapshot_id}' AND salary > 0
       AND person_key IN (${shownKeys.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ')}) GROUP BY person_key) WHERE pay > 0`,
  );
  expect(dotted.n, 'none of the eight has a dot to mark').toBeGreaterThan(0);
  await expect.poll(() => marked(page), { timeout: 30_000 }).toBe(Number(dotted.n));
  await ctx.close();
});

test('the list lies over the graph only while the box is in use, and never moves the plot', async ({ browser }) => {
  for (const [width, height, phone] of [[1280, 800, false], [1440, 900, false], [375, 812, true]] as const) {
    const { ctx, page } = await open(browser, { width, height, phone });
    const before = await plotShape(page);
    expect(await barOverPlot(page), `${width}px: the bar lies on the graph before anything is typed`).toEqual([]);
    await box(page).fill('aaron');
    await expect(people(page).first()).toBeVisible({ timeout: 60_000 });
    // In the panel, under the box — not a menu out in the page.
    await expect(page.locator('.search-dropdown'), `${width}px: a menu came up full page`).toHaveCount(0);
    const b = (await box(page).boundingBox())!;
    const l = (await list(page).boundingBox())!;
    expect(l.y, `${width}px: the list is not under the box`).toBeGreaterThanOrEqual(b.y + b.height - 1);
    expect(Math.abs(l.x - b.x), `${width}px: the list is not at the box's edge`).toBeLessThanOrEqual(1);
    // Never past the panel, nor the screen: past that it scrolls.
    const panel = (await page.locator('.hero-dist-full').boundingBox())!;
    expect(l.y + l.height, `${width}px: the list runs past the panel`).toBeLessThanOrEqual(Math.min(panel.y + panel.height, height) + 1);
    expect(l.x + l.width, `${width}px: the list runs off the panel's side`).toBeLessThanOrEqual(panel.x + panel.width + 1);
    expect(await plotShape(page), `${width}px: the list moved the plot`).toEqual(before);
    // Turned away from — the box left — the list goes, and nothing of the bar lies on the graph.
    await box(page).blur();
    await expect(list(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('aaron');
    expect(await barOverPlot(page), `${width}px: something of the bar stayed on the graph`).toEqual([]);
    expect(await plotShape(page), `${width}px: closing the list moved the plot`).toEqual(before);
    // Nothing found says so, in the list.
    await box(page).fill('zzqqxxzz');
    await expect(list(page).getByText('No matches for')).toBeVisible({ timeout: 60_000 });
    await box(page).fill('');
    await expect(list(page)).toHaveCount(0);
    expect(await plotShape(page), `${width}px: clearing moved the plot`).toEqual(before);
    await ctx.close();
  }
});

test('a press on the graph while the list is open only puts it away; the next one scatters', async ({ browser }) => {
  const { ctx, page } = await open(browser, { motion: true });
  const dots = page.locator('.hero-dist-full .hero-dots');
  await box(page).fill('aaron');
  await expect(people(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(dots).toHaveAttribute('data-marks', /./, { timeout: 30_000 });
  const marks = await dots.getAttribute('data-marks');
  const main = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
  const at = { x: main.x + main.width * 0.7, y: main.y + main.height * 0.9 };
  const flights = () => page.evaluate(() => performance.getEntriesByName('flight-frame').length);
  const before = await flights();
  await page.mouse.click(at.x, at.y);
  await expect(list(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await flights(), 'the press that put the list away scattered the dots').toBe(before);
  await expect(dots).toHaveAttribute('data-flight', 'idle');
  // The query and the people it marked stay.
  await expect(box(page)).toHaveValue('aaron');
  await expect(dots).toHaveAttribute('data-marks', marks!);
  // Back to the box, the list is back; Escape empties it and puts it away, and full page stays.
  await box(page).click();
  await expect(people(page).first()).toBeVisible({ timeout: 30_000 });
  await box(page).press('Escape');
  await expect(box(page)).toHaveValue('');
  await expect(list(page)).toHaveCount(0);
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  // With nothing open, a press scatters as it always has.
  await page.mouse.click(at.x, at.y);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await ctx.close();
});

test('on a phone, a tap on the graph while the list is open only puts it away', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 375, height: 812, phone: true, motion: true });
  const dots = page.locator('.hero-dist-full .hero-dots');
  await box(page).fill('aaron');
  await expect(people(page).first()).toBeVisible({ timeout: 60_000 });
  const main = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
  const l = (await list(page).boundingBox())!;
  // As wide as the graph, it stops halfway down it: the rest stays in sight, to watch and to tap.
  expect(l.y + l.height, 'the list covers the whole graph').toBeLessThanOrEqual(main.y + main.height / 2 + 1);
  const at = { x: main.x + main.width * 0.85, y: main.y + main.height * 0.8 };
  const flights = () => page.evaluate(() => performance.getEntriesByName('flight-frame').length);
  const before = await flights();
  await page.touchscreen.tap(at.x, at.y);
  await expect(list(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await flights(), 'the tap that put the list away scattered the dots').toBe(before);
  await expect(box(page)).toHaveValue('aaron');
  await expect(dots).toHaveAttribute('data-marks', /./);
  await ctx.close();
});

test('↓ in the box moves down the list, and draws that person’s dot large', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  const dots = page.locator('.hero-dist-full .hero-dots');
  await box(page).fill('aaron');
  await expect(people(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(dots).toHaveAttribute('data-marks', /./, { timeout: 30_000 });
  await expect(people(page).first()).toHaveAttribute('aria-selected', 'true');
  const first = await dots.getAttribute('data-mark-big');
  await box(page).press('ArrowDown');
  await expect(people(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(box(page)).toHaveAttribute('aria-activedescendant', (await people(page).nth(1).getAttribute('id'))!);
  await expect.poll(() => dots.getAttribute('data-mark-big')).not.toBe(first);
  await ctx.close();
});

test('the open list passes a strict accessibility scan, and is never a listbox of nothing', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  // Every state the list passes through as a search runs, watched in the page: while the first people are
  // still being found it is a status with nothing to choose, and must not be a listbox then.
  await page.evaluate(() => {
    const w = window as unknown as { __emptyListbox: number };
    w.__emptyListbox = 0;
    new MutationObserver(() => {
      for (const lb of document.querySelectorAll('.search-bar-list [role="listbox"]')) if (!lb.querySelector('[role="option"]')) w.__emptyListbox++;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  for (const q of ['aaron', 'zzqqxxzz', 'smith']) {
    await box(page).fill(q);
    await expect(list(page).locator('[role="option"], .search-status, p').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(600);
  }
  expect(await page.evaluate(() => (window as unknown as { __emptyListbox: number }).__emptyListbox), 'the list was a listbox with no options').toBe(0);
  await box(page).fill('medicine');
  await expect(list(page).locator('[role="option"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(box(page)).toHaveAttribute('aria-expanded', 'true');
  const axe = await new AxeBuilder({ page }).include('.search-bar-list').include('[role="combobox"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await ctx.close();
});
