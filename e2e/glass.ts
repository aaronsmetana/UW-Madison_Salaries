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
