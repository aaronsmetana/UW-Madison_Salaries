import { test, expect, type Browser, type Page } from '@playwright/test';
import { parseColor, flatten, contrast } from './color';
import { HOME_STATS } from './homeDots';

/**
 * How the landing graph looks, past where its dots are (dots.spec.ts has that): the band of light that
 * finishes a rain, the glow under the field on a dark page, every tone a dot takes against what is really
 * behind it, the shadow the mountain stands on, and the colours of the wash beneath it. None of it may
 * change what the graph says, so what is checked is that each is there, only where it belongs, and
 * never in the way of reading a dot.
 */

async function open(browser: Browser, o: { scheme?: 'light' | 'dark'; motion?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: o.scheme ?? 'light',
    reducedMotion: o.motion ? 'no-preference' : 'reduce',
  });
  return { ctx, page: await ctx.newPage() };
}
async function settled(page: Page) {
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await unpeeked(page);
}
/** The sidebar's once-a-visit peek gone from over the plot's left end — its shadow alone took the panel
 *  from 252 to 226 there — and the pointer resting on neither. */
async function unpeeked(page: Page) {
  await page.mouse.move(1400, 200);
  await expect(page.locator('nav[data-peek]')).toHaveCount(0, { timeout: 10_000 });
}

/** Every band of light the page puts up, as it goes up: what animates it, and whether it is clipped to
 *  the area under the curve (the same outline as the wash's). Kept in the page, so a band that comes
 *  and goes between two reads is still counted. */
function watchSheens(page: Page) {
  return page.addInitScript(() => {
    const w = window as unknown as { __sheens: { anim: string; clipped: boolean }[] };
    w.__sheens = [];
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          for (const el of n.matches('.hero-dist-sheen') ? [n] : [...n.querySelectorAll('.hero-dist-sheen')]) {
            const id = el.parentElement?.getAttribute('clip-path')?.match(/url\(#(.+)\)/)?.[1];
            const clip = id ? document.getElementById(id)?.querySelector('path')?.getAttribute('d') : null;
            w.__sheens.push({ anim: getComputedStyle(el).animationName, clipped: !!clip && clip === document.querySelector('.hero-dist-floor')?.getAttribute('d') });
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const sheens = (page: Page) => page.evaluate(() => (window as unknown as { __sheens: { anim: string; clipped: boolean }[] }).__sheens);

test('when the rain lands a band of light crosses the mountain once; a burst, a stir, a solo, a re-stack and a filter bring none', async ({ browser }) => {
  const { ctx, page } = await open(browser, { motion: true });
  await watchSheens(page);
  await page.goto('./');
  const dots = page.locator('.hero-dots');
  const main = page.locator('.hero-dist-main');
  await expect(dots).toHaveAttribute('data-settled', 'false', { timeout: 30_000 });
  expect(await sheens(page), 'a band crossed before the rain had landed').toHaveLength(0);
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await expect(main).toHaveAttribute('data-sheens', '1');
  const [first] = await sheens(page);
  expect(first.anim, 'the band does not move').toBe('hero-sheen');
  expect(first.clipped, 'the band is not clipped to the area under the curve').toBe(true);
  // It crosses once and is gone.
  await expect(page.locator('.hero-dist-sheen')).toHaveCount(0, { timeout: 5_000 });

  await unpeeked(page);
  const box = (await dots.boundingBox())!;
  const away = () => page.mouse.move(box.x + box.width * 0.98, box.y - 60);
  // A burst.
  await page.mouse.click(box.x + box.width * 0.27, box.y + box.height * 0.72);
  await away();
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 10_000 });
  // A stir: pressed just left of the plot and drawn in.
  await page.mouse.move(box.x - 8, box.y + box.height * 0.72);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + (box.width * 0.4 * i) / 20, box.y + box.height * 0.72);
  await page.mouse.up();
  await away();
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 10_000 });
  // A category alone, and everyone again.
  const faculty = page.locator('.hero-dist-legend-item[data-category="Faculty"]');
  await faculty.click();
  await expect(faculty).toHaveAttribute('aria-pressed', 'true');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 5_000 });
  await faculty.click();
  await expect(faculty).toHaveAttribute('aria-pressed', 'false');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 5_000 });
  // The re-stack, to one ink and back.
  await page.locator('.hero-dist-toggle').getByText('Generic', { exact: true }).click();
  await expect(dots).toHaveAttribute('data-stack', 'off');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  await page.locator('.hero-dist-toggle').getByText('By employment type').click();
  await expect(dots).toHaveAttribute('data-stack', 'on');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  expect(await sheens(page), 'a band crossed without a rain').toHaveLength(1);

  // A rain lands in a band wherever it falls. Full page lays the field out afresh at its new size, and
  // in a session that plays the entrance the dots rain in there too (as they did before there was a band
  // to end it) — one rain, one band.
  const rained = async (n: number) => {
    await expect(dots).toHaveAttribute('data-settled', 'false');
    await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    await expect(main).toHaveAttribute('data-sheens', String(n));
    await expect(page.locator('.hero-dist-sheen')).toHaveCount(0, { timeout: 5_000 });
    const all = await sheens(page);
    expect(all, `${all.length} bands for ${n} rains`).toHaveLength(n);
    expect(all[n - 1]).toEqual({ anim: 'hero-sheen', clipped: true });
  };
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await rained(2);
  // A filter from the full page's bar, and off again: the field dims and brightens, and nothing rains.
  await page.locator('.hero-dist-full .search-bar-field input').fill('professor');
  const chip = page.locator('.hero-dist-full [role="option"][data-key^="t:"]').first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await chip.click();
  await expect(main).toHaveAttribute('data-filter', /.+/);
  await expect(dots).toHaveAttribute('data-dimmed', /.+/, { timeout: 30_000 });
  await page.locator('.search-token-x').click();
  await expect(main).not.toHaveAttribute('data-filter', /.+/);
  await expect(dots).not.toHaveAttribute('data-dimmed', /.+/);
  expect(await sheens(page), 'a filter brought a band').toHaveLength(2);
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await rained(3);

  // "Drop again" is a rain, and ends in a band of its own — one.
  await page.locator('.hero-dist-drop').click();
  await rained(4);
  await ctx.close();
});

