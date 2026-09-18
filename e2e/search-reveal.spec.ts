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

test('every marked person is named beside their own dot, tied to it, and no two names touch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await searchBox(page).fill('smith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  // The places are read again once the marks have grown in.
  await page.waitForTimeout(1500);

  const marks = await marksOf(page, '.hero-dots');
  const field = (await page.locator('.hero-dots').boundingBox())!;
  const labels = await page.locator('.hero-found-label').evaluateAll((els) => els.map((el) => {
    const b = el.getBoundingClientRect();
    return { text: (el.textContent ?? '').trim(), left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }));
  // Everyone marked is named, bar at most one: where several people earn within a few hundred dollars
  // of each other their dots are a few pixels apart, and a name that would have to cross another to
  // reach its dot is left to the list instead of drawn misleadingly.
  expect(labels.length, 'the names were thinned further than a crowd explains').toBeGreaterThanOrEqual(marks.length - 1);

  // The names shown are the people whose dots are marked — from SQL and the dot rule, not the page's
  // own account of itself.
  const where = await spots();
  const byIndex = new Map<number, string>();
  for (const [key, spot] of where) if (spot.field === 'main') byIndex.set(spot.index, key);
  const names = new Map((await people()).map((p) => [p.person_key, `${p.fn} ${p.ln}`.toLowerCase()]));
  const marked = new Set(marks.map((m) => names.get(byIndex.get(m.i)!)));
  for (const l of labels) expect(marked.has(l.text.toLowerCase()), `"${l.text}" is on no marked dot`).toBe(true);

  // No two names on top of each other.
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
        `"${a.text}" and "${b.text}" overlap`).toBe(false);
    }
  }

  // Each leader runs from a marked dot to the edge of a name — and the name is beside its dot rather
  // than banked at the top of the plot with a line crossing the graph to reach it.
  const leaders = await page.locator('.hero-found-leaders line').evaluateAll((els) => els.map((el) => {
    const b = el.getBoundingClientRect();
    return { x1: Number(el.getAttribute('x1')), y1: Number(el.getAttribute('y1')), x2: Number(el.getAttribute('x2')), y2: Number(el.getAttribute('y2')), h: b.height };
  }));
  expect(leaders.length).toBe(labels.length);
  for (const l of leaders) {
    const from = { x: field.x + l.x1, y: field.y + l.y1 };
    const to = { x: field.x + l.x2, y: field.y + l.y2 };
    const dot = marks.map((m) => ({ x: field.x + m.x, y: field.y + m.y }))
      .reduce((best, m) => (Math.hypot(m.x - from.x, m.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? m : best));
    expect(Math.hypot(dot.x - from.x, dot.y - from.y), 'a leader starts nowhere near a dot').toBeLessThan(30);
    expect(Math.hypot(to.x - from.x, to.y - from.y), 'a name sits far from the dot it names').toBeLessThan(170);
    const touches = labels.some((b) => to.x >= b.left - 2 && to.x <= b.right + 2 && Math.min(Math.abs(to.y - b.top), Math.abs(to.y - b.bottom)) < 2);
    expect(touches, 'a leader ends at no name').toBe(true);
  }
});

/** How far the solid core of a mark reaches from its centre, CSS px: out along a row until the ink
 *  stops being the found green. A mark's core is its radius less a rim of about a fifth. */
const coreRadius = (page: Page, sel: string, at: { x: number; y: number }, ink: number[]) =>
  page.locator(`${sel} canvas`).first().evaluate((c: HTMLCanvasElement, a) => {
    const k = c.width / c.clientWidth;
    const ctx = c.getContext('2d')!;
    const y = Math.round(a.y * k);
    let out = 0;
    for (let dx = 0; dx < 120; dx++) {
      const x = Math.round(a.x * k) + dx;
      if (x >= c.width) break;
      const d = ctx.getImageData(x, y, 1, 1).data;
      const isInk = d[3] > 230 && Math.abs(d[0] - a.ink[0]) < 30 && Math.abs(d[1] - a.ink[1]) < 30 && Math.abs(d[2] - a.ink[2]) < 30;
      if (!isInk) break;
      out = dx / k;
    }
    return out;
  }, { ...at, ink });

test('the person the list has active is drawn twice the size, and wears the filled name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const ink = parseColor(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--found')));

  // Someone searched alone: their row is the active one, so their dot is the big one.
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const spot = (await spots()).get(who.person_key)!;
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-mark-big', String(spot.index));
  const markR = Number(await page.locator('.hero-dots').getAttribute('data-mark-r'));
  expect(markR).toBeGreaterThan(1);
  const [big] = await marksOf(page, '.hero-dots');
  const bigCore = await coreRadius(page, '.hero-dots', big, ink);
  expect(bigCore, 'nothing was drawn where the mark is').toBeGreaterThan(markR);

  // The one name drawn filled is that person's.
  const active = page.locator('.hero-found-label[data-active="on"]');
  await expect(active).toHaveCount(1);
  expect(((await active.textContent()) ?? '').toLowerCase()).toBe(who.name.toLowerCase());

  // A mark nobody has picked out is drawn at a mark's own size: the one furthest from the big one in a
  // search that shows several, so no neighbour's ink runs into the measurement.
  await searchBox(page).fill('smith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-mark-big', /\d/, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const marks = await marksOf(page, '.hero-dots');
  const bigNow = Number(await page.locator('.hero-dots').getAttribute('data-mark-big'));
  const lonely = marks
    .filter((m) => m.i !== bigNow)
    .map((m) => ({ m, near: Math.min(...marks.filter((o) => o.i !== m.i).map((o) => Math.hypot(o.x - m.x, o.y - m.y))) }))
    .reduce((far, c) => (c.near > far.near ? c : far));
  expect(lonely.near, 'no mark stands clear enough of its neighbours to measure').toBeGreaterThan(markR * 6);
  const plainCore = await coreRadius(page, '.hero-dots', lonely.m, ink);
  expect(plainCore, `against a mark radius of ${markR}`).toBeLessThan(markR * 1.2);
  expect(plainCore).toBeGreaterThan(markR * 0.5);
  // Measured the same way, on the same field: the picked-out dot is the bigger one by well over half
  // again — the drawing doubles it, and a core is its radius less a rim.
  expect(bigCore / plainCore, `${bigCore} against ${plainCore}`).toBeGreaterThan(1.6);
});

