import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY, latestSnapshot } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * Every employee as a dot (src/components/chart/DotField.tsx): the landing page's distribution — with
 * its pile of people above the cap, its "By employment type" colouring, the readout's highlight, the
 * glass, a click's burst, a drag's stir and a soloed category — and a large peer strip. Expected values
 * from SQL written here.
 */

const KENNETH = 'kennethposs|2024-07-01';

/** People with actual pay above zero and under the landing chart's $250k cap. */
async function peopleUnderCap() {
  const snap = await latestSnapshot();
  const [r] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
     WHERE snapshot_id = '${snap}' GROUP BY person_key) WHERE pay > 0 AND pay < 250000`
  );
  return r.n;
}

/** The colour the page paints behind `sel`: every ancestor's background, laid down from the root. */
async function groundBehind(page: Page, sel: string) {
  const layers = await page.locator(sel).evaluate((el) => {
    const out: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) out.push(getComputedStyle(e).backgroundColor);
    return out.reverse();
  });
  let ground = [255, 255, 255];
  for (const c of layers) {
    const [r, g, b, a] = parseColor(c);
    if (a > 0) ground = flatten([r, g, b, a], ground);
  }
  return ground;
}

test('the landing page draws one dot for each person under the cap, and loads no database', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('./');
  const dots = page.locator('.hero-dots');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await expect(dots).toHaveAttribute('data-dots', String(await peopleUnderCap()));
  expect(requests.filter((u) => /\.parquet|duckdb/i.test(u)), 'the landing page fetched the database').toEqual([]);
});

test('with reduced motion the dots are simply there; otherwise their fall stays under 8ms a frame', async ({ browser }) => {
  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const p1 = await still.newPage();
  await p1.goto('./');
  const dots1 = p1.locator('.hero-dots[data-dots]');
  await expect(dots1).toBeAttached({ timeout: 30_000 });
  await expect(dots1).toHaveAttribute('data-settled', 'true', { timeout: 1_000 });
  expect(await p1.evaluate(() => performance.getEntriesByName('dot-frame').length), 'no frames were animated').toBe(0);
  await still.close();

  const moving = await browser.newContext({ reducedMotion: 'no-preference' });
  const p2 = await moving.newPage();
  await atCiPace(p2);
  await p2.goto('./');
  await expect(p2.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const frames = await p2.evaluate(() => performance.getEntriesByName('dot-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the entrance played').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(8);
  await moving.close();
});

test('the lens follows a mouse, not a finger; a tap stays on the page', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('./');
  const dots = page.locator('.hero-dots');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  // The flag the cursor rule reads (`.hero-dist-main[data-lens='on']`).
  const main = page.locator('.hero-dist-main');
  const plot = page.locator('.hero-dist-plot');
  const box = (await plot.boundingBox())!;
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.8 };

  // A finger's move, sent to the box that listens for it: no lens.
  await main.evaluate((el, p) => {
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: p.x, clientY: p.y }));
  }, at);
  await page.waitForTimeout(200);
  await expect(main).toHaveAttribute('data-lens', 'off');

  // A mouse's: the lens, over the dots under the pointer.
  await page.mouse.move(at.x, at.y);
  await expect(main).toHaveAttribute('data-lens', 'on');
  await expect(page.locator('.dot-field-lens')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(main).toHaveAttribute('data-lens', 'off');

  // The panel is not a link: it is for pointing at, and Divisions has its own link below it.
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/UW-Madison_Salaries\/$/);
  await page.getByText('Browse every school and title under Divisions').click();
  await expect(page).toHaveURL(/\/explore/);
  await ctx.close();
});

test('the magnifying glass sits on the pointer and shows the curve under it, magnified', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await settledHome(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  await page.mouse.move(plot.x + plot.width * 0.45, plot.y + plot.height * 0.8);
  // The readout's point, where the curve is at the pointer's pay: point the glass right at it.
  const point = page.locator('.hero-dist-point');
  await expect(point).toBeVisible();
  const pb = (await point.boundingBox())!;
  const at = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 };
  await page.mouse.move(at.x, at.y);
  const lens = page.locator('.fisheye-lens');
  await expect(lens).toBeVisible();
  await page.waitForTimeout(100);
  const lb = (await lens.boundingBox())!;
  expect(Math.abs(lb.x + lb.width / 2 - at.x), 'the glass is centred on the pointer, across').toBeLessThanOrEqual(1);
  expect(Math.abs(lb.y + lb.height / 2 - at.y), 'the glass is centred on the pointer, down').toBeLessThanOrEqual(1);
  // Its centre is the curve's point, magnified: the readout's accent, not a dot's ink or the card.
  const { centre, accent } = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.fisheye-lens canvas')!;
    const d = c.getContext('2d')!.getImageData(c.width / 2 - 2, c.height / 2 - 2, 5, 5).data;
    const px: number[][] = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
    const a = getComputedStyle(document.querySelector('.hero-dist-point')!).backgroundColor;
    return { centre: px, accent: a };
  });
  const [ar, ag, ab] = parseColor(accent);
  const near = centre.filter(([r, g, b]) => Math.hypot(r - ar, g - ag, b - ab) < 40);
  expect(near.length, `the glass's centre shows the curve's point (${accent}); it showed ${JSON.stringify(centre.slice(0, 3))}`).toBeGreaterThanOrEqual(12);
  await ctx.close();
});

test("a large title's peer strip draws each peer as a dot", async ({ page }) => {
  const snap = await latestSnapshot();
  const [r] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
     WHERE snapshot_id = '${snap}' AND job_code = 'FA020' GROUP BY person_key) WHERE pay > 0`
  );
  await page.goto(`./person/${encodeURIComponent(KENNETH)}`);
  // Everyone in the title but Kenneth, who has his own mark: in the plot, or in the piles of the people
  // paid outside the title's pay window at either end (lib/payWindow).
  await expect(page.locator('.peer-strip .strip-dots').first()).toBeAttached({ timeout: 60_000 });
  await expect.poll(
    () => page.locator('.peer-strip .strip-dots').evaluateAll((els) => els.reduce((t, e) => t + Number(e.getAttribute('data-dots')), 0)),
    { timeout: 30_000 },
  ).toBe(r.n - 1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`a lone landing dot clears 3:1 against the card (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    const dots = page.locator('.hero-dots');
    await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
    const ground = await groundBehind(page, '.hero-dots');
    const ink = parseColor(await page.locator('.hero-dots .dot-field-ink').evaluate((e) => getComputedStyle(e).color));
    const alpha = Number(await dots.getAttribute('data-alpha'));
    expect(contrast(flatten([ink[0], ink[1], ink[2], ink[3] * alpha], ground), ground)).toBeGreaterThanOrEqual(3);
  });
}

/** Everyone paid in the latest snapshot, each once, at their total pay, in the category of their
 *  highest-paid appointment (ties to the category's name) — largest category first. */
async function categories() {
  const snap = await latestSnapshot();
  return oracle<{ cat: string; und: number; ovr: number; n: number }>(
    `WITH r AS (SELECT person_key, coalesce(employee_category, 'Other') ct, ${PAY} rp FROM $SAL
                WHERE snapshot_id = '${snap}' AND salary > 0),
          p AS (SELECT person_key, sum(rp) pay, first(ct ORDER BY rp DESC, ct) ct FROM r GROUP BY person_key)
     SELECT ct cat, count(*) FILTER (WHERE pay < 250000) und, count(*) FILTER (WHERE pay >= 250000) ovr, count(*) n
     FROM p WHERE pay > 0 GROUP BY ct ORDER BY n DESC, ct`
  );
}
const kindsOf = (counts: number[]) => counts.map((n, k) => [k, n]).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(',');

/**
 * On a developer's machine, run at about a CI runner's pace: CPU slowed three times. A frame budget met
 * only on a fast laptop is not met — a click's guard passed here at 3.8ms and failed in CI at 14ms,
 * when every moving frame stamped two thousand bead sprites. CI itself is not slowed further.
 */
async function atCiPace(page: Page) {
  if (process.env.CI) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 3 });
}

async function settledHome(page: Page) {
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
/** "By employment type" (the staff category): where the page opens, and a click away from "Generic". */
async function byCategory(page: Page) {
  await page.locator('.hero-dist-toggle').getByText('By employment type').click();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'on');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
}
async function allOneInk(page: Page) {
  await page.locator('.hero-dist-toggle').getByText('Generic', { exact: true }).click();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'off');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
}

test('every person paid is a dot: the field under the cap and the pile above it', async ({ page }) => {
  const cats = await categories();
  const under = cats.reduce((t, c) => t + c.und, 0);
  const over = cats.reduce((t, c) => t + c.ovr, 0);
  await settledHome(page);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-dots', String(under));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-dots', String(over));
  await expect(page.locator('.hero-dist-pile-label')).toHaveText(`${over.toLocaleString('en-US')} at $250k+`);
});

test("the page opens By employment type: each person in their highest-paid appointment's category", async ({ page }) => {
  const cats = await categories();
  await settledHome(page);
  // Where a first visit opens, with nothing clicked.
  await expect(page.locator('.hero-dist-toggle').getByRole('radio', { name: 'By employment type' })).toBeChecked();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'on');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-kinds', kindsOf(cats.map((c) => c.und)));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-kinds', kindsOf(cats.map((c) => c.ovr)));
  for (const c of cats) await expect(page.locator(`.hero-dist-legend-item[data-category="${c.cat}"]`)).toHaveAttribute('data-n', String(c.n));
  const under = await page.locator('.hero-dots').getAttribute('data-dots');
  // "Generic" is one ink and the same people, and it is remembered for this viewer.
  await allOneInk(page);
  await expect(page).toHaveURL(/\/UW-Madison_Salaries\/$/);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-dots', under!);
  await page.reload();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'off', { timeout: 30_000 });
  // A choice stored under the old key (from when the page opened on the one ink) does not hide the new default.
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('uwsal.pref.home-dots-colour', '"all"'); });
  await page.reload();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'on', { timeout: 30_000 });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every category's ink clears 3:1 as a lone dot, and its highlight differs visibly (${scheme})`, async ({ page, browser }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await settledHome(page);
    await byCategory(page);
    const dots = page.locator('.hero-dots');
    const ground = await groundBehind(page, '.hero-dots');
    const alpha = Number(await dots.getAttribute('data-alpha'));
    const inks = (await dots.getAttribute('data-inks'))!.split('|').map(parseColor);
    const strong = (await dots.getAttribute('data-strong-inks'))!.split('|').map(parseColor);
    expect(inks.length).toBe((await categories()).length);
    inks.forEach((ink, k) => {
      const lone = flatten([ink[0], ink[1], ink[2], ink[3] * alpha], ground);
      expect(contrast(lone, ground), `category ${k} as a lone dot`).toBeGreaterThanOrEqual(3);
      expect(contrast(strong[k].slice(0, 3), ink.slice(0, 3)), `category ${k}'s highlight against its ink`).toBeGreaterThanOrEqual(1.4);
    });
    // Every tone a dot can take (its depth in the stack, give or take one), not only the ink.
    const tones = (await dots.getAttribute('data-tones'))!.split('|').map((t) => t.split(';').map(parseColor));
    expect(tones.length).toBe(inks.length);
    tones.forEach((ts, k) => ts.forEach((t, j) => {
      const lone = flatten([t[0], t[1], t[2], t[3] * alpha], ground);
      expect(contrast(lone, ground), `category ${k}, tone ${j}, as a lone dot`).toBeGreaterThanOrEqual(3);
    }));
    // And each bead as drawn — its highlight, its deeper edge — seen from a step back: its mean colour.
    // Here at 1x the beads are too small for a highlight; at 3x they are widest in device pixels and the
    // highlight is the largest share of each, so the beads are read there too.
    const beadMeans = async (p: Page, scale: number) => {
      const d = p.locator('.hero-dots');
      const g = await groundBehind(p, '.hero-dots');
      const a = Number(await d.getAttribute('data-alpha'));
      const beads = (await d.getAttribute('data-bead-inks'))!.split('|').map((t) => t.split(';').map(parseColor));
      beads.forEach((bs, k) => bs.forEach((b, j) => {
        const lone = flatten([b[0], b[1], b[2], b[3] * a], g);
        expect(contrast(lone, g), `category ${k}, tone ${j}, a bead's mean colour at ${scale}x`).toBeGreaterThanOrEqual(3);
      }));
    };
    await beadMeans(page, 1);
    const ctx = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: 3, reducedMotion: 'reduce' });
    const sharp = await ctx.newPage();
    await settledHome(sharp);
    await byCategory(sharp);
    await beadMeans(sharp, 3);
    await ctx.close();
  });
}

