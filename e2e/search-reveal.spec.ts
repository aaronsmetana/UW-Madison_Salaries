import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle, PAY, usd } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * The landing search marks the people it shows on the graph: each on their own dot, glowing green; a
 * pointer over one says who it is, and a press on it — or picking them in the list — turns the page into
 * theirs (components/PersonReveal). The dots are drawn from `home-stats.json`'s counts and carry no names,
 * so which dot is whose is a rule (lib/homePeople `dotSpots`), restated independently here.
 */

const HOME_STATS = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/home-stats.json', import.meta.url)), 'utf8')) as {
  snapshot_id: string;
  bin_cap: number;
  pay_counts: { lo100: number; counts: number[]; categories: { name: string; over: number; counts: number[] }[] };
};

/** Everyone paid in the graph's snapshot as the landing page counts them: total actual pay over paid
 *  appointments, in the category of their highest-paid appointment. */
const people = () => oracle<{ person_key: string; pay: number; cat: string; fn: string; ln: string }>(
  `WITH r AS (SELECT person_key, first_name, last_name, coalesce(employee_category, 'Other') ct, ${PAY} rp FROM $SAL
              WHERE snapshot_id = '${HOME_STATS.snapshot_id}' AND salary > 0)
   SELECT person_key, sum(rp) pay, first(ct ORDER BY rp DESC, ct) cat, any_value(first_name) fn, any_value(last_name) ln
   FROM r GROUP BY person_key HAVING sum(rp) > 0`,
);

/**
 * Each person's dot, by the rule stated from the page's own drawing: under the cap, the dots run $100 by
 * $100, each $100's categories in the artifact's order, and a $100's category's people take its dots by
 * pay, then by key; over the cap, each category's people take a block of the pile in the same order.
 */
