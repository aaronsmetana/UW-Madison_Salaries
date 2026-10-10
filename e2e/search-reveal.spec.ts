import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, usd, searchCounts } from './oracle';
import { HOME_STATS, people, places, spots } from './homeDots';
import { parseColor } from './color';

/**
 * The landing search marks the people it shows on the graph: each on their own square, a white square ringed
 * in ink with their type's colour at its heart; a pointer over one brings up the lens and says who it is, and
 * a press on it follows them, and Open on their chip — or picking them in the list — turns the page into theirs
 * (components/PersonReveal). The
 * squares are drawn from `home-stats.json`'s counts and carry no names, so which square is whose is a rule
 * (lib/homePeople `dotSpots`), restated independently here.
 */

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

/** The landing page, its squares at rest. */
async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
const searchBox = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
/** The marks under the cap: index and resting centre (the field's CSS px). */
async function marksOf(page: Page, sel: string) {
  const attr = await page.locator(sel).getAttribute('data-marks');
  return (attr ?? '').split(' ').filter(Boolean).map((m) => { const [i, x, y] = m.split(':').map(Number); return { i, x, y }; });
}
/** A mark's colours, read off the canvas: at its heart, and halfway out to its ring. */
const markPaint = (page: Page, at: { x: number; y: number }) => page.locator('.strata-base').first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const px = (x: number, y: number) => [...c.getContext('2d')!.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
  return { heart: px(a.x, a.y), inside: px(a.x + 2.5, a.y) };
}, at);
/** A token's colour as the page resolves it. */
const tokenColor = (page: Page, v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, v);
/** How far a mark's ring stands from its centre, CSS px: out along its row, past the type's heart and the
 *  white round it, to the first pixel that leans toward the ring's ink (an edge part way through a pixel is
 *  blended with the white). */
const ringAt = (page: Page, at: { x: number; y: number }, ink: number[]) => page.locator('.strata-base').first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const ctx = c.getContext('2d')!;
  const lum = (d: ArrayLike<number>) => 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
  const inkLum = lum(a.ink);
  for (let dx = Math.ceil(2.5 * k); dx < 30 * k; dx++) {
    const d = ctx.getImageData(Math.round(a.x * k) + dx, Math.round(a.y * k), 1, 1).data;
    if (d[3] > 200 && lum(d) < (255 + inkLum) / 2) return dx / k;
  }
  return null;
}, { ...at, ink });
/** A mark's place on the screen. */
async function onScreen(page: Page, sel: string, m: { x: number; y: number }) {
  const box = (await page.locator(sel).boundingBox())!;
  return { x: box.x + m.x, y: box.y + m.y };
}

test('the page knows every square: the people the search can mark are exactly the people drawn', async ({ page }) => {
  await home(page);
  const everyone = await people();
  await searchBox(page).fill('smith');
  // Null — no attribute — when the page's people and the artifact's counts disagree anywhere.
  await expect(page.locator('.hero-dist-wrap')).toHaveAttribute('data-people-mapped', String(everyone.length), { timeout: 60_000 });
});