test('the re-stack moves in frames under 8ms, and not at all under reduced motion', async ({ browser }) => {
  // On a 2× screen, where each bead is a sprite: drawn as beads every frame, 21,000 of them held the
  // re-stack at 16ms, so the whole field moves in squares and settles into beads.
  const moving = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await moving.newPage();
  await atCiPace(p);
  await settledHome(p);
  // From a known state, whatever the page opens on.
  await byCategory(p);
  await p.evaluate(() => performance.clearMeasures());
  await allOneInk(p);
  const frames = await p.evaluate(() => performance.getEntriesByName('dot-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the re-stack played').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(8);
  await moving.close();

  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const q = await still.newPage();
  await settledHome(q);
  await byCategory(q);
  await allOneInk(q);
  await byCategory(q);
  expect(await q.evaluate(() => performance.getEntriesByName('dot-frame').length), 'frames were animated').toBe(0);
  await still.close();
});

/**
 * The landing page on Playwright's fake clock, laid out and with time stopped: a test steps it to the
 * exact moments it reads, so what the field looks like at +128ms is the same on any machine. The
 * entrance is marked seen, so the field is laid at once. The fake clock blanks `performance` entries,
 * so frame budgets are measured on the real clock instead.
 */
async function frozenHome(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.clock.install({ time: new Date('2026-09-12T12:00:00') });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.clock.pauseAt(new Date('2026-09-12T12:01:00'));
}
const picture = (page: Page) => page.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

test('hovering moves no dot: the field is as still as the pointer leaves it', async ({ page }) => {
  // The pointer's wake parted the dots up and down as it passed — a slit that followed the cursor —
  // and read as wrong. Pointing shows the glass and the readout, and nothing else moves.
  await frozenHome(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const y = plot.y + plot.height * 0.6;
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(plot.x + plot.width * (0.15 + (0.5 * i) / 40), y);
    await page.clock.runFor(16);
  }
  await page.clock.runFor(32);
  const now = await picture(page);
  await page.clock.runFor(700);
  expect((await picture(page)) === now, 'the field was still moving after the pointer stopped').toBe(true);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle');
});

/** The field's canvas box, and readers of it: the share of a square (CSS px from the canvas's corner,
 *  `half` either way) that has any ink; the mean ink over a rectangle; and its inked pixels' colours. */
const canvasBox = async (page: Page) => (await page.locator('.hero-dots canvas').first().boundingBox())!;
const inkShare = (page: Page, x: number, y: number, half: number, over = 0) => page.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const w = Math.round(2 * a.half * k);
  const d = c.getContext('2d')!.getImageData(Math.round((a.x - a.half) * k), Math.round((a.y - a.half) * k), w, w).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > a.over) n++;
  return n / (w * w);
}, { x, y, half, over });
/** Ink a dot lays down, not the bloom's faint glow over the hole (under 20 of 255 by +128ms); and ink
 *  above anything the bloom can draw at all (it starts at 0.3 of full ink). */
