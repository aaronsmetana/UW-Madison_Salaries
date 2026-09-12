import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, latestSnapshot } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * Every employee as a dot (src/components/chart/DotField.tsx): the landing page's distribution — with
 * its pile of people above the cap, its "By category" colouring, the pointer's wake and the readout's
 * highlight — and a large peer strip. Expected values from SQL written here.
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
  await p2.goto('./');
  await expect(p2.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const frames = await p2.evaluate(() => performance.getEntriesByName('dot-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the entrance played').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(8);
  await moving.close();
});

test('the lens follows a mouse, not a finger; a tap still opens Divisions', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('./');
  const dots = page.locator('.hero-dots');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const plot = page.locator('.hero-dist-plot');
  const box = (await plot.boundingBox())!;
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.8 };

  // A finger's move: no lens.
  await plot.evaluate((el, p) => {
    el.parentElement!.parentElement!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: p.x, clientY: p.y }));
  }, at);
  await page.waitForTimeout(200);
  await expect(dots).toHaveAttribute('data-lens', 'off');

  // A mouse's: the lens, over the dots under the pointer.
  await page.mouse.move(at.x, at.y);
  await expect(dots).toHaveAttribute('data-lens', 'on');
  await expect(page.locator('.dot-field-lens')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(dots).toHaveAttribute('data-lens', 'off');

  await page.touchscreen.tap(at.x, at.y);
  await expect(page).toHaveURL(/\/explore/);
  await ctx.close();
});

test("a large title's peer strip draws each peer as a dot", async ({ page }) => {
  const snap = await latestSnapshot();
  const [r] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
     WHERE snapshot_id = '${snap}' AND job_code = 'FA020' GROUP BY person_key) WHERE pay > 0`
  );
  await page.goto(`./person/${encodeURIComponent(KENNETH)}`);
  // Everyone in the title but Kenneth, who has his own mark.
  await expect(page.locator('.strip-dots')).toHaveAttribute('data-dots', String(r.n - 1), { timeout: 60_000 });
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

async function settledHome(page: Page) {
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
async function byCategory(page: Page) {
  await page.locator('.hero-dist-toggle').getByText('By category').click();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'on');
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

test("By category colours each person by their highest-paid appointment's category, and the toggle stays put", async ({ page }) => {
  const cats = await categories();
  await settledHome(page);
  const under = await page.locator('.hero-dots').getAttribute('data-dots');
  await byCategory(page);
  // A control, not part of the link around the chart.
  await expect(page).toHaveURL(/\/UW-Madison_Salaries\/$/);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-kinds', kindsOf(cats.map((c) => c.und)));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-kinds', kindsOf(cats.map((c) => c.ovr)));
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-dots', under!);
  for (const c of cats) await expect(page.locator(`.hero-dist-legend-item[data-category="${c.cat}"]`)).toHaveAttribute('data-n', String(c.n));
  // Remembered for this viewer.
  await page.reload();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'on', { timeout: 30_000 });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every category's ink clears 3:1 as a lone dot, and its highlight differs visibly (${scheme})`, async ({ page }) => {
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
  });
}

test('the re-stack moves in frames under 8ms, and not at all under reduced motion', async ({ browser }) => {
  const moving = await browser.newContext({ reducedMotion: 'no-preference' });
  const p = await moving.newPage();
  await settledHome(p);
  await p.evaluate(() => performance.clearMeasures());
  await byCategory(p);
  const frames = await p.evaluate(() => performance.getEntriesByName('dot-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the re-stack played').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(8);
  await moving.close();

  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const q = await still.newPage();
  await settledHome(q);
  await byCategory(q);
  expect(await q.evaluate(() => performance.getEntriesByName('dot-frame').length), 'frames were animated').toBe(0);
  await still.close();
});

/** Sweeps the mouse across the plot's lower half at a steady pace. */
async function sweep(page: Page) {
  const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
  const y = plot.y + plot.height * 0.8;
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(plot.x + plot.width * (0.2 + (0.4 * i) / 30), y);
    await page.waitForTimeout(12);
  }
}

test('the wake follows a moving mouse in frames under 8ms, and settles once it stops', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await settledHome(page);
  await page.evaluate(() => performance.clearMeasures());
  await sweep(page);
  const frames = await page.evaluate(() => performance.getEntriesByName('wake-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the wake moved no dots').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(8);
  // A resting pointer leaves a calm field.
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-wake', 'idle', { timeout: 600 });
  await ctx.close();
});

test('no wake under reduced motion, or for a finger', async ({ browser }) => {
  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const p = await still.newPage();
  await settledHome(p);
  await sweep(p);
  expect(await p.evaluate(() => performance.getEntriesByName('wake-frame').length), 'the wake ran under reduced motion').toBe(0);
  await still.close();

  const touch = await browser.newContext({ hasTouch: true, reducedMotion: 'no-preference' });
  const q = await touch.newPage();
  await settledHome(q);
  const plot = (await q.locator('.hero-dist-plot').boundingBox())!;
  await q.locator('.hero-dist-plot').evaluate((el, b) => {
    for (let i = 0; i <= 20; i++) {
      el.parentElement!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: b.x + b.width * (0.2 + i / 50), clientY: b.y + b.height * 0.8 }));
    }
  }, plot);
  await q.waitForTimeout(300);
  expect(await q.evaluate(() => performance.getEntriesByName('wake-frame').length), 'the wake ran for a finger').toBe(0);
  await touch.close();
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
  // Over the pile: all of it, and the pill says so.
  const pile = (await page.locator('.hero-dist-pile').boundingBox())!;
  await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height - 6);
  await expect(pill).toContainText('people at $250k or more');
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-highlight', String(await counted()));
  await expect(page.locator('.hero-dots-over')).toHaveAttribute('data-highlight', (await page.locator('.hero-dots-over').getAttribute('data-dots'))!);
});

test('pointing changes nothing away from the pointer: no dot elsewhere dims', async ({ browser }) => {
  // Reduced motion, so no wake: what could change far from the pointer is only a dimming.
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
