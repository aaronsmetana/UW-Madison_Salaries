import type { Locator, Page } from '@playwright/test';

/**
 * Shared helpers for asserting a glass surface. Not a spec — Playwright's default `testMatch` is
 * `**\/*.@(spec|test).*`, so a bare `.ts` here is imported, never collected.
 *
 * These exist because the lesson in them was learned the expensive way and must not be re-learned
 * per surface: an assertion about glass that reads the HOST's transparency preference is a test of
 * the machine, not of the stylesheet. One such assertion passed on a developer Mac and failed in
 * CI, where the panel was correctly taking its `prefers-reduced-transparency` branch and the test
 * had no idea that branch existed. Emulating the preference is deterministic everywhere, and it
 * covers the fallback for free — so every glass surface gets BOTH branches asserted, always.
 */

/**
 * Emulate `prefers-reduced-transparency`. Playwright's `emulateMedia` has no key for this feature
 * yet, hence CDP. Remember to set it back to 'no-preference' if the test continues afterwards.
 */
export async function transparencyEmulator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (value: 'no-preference' | 'reduce') =>
    cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
}

export interface Surface {
  /** Resolved `backdrop-filter`, falling back to the `-webkit-` alias. */
  filter: string;
  /** Raw computed `background-color`, for error messages. */
  bg: string;
  /** Background alpha, 0–1. */
  alpha: number;
  /** Resolved `box-shadow`. */
  shadow: string;
}

/** Read the properties that decide whether something is glass. */
export function readSurface(target: Locator): Promise<Surface> {
  return target.evaluate((el) => {
    const cs = getComputedStyle(el);
    // `color-mix()` computes to `color(srgb r g b / a)`, not to `rgba()`, so read the alpha out of
    // either form rather than pattern-matching one of them.
    const bg = cs.backgroundColor;
    const slash = /\/\s*([\d.]+%?)\s*\)/.exec(bg);
    const legacy = /rgba?\(([^)]+)\)/.exec(bg);
    const alpha = slash
      ? (slash[1].endsWith('%') ? parseFloat(slash[1]) / 100 : Number(slash[1]))
      : legacy
        ? ((p) => (p.length > 3 ? Number(p[3]) : 1))(legacy[1].split(/[,\s/]+/).filter(Boolean))
        : 1;
    return {
      filter: cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter'),
      bg,
      alpha,
      shadow: cs.boxShadow,
    };
  });
}

/** CIE76 ΔE between two sRGB triples. Small enough to inline; the alternative is a dependency. */
export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const lab = ([r, g, bl]: [number, number, number]) => {
    const lin = (c: number) => (c /= 255, c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
    const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
    const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * Sample the rendered colour of single pixels, given viewport coordinates.
 *
 * Rendered rather than computed on purpose: the question a sheen has to answer is "can this be
 * seen", and compositing the token in the test would only re-derive the arithmetic the browser
 * already did — it would pass just as happily on a rule that never applied to anything.
 */
export async function samplePixels(page: Page, points: { x: number; y: number }[]): Promise<[number, number, number][]> {
  const shots: string[] = [];
  for (const { x, y } of points) {
    shots.push((await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64'));
  }
  return page.evaluate(async (list: string[]) => {
    const out: [number, number, number][] = [];
    for (const s of list) {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + s; });
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out.push([d[0], d[1], d[2]]);
    }
    return out;
  }, shots);
}

/** Force a colour scheme, the way a11y.spec.ts does. */
export async function setScheme(page: Page, scheme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-mantine-color-scheme', t);
    try { localStorage.setItem('mantine-color-scheme-value', t); } catch { /* ignore */ }
  }, scheme);
}
