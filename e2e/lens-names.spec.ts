import { test, expect, type Browser, type Page } from '@playwright/test';
import { oracle, PAY } from './oracle';
import { HOME_STATS } from './homeDots';

/**
 * Full page, the magnifying glass names the dot at its centre: who they are, their title and school, and
 * their pay, in a caption beside the glass. It only informs — a click still scatters — and it is the full
 * page's alone: the page's own graph names no one and looks no one up.
 */

const SNAP = HOME_STATS.snapshot_id;
const SCHOOL = 'School of Medicine and Public Health';
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

/** Someone under the cap whose name no one else's contains, so a search shows them alone — with the title
 *  and school of their highest-paid appointment, the one their dot is coloured by. Someone paid in more than
 *  one title or school, so it matters which appointment the glass reads them from. */
async function lone() {
  const [r] = await oracle<{ person_key: string; nm: string; pay: number; title: string | null; school: string | null }>(
    `WITH names AS (SELECT person_key, lower(any_value(first_name) || ' ' || any_value(last_name)) nm FROM $SAL GROUP BY person_key),
          now AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key),
          top AS (SELECT person_key, title, school FROM (
                    SELECT person_key, title, school,
                           row_number() OVER (PARTITION BY person_key ORDER BY ${PAY} DESC, coalesce(employee_category, 'Other'), title, school) k
                    FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0) WHERE k = 1),
          multi AS (SELECT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key
                    HAVING count(DISTINCT coalesce(title, '') || '|' || coalesce(school, '')) > 1),
          alone AS (SELECT n.person_key, n.nm FROM names n JOIN multi USING (person_key) WHERE length(n.nm) > 9 AND n.nm NOT LIKE '%''%'
                     AND (SELECT count(*) FROM names o WHERE o.nm LIKE '%' || n.nm || '%') = 1)
     SELECT a.person_key, a.nm, now.pay, top.title, top.school FROM alone a JOIN now USING (person_key) JOIN top USING (person_key)
     WHERE now.pay < ${HOME_STATS.bin_cap} AND now.pay > 60000
     ORDER BY a.person_key LIMIT 1`,
  );
  return r;
}

/** Everyone the School of Medicine filter lights: a paid appointment there, and a dot. */
async function inSchool() {
  const rows = await oracle<{ person_key: string }>(
    `SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND school = '${SCHOOL.replace(/'/g, "''")}'`,
  );
  return new Set(rows.map((r) => r.person_key));
}