const DOT_INK = 24;
const OVER_BLOOM = 96;
const meanInk = (page: Page, x: number, y: number, w: number, h: number) => page.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const d = c.getContext('2d')!.getImageData(Math.round(a.x * k), Math.round(a.y * k), Math.round(a.w * k), Math.round(a.h * k)).data;
  const m = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3] / 255; m[0] += d[i] * al; m[1] += d[i + 1] * al; m[2] += d[i + 2] * al; m[3] += al; }
  return m.map((v) => v / (d.length / 4));
}, { x, y, w, h });
/** Presses and lets go at `x, y` (CSS px from the canvas's corner), then takes the pointer off the
 *  plot, so neither the glass nor the readout's highlight is drawn on what a test reads. */
async function clickAway(page: Page, c: { x: number; y: number; width: number }, x: number, y: number) {
  await page.mouse.move(c.x + x, c.y + y);
  await page.clock.runFor(32);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(c.x + c.width * 0.98, c.y - 60);
}

test('a click bursts a hole you can see behind a shockwave, and every dot comes back to its place', async ({ page }) => {
  // The splash it replaces threw 1–2px dots up out of a dense field: nothing in the field visibly
  // changed. A burst opens a hole — a nearer dot never passes a farther one — and the front reaches
  // the square round the click after the first frame, not with it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const dots = page.locator('.hero-dots');
  const c = await canvasBox(page);
  const x = c.width * 0.27, y = c.height * 0.72;
  const rest = await picture(page);
  expect(await inkShare(page, x, y, 20, DOT_INK), 'the click is in the densest part of the field').toBeGreaterThan(0.8);
  for (const off of [-110, -76, 76, 110]) expect(await inkShare(page, x + off, y, 4, DOT_INK), 'the field is dense round the glass').toBeGreaterThan(0.6);
  await clickAway(page, c, x, y);
  await page.clock.runFor(16);
  // By the first frame the front has run 15px, so the square round the click is only partly emptied
  // (counted above the bloom, which swells there at once): without the front, every dot in it is gone.
  expect(await inkShare(page, x, y, 20, OVER_BLOOM), 'the shockwave reached the square with the click').toBeGreaterThan(0.3);
  await page.clock.runFor(112);
  expect(await inkShare(page, x, y, 20, DOT_INK), 'no hole opened round the click').toBeLessThan(0.15);
  // The hole reaches well past the glass that sits on the click: round its rim (LENS_D / 2 = 70px) and
  // 110px out the dots are gone too, left and right of the click, where the field was dense.
  for (const off of [-110, -76, 76, 110]) expect(await inkShare(page, x + off, y, 4, DOT_INK), `no hole ${off}px from the click`).toBeLessThan(0.15);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  // The burst and its ripple, which runs out to the plot's far corner and rocks the dots there.
  await page.clock.runFor(2372);
  await expect(dots).toHaveAttribute('data-flight', 'idle');
  expect((await picture(page)) === rest, 'the dots did not all come back to exactly their places').toBe(true);
});

test("the shockwave's rings run out across the whole plot and fade, even where there is nothing to throw", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  // High over the tail, where the field is empty: only the rings draw here, 45px above the click, and
  // 500px to its left, past the burst.
  const x = c.width * 0.62, y = c.height * 0.4;
  const near = () => inkShare(page, x, y - 45, 12);
  const far = () => inkShare(page, x - 500, y, 12);
  expect(await near(), 'the field is empty above the click').toBe(0);
  expect(await far(), 'the field is empty left of the click').toBe(0);
  await clickAway(page, c, x, y);
  await page.clock.runFor(48);
  expect(await near(), 'no ring passed 45px above the click at +48ms').toBeGreaterThan(0);
  await page.clock.runFor(252);
  expect(await near(), 'a ring was still drawn there at +300ms').toBe(0);
  // The front reaches 500px at about 536ms, and its first echo a ripple's period (184ms) later.
  await page.clock.runFor(236);
  expect(await far(), 'the front never reached 500px out').toBeGreaterThan(0);
  // The front is a soft glowing band under a thin core: along the click's row, its ink spans more than
  // the 1.5px line alone.
  const band = await page.locator('.hero-dots canvas').first().evaluate((cv: HTMLCanvasElement, a) => {
    const k = cv.width / cv.clientWidth;
    const d = cv.getContext('2d')!.getImageData(Math.round((a.x - 16) * k), Math.round(a.y * k), Math.round(32 * k), 1).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / k;
  }, { x: x - 500, y });
  expect(band, 'the ring is a bare line (its ink across, px)').toBeGreaterThanOrEqual(5);
  await page.clock.runFor(184);
  expect(await far(), 'no echo followed the front').toBeGreaterThan(0);
  await page.clock.runFor(1500);
  expect(await far(), 'a ring was still drawn at +2s').toBe(0);
});

test('past the burst the dots ripple: each rocks outward as the front passes, back past its place, and rests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  const x = c.width * 0.3, y = c.height * 0.72;
  // A window 420px right of the click — three times the burst's reach — over the stacks at the foot of
  // the plot (above them only the rings draw). Its ink summed down each column.
  const D = 420;
  const profile = () => page.locator('.hero-dots canvas').first().evaluate((cv: HTMLCanvasElement, a) => {
    const k = cv.width / cv.clientWidth;
    const x0 = Math.round((a.x - 30) * k), w = Math.round(60 * k), y0 = Math.round(cv.height * 0.55);
    const d = cv.getContext('2d')!.getImageData(x0, y0, w, cv.height - y0).data;
    const col = new Array<number>(w).fill(0);
    for (let i = 0; i < d.length; i += 4) col[(i / 4) % w] += d[i + 3];
    return col;
  }, { x: x + D });
  // How far the window's dots sit from their places, px (outward, from the click, is +): the shift that
  // best lays the middle half of the window back over its resting profile.
  const shift = (rest: number[], now: number[]) => {
    const w = rest.length, q = Math.floor(w / 4);
    let best = 0, err = Infinity;
    for (let s = -q; s <= q; s++) {
      let e = 0;
      for (let j = q; j < w - q; j++) e += (now[j] - rest[j - s]) ** 2;
      if (e < err) { err = e; best = s; }
    }
    return best;
  };
  const rest = await profile();
  const picked = await picture(page);
  await clickAway(page, c, x, y);
  // The front reaches 420px at about 450ms: before it, nothing there has moved.
  await page.clock.runFor(384);
  expect(Math.abs(shift(rest, await profile())), 'the dots moved before the front reached them').toBeLessThanOrEqual(1);
  // Just past it, they swing out — about 11px at three reaches — ...
  await page.clock.runFor(112);
  const out = shift(rest, await profile());
  expect(out, 'the dots past the burst did not swing out as the front passed').toBeGreaterThanOrEqual(5);
  // ... and half a period on they are back past their places: a ripple, not a single push.
  await page.clock.runFor(96);
  expect(shift(rest, await profile()), 'the dots never swung back past their places').toBeLessThanOrEqual(-2);
  await page.clock.runFor(2000);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle');
  expect((await picture(page)) === picked, 'the rippled dots did not all come back to their places').toBe(true);
});