test('under Reduce Motion there is no rain, so no band of light', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await watchSheens(page);
  await settled(page);
  await expect(page.locator('.hero-dist-main')).toHaveAttribute('data-sheens', '0');
  expect(await sheens(page)).toHaveLength(0);
  await ctx.close();
});

/** The dense core of the field, and the empty sky over its tail, in page px. */
async function places(page: Page) {
  const b = (await page.locator('.hero-dots').boundingBox())!;
  return {
    core: { x: b.x + b.width * 0.27 - 30, y: b.y + b.height * 0.72 - 20, width: 60, height: 40 },
    sky: { x: b.x + b.width * 0.7, y: b.y + 20, width: 120, height: 30 },
  };
}
const hide = (page: Page, sel: string) => page.addStyleTag({ content: `${sel} { visibility: hidden !important; }` });

for (const scheme of ['dark', 'light'] as const) {
  test(`the glow beneath the field: ${scheme === 'dark' ? 'the dense core glows on a dark page, and the sky does not' : 'none on a light page'}`, async ({ browser }) => {
    const { ctx, page } = await open(browser, { scheme });
    await settled(page);
    const at = await places(page);
    if (scheme === 'dark') {
      // Beneath the dots, not over them, where a blurred copy would soften every one: the browser's own
      // paint order at the core, topmost first. The field takes no pointer, so it is not hit-tested until
      // it does; that moves nothing in the stacking.
      await page.addStyleTag({ content: '.hero-dots, .hero-dots canvas { pointer-events: auto !important; }' });
      const order = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((e) => e.getAttribute('class') ?? e.tagName), {
        x: at.core.x + at.core.width / 2, y: at.core.y + at.core.height / 2,
      });
      const [ink, bloom] = [order.indexOf('dot-field-ink'), order.indexOf('dot-field-bloom')];
      expect(ink >= 0 && bloom >= 0, `the ink and the glow are not both under the core (${order.join(' > ')})`).toBe(true);
      expect(ink, `the glow is over the dots (${order.join(' > ')})`).toBeLessThan(bloom);
    }
    // The dots themselves out of the way: what is left over the core is the glow, if any.
    await hide(page, '.hero-dots .dot-field-ink');
    const lit = { core: await page.screenshot({ clip: at.core }), sky: await page.screenshot({ clip: at.sky }) };
    await hide(page, '.hero-dots .dot-field-bloom');
    const dark = { core: await page.screenshot({ clip: at.core }), sky: await page.screenshot({ clip: at.sky }) };
    expect(Buffer.compare(lit.sky, dark.sky), 'the glow reaches the empty sky').toBe(0);
    if (scheme === 'dark') {
      expect(Buffer.compare(lit.core, dark.core), 'no glow under the dense core').not.toBe(0);
      // And it is the field's own picture at rest: a copy of the dots, pixel for pixel.
      const same = await page.evaluate(() => {
        const [ink, bloom] = ['.hero-dots .dot-field-ink', '.hero-dots .dot-field-bloom'].map((s) => document.querySelector(s) as HTMLCanvasElement);
        return ink.toDataURL() === bloom.toDataURL();
      });
      expect(same, 'the glow is not the field as it rests').toBe(true);
    } else {
      expect(Buffer.compare(lit.core, dark.core), 'a light page glows').toBe(0);
      // Not drawn at all, not merely hidden: a light page does none of the copying.
      const inked = await page.locator('.hero-dots .dot-field-bloom').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
        return false;
      });
      expect(inked, 'the glow was drawn on a light page').toBe(false);
    }
    await ctx.close();
  });
}

