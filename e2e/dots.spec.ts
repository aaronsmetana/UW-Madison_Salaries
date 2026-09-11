import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, latestSnapshot } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * Every employee as a dot (src/components/chart/DotField.tsx): the landing page's distribution and a
 * large peer strip. Expected values from SQL written here.
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