test('in the Generic view a dot in the air wears its employment type, and turns back as it lands', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  // "Generic", and the re-stack played out on the stopped clock.
  await page.locator('.hero-dist-toggle').getByText('Generic', { exact: true }).click();
  await page.clock.runFor(600);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'off');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true');
  const c = await canvasBox(page);
  const x = c.width * 0.27, y = c.height * 0.72;
  const rest = await picture(page);
  // The share of inked pixels round the click whose hue is far from the one ink's.
  const offHue = () => page.locator('.hero-dots').evaluate((box: HTMLElement, a) => {
    const c = box.querySelector('canvas')!;
    const hue = (r: number, g: number, b: number) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 12) return null;
      const h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      return (h * 60 + 360) % 360;
    };
    const [r, g, b] = (box.dataset.inks ?? '').split('|')[0].match(/[\d.]+/g)!.map(Number);
    const base = hue(r, g, b)!;
    const k = c.width / c.clientWidth, half = 100;
    const d = c.getContext('2d')!.getImageData(Math.round((a.x - half) * k), Math.round((a.y - half) * k), Math.round(2 * half * k), Math.round(2 * half * k)).data;
    let inked = 0, off = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      inked++;
      const h = hue(d[i], d[i + 1], d[i + 2]);
      if (h != null && Math.min(Math.abs(h - base), 360 - Math.abs(h - base)) > 40) off++;
    }
    return off / Math.max(1, inked);
  }, { x, y });
  expect(await offHue(), 'at rest the Generic view is one ink').toBeLessThan(0.005);
  await clickAway(page, c, x, y);
  await page.clock.runFor(128);
  expect(await offHue(), "no dot in the air wore its employment type's colour").toBeGreaterThan(0.05);
  await page.clock.runFor(2372);
  expect((await picture(page)) === rest, 'the dots did not land back in the one ink').toBe(true);
});

test('the glass shows the hole a click opens under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  const x = c.width * 0.27, y = c.height * 0.72;
  await page.mouse.move(c.x + x, c.y + y);
  await page.clock.runFor(48);
  // A block of the glass left of its centre, across the pointer's row: the dots there, magnified —
  // then, thrown out sideways, nothing but the band's even tint. The share of its pixels unlike its
  // commonest one.
  const unlike = () => page.locator('.dot-field-lens').evaluate((cv: HTMLCanvasElement) => {
    const k = cv.width / cv.clientWidth, R = cv.clientWidth / 2;
    const d = cv.getContext('2d')!.getImageData(Math.round((R - 40) * k), Math.round((R - 16) * k), Math.round(14 * k), Math.round(32 * k)).data;
    const seen = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) { const key = (d[i] << 24) ^ (d[i + 1] << 16) ^ (d[i + 2] << 8) ^ d[i + 3]; seen.set(key, (seen.get(key) ?? 0) + 1); }
    return 1 - Math.max(...seen.values()) / (d.length / 4);
  });
  expect(await unlike(), 'the glass shows no dots at rest').toBeGreaterThan(0.5);
  await page.mouse.down();
  await page.mouse.up();
  // Read once the bloom has faded (BLOOM_MS, 250ms), while the hole is still open under the glass.
  await page.clock.runFor(272);
  expect(await unlike(), 'the glass still showed dots where the burst had thrown them out').toBeLessThan(0.02);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`while dots move, the still ones drawn round them weigh what they do at rest (${scheme})`, async ({ browser }) => {
    // Moving dots are squares, and so are still ones inside a moving strip. Each lays down its bead's
    // own ink, within a few percent; a flat square 2r wide laid down 15–35% more at 2x, so a strip in
    // motion was a darker rectangle in the field.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await frozenHome(page);
    const c = await canvasBox(page);
    const x = c.width * 0.2, y = c.height * 0.78;
    // 450px from the click: the front has not reached it at +128ms, so no dot here has moved, but the
    // ripple spans the whole field, which is repainted — in squares — every frame.
    const band = () => meanInk(page, x + 450, 0, 10, c.height);
    const rest = await band();
    await clickAway(page, c, x, y);
    await page.clock.runFor(128);
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'moving');
    const moving = await band();
    for (let k = 0; k < 4; k++) {
      expect(Math.abs(moving[k] / rest[k] - 1), `channel ${k}: ${moving[k].toFixed(4)} moving against ${rest[k].toFixed(4)} at rest`).toBeLessThan(0.06);
    }
    await ctx.close();
  });
}

test('switching on Reduce Motion mid-burst puts every dot home at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const dots = page.locator('.hero-dots');
  const c = await canvasBox(page);
  const rest = await picture(page);
  await clickAway(page, c, c.width * 0.27, c.height * 0.72);
  await page.clock.runFor(64);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dots).toHaveAttribute('data-flight', 'idle');
  expect((await picture(page)) === rest, 'the dots were not all home').toBe(true);
});

test('a drag with the button held stirs the dots along its path, and they close up behind it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  const y = c.height * 0.72;
  const x0 = c.width * 0.2, x1 = c.width * 0.4, far = c.width * 0.85;
  const rest = await picture(page);
  const farRest = await inkShare(page, far, y, 8);
  expect(await inkShare(page, x1, y, 8), "the drag ends in a dense part of the field").toBeGreaterThan(0.6);
  // Pressed on the panel just left of the plot and drawn in: a stir alone (a press on the plot bursts,
  // and its ripple would rock the dots measured here).
  await page.mouse.move(c.x - 8, c.y + y);
  await page.mouse.down();
  await page.mouse.move(c.x + x0, c.y + y);
  await page.clock.runFor(16);
  for (let x = x0 + 16; ; x += 16) {
    await page.mouse.move(c.x + Math.min(x, x1), c.y + y);
    await page.clock.runFor(16);
    if (x >= x1) break;
  }
  await page.clock.runFor(96);
  expect(await inkShare(page, x1, y, 8), 'the dots at the end of the drag did not part').toBeLessThan(0.4);
  expect(await inkShare(page, far, y, 8), 'dots far from the drag moved').toBe(farRest);
  await page.mouse.up();
  await page.mouse.move(c.x + c.width * 0.98, c.y - 60);
  await page.clock.runFor(1500);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle');
  expect((await picture(page)) === rest, 'the stirred dots did not all come back to their places').toBe(true);
});

/** A straight drag by the clock at `v` px/ms along canvas row `y`, pressed just left of the plot (so it
 *  is a stir alone, not a burst) to canvas x `x1`; the button is left held. */
async function dragAt(page: Page, c: { x: number; y: number }, y: number, x1: number, v: number) {
  await page.mouse.move(c.x - 8, c.y + y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + y);
  await page.clock.runFor(16);
  const steps = Math.ceil(x1 / (v * 16));
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(c.x + Math.min(x1, v * 16 * k), c.y + y);
    await page.clock.runFor(16);
  }
}
/** The clearing a drag along canvas row `y` opened at `x`, CSS px tall: the rows either side of it with
 *  under a quarter of a 12px-wide column in dot ink, from `skip` px out (inside that a wake is drawn). */