test('the glow fades out while the dots move — a rain or a burst — and comes back as the field rests', async ({ browser }) => {
  const { ctx, page } = await open(browser, { scheme: 'dark', motion: true });
  await settled(page);
  const dots = page.locator('.hero-dots');
  const opacity = () => page.locator('.hero-dots .dot-field-bloom').evaluate((e) => getComputedStyle(e).opacity);
  const copied = () => page.evaluate(() => {
    const [ink, bloom] = ['.hero-dots .dot-field-ink', '.hero-dots .dot-field-bloom'].map((s) => document.querySelector(s) as HTMLCanvasElement);
    return ink.toDataURL() === bloom.toDataURL();
  });
  await expect.poll(opacity).toBe('0.55');
  await page.locator('.hero-dist-drop').click();
  await expect(dots).toHaveAttribute('data-settled', 'false');
  await expect.poll(opacity, { message: 'the glow stayed up through the rain' }).toBe('0');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
  await expect.poll(opacity).toBe('0.55');
  expect(await copied(), 'the glow is not the field the rain left').toBe(true);
  const b = (await dots.boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.27, b.y + b.height * 0.72);
  await page.mouse.move(b.x + b.width * 0.98, b.y - 60);
  await expect(dots).toHaveAttribute('data-flight', 'moving');
  await expect.poll(opacity, { message: 'the glow stayed up through the burst' }).toBe('0');
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 10_000 });
  await expect.poll(opacity).toBe('0.55');
  expect(await copied(), 'the glow is not the field the burst left').toBe(true);
  await ctx.close();
});

/** Rendered colours at points of a clip (px from its corner), from one screenshot of it. */
async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }, pts: { x: number; y: number }[]) {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async ({ png, pts, w }) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + png; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const k = img.width / w;
    return pts.map((p) => { const d = ctx.getImageData(Math.floor(p.x * k), Math.floor(p.y * k), 1, 1).data; return [d[0], d[1], d[2]]; });
  }, { png, pts, w: clip.width });
}