async function open(browser: Browser, o: { scheme?: 'light' | 'dark'; motion?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: o.scheme ?? 'light', reducedMotion: o.motion ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); sessionStorage.setItem('nav-peek', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  return { ctx, page };
}
async function goFull(page: Page) {
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
}
const main = (page: Page) => page.locator('.hero-dist-full .hero-dist-main');
const who = (page: Page) => page.locator('.hero-lens-who');

/** Bring the glass up and wait for the page to have looked everyone up. */
async function ready(page: Page) {
  const b = (await main(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.75);
  await expect(main(page)).toHaveAttribute('data-lens', 'on');
  await expect(main(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  return b;
}

/** Where the glass names someone along a sweep across the dense core: each step's name (or none), with the
 *  caption's box and the glass's. */
async function sweep(page: Page, b: { x: number; y: number; width: number; height: number }, steps = 60) {
  type Box = { x: number; y: number; width: number; height: number };
  const out: { key: string | null; cap: Box | null; lens: Box }[] = [];
  // Slid into, the way a hand arrives, rather than jumped to: the packed core has gaps a pixel or two wide,
  // where by design no one is named (WHO_REACH), and a pointer set down in one names no one until it moves.
  // The Sep 2026 field put one exactly on the first step.
  for (let dx = 8; dx > 0; dx--) {
    await page.mouse.move(b.x + b.width * 0.28 - dx, b.y + b.height * 0.78);
    await page.waitForTimeout(15);
  }
  for (let k = 0; k < steps; k++) {
    await page.mouse.move(b.x + b.width * 0.28 + k * 1.3, b.y + b.height * 0.78);
    await page.waitForTimeout(40);
    const key = (await who(page).count()) ? await who(page).getAttribute('data-who') : null;
    const cap = key ? await who(page).boundingBox() : null;
    const lens = (await page.locator('.fisheye-lens').boundingBox())!;
    out.push({ key, cap, lens });
  }
  return out;
}

test('full page, the glass names the dot under it: who, their title and school, and their pay', async ({ browser }) => {
  const p = await lone();
  expect(p, 'no one to look for').toBeTruthy();
  const { ctx, page } = await open(browser, { scheme: 'dark' });
  await goFull(page);
  // Where their dot is: the search marks it, and says where.
  const box = page.locator('.hero-dist-full .search-bar-field input');
  await box.fill(p.nm);
  const dots = page.locator('.hero-dist-full .hero-dots');
  await expect(dots).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  const [, x, y] = (await dots.getAttribute('data-marks'))!.split(' ')[0].split(':').map(Number);
  // Then no search, so nothing is marked and the glass is what says who is there. (Emptied, not escaped:
  // Escape in an empty box leaves full page.)
  await box.fill('');
  await expect(dots).not.toHaveAttribute('data-marks', /./);
  const b = await ready(page);
  await page.mouse.move(b.x + x, b.y + y);
  await expect(who(page)).toHaveAttribute('data-who', p.person_key);
  const name = await who(page).locator('.hero-lens-who-name').textContent();
  expect(name!.toLowerCase()).toBe(p.nm);
  await expect(who(page).locator('.hero-lens-who-pay')).toHaveText(fmtK(p.pay));
  const detail = await who(page).locator('.hero-lens-who-detail').allTextContents();
  expect(detail).toEqual([p.title, p.school].filter(Boolean));
  // Held to the plot, and clear of the glass it sits beside and of the readout above it.
  const cap = (await who(page).boundingBox())!;
  const lens = (await page.locator('.fisheye-lens').boundingBox())!;
  const pill = (await page.locator('.chart-value-pill').first().boundingBox())!;
  const clear = (a: typeof cap, c: typeof cap) => a.x >= c.x + c.width || c.x >= a.x + a.width || a.y >= c.y + c.height || c.y >= a.y + a.height;
  expect(clear(cap, lens), 'the caption lies on the glass').toBe(true);
  expect(clear(cap, pill), 'the caption lies on the readout').toBe(true);
  expect(cap.x >= b.x - 1 && cap.x + cap.width <= b.x + b.width + 1 && cap.y >= b.y - 1 && cap.y + cap.height <= b.y + b.height + 1, 'the caption is off the plot').toBe(true);
  // Empty sky names no one, with the glass still up.
  await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.1);
  await expect(main(page)).toHaveAttribute('data-lens', 'on');
  await expect(who(page)).toHaveCount(0);
  await ctx.close();
});

test('the caption holds still as the glass crosses dot after dot, and a click still scatters', async ({ browser }) => {
  // With motion, or a click has nothing to throw: under Reduce Motion the dots never scatter.
  const { ctx, page } = await open(browser, { motion: true });
  await goFull(page);
  const b = await ready(page);
  const steps = await sweep(page, b);
  const named = steps.filter((s) => s.key);
  expect(new Set(named.map((s) => s.key)).size, 'the sweep named hardly anyone').toBeGreaterThan(5);
  // One size throughout, and one place beside the glass.
  const first = named[0].cap!;
  for (const s of named) {
    expect(Math.round(s.cap!.width), 'the caption changed width').toBe(Math.round(first.width));
    expect(Math.round(s.cap!.height), 'the caption changed height').toBe(Math.round(first.height));
    expect(Math.round(s.cap!.x - s.lens.x), 'the caption moved against the glass').toBe(Math.round(first.x - named[0].lens.x));
    const c = s.cap!, l = s.lens;
    expect(c.x >= l.x + l.width || l.x >= c.x + c.width || c.y >= l.y + l.height || l.y >= c.y + c.height, 'the caption lies on the glass').toBe(true);
  }
  // It only informs: a click throws the dots, as it always has.
  const dots = page.locator('.hero-dist-full .hero-dots');
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.75);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await ctx.close();
});

test('with a filter on, the glass names only the people it lights', async ({ browser }) => {
  test.setTimeout(120_000);
  const covered = await inSchool();
  const { ctx, page } = await open(browser, { scheme: 'dark' });
  await goFull(page);
  const b = await ready(page);
  const before = await sweep(page, b);
  const box = page.locator('.hero-dist-full .search-bar-field input');
  await box.fill('medicine');
  await page.locator(`.hero-dist-full [role="option"][data-key="d:${SCHOOL}"]`).click({ timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await box.blur();
  const after = await sweep(page, b);
  const named = after.filter((s) => s.key).map((s) => s.key!);
  expect(named.length, 'the glass named no one in the school').toBeGreaterThan(3);
  for (const k of named) expect(covered.has(k), `the glass named ${k}, who the filter does not light`).toBe(true);
  // Where the same sweep named someone outside it before, it now names no one or someone in it.
  const passedOver = before.filter((s, i) => s.key && !covered.has(s.key) && after[i].key !== s.key).length;
  expect(passedOver, 'the sweep never crossed anyone the filter dims').toBeGreaterThan(0);
  await ctx.close();
});

test('on a phone, a finger held on the graph full page names the dot under its tip', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); sessionStorage.setItem('nav-peek', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await goFull(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const b = (await main(page).boundingBox())!;
  let named = false;
  // Held, then slid a pixel at a time until the tip is on a dot.
  const x = b.x + b.width * 0.3, y = b.y + b.height * 0.8;
  await touch('touchStart', x, y);
  await page.waitForTimeout(600);
  await expect(main(page)).toHaveAttribute('data-lens', 'on');
  await expect(main(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  for (let k = 0; k < 40 && !named; k++) {
    await touch('touchMove', x + k, y);
    await page.waitForTimeout(30);
    named = (await who(page).count()) > 0 && !!(await who(page).getAttribute('data-who'));
  }
  expect(named, 'a held finger named no one').toBe(true);
  // Not under the finger, which would hide it.
  const cap = (await who(page).boundingBox())!;
  const lens = (await page.locator('.fisheye-lens').boundingBox())!;
  expect(cap.y + cap.height <= lens.y || cap.y >= lens.y + lens.height || cap.x >= lens.x + lens.width || cap.x + cap.width <= lens.x, 'the caption lies on the glass').toBe(true);
  await touch('touchEnd', x, y);
  await ctx.close();
});

test('the page’s own graph names no one, and looks no one up', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  const plot = page.locator('.hero-dist-main');
  const b = (await plot.boundingBox())!;
  for (let k = 0; k < 30; k++) {
    await page.mouse.move(b.x + b.width * 0.28 + k * 1.3, b.y + b.height * 0.78);
    await page.waitForTimeout(30);
  }
  await expect(plot).toHaveAttribute('data-lens', 'on');
  await expect(plot).toHaveAttribute('data-who', 'off');
  await expect(who(page)).toHaveCount(0);
  await ctx.close();
});

test('the glass keeps the name it is on while the pointer barely moves', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await open(browser, { scheme: 'dark' });
  await goFull(page);
  const b = await ready(page);
  const at = async () => ((await who(page).count()) ? await who(page).getAttribute('data-who') : null);
  // A dot with sky right above it: the topmost of a column in the packed middle. Nowhere inside the
  // middle will do — there a dot is within reach of every pixel, so a hold proves nothing there.
  const off = { x: b.x + b.width * 0.28, y: b.y - 20 };
  /** Where the pointer names, arriving with nothing held: off the plot first, then straight to the spot,
   *  by way of `from` when the walk is supposed to be carrying a name. */
  const land = async (to: { x: number; y: number }, from?: { x: number; y: number }) => {
    await page.mouse.move(off.x, off.y); // off the plot: the glass goes down and lets go of its name
    await expect(main(page)).toHaveAttribute('data-lens', 'off');
    if (from) {
      await page.mouse.move(from.x, from.y);
      await page.waitForTimeout(40);
    }
    await page.mouse.move(to.x, to.y);
    await page.waitForTimeout(40);
    return at();
  };
  let spot: { x: number; y: number } | null = null;
  let key: string | null = null;
  for (const fx of [0.28, 0.34, 0.4]) {
    const x = b.x + b.width * fx;
    // Down through the sky until a name appears: roughly, then a pixel at a time from well above it.
    let rough = 0;
    for (let y = b.y + b.height * 0.1; y < b.y + b.height * 0.95 && !rough; y += 5) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(30);
      if (await at()) rough = y;
    }
    if (!rough) continue;
    for (let y = rough - 8; y <= rough && !spot; y++) {
      const k = await land({ x, y });
      // A stray dot a few pixels above the column's top, with sky between — the coarse sweep stepped over
      // it. That is not a top with sky right above it, so this column cannot show a hold; try the next.
      if (y === rough - 8 && k) break;
      if (k) { spot = { x, y }; key = k; }
    }
    if (spot) break;
  }
  expect(key, 'no column had a top with sky above it, or the glass named no one to hold on to').toBeTruthy();
  // A hand resting on a dot: a pixel this way or that is not a move to somebody else.
  for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
    await page.mouse.move(spot!.x + dx, spot!.y + dy);
    await page.waitForTimeout(40);
    expect(await at(), 'the name changed under a still hand').toBe(key);
  }
  // Held, not locked. Every row above that dot is sky — the sweep down just landed in it and named nobody
  // — so nothing but the hold can name anyone up there. Walking up from the dot, the name comes along for
  // several pixels, and then it goes: a hold, not a lock.
  let carry = 0;
  for (let k = 1; k <= 20 && !carry; k++) {
    if ((await land({ x: spot!.x, y: spot!.y - k }, spot!)) !== key) carry = k;
  }
  expect(carry, 'the glass never let the name go').toBeGreaterThan(0);
  expect(carry, 'the hold did not carry the name past the reach of every dot').toBeGreaterThan(4);
  // A hold, not a lock: about WHO_STICK past a dot's own radius. Measured from a marked dot's radius it
  // would be five times that, and a name would follow the pointer dots away from whose it is.
  expect(carry, 'the name followed the pointer far past its dot').toBeLessThan(9);
  await ctx.close();
});

test('crossing the packed middle names each dot in turn, not one dot in several', async ({ browser }) => {
  // The other half of the hold. It steadies a name under a still hand, but it must not be so firm that a
  // reader has to drag the glass clear of a dot to reach the next one: held by a fixed distance from the
  // dot it named, a name in the packed middle stayed on while the pointer crossed several of its
  // neighbours — one new name every 9.8px, where the dots are about a pixel apart. Yielding to whoever is
  // the nearer instead makes that 4.1, so how firmly a name is held follows how close together the dots
  // are rather than a distance that is only right where the field is sparse.
  const { ctx, page } = await open(browser);
  await goFull(page);
  const b = await ready(page);
  const keys = (await sweep(page, b)).map((s) => s.key);
  expect(keys.filter(Boolean).length, 'the sweep left the dots, so it says nothing about a packed field').toBe(keys.length);
  let changes = 0;
  for (let i = 1; i < keys.length; i++) if (keys[i] && keys[i] !== keys[i - 1]) changes++;
  // 60 steps of 1.3px: 78px across the core. Held by a fixed distance this is 8.
  expect(changes, 'the glass carried one name across several dots').toBeGreaterThanOrEqual(13);
  await ctx.close();
});