const clearing = (page: Page, x: number, y: number, skip = 7) => page.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement, a) => {
  const k = c.width / c.clientWidth;
  const col = Math.round(a.x * k), yy = Math.round(a.y * k), w = Math.round(12 * k);
  const d = c.getContext('2d')!.getImageData(col - (w >> 1), 0, w, c.height).data;
  const inked = (row: number) => { let n = 0; for (let x = 0; x < w; x++) if (d[(row * w + x) * 4 + 3] > 24) n++; return n / w; };
  const from = Math.round(a.skip * k);
  let up = from; while (yy - up > 0 && inked(yy - up) < 0.25) up++;
  let dn = from; while (yy + dn < c.height - 1 && inked(yy + dn) < 0.25) dn++;
  return (up + dn) / k;
}, { x, y, skip });

test('the faster a drag, the further the dots part and spread — and every one comes home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const main = page.locator('.hero-dist-main');
  const dots = page.locator('.hero-dots');
  const c = await canvasBox(page);
  const y = c.height * 0.72, at = c.width * 0.3;
  // (Whether dots far from a drag stay put is the slow drag's test above: a drag this long flies dots
  // across over a third of the field, which is then repainted whole, in squares, while they move.)
  const rest = await picture(page);
  expect(await inkShare(page, at, y, 8), 'the drag passes a dense part of the field').toBeGreaterThan(0.6);
  // Each drag passes the same point, stops 64ms of its own travel past it, and is read 48ms later: near
  // the dots' widest there.
  const part = async (v: number) => {
    await dragAt(page, c, y, at + v * 64, v);
    const strength = Number(await main.getAttribute('data-stir'));
    await page.clock.runFor(48);
    const gap = await clearing(page, at, y);
    await page.mouse.up();
    await page.mouse.move(c.x + c.width * 0.98, c.y - 60);
    await page.clock.runFor(1500);
    await expect(dots).toHaveAttribute('data-flight', 'idle');
    expect((await picture(page)) === rest, `after a ${v}px/ms drag the dots did not all come back to their places`).toBe(true);
    return { strength, gap };
  };
  const slow = await part(0.2);
  const fast = await part(3);
  expect(slow.strength, 'a slow drag read as fast').toBe(0);
  expect(fast.strength, 'a fast drag read as slow').toBeGreaterThan(0.85);
  expect(slow.gap, 'a slow drag parted the dots wide').toBeLessThan(40);
  expect(fast.gap, 'a fast drag did not part the dots wide').toBeGreaterThan(70);
  expect(fast.gap, 'a fast drag parted the dots wider than one stir can: its kicks piled up').toBeLessThan(140);
  expect(fast.gap, 'a fast drag parted no wider than a slow one').toBeGreaterThan(2.5 * slow.gap);
});

test('a fast drag leaves a wake that fades; a slow one leaves none', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  // Above the peak, where no dot ever is: any ink on the drag's line is its wake.
  const y = 12, x1 = c.width * 0.5, at = c.width * 0.35;
  expect(await inkShare(page, at, y, 4), 'dots above the peak').toBe(0);
  await dragAt(page, c, y, x1, 3);
  await page.clock.runFor(32);
  expect(await inkShare(page, at, y, 2), 'a fast drag left no wake').toBeGreaterThan(0.6);
  expect(await inkShare(page, at, y - 8, 1), 'the wake is wider than a stroke should be').toBe(0);
  await page.clock.runFor(320);
  expect(await inkShare(page, at, y, 4), 'the wake did not fade').toBe(0);
  await page.mouse.up();
  await page.clock.runFor(1200);
  await dragAt(page, c, y, x1, 0.2);
  await page.clock.runFor(32);
  expect(await inkShare(page, at, y, 4), 'a slow drag left a wake').toBe(0);
  await page.mouse.up();
});

test('a touch the browser takes back throws nothing', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, reducedMotion: 'no-preference', viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await frozenHome(page);
  const c = await canvasBox(page);
  const rest = await picture(page);
  // Down, then cancelled — the browser took the gesture — and an up at the same spot at once.
  await page.locator('.hero-dist-main').evaluate((el, p) => {
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: p.x, clientY: p.y });
    el.dispatchEvent(ev('pointerdown'));
    el.dispatchEvent(ev('pointercancel'));
    el.dispatchEvent(ev('pointerup'));
  }, { x: c.x + c.width * 0.3, y: c.y + c.height * 0.7 });
  await page.clock.runFor(200);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle');
  expect((await picture(page)) === rest, 'a cancelled touch threw dots').toBe(true);
  await ctx.close();
});

test('a tap that bursts the dots ticks the phone once; a click, a scroll and a still tap do not', async ({ browser }) => {
  const buzz = () => {
    const w = window as unknown as { buzz: unknown[] };
    w.buzz = [];
    (Navigator.prototype as unknown as { vibrate: (p: unknown) => boolean }).vibrate = (p) => { w.buzz.push(p); return true; };
  };
  const ctx = await browser.newContext({ hasTouch: true, reducedMotion: 'no-preference', viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.addInitScript(buzz);
  await settledHome(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const at = { x: plot.x + plot.width * 0.3, y: plot.y + plot.height * 0.75 };
  await page.mouse.click(at.x, at.y);
  await page.locator('.hero-dist-main').evaluate((el, p) => {
    const ev = (type: string, y: number) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, buttons: 1, clientX: p.x, clientY: y });
    el.dispatchEvent(ev('pointerdown', p.y));
    el.dispatchEvent(ev('pointermove', p.y + 20));
    el.dispatchEvent(ev('pointerup', p.y + 40));
  }, at);
  expect(await page.evaluate(() => (window as unknown as { buzz: unknown[] }).buzz), 'a click or a scroll ticked the phone').toEqual([]);
  await page.touchscreen.tap(at.x, at.y);
  expect(await page.evaluate(() => (window as unknown as { buzz: unknown[] }).buzz)).toEqual([10]);
  await ctx.close();

  const still = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce', viewport: { width: 375, height: 812 } });
  const q = await still.newPage();
  await q.addInitScript(buzz);
  await settledHome(q);
  await q.touchscreen.tap(at.x, at.y);
  expect(await q.evaluate(() => (window as unknown as { buzz: unknown[] }).buzz), 'a tap under Reduce Motion ticked the phone').toEqual([]);
  await still.close();
});

test("every landing dot has its own room: none crowded, none more than 3.75px from its pay", async ({ browser }) => {
  // One-pixel columns put 66% of dots over a neighbour, and a column of people sharing a pay held up to
  // 3.7 times its room — a solid streak. Packed (lib/dotLayout packDots), columns are a dot-width apart
  // and a crowded one evens out with its neighbours within 3px.
  for (const [viewport, scale, crowd] of [[{ width: 1440, height: 900 }, 2, 0.005], [{ width: 375, height: 812 }, 3, 0]] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await settledHome(page);
    const dots = page.locator('.hero-dots');
    // A field laid out without packing carries no count; a missing one must not read as none crowded.
    await expect(dots, 'the field is not packed: no crowding measured').toHaveAttribute('data-crowded', /^\d+$/);
    await expect(dots, 'the field is not packed: no shift measured').toHaveAttribute('data-max-shift', /^\d+(\.\d+)?$/);
    const n = Number(await dots.getAttribute('data-dots'));
    const crowded = Number(await dots.getAttribute('data-crowded'));
    expect(crowded, `${crowded} of ${n} dots crowded at ${viewport.width}px @${scale}x`).toBeLessThanOrEqual(crowd * n);
    // The spill (3px) and half a column.
    expect(Number(await dots.getAttribute('data-max-shift')), 'the furthest a dot sits from its pay, px').toBeLessThanOrEqual(3.75);
    await expect(dots).toHaveAttribute('data-alpha', '1');
    await ctx.close();
  }
});

test('at 2x the densest part of the field shows the gaps between its dots, and every dot is crisp', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await settledHome(page);
  await page.mouse.move(0, 0);
  const seen = await page.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement) => {
    const k = c.width / c.clientWidth, g = c.getContext('2d')!, W = c.clientWidth, H = c.clientHeight;
    // The most inked 40x40 square along the foot of the field, and the share of its pixels left empty.
    let best = { cov: 0, empty: 1 };
    for (let x = 20; x < W - 20; x += 10) {
      const d = g.getImageData(Math.round((x - 20) * k), Math.round((H - 60) * k), Math.round(40 * k), Math.round(40 * k)).data;
      let empty = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) empty++;
      const cov = 1 - empty / (d.length / 4);
      if (cov > best.cov) best = { cov, empty: empty / (d.length / 4) };
    }
    // In the thin tail, the share of a dot's pixels at full ink: a sprite stamped on whole pixels keeps
    // its opaque centre; one stamped between pixels is resampled, and none are.
    const d = g.getImageData(Math.round(W * 0.6 * k), Math.round((H - 30) * k), Math.round(W * 0.38 * k), Math.round(28 * k)).data;
    let inked = 0, full = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { inked++; if (d[i] === 255) full++; }
    return { empty: best.empty, full: full / Math.max(1, inked) };
  });
  expect.soft(seen.empty, 'the densest square of the field is a solid mass (share of its pixels empty)').toBeGreaterThanOrEqual(0.28);
  expect.soft(seen.full, "the dots' sprites were resampled (share of their pixels at full ink)").toBeGreaterThanOrEqual(0.08);
  await ctx.close();
});