/** The curve's height above the plot's top at every x, in page px from the plot's corner. */
async function curveAt(page: Page) {
  const d = (await page.locator('.hero-dist-plot path').nth(1).getAttribute('d'))!;
  const box = (await page.locator('.hero-dist-plot').boundingBox())!;
  const pts = d.split(/[ML]/).filter(Boolean).map((p) => p.trim().split(',').map(Number)).map(([x, y]) => ({ x: (x * box.width) / 1000, y }));
  return (x: number) => {
    let i = 1;
    while (i < pts.length - 1 && pts[i].x < x) i++;
    const a = pts[i - 1], b = pts[i];
    return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
  };
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every tone a dot takes clears 3:1 against what lies behind it — card, backdrop, wash and floor (${scheme})`, async ({ browser }) => {
    const { ctx, page } = await open(browser, { scheme });
    await settled(page);
    const dots = page.locator('.hero-dots');
    const alpha = Number(await dots.getAttribute('data-alpha'));
    const tones = (await dots.getAttribute('data-tones'))!.split('|').flatMap((t) => t.split(';').map(parseColor));
    expect(tones.length, 'the tones are not all there').toBeGreaterThan(100);
    // Everything that is not behind a dot, out of the way: the dots, the curve and marks drawn over them,
    // and the glow — which is other dots, blurred, and bright only where they crowd, where no dot is read
    // alone. A lone dot's own glow spreads its ink over a patch some 80 times its size at about half
    // strength: well under a hundredth of its colour behind it.
    await hide(page, '.hero-dots .dot-field-ink, .hero-dots .dot-field-bloom, .hero-dist-plot');
    const main = (await page.locator('.hero-dist-main').boundingBox())!;
    const H = (await dots.boundingBox())!.height;
    const top = await curveAt(page);
    // Down every stretch of the plot, from just under the curve to the axis: where the dots are.
    const pts: { x: number; y: number }[] = [];
    for (let x = 4; x < main.width - 4; x += main.width / 90) {
      for (let y = Math.ceil(top(x)) + 3; y < H - 0.5; y += 5) pts.push({ x, y });
      pts.push({ x, y: H - 1 });
    }
    const grounds = await pixels(page, main, pts);
    // Not vacuous: the backdrop is there to be measured against, and so is the floor's shadow.
    const card = parseColor(await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor));
    const off = (g: number[]) => Math.max(...g.map((v, k) => Math.abs(v - card[k])));
    expect(Math.max(...grounds.map(off)), 'nothing behind the dots but the card').toBeGreaterThan(6);
    let worst = { c: Infinity, tone: '', at: { x: 0, y: 0 }, ground: [0, 0, 0] };
    for (const t of tones) {
      grounds.forEach((g, i) => {
        const c = contrast(flatten([t[0], t[1], t[2], t[3] * alpha], g), g);
        if (c < worst.c) worst = { c, tone: t.slice(0, 3).map(Math.round).join(','), at: pts[i], ground: g };
      });
    }
    expect(worst.c, `tone rgb(${worst.tone}) on rgb(${worst.ground.join(',')}) at ${Math.round(worst.at.x)},${Math.round(worst.at.y)}`).toBeGreaterThanOrEqual(3);
    await ctx.close();
  });
}

test("the mountain stands on a shadow: along the axis under it, in its own outline, and nowhere in the sky", async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const { ctx, page } = await open(browser, { scheme });
    await settled(page);
    const floor = page.locator('.hero-dist-floor');
    expect(await floor.getAttribute('d'), 'the shadow is not the area under the curve').toBe(await page.locator('.hero-dist-wash g > path').first().getAttribute('d'));
    const b = (await page.locator('.hero-dots').boundingBox())!;
    const base = { x: b.x + b.width * 0.2, y: b.y + b.height - 12, width: b.width * 0.2, height: 12 };
    const sky = { x: b.x + b.width * 0.2, y: b.y + 4, width: b.width * 0.2, height: 12 };
    await hide(page, '.hero-dots .dot-field-ink, .hero-dots .dot-field-bloom');
    const on = { base: await page.screenshot({ clip: base }), sky: await page.screenshot({ clip: sky }) };
    await hide(page, '.hero-dist-floor');
    const offShot = { base: await page.screenshot({ clip: base }), sky: await page.screenshot({ clip: sky }) };
    expect(Buffer.compare(on.base, offShot.base), `no shadow along the axis (${scheme})`).not.toBe(0);
    expect(Buffer.compare(on.sky, offShot.sky), `the shadow reaches the sky (${scheme})`).toBe(0);
    await ctx.close();
  }
});

/** OKLab of an sRGB colour, 0-255 channels. */
function oklab([r, g, b]: number[]) {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

test("the wash takes the colours above it: where one employment type is most of a pay's people, the wash there is nearest its ink", async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await settled(page);
  const grad = page.locator('.hero-dist-wash-hue');
  const lo = Number(await grad.getAttribute('data-from'));
  const hi = Number(await grad.getAttribute('data-to'));
  const inks = (await page.locator('.hero-dots').getAttribute('data-inks'))!.split('|').map(parseColor);
  // Each stop's colour as the browser renders it: whatever the stop was written as, painted and read back.
  const stops = await grad.evaluate((g) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    return [...g.querySelectorAll('stop')].map((s) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = getComputedStyle(s).stopColor;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { offset: Number(s.getAttribute('offset')), rgb: [d[0], d[1], d[2]] };
    });
  });
  // Restated from the artifact: who is at each stop's stretch of pay, by type.
  const { lo100, counts, categories } = HOME_STATS.pay_counts;
  expect(inks.length).toBe(categories.length);
  const S = stops.length;
  const sums = Array.from({ length: S }, () => new Array<number>(categories.length).fill(0));
  for (let b = 0; b < counts.length; b++) {
    const seg = Math.min(S - 1, Math.max(0, Math.floor((((lo100 + b) * 100 - lo) / (hi - lo || 1)) * S)));
    categories.forEach((c, k) => { sums[seg][k] += c.counts[b] ?? 0; });
  }
  const dist = (a: number[], b: number[]) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const held = new Set<number>();
  let checked = 0;
  sums.forEach((row, seg) => {
    const total = row.reduce((t, n) => t + n, 0);
    const top = row.indexOf(Math.max(...row));
    if (!total || row[top] / total < 0.6) return;
    const at = stops[seg].rgb;
    const nearest = inks.map((ink, k) => ({ k, d: dist(at, ink) })).sort((p, q) => p.d - q.d)[0].k;
    expect(nearest, `at ${Math.round(lo + (seg / S) * (hi - lo))}, ${categories[top].name} is ${Math.round((row[top] / total) * 100)}% but the wash is nearest ${categories[nearest].name}`).toBe(top);
    held.add(top);
    checked++;
  });
  expect(checked, 'too few stretches of pay held mostly by one type to say anything').toBeGreaterThanOrEqual(5);
  expect(held.size, 'the wash is one colour all along').toBeGreaterThanOrEqual(2);
  // In one ink the wash is the one accent again.
  await page.locator('.hero-dist-toggle').getByText('Generic', { exact: true }).click();
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-stack', 'off');
  await expect(grad).toHaveCount(0);
  await ctx.close();
});

/** The person the peer-strip checks visit: a large title, so the strip is full of peers. */
const KENNETH = 'kennethposs|2024-07-01';

/**
 * The full shading is the landing graph's. Given to a person's peer strip, whose dots are sparse enough that
 * nearly every one crowns its own one-pixel column, its rim lit almost every grey peer near white on a
 * dark page, over the green of the same-school peers the strip exists to pick out (measured: a grey peer
 * at 7.45:1 against the card, the quietest green at 3.30:1). On a light page the full shading darkens the
 * grey but not past the green, so there it is the look itself that is checked.
 */
for (const scheme of ['dark', 'light'] as const) {
  test(`only the landing graph wears the full shading; a peer strip's grey peers never outshine its green ones (${scheme})`, async ({ browser }) => {
    const { ctx, page } = await open(browser, { scheme });
    await settled(page);
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-look', 'rich');
    await page.goto(`./person/${encodeURIComponent(KENNETH)}`);
    const strip = page.locator('.peer-strip .strip-dots').first();
    await expect(strip).toHaveAttribute('data-tones', /./, { timeout: 60_000 });
    await expect(strip).toHaveAttribute('data-look', 'plain');
    // The card behind the strip: the first painted background up from it.
    const card = parseColor(await strip.evaluate((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c !== 'transparent' && !/[,/]\s*0\)$/.test(c)) return c;
      }
      return 'rgb(255, 255, 255)';
    }));
    const alpha = Number(await strip.getAttribute('data-alpha'));
    // Kind 0 is a peer at another school, in grey; kind 1 one at the same school, in green.
    const [grey, green] = (await strip.getAttribute('data-tones'))!.split('|')
      .map((t) => t.split(';').map((c) => { const [r, g, b, a] = parseColor(c); return contrast(flatten([r, g, b, a * alpha], card), card); }));
    expect(green, 'the strip has no same-school tones').toBeTruthy();
    const [loudest, quietest] = [Math.max(...grey), Math.min(...green)];
    expect(loudest, `a grey peer stands out from the card more than a green one (${loudest.toFixed(2)}:1 against ${quietest.toFixed(2)}:1)`).toBeLessThan(quietest);
    await ctx.close();
  });
}