/**
 * The graph going full page takes the search with it. The panel is re-parented into a portal to fill
 * the window, which remounts everything inside it, so the query cannot live in the box: one box stands
 * down, the other comes up holding what the first one held, and the marked dots never blink.
 */
test('the search goes full page with the graph: one box, the query kept, the dots still named', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Not `home`, which tells the field its entrance has already played. A visitor's first sight of the
  // page is the dots falling, and the panel going full page lays them out and drops them again — which
  // is the only time the places a name could be hung on are moving. Skip that and there is nothing here
  // to get wrong: the field re-lays out between two frames and every reading is the settled one.
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  await searchBox(page).fill('goldsmith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const before = (await marksOf(page, '.hero-dots')).length;
  expect(before, 'nobody was marked to begin with').toBeGreaterThan(1);
  await expect(page.locator('.hero-found-label')).toHaveCount(before);
  // On the page, the list is open: that is what typing does.
  expect(await page.getByRole('option').count()).toBeGreaterThan(0);

  // Sampled from the click onward, because the difficulty is in the travelling: the panel lays its dots
  // out again for the taller plot and they move to their new places, and a name is hung on a place. The
  // place a dot is passing through is not the place it is going.
  const leaderEnds = () => page.locator('.hero-found-leaders line').evaluateAll((els) => els.map((el) => ({
    x: Number(el.getAttribute('x1')), y: Number(el.getAttribute('y1')),
  })));
  await page.getByRole('button', { name: 'Full page' }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  const travelling: { x: number; y: number }[][] = [];
  for (let i = 0; i < 30; i++) {
    travelling.push(await leaderEnds());
    if (i > 1 && await page.locator('.hero-dots').getAttribute('data-settled') === 'true') break;
    await page.waitForTimeout(100);
  }
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForTimeout(400);

  // One box, inside the panel, holding the query the page's box was holding.
  const boxes = page.getByRole('combobox', { name: /Search a person/ });
  await expect(boxes).toHaveCount(1);
  await expect(boxes).toHaveValue('goldsmith');
  await expect(page.locator('.hero-dist-full .hero-dist-search input')).toHaveCount(1);
  // And its list is shut. A box handed a query opens closed — the reader asked for the graph, and the
  // list would drop over the thing they just made bigger.
  await expect(page.getByRole('option')).toHaveCount(0);

  // The dots stayed marked and named right through the handover.
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./);
  expect((await marksOf(page, '.hero-dots')).length, 'the marks were lost going full page').toBe(before);

  const atRest = await leaderEnds();
  expect(atRest.length, 'the names went away going full page').toBe(before);

  // Not a pixel of wander from the moment the names appear: they are put where their dots are going, so
  // the dots arrive under them rather than dragging them along. Every sample taken while the field was
  // laying itself out again has to match where they ended up.
  const watched = travelling.filter((s) => s.length === atRest.length);
  expect(watched.length, 'the names were never seen while the dots moved').toBeGreaterThan(1);
  for (const s of watched) {
    for (let i = 0; i < atRest.length; i++) {
      expect(Math.hypot(atRest[i].x - s[i].x, atRest[i].y - s[i].y),
        'a name wandered while the dots flew').toBeLessThan(2);
    }
  }
  // And each one ended up on a dot. A name read once off a dot in flight and never read again sat
  // 389px from the person it named, at their right pay, for as long as the graph stayed open.
  const after = await marksOf(page, '.hero-dots');
  const field = (await page.locator('.hero-dots').boundingBox())!;
  for (const l of atRest) {
    const from = { x: field.x + l.x, y: field.y + l.y };
    const near = after.map((m) => Math.hypot(field.x + m.x - from.x, field.y + m.y - from.y)).sort((a, b) => a - b)[0];
    expect(near, 'a name is stranded away from every dot, full page').toBeLessThan(30);
  }

  // Searching from in here works, and marks a different set.
  await page.locator('.hero-dist-search input').fill('carlsmith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const inFull = await marksOf(page, '.hero-dots');
  expect(inFull.length, 'a search from inside full page marked nobody').toBeGreaterThan(0);
  expect(inFull.map((m) => m.i).join(), 'the full page search marked the same people').not.toBe(after.map((m) => m.i).join());

  // And back out, the page's own box has what was typed in there.
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await expect(searchBox(page)).toHaveValue('carlsmith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./);
});