test('the keyboard walks the readout along the pay, bursts the dots at it, and puts it away', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await settledHome(page);
  const main = page.locator('.hero-dist-main');
  const dots = page.locator('.hero-dots');
  const pill = page.locator('.chart-value-pill').first();
  const bucket = async () => Number(await main.getAttribute('aria-valuenow'));
  const counted = async () => Number((((await pill.textContent()) ?? '').match(/([\d,]+) people/)?.[1] ?? '').replace(/,/g, ''));
  // From the toggle just before it, Tab brings the keyboard to the plot: the readout starts at the median.
  await page.locator('.hero-dist-toggle input:checked').focus();
  await page.keyboard.press('Tab');
  await expect(main).toBeFocused();
  await expect(pill).toBeVisible();
  const median = await bucket();
  await expect(main).toHaveAttribute('role', 'slider');
  // The median's own value, to within the $1k the readout steps by.
  const p50 = (await (await page.request.get('./data/home-stats.json')).json()).p50 as number;
  expect(Math.abs(median - p50)).toBeLessThanOrEqual(1000);
  for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowRight');
  expect(await bucket()).toBe(median + 3000);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await bucket()).toBe(median + 13000);
  // What a screen reader hears is what the pill shows, and the highlighted dots are the people counted.
  const n = await counted();
  expect(await main.getAttribute('aria-valuetext')).toContain(`${n.toLocaleString('en-US')} people within`);
  await expect(dots).toHaveAttribute('data-highlight', String(n));
  // With the plot focused the page still passes axe.
  const axe = await new AxeBuilder({ page }).include('.hero-dist').analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([]);
  // Enter bursts the dots at the readout's point; Escape puts the readout away.
  await page.keyboard.press('Enter');
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await page.keyboard.press('Escape');
  await expect(pill).toBeHidden();
  await ctx.close();

  // A mouse's click focuses the plot but does not jump the readout to the median.
  const other = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const q = await other.newPage();
  await settledHome(q);
  const box = (await q.locator('.hero-dist-plot').boundingBox())!;
  await q.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.7);
  await expect(q.locator('.hero-dist-main')).toBeFocused();
  await expect.poll(async () => Number(await q.locator('.hero-dist-main').getAttribute('aria-valuenow')), { message: 'a click jumped the readout to the median' }).toBeGreaterThan(150000);
  await q.waitForTimeout(200);
  expect(Number(await q.locator('.hero-dist-main').getAttribute('aria-valuenow')), 'the readout moved to the median after the click').toBeGreaterThan(150000);
  // Under Reduce Motion, Enter throws nothing.
  await q.keyboard.press('Enter');
  await q.waitForTimeout(200);
  expect(await q.evaluate(() => performance.getEntriesByName('flight-frame').length)).toBe(0);
  await other.close();
});

test('on a phone a finger held still brings up the glass above it; one that moves scrolls', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await settledHome(page);
  const main = page.locator('.hero-dist-main');
  await main.scrollIntoViewIfNeeded();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const box = (await page.locator('.hero-dist-plot').boundingBox())!;
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.7;
  const scrolled = () => page.evaluate(() => window.scrollY);
  const before = await scrolled();
  await touch('touchStart', x, y);
  await page.waitForTimeout(600);
  await expect(main).toHaveAttribute('data-lens', 'on');
  const glass = (await page.locator('.fisheye-lens').boundingBox())!;
  // Above the finger, so the finger does not hide it.
  expect(glass.y + glass.height, 'the glass is not above the finger').toBeLessThan(y);
  // Sliding moves the glass, and the page stays put. (A page that scrolls takes the gesture, and the glass
  // goes with it: checked first, or reading the missing glass's box would wait out the test.)
  for (let k = 1; k <= 6; k++) { await touch('touchMove', x + 8 * k, y - 6 * k); await page.waitForTimeout(16); }
  expect(await scrolled(), 'the page scrolled under the glass').toBe(before);
  await expect(main, 'the glass went as the finger slid').toHaveAttribute('data-lens', 'on');
  const moved = (await page.locator('.fisheye-lens').boundingBox())!;
  expect(moved.x - glass.x, 'the glass did not follow the finger').toBeGreaterThan(30);
  // Lifting puts the glass away and leaves the readout, with nothing thrown: counted in frames, since a
  // burst is over within the time an attribute's check waits for "idle".
  const thrown = () => page.evaluate(() => performance.getEntriesByName('flight-frame').length);
  const framesBefore = await thrown();
  await touch('touchEnd', x + 48, y - 36);
  await expect(main).toHaveAttribute('data-lens', 'off');
  await expect(page.locator('.chart-value-pill').first()).toBeVisible();
  await page.waitForTimeout(200);
  expect(await thrown(), 'lifting the finger threw the dots').toBe(framesBefore);

  // A finger that moves at once is scrolling: the page moves and no glass comes up.
  const start = await scrolled();
  await touch('touchStart', x, y);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', x, y - 20 * k); await page.waitForTimeout(10); }
  await touch('touchEnd', x, y - 160);
  await page.waitForTimeout(300);
  expect(await scrolled(), 'a quick swipe did not scroll the page').toBeGreaterThan(start + 40);
  await expect(main).toHaveAttribute('data-lens', 'off');
  await ctx.close();
});

test('a click blooms: a soft glow swells where it lands and is gone within a quarter second', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await frozenHome(page);
  const c = await canvasBox(page);
  // High over the tail, where the field is empty: a square 20px beside the click, inside the bloom and
  // clear of the front's ring, which has run 60px by then.
  const x = c.width * 0.62, y = c.height * 0.4;
  const beside = () => inkShare(page, x - 20, y, 8);
  expect(await beside(), 'the field is empty beside the click').toBe(0);
  await clickAway(page, c, x, y);
  await page.clock.runFor(64);
  expect(await beside(), 'no bloom where the click landed').toBeGreaterThan(0.5);
  await page.clock.runFor(236);
  expect(await beside(), 'the bloom was still there at +300ms').toBe(0);
});