/**
 * A filter's own line over a large group — the School of Medicine is a quarter of the field lit — crossed
 * dots of every colour, and read as one more speckle among them. It is drawn over a casing: the same path,
 * wider, in the panel's own colour, so the dashes cross one quiet channel. Checked where it is drawn: along
 * the line, the dots' ink is pulled to the panel's colour by the casing's own opacity, and the dashes stand
 * out from that channel as text does from the page.
 */
for (const scheme of ['dark', 'light'] as const) {
  test(`a filter's line runs in a channel of the panel's own colour through the dots (${scheme})`, async ({ browser }) => {
    const { ctx, page } = await open(browser, { scheme });
    await settled(page);
    await page.locator('.hero-dist-full-toggle').click();
    await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
    const box = page.locator('.hero-dist-full .search-bar-field input');
    await box.fill('medicine');
    await page.locator('.hero-dist-full [role="option"][data-key="d:School of Medicine and Public Health"]').click({ timeout: 60_000 });
    await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
    await box.blur();
    await page.mouse.move(1430, 5);
    await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
    const curve = page.locator('.hero-dist-full .hero-dist-group-curve');
    const casing = page.locator('.hero-dist-full .hero-dist-group-casing');
    // Under the line and under its median, each the same shape as what it is under.
    await expect(casing).toHaveCount(2);
    expect(await casing.first().getAttribute('d')).toBe(await curve.getAttribute('d'));
    expect(await casing.nth(1).getAttribute('x1')).toBe(await page.locator('.hero-dist-full .hero-dist-group-median').getAttribute('x1'));
    const look = await page.evaluate(() => {
      const c = getComputedStyle(document.querySelector('.hero-dist-full .hero-dist-group-casing')!);
      const l = getComputedStyle(document.querySelector('.hero-dist-full .hero-dist-group-curve')!);
      // The panel's surface, resolved where the panel is: the page behind it is a darker canvas.
      const probe = document.createElement('span');
      probe.style.color = 'var(--mantine-color-body)';
      document.querySelector('.hero-dist-full')!.appendChild(probe);
      const body = getComputedStyle(probe).color;
      probe.remove();
      return { stroke: c.stroke, width: parseFloat(c.strokeWidth), opacity: parseFloat(c.strokeOpacity), line: l.stroke, lineWidth: parseFloat(l.strokeWidth), body };
    });
    expect(parseColor(look.stroke).slice(0, 3), 'the casing is not the panel’s colour').toEqual(parseColor(look.body).slice(0, 3));
    expect(look.width, 'the casing is no wider than the line').toBeGreaterThanOrEqual(look.lineWidth + 3);
    expect(look.opacity, 'the casing is too faint to quiet the dots').toBeGreaterThanOrEqual(0.8);
    // Points along the line across the field's crowded middle, and a pixel either side.
    const main = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
    const along = (await curve.evaluate((p: SVGPathElement) => {
      const L = p.getTotalLength();
      const m = p.getScreenCTM()!;
      return Array.from({ length: 240 }, (_, k) => new DOMPoint(p.getPointAtLength((L * (k + 0.5)) / 240).x, p.getPointAtLength((L * (k + 0.5)) / 240).y).matrixTransform(m));
    })).filter((q) => q.x > main.x + main.width * 0.2 && q.x < main.x + main.width * 0.6 && q.y < main.y + main.height - 4);
    const pts = along.flatMap((q) => [-2, 0, 2].map((dy) => ({ x: q.x - main.x, y: q.y + dy - main.y })));
    expect(pts.length, 'too little of the line crosses the field').toBeGreaterThan(90);
    // What is under the line: the channel, then the dots with no casing.
    await hide(page, '.hero-dist-full .hero-dist-group-curve, .hero-dist-full .hero-dist-group-median');
    const channel = await pixels(page, main, pts);
    await hide(page, '.hero-dist-full .hero-dist-group-casing');
    const bare = await pixels(page, main, pts);
    const card = parseColor(look.body);
    const off = (c: number[]) => Math.hypot(c[0] - card[0], c[1] - card[1], c[2] - card[2]);
    const inkBare = bare.reduce((t, c) => t + off(c), 0);
    const inkChannel = channel.reduce((t, c) => t + off(c), 0);
    expect(inkBare / pts.length, 'no dots under the line to quiet').toBeGreaterThan(12);
    expect(inkChannel, `the dots' ink under the line is not quieted by the casing (${Math.round(inkChannel)} of ${Math.round(inkBare)})`)
      .toBeLessThanOrEqual(inkBare * (1 - look.opacity + 0.08));
    // And the dashes against that channel read as text does.
    const mean = [0, 1, 2].map((k) => channel.reduce((t, c) => t + c[k], 0) / channel.length);
    expect(contrast(parseColor(look.line).slice(0, 3), mean), 'the line is faint against its channel').toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  });
}