for (const over of [false, true]) {
  test(`a search marks the person it shows on their own square, white with their type at its heart (${over ? 'over the cap, in the pile' : 'under the cap'})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    const who = await lone(over);
    expect(who, 'no lone name to search').toBeTruthy();
    const expected = (await spots()).get(who.person_key)!;
    expect(expected.field).toBe(over ? 'pile' : 'main');
    const field = page.locator('.hero-dots');
    await searchBox(page).fill(who.name);
    await expect(field).toHaveAttribute(over ? 'data-pile-marks' : 'data-marks', new RegExp(`^${expected.index}(:|$)`), { timeout: 60_000 });
    expect(await field.getAttribute(over ? 'data-marks' : 'data-pile-marks')).toBeNull();
    // The name typed is a group of one, lit and sunk to the floor of their column: read their square once
    // it is there.
    await expect(field).toHaveAttribute(over ? 'data-pile-lit' : 'data-lit', /^1:/, { timeout: 60_000 });
    await expect(field).toHaveAttribute('data-settled', 'true');
    // Drawn: at its own square, the heart in its type's ink and white round it.
    const pts = await places(page, '.hero-dots', expected.field);
    const at = { x: pts[2 * expected.index], y: pts[2 * expected.index + 1] };
    const cat = (await people()).find((p) => p.person_key === who.person_key)!.cat;
    const typeInk = parseColor(await tokenColor(page, ({ 'Academic Staff': '--cat-academic', 'University Staff': '--cat-university', Faculty: '--cat-faculty', 'Employees in Training': '--cat-training', Limited: '--cat-limited' } as Record<string, string>)[cat]));
    const card = parseColor(await tokenColor(page, '--surface'));
    const paint = await markPaint(page, at);
    for (let c = 0; c < 3; c++) expect(Math.abs(paint.heart[c] - typeInk[c]), `heart channel ${c}: ${paint.heart} against ${typeInk}`).toBeLessThan(12);
    for (let c = 0; c < 3; c++) expect(Math.abs(paint.inside[c] - card[c]), `inside channel ${c}: ${paint.inside} against ${card}`).toBeLessThan(12);
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

test('pointing at a mark says who it is; pressing it follows them, and Open turns the page into theirs, in about three and a half seconds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(700);
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  // The lens comes up on the mark, and its card is the person's — before the names have loaded, from the search.
  await page.mouse.move(at.x - 10, at.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  const card = page.locator(`.strata-card[data-who="${who.person_key}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(usd(who.pay));
  expect((await card.locator('.strata-card-name').innerText()).trim().toLowerCase()).toBe(who.name);

  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.hero-dist-main')).toHaveAttribute('data-follow', who.person_key);
  const chip = page.locator('.strata-follow-chip');
  await expect(chip).toContainText(/^Following /);
  await chip.getByRole('button', { name: 'Open', exact: true }).click();
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

test('under Reduce Motion, Open on a followed mark simply opens the page', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  // Pressed as soon as the lens is on the mark.
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.hero-dist-main')).toHaveAttribute('data-pick', /^main:\d+$/);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('.strata-follow-chip').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`), { timeout: 1000 });
  expect(await page.locator('.person-reveal').count()).toBe(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused({ timeout: 10_000 });
  await ctx.close();
});

test('on a phone a tap on a mark brings up the lens and its card, and the card opens them', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await home(page);
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(800);
  // On a phone the box is above the graph, and while it is in use its list lies over the top of the plot:
  // the first tap on the graph puts it away and does nothing else (the next test), so the mark is free.
  const plot = (await page.locator('.hero-dist-main').boundingBox())!;
  await page.touchscreen.tap(plot.x + plot.width / 2, plot.y + plot.height - 12);
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
  const [m] = await marksOf(page, '.hero-dots');
  const at = await onScreen(page, '.hero-dots', m);
  await page.touchscreen.tap(at.x, at.y);
  const card = page.locator(`.strata-card[data-who="${who.person_key}"]`);
  await expect(card).toBeVisible();
  // Nothing moves for a tap.
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  await card.getByRole('button', { name: 'Open', exact: true }).tap();
  await expect(page.locator('.person-reveal')).toHaveAttribute('data-phase', 'swell');
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(who.person_key)}`), { timeout: 4000 });
  await ctx.close();
});

test('on a phone the search is above the graph, and its list leaves the lower half of the plot in sight', async ({ browser }) => {
  // Under the graph, the page's search began at y=974 on an 812px phone: the one thing a visitor comes to
  // do was off the first screen. Above the graph, its list lies over the plot — so it is the full page's
  // on a phone: open only while the box is in use, stopping halfway down the plot so the marks landing
  // as the reader types stay in sight, and put away by a tap on the graph that does nothing else.
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await home(page);
  const box = (await searchBox(page).boundingBox())!;
  const panel = (await page.locator('.hero-dist').boundingBox())!;
  expect(box.y + box.height, 'the search is not above the graph').toBeLessThanOrEqual(panel.y);
  expect(box.y + box.height, 'the search is off the first screen').toBeLessThanOrEqual(812);

  await searchBox(page).tap();
  await searchBox(page).fill('smith');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(500);
  const plot = (await page.locator('.hero-dist-main').boundingBox())!;
  const list = (await page.locator('.search-dropdown').boundingBox())!;
  expect(list.y + list.height, 'the list reaches past the middle of the plot').toBeLessThanOrEqual(plot.y + plot.height / 2 + 1);

  // A tap on the graph: the list goes, and nothing else — no lens, the squares where they are, the search and
  // its marks kept.
  const marks = await page.locator('.hero-dots').getAttribute('data-marks');
  await page.touchscreen.tap(plot.x + plot.width / 2, plot.y + plot.height - 12);
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.search-dropdown')).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(page.locator('.hero-dist-main'), 'the tap that put the list away brought up the lens').toHaveAttribute('data-lens', 'off');
  await expect(searchBox(page)).toHaveValue('smith');
  expect(await page.locator('.hero-dots').getAttribute('data-marks')).toBe(marks);

  // Back to the box, the list is back; a tap on a person in it opens them.
  await searchBox(page).tap();
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'true');
  const first = page.locator('[data-group="people"] [role="option"]').first();
  await first.tap();
  await expect(page).toHaveURL(/\/person\//, { timeout: 10_000 });
  await ctx.close();
});

test('someone no longer here is listed, but has no square to mark', async ({ page }) => {
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
  expect(await page.locator('.hero-dots').getAttribute('data-pile-marks')).toBeNull();
});

test('every marked person is named beside their own square, tied to it, and no two names touch', async ({ page }) => {
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

test('the person the list has active is drawn bigger, and wears the filled name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const ink = parseColor(await tokenColor(page, '--mantine-color-text'));
  // Someone searched alone: their row is the active one, so theirs is the big mark.
  const who = await lone(false);
  await searchBox(page).fill(who.name);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  const spot = (await spots()).get(who.person_key)!;
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-mark-big', `main:${spot.index}`);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-lit', /^1:/, { timeout: 60_000 });
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  const [big] = await marksOf(page, '.hero-dots');
  const bigRing = await ringAt(page, big, ink);
  // The one name drawn filled is that person's.
  const active = page.locator('.hero-found-label[data-active="on"]');
  await expect(active).toHaveCount(1);
  expect(((await active.textContent()) ?? '').toLowerCase()).toBe(who.name.toLowerCase());
  // A mark nobody has picked out is drawn smaller: one standing clear of the others in a search of several.
  await searchBox(page).fill('smith');
  await expect.poll(async () => (await marksOf(page, '.hero-dots')).length, { timeout: 60_000 }).toBeGreaterThan(3);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-mark-big', /^main:\d/);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  const marks = await marksOf(page, '.hero-dots');
  const bigNow = Number((await page.locator('.hero-dots').getAttribute('data-mark-big'))!.split(':')[1]);
  const lonely = marks.filter((m) => m.i !== bigNow)
    .map((m) => ({ m, near: Math.min(...marks.filter((o) => o.i !== m.i).map((o) => Math.hypot(o.x - m.x, o.y - m.y))) }))
    .reduce((far, c) => (c.near > far.near ? c : far));
  expect(lonely.near, 'no mark stands clear enough of its neighbours to measure').toBeGreaterThan(20);
  const plainRing = await ringAt(page, lonely.m, ink);
  expect(bigRing, 'no ring round the big mark').not.toBeNull();
  expect(plainRing, 'no ring round the plain mark').not.toBeNull();
  expect(bigRing! - plainRing!, `the big mark's ring at ${bigRing}px against ${plainRing}px`).toBeGreaterThan(1.5);
});

/**
 * The graph going full page takes the search with it. The panel is re-parented into a portal to fill
 * the window, which remounts everything inside it, so the query cannot live in the box: one box stands
 * down, the other comes up holding what the first one held, and the marked dots never blink.
 */
test('the search goes full page with the graph: one box, the query kept, the dots still named', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Not `home`, which tells the field its intro has already played. A visitor's first sight of the page is
  // the intro, which typing in the box skips — the field going from magnified to everyone, its places moving
  // while a name could be hung on them. Skip the intro here and there is nothing to get wrong: the field
  // re-lays out between two frames and every reading is the settled one.
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  // A name more people share than the graph names (six): the page's box and the full page's list the same
  // people and name the same six, and the handover keeps them.
  await searchBox(page).fill('aaron');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const before = (await marksOf(page, '.hero-dots')).length;
  expect(before, 'nobody was marked to begin with').toBeGreaterThan(1);
  await expect(page.locator('.hero-found-label')).toHaveCount(before);
  // On the page, the list is open: that is what typing does.
  expect(await page.getByRole('option').count()).toBeGreaterThan(0);

  const leaderEnds = () => page.locator('.hero-found-leaders line').evaluateAll((els) => els.map((el) => ({
    x: Number(el.getAttribute('x1')), y: Number(el.getAttribute('y1')),
  })));
  // Going full page draws the field afresh at the larger size, where it simply is (the drop plays once a visit).
  await page.getByRole('button', { name: 'Full page' }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForTimeout(400);

  // One box, inside the panel, holding the query the page's box was holding.
  const boxes = page.getByRole('combobox', { name: /Search a person/ });
  await expect(boxes).toHaveCount(1);
  await expect(boxes).toHaveValue('aaron');
  await expect(page.locator('.hero-dist-full .hero-dist-search input')).toHaveCount(1);
  // Its list stays shut until the reader turns to the box: they asked for the graph, and a list would drop
  // over it. No menu anywhere, no list, and no chips on the bar — its starters are for an empty box. (It
  // holds the page's people, so the marks below are the ones the page's box made.)
  await expect(page.locator('.hero-dist-full .search-bar-list')).toHaveCount(0);
  await expect(page.locator('.hero-dist-full [role="option"]')).toHaveCount(0);
  await expect(page.locator('.search-dropdown')).toHaveCount(0);

  // The dots stayed marked and named right through the handover.
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./);
  expect((await marksOf(page, '.hero-dots')).length, 'the marks changed going full page').toBe(before);

  const atRest = await leaderEnds();
  expect(atRest.length, 'the names went away going full page').toBe(before);

  // Each one on its square at the full page's size. A name read once off a square in flight and never read
  // again sat 389px from the person it named, at their right pay, for as long as the graph stayed open.
  const after = await marksOf(page, '.hero-dots');
  const field = (await page.locator('.hero-dots').boundingBox())!;
  for (const l of atRest) {
    const from = { x: field.x + l.x, y: field.y + l.y };
    const near = after.map((m) => Math.hypot(field.x + m.x - from.x, field.y + m.y - from.y)).sort((a, b) => a - b)[0];
    expect(near, 'a name is stranded away from every dot, full page').toBeLessThan(30);
  }

  // Turned to, the full page's box lists the page's people — both ask for as many — and names the same
  // six: nothing asked again, and no mark moves.
  await page.locator('.hero-dist-full .hero-dist-search input').focus();
  const { total } = await searchCounts('aaron');
  await expect(page.locator('.hero-dist-full .search-bar-list [role="option"][data-kind="person"]')).toHaveCount(Math.min(50, total), { timeout: 60_000 });
  await page.waitForTimeout(500);
  expect((await marksOf(page, '.hero-dots')).map((m) => m.i).join(), 'turning to the box changed the marks').toBe(after.map((m) => m.i).join());

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

/**
 * One Escape does one thing. In the full page's box it empties the box; only once the box is empty does
 * Escape leave full page. A single press used to do both, throwing the reader out of the view they were
 * searching in along with their query.
 */
test('Escape in the full-page bar empties it first, and only then leaves full page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  const box = page.locator('.hero-dist-full .hero-dist-search input');
  await box.fill('aaron');
  await expect(page.locator('.hero-dist-full [role="option"]').first()).toBeVisible({ timeout: 60_000 });
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(page.locator('.hero-dist'), 'the Escape that emptied the box also left full page').toHaveAttribute('data-full', 'on');
  await box.press('Escape');
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
});

/**
 * More chips than the line holds — the starters beside an empty box: the strip says how many are past its
 * edge, a press on that takes the pointer to them, and the keys reach every one by themselves — the active
 * chip is always in view. (What is typed goes to a list under the box instead: search-bar-list.spec.)
 */
test('a strip too long for its line says how many are past its edge, and the keys reach them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await home(page);
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  const box = page.locator('.hero-dist-full .hero-dist-search input');
  const options = page.locator('.hero-dist-full .search-strip [role="option"]');
  await expect(options.first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const more = page.locator('.search-strip-more');
  await expect(more, 'more starters than the line holds, and no word of the ones past the edge').toBeVisible();
  const n = Number((await more.textContent())!.replace('+', ''));
  // What "+N" counts: the chips that do not end inside the strip.
  const inView = () => page.evaluate(() => {
    const strip = document.querySelector('.search-strip')!.getBoundingClientRect();
    return [...document.querySelectorAll('.hero-dist-full .search-strip [role="option"]')].map((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= strip.left - 1 && r.right <= strip.right + 1;
    });
  });
  const seen = await inView();
  expect(seen.filter((v) => !v).length, '"+N" is not the number past the edge').toBe(n);

  await more.click();
  await expect.poll(() => page.locator('.search-strip').evaluate((el) => el.scrollLeft), { message: '"+N" did not move the strip' }).toBeGreaterThan(0);
  // Back to the start, and still: the keys below start from the first chip in view.
  await page.locator('.search-strip').evaluate((el) => { el.scrollLeft = 0; });

  // The keys, from the first chip to the last: each one brought into view as it becomes the active one.
  const total = await options.count();
  await box.focus();
  for (let i = 1; i < total; i++) {
    await box.press('ArrowDown');
    await expect(options.nth(i)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await inView())[i], { message: `the active chip, ${i + 1} of ${total}, is out of sight`, timeout: 2_000 }).toBe(true);
  }
  // And past the edge they were: the last one needed the strip to move.
  expect(await page.locator('.search-strip').evaluate((el) => el.scrollLeft), 'the keys never had to move the strip').toBeGreaterThan(0);
});