test('the curve glows, and a faint wash lies under it behind the dots', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await settledHome(page);
  await page.mouse.move(0, 0);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  // In the tail: the sky far above the curve, and the foot of the field, where the curve runs low.
  const sky = { x: plot.x + plot.width * 0.7, y: plot.y + 20, width: 120, height: 30 };
  const foot = { x: plot.x + plot.width * 0.7, y: plot.y + plot.height - 50, width: 120, height: 48 };
  const shot = async () => ({ sky: await page.screenshot({ clip: sky }), foot: await page.screenshot({ clip: foot }) });
  const all = await shot();
  await page.addStyleTag({ content: '.hero-dist-wash { visibility: hidden; }' });
  const noWash = await shot();
  expect(Buffer.compare(noWash.sky, all.sky), 'the wash reaches above the curve').toBe(0);
  expect(Buffer.compare(noWash.foot, all.foot), 'no wash under the curve, between the dots').not.toBe(0);
  await page.addStyleTag({ content: '.hero-dist-curve-glow { visibility: hidden; }' });
  const noGlow = await shot();
  expect(Buffer.compare(noGlow.sky, noWash.sky), 'the glow reaches the sky').toBe(0);
  expect(Buffer.compare(noGlow.foot, noWash.foot), 'no glow along the curve').not.toBe(0);
  await ctx.close();
});

test('the highlighted dots are the people the readout counts', async ({ page }) => {
  await settledHome(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const dots = page.locator('.hero-dots');
  const pill = page.locator('.chart-value-pill').first();
  const counted = async () => Number((((await pill.textContent()) ?? '').match(/([\d,]+) people/)?.[1] ?? '').replace(/,/g, ''));
  for (const frac of [0.25, 0.45, 0.8]) {
    await page.mouse.move(plot.x + plot.width * frac, plot.y + plot.height * 0.7);
    await expect(pill).toBeVisible();
    await expect(dots).toHaveAttribute('data-highlight', String(await counted()));
  }
  // Over the pile: all of it, and the pill says so. Pointed at its middle: at 1280x720 the page's fixed
  // footer covers the foot of the 375px plot until the page scrolls.
  const pile = (await page.locator('.hero-dist-pile').boundingBox())!;
  await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height * 0.6);
  await expect(pill).toContainText('people at $250k or more');
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-highlight', String(await counted()));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-highlight', (await page.locator('.hero-dots-over').getAttribute('data-dots'))!);
});

test('pointing changes nothing away from the pointer: no dot elsewhere dims', async ({ browser }) => {
  // What could change far from the pointer is only a dimming.
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await settledHome(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  // A strip of dots at 12% of the plot, well clear of the band, the pill and the lens at 65%.
  const strip = { clip: { x: plot.x + plot.width * 0.12, y: plot.y + plot.height - 40, width: 24, height: 36 } };
  await page.mouse.move(plot.x + plot.width * 0.5, plot.y - 120);
  const before = await page.screenshot(strip);
  await page.mouse.move(plot.x + plot.width * 0.65, plot.y + plot.height * 0.7);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-highlight', /^[1-9]/);
  // At 1x the landing's dots overlap across one-pixel columns, so each is laid down at 0.85 and the ink
  // builds (from 1.25x they stand apart and are drawn in their full ink).
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-alpha', '0.85');
  const after = await page.screenshot(strip);
  expect(Buffer.compare(before, after), 'dots far from the pointer changed while it pointed').toBe(0);
  await ctx.close();
});

test('after a window resize the dots are laid out for the width they are drawn at, as a fresh load lays them', async ({ browser }) => {
  // On the way to a phone width the app shell eases its navbar's padding away, so the plot grows from
  // nothing to its width in ~9ms steps. A half-pixel dead band in the field's width measure swallowed
  // the last step whenever it came in under 0.5px, and the phone's dots were laid out for a width the
  // canvas was not drawn at — differently run to run, which is how the visual suite found it.
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await settledHome(page);
  const field = page.locator('.hero-dots');
  const offBy = () => field.evaluate((el) => Math.abs(Number(el.getAttribute('data-width')) - el.getBoundingClientRect().width));
  const laidOut = (why: string) => expect.poll(offBy, { message: `the dots are laid out for the width the field is drawn at ${why}` }).toBeLessThan(0.01);
  await page.setViewportSize({ width: 375, height: 812 });
  // Until the shell's ease has finished: the same width over ten frames.
  await page.evaluate(() => new Promise<void>((resolve) => {
    const el = document.querySelector('.hero-dots')!;
    let last = -1, same = 0;
    const tick = () => { const w = el.getBoundingClientRect().width; same = w === last ? same + 1 : 0; last = w; if (same >= 10) resolve(); else requestAnimationFrame(tick); };
    tick();
  }));
  await laidOut('after the resize');
  // Where that last step fell is a matter of frame timing, so make one that always falls short of
  // half a pixel: widen the pile's gap by 0.3px, then put it back.
  for (const gap of ['14.3px', '14px']) {
    await page.locator('.hero-dist-row').evaluate((el, g) => (el as HTMLElement).style.setProperty('--pile-gap', g), gap);
    await laidOut(`with the gap at ${gap}`);
  }
  const ink = (p: Page) => p.locator('.hero-dots canvas').first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const resized = await ink(page);

  const fresh = await ctx.newPage();
  await fresh.setViewportSize({ width: 375, height: 812 });
  await settledHome(fresh);
  expect(await ink(fresh) === resized, 'the resized field paints what a fresh load at that width paints').toBe(true);
  await ctx.close();
});

test('a burst and a drag move in frames under 8ms at 2x, and every dot lands; the page stays', async ({ browser }) => {
  // The Generic view, so the frames carry the dots in the air in their own colours, and the ring.
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await atCiPace(page);
  await settledHome(page);
  await allOneInk(page);
  const dots = page.locator('.hero-dots');
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const median = async () => {
    const f = await page.evaluate(() => performance.getEntriesByName('flight-frame').map((e) => e.duration).sort((a, b) => a - b));
    return { n: f.length, median: f[Math.floor(f.length / 2)] };
  };
  await page.evaluate(() => performance.clearMeasures());
  await page.mouse.click(plot.x + plot.width * 0.27, plot.y + plot.height * 0.72);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 6000 });
  const burst = await median();
  expect(burst.n, 'the burst moved no dots').toBeGreaterThan(10);
  expect(burst.median, 'a burst frame, ms').toBeLessThan(8);
  // A stir, by the clock: 200px through the densest part in 0.8s, pressed just off the plot, so it is a
  // stir alone and repainted in strips — narrower than a third of the field, which is repainted whole.
  // (A press on the plot bursts, and its ripple repaints the whole field, which the burst above timed.)
  await page.evaluate(() => performance.clearMeasures());
  const y = plot.y + plot.height * 0.72, x0 = plot.x + plot.width * 0.15;
  await page.mouse.move(plot.x - 8, y);
  await page.mouse.down();
  await page.mouse.move(x0, y);
  const t0 = Date.now();
  for (let t = 0; t < 800; t = Date.now() - t0) {
    await page.mouse.move(x0 + 0.25 * t, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 6000 });
  const drag = await median();
  expect(drag.n, 'the drag moved no dots').toBeGreaterThan(20);
  expect(drag.median, 'a drag frame, ms').toBeLessThan(8);
  // A fast drag, back and forth at 3px/ms over the same 300px for 0.8s: its wider stir and its wake.
  await page.evaluate(() => performance.clearMeasures());
  await page.mouse.move(plot.x - 8, y);
  await page.mouse.down();
  await page.mouse.move(x0, y);
  const t1 = Date.now();
  for (let t = 0; t < 800; t = Date.now() - t1) {
    const s = (3 * t) % 600;
    await page.mouse.move(x0 + (s < 300 ? s : 600 - s), y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 6000 });
  const flick = await median();
  expect(flick.n, 'the fast drag moved no dots').toBeGreaterThan(10);
  expect(flick.median, 'a fast drag frame, ms').toBeLessThan(8);
  await expect(dots).toHaveAttribute('data-visible', (await dots.getAttribute('data-dots'))!);
  await expect(page).toHaveURL(/\/UW-Madison_Salaries\/$/);
  await ctx.close();

  // Under reduced motion a click, a tap and a drag throw nothing.
  const still = await browser.newContext({ reducedMotion: 'reduce', hasTouch: true });
  const q = await still.newPage();
  await settledHome(q);
  const box = (await q.locator('.hero-dist-plot').boundingBox())!;
  await q.mouse.click(box.x + box.width * 0.26, box.y + box.height * 0.7);
  await q.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await q.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
  await q.mouse.down();
  for (let i = 1; i <= 20; i++) await q.mouse.move(box.x + box.width * (0.2 + i * 0.01), box.y + box.height * 0.7);
  await q.mouse.up();
  await q.waitForTimeout(300);
  expect(await q.evaluate(() => performance.getEntriesByName('flight-frame').length), 'dots moved under reduced motion').toBe(0);
  await still.close();
});