test('the glow does not stay behind where the field has moved on', async ({ browser }) => {
  // The glow is a copy of the last frame the field painted, and it is not copied while the field moves
  // (too dear a frame). Left showing, what it holds is the picture the field is leaving: the whole graph,
  // blurred, standing where it used to be while its dots slide out from under it — a ghost of the old
  // graph lying over the new one. So it goes as the move starts, and is read for twice: once at the very
  // top of the move, because easing it away over the move is the same ghost more slowly, and once well
  // into it over ground the field has plainly left.
  const { ctx, page } = await open(browser, { scheme: 'dark', motion: true });
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.clock.install({ time: new Date('2026-09-12T12:00:00') });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await unpeeked(page);
  // Time stopped, so each pair of reads below is of one instant: the only thing that differs across a
  // pair is the glow itself.
  await page.clock.pauseAt(new Date('2026-09-12T12:01:00'));
  const b = (await page.locator('.hero-dots').boundingBox())!;
  /** The glow out of the way and back, rather than for good: the later reads need it showing again. */
  const glow = (on: boolean) => page.evaluate((show) => {
    const id = 'e2e-glow-off';
    document.getElementById(id)?.remove();
    if (show) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = '.hero-dots .dot-field-bloom { visibility: hidden !important; }';
    document.head.append(s);
  }, on);
  /** What the glow adds over `clip`, as bytes: nothing, and the two shots are the same file. */
  const adds = async (clip: { x: number; y: number; width: number; height: number }) => {
    const lit = await page.screenshot({ clip });
    await glow(false);
    const off = await page.screenshot({ clip });
    await glow(true);
    return Buffer.compare(lit, off) !== 0;
  };
  // At rest it is the field's own picture, so it does show: that is what makes the reads below mean
  // something.
  const field = { x: b.x, y: b.y, width: b.width, height: b.height * 0.9 };
  expect(await adds(field), 'no glow under the field at rest, so nothing here is being tested').toBe(true);

  await page.getByRole('button', { name: /at \$250k\+$/ }).click();
  await page.clock.runFor(60);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-move', 'moving');
  expect(await adds(field), 'the glow is still showing as the field sets off').toBe(false);

  await page.clock.runFor(640);
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-move', 'moving');
  // A band the graph has left: the middle of the plot, where the mountain stood and the squeezed field no
  // longer reaches. Above the baseline, so the axis and its labels stay out of it.
  const gone = { x: b.x + b.width * 0.35, y: b.y + b.height * 0.45, width: b.width * 0.3, height: b.height * 0.3 };
  const ink = await page.locator('.hero-dots .dot-field-ink').evaluate((c: HTMLCanvasElement, r) => {
    const k = c.width / (c.getBoundingClientRect().width || 1);
    const d = c.getContext('2d')!.getImageData(Math.round(r.dx * k), Math.round(r.dy * k), Math.round(r.w * k), Math.round(r.h * k)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  }, { dx: gone.x - b.x, dy: gone.y - b.y, w: gone.width, h: gone.height });
  expect(ink, 'the field has not left this band, so it proves nothing about what is left behind').toBe(0);
  expect(await adds(gone), 'the glow is still showing the graph the field has left').toBe(false);
  await ctx.close();
});