async function spots(): Promise<Map<string, { field: 'main' | 'pile'; index: number }>> {
  const { lo100, counts, categories } = HOME_STATS.pay_counts;
  const cats = categories.map((c) => c.name);
  const rows = await people();
  const byPay = (a: { person_key: string; pay: number }, b: { person_key: string; pay: number }) =>
    a.pay - b.pay || (a.person_key < b.person_key ? -1 : a.person_key > b.person_key ? 1 : 0);
  const out = new Map<string, { field: 'main' | 'pile'; index: number }>();
  let before = 0;
  const groups = new Map<string, typeof rows>();
  for (const p of rows) {
    const key = p.pay >= HOME_STATS.bin_cap ? `over:${p.cat}` : `${Math.floor(p.pay / 100)}:${p.cat}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (let b = 0; b < counts.length; b++) {
    let at = before;
    for (let c = 0; c < cats.length; c++) {
      const list = (groups.get(`${lo100 + b}:${cats[c]}`) ?? []).sort(byPay);
      list.forEach((p, k) => out.set(p.person_key, { field: 'main', index: at + k }));
      at += categories[c].counts[b];
    }
    before += counts[b];
  }
  let at = 0;
  for (let c = 0; c < cats.length; c++) {
    (groups.get(`over:${cats[c]}`) ?? []).sort(byPay).forEach((p, k) => out.set(p.person_key, { field: 'pile', index: at + k }));
    at += categories[c].over;
  }
  return out;
}

/** Someone in the graph whose full name no one else in the data shares, and which no other name contains —
 *  so searching it shows them alone — under the cap, or over it. */
async function lone(over: boolean) {
  const [r] = await oracle<{ person_key: string; full_name: string; pay: number }>(
    `WITH names AS (SELECT person_key, lower(any_value(first_name) || ' ' || any_value(last_name)) nm FROM $SAL GROUP BY person_key),
          now AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${HOME_STATS.snapshot_id}' AND salary > 0 GROUP BY person_key),
          alone AS (SELECT n.person_key, n.nm FROM names n WHERE length(n.nm) > 9 AND n.nm NOT LIKE '%''%'
                     AND (SELECT count(*) FROM names o WHERE o.nm LIKE '%' || n.nm || '%') = 1)
     SELECT a.person_key, a.nm AS full_name, now.pay FROM alone a JOIN now USING (person_key)
     WHERE now.pay ${over ? '>=' : '<'} ${HOME_STATS.bin_cap} AND now.pay > 0
     ORDER BY a.person_key LIMIT 1`,
  );
  return r && { person_key: r.person_key, name: r.full_name, pay: r.pay };
}

/** The landing page at `width x height`, the dots at rest. */
async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
const searchBox = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
/** The marks a field carries: index and resting place (the field's CSS px). */
async function marksOf(page: Page, sel: string) {
  const attr = await page.locator(sel).getAttribute('data-marks');
  return (attr ?? '').split(' ').filter(Boolean).map((m) => { const [i, x, y] = m.split(':').map(Number); return { i, x, y }; });
}
/** A mark's place on the screen. */
async function onScreen(page: Page, sel: string, m: { x: number; y: number }) {
  const box = (await page.locator(sel).boundingBox())!;
  return { x: box.x + m.x, y: box.y + m.y };
}

test('the page knows every dot: the people the search can mark are exactly the people drawn', async ({ page }) => {
  await home(page);
  const everyone = await people();
  await searchBox(page).fill('smith');
  // Null — no attribute — when the page's people and the artifact's counts disagree anywhere.
  await expect(page.locator('.hero-dist-wrap')).toHaveAttribute('data-people-mapped', String(everyone.length), { timeout: 60_000 });
});

for (const over of [false, true]) {
  test(`a search marks the person it shows on their own dot, in the found green (${over ? 'over the cap, in the pile' : 'under the curve'})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    const who = await lone(over);
    expect(who, 'no lone name to search').toBeTruthy();
    const expected = (await spots()).get(who.person_key)!;
    expect(expected.field).toBe(over ? 'pile' : 'main');
    const field = over ? '.hero-dots-over' : '.hero-dots';
    const other = over ? '.hero-dots' : '.hero-dots-over';
    await searchBox(page).fill(who.name);
    await expect(page.locator(field)).toHaveAttribute('data-marks', new RegExp(`^${expected.index}:`), { timeout: 60_000 });
    expect(await page.locator(other).getAttribute('data-marks')).toBeNull();
    // Drawn: the canvas at the mark is the found ink, once it has grown in.
    await page.waitForTimeout(1000);
    const [m] = await marksOf(page, field);
    const ink = await page.locator(`${field} canvas`).evaluate((c: HTMLCanvasElement, at) => {
      const k = c.width / c.clientWidth;
      const d = c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, m);
    const found = parseColor(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--found')));
    for (let c = 0; c < 3; c++) expect(Math.abs(ink[c] - found[c]), `channel ${c}: ${ink} against ${found}`).toBeLessThan(24);
    expect(ink[3]).toBeGreaterThan(240);
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`a found person's mark clears 3:1 against the card (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await home(page);
    const layers = await page.locator('.hero-dots').evaluate((el) => {
      const out: string[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) out.push(getComputedStyle(e).backgroundColor);
      return out.reverse();
    });
    let ground = [255, 255, 255];
    for (const c of layers) { const [r, g, b, a] = parseColor(c); if (a > 0) ground = flatten([r, g, b, a], ground); }
    const found = parseColor(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--found')));
    expect(contrast(found, ground)).toBeGreaterThanOrEqual(3);
  });
}

for (const [width, height] of [[1440, 900], [1280, 720]] as const) {
  test(`the list opens below the box, and the graph stays in view above it (${width}x${height})`, async ({ page }) => {
    // Flipped up, the list covered the whole graph at 1440x900 — every dot it had just marked.
    await page.setViewportSize({ width, height });
    await home(page);
    await searchBox(page).fill('smith');
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
    await page.waitForTimeout(800);
    const list = (await page.locator('.search-dropdown').boundingBox())!;
    const plot = (await page.locator('.hero-dist-main').boundingBox())!;
    const header = (await page.locator('.mantine-AppShell-header').boundingBox())!;
    expect(list.y, 'the list covers the graph').toBeGreaterThanOrEqual(plot.y + plot.height);
    expect(plot.y, 'the graph was scrolled under the header').toBeGreaterThanOrEqual(header.y + header.height - 1);
    // Where the window has the height for it, the page made the list room to show its rows — as much as
    // it can with the graph still whole above it (241px at 1440x900; unscrolled, under 60).
    if (height >= 900) expect(height - list.y, 'the list was left no room below the box').toBeGreaterThanOrEqual(200);
    // The marks go with the text.
    await searchBox(page).fill('');
    await expect(page.locator('.hero-dots')).not.toHaveAttribute('data-marks', /./);
  });
}

test('pointing at a mark says who it is; pressing it turns the page into theirs, in about three and a half seconds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(700);
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  await page.mouse.move(at.x, at.y);
  const card = page.locator(`[data-found-card="${who.person_key}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(usd(who.pay));
  const shown = (await card.locator('p, div').first().innerText()).trim();
  expect(shown.toLowerCase()).toBe(who.name);
  // No glass over a mark: the card is what it shows.
  await expect(page.locator('.hero-dist-main')).toHaveAttribute('data-lens', 'off');

  await page.mouse.down();
  await page.mouse.up();
  const t0 = Date.now();
  const reveal = page.locator('.person-reveal');
  await expect(reveal).toHaveAttribute('data-phase', 'swell', { timeout: 500 });
  // The landing page stays until the disc has covered the window.
  await page.waitForTimeout(1500 - (Date.now() - t0));
  expect(page.url()).not.toContain('/person/');
  await expect(reveal).toHaveAttribute('data-phase', 'cover');
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`), { timeout: 2500 });
  await expect(reveal).toHaveCount(0, { timeout: 5500 - (Date.now() - t0) });
  const took = Date.now() - t0;
  expect(took, 'the reveal was over too soon to see').toBeGreaterThan(2900);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toBeFocused();
  expect((await h1.innerText()).toLowerCase()).toBe(who.name);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('picking the person in the list reveals them from their dot, and any key finishes it at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await searchBox(page).press('Enter');
  const reveal = page.locator('.person-reveal');
  await expect(reveal).toHaveAttribute('data-phase', 'swell');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(reveal).toHaveCount(0, { timeout: 300 });
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`));
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused({ timeout: 10_000 });
});

test('under Reduce Motion a pressed mark simply opens the page', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`), { timeout: 1000 });
  expect(await page.locator('.person-reveal').count()).toBe(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused({ timeout: 10_000 });
  await ctx.close();
});

test('on a phone a tap on a mark shows its card, and the card opens them', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  await page.touchscreen.tap(at.x, at.y);
  const card = page.locator(`[data-found-card="${who.person_key}"]`);
  await expect(card).toBeVisible();
  // A tap on a mark is not a tap on the dots: nothing bursts.
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle');
  await card.getByRole('button', { name: /^Open / }).tap();
  await expect(page.locator('.person-reveal')).toHaveAttribute('data-phase', 'swell');
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`), { timeout: 4000 });
  await ctx.close();
});

test('someone no longer here is listed, but has no dot to mark', async ({ page }) => {
  await home(page);
  const [gone] = await oracle<{ full_name: string }>(
    `WITH names AS (SELECT person_key, lower(arg_max(first_name, snapshot_date) || ' ' || arg_max(last_name, snapshot_date)) nm FROM $SAL GROUP BY person_key)
     SELECT n.nm AS full_name FROM names n
     WHERE n.person_key NOT IN (SELECT person_key FROM $SAL WHERE snapshot_id = '${HOME_STATS.snapshot_id}')
       AND length(n.nm) > 9 AND n.nm NOT LIKE '%''%' AND (SELECT count(*) FROM names o WHERE o.nm LIKE '%' || n.nm || '%') = 1
     ORDER BY n.person_key LIMIT 1`,
  );
  await searchBox(page).fill(gone.full_name);
  await expect(page.getByRole('option').filter({ hasText: 'Former' })).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-wrap')).toHaveAttribute('data-people-mapped', /\d+/, { timeout: 60_000 });
  await page.waitForTimeout(500);
  expect(await page.locator('.hero-dots').getAttribute('data-marks')).toBeNull();
  expect(await page.locator('.hero-dots-over').getAttribute('data-marks')).toBeNull();
});