test('a tap bursts the dots and shows the count there; a finger that scrolls does neither', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, reducedMotion: 'no-preference', viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await settledHome(page);
  const dots = page.locator('.hero-dots');
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const at = { x: plot.x + plot.width * 0.3, y: plot.y + plot.height * 0.75 };
  // A scroll gesture first: down, 40px of travel, up — its moves carrying the button a touch contact
  // reports, so a stir that took any pointer with a button held would throw dots here.
  await page.locator('.hero-dist-main').evaluate((el, p) => {
    const ev = (type: string, y: number) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, buttons: 1, clientX: p.x, clientY: y });
    el.dispatchEvent(ev('pointerdown', p.y));
    for (let k = 1; k <= 4; k++) el.dispatchEvent(ev('pointermove', p.y + 10 * k));
    el.dispatchEvent(ev('pointerup', p.y + 40));
  }, at);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => performance.getEntriesByName('flight-frame').length), 'a scrolling finger threw dots').toBe(0);
  // A tap.
  await page.touchscreen.tap(at.x, at.y);
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 1500 });
  expect(await page.evaluate(() => performance.getEntriesByName('flight-frame').length), 'the tap threw nothing').toBeGreaterThan(5);
  await expect(page.locator('.chart-value-pill').first()).toBeVisible();
  await expect(page.locator('.chart-value-pill').first()).toContainText(/people ±\$5k/);
  await expect(page).toHaveURL(/\/UW-Madison_Salaries\/$/);
  await ctx.close();
});

test('"Drop again" plays the fall once more; there is none under reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await settledHome(page);
  await page.evaluate(() => performance.clearMeasures());
  await page.locator('.hero-dist-drop').click();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'false');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 5000 });
  const frames = await page.evaluate(() => performance.getEntriesByName('dot-frame').length);
  expect(frames, 'the fall did not play').toBeGreaterThan(10);
  await ctx.close();

  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const q = await still.newPage();
  await settledHome(q);
  await expect(q.locator('.hero-dist-drop')).toHaveCount(0);
  await still.close();
});

test('soloing a category leaves exactly its people, and the readout counts them; again, everyone', async ({ browser }) => {
  const cats = await categories();
  const faculty = cats.findIndex((c) => c.cat === 'Faculty');
  expect(faculty, 'the categories include Faculty').toBeGreaterThanOrEqual(0);
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await settledHome(page);
  const dots = page.locator('.hero-dots');
  const all = (await dots.getAttribute('data-dots'))!;
  const item = page.locator('.hero-dist-legend-item[data-category="Faculty"]');
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(dots).toHaveAttribute('data-solo', String(faculty));
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 5000 });
  await expect(dots).toHaveAttribute('data-visible', String(cats[faculty].und));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-visible', String(cats[faculty].ovr));
  // Nothing of the others is drawn: no pixel of the Academic Staff ink is left on the canvas.
  const academic = parseColor((await dots.getAttribute('data-inks'))!.split('|')[cats.findIndex((c) => c.cat === 'Academic Staff')]);
  const left = await page.locator('.hero-dots canvas').evaluate((c: HTMLCanvasElement, ink) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 180 && Math.abs(d[i] - ink[0]) + Math.abs(d[i + 1] - ink[1]) + Math.abs(d[i + 2] - ink[2]) < 24) n++;
    return n;
  }, academic);
  expect(left, 'Academic Staff pixels left on the canvas').toBe(0);
  // The readout counts Faculty, within ±$5k of the pay under the pointer.
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  await page.mouse.move(plot.x + plot.width * 0.62, plot.y + plot.height * 0.9);
  const pill = page.locator('.chart-value-pill').first();
  await expect(pill).toContainText('Faculty ±$5k');
  const text = (await pill.textContent())!;
  const bucket = Number(text.match(/^\$([\d.]+)k/)![1]) * 1000;
  const snap = await latestSnapshot();
  const [o] = await oracle<{ n: number }>(
    `WITH r AS (SELECT person_key, coalesce(employee_category, 'Other') ct, ${PAY} rp FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0),
          p AS (SELECT person_key, sum(rp) pay, first(ct ORDER BY rp DESC, ct) ct FROM r GROUP BY person_key)
     SELECT count(*) n FROM p WHERE ct = 'Faculty' AND pay >= ${bucket - 5000} AND pay < ${bucket + 6000} AND pay < 250000`
  );
  expect(Number(text.match(/· ([\d,]+) Faculty/)![1].replace(/,/g, '')), `Faculty within ±$5k of ${bucket}`).toBe(o.n);
  await expect(dots).toHaveAttribute('data-highlight', String(o.n));
  // Again: everyone back.
  await page.mouse.move(0, 0);
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', 'false');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 5000 });
  await expect(dots).toHaveAttribute('data-visible', all);
  await ctx.close();

  // Under reduced motion the change is at once, with no flight.
  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const q = await still.newPage();
  await settledHome(q);
  await q.locator('.hero-dist-legend-item[data-category="Faculty"]').click();
  await expect(q.locator('.hero-dots')).toHaveAttribute('data-visible', String(cats[faculty].und), { timeout: 1000 });
  expect(await q.evaluate(() => performance.getEntriesByName('flight-frame').length), 'the solo flew under reduced motion').toBe(0);
  await still.close();
});

test('once still again, the field is the picture it was before a stir', async ({ browser }) => {
  // While dots move, what they cross is drawn in squares; once all is still it is drawn in beads again.
  // A stir alone repaints in strips, which only the bead repaint of what they crossed puts back (a
  // click's ripple spans the field, which is repainted whole: the burst tests cover that).
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await settledHome(page);
  const before = await picture(page);
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  await page.mouse.move(plot.x - 8, plot.y + plot.height * 0.8);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(plot.x + plot.width * (0.2 + (0.1 * i) / 12), plot.y + plot.height * 0.8);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.mouse.move(plot.x + plot.width * 0.5, plot.y - 200);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-flight', 'idle', { timeout: 3000 });
  await expect.poll(async () => (await picture(page)) === before, { message: 'the field did not come back to its picture' }).toBe(true);
  await ctx.close();
});
