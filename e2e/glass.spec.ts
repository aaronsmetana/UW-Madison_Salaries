import { test, expect } from '@playwright/test';
import { readSurface, transparencyEmulator } from './glass';

/**
 * The chart tooltip is the surface every graph in the app produces, so it is where a "sheen" reaches
 * furthest. It shipped as two byte-identical copies of one look — `.chart-tip` in app.css for the
 * eight bespoke tooltips, and `TIP_STYLE` in lib/chartStyle.ts for the five that let Recharts own the
 * markup — carrying `blur(10px)` and a tint but no specular and, more seriously, neither of the two
 * fallbacks every other glass surface in the app has.
 *
 * Both are now expressed against the same `--tip-bg` / `--tip-blur` variables, so this compares each
 * to that single source rather than to the other: if both match the variable they match each other,
 * and the failure message points at whichever one drifted.
 *
 * Deliberately not driven by hovering a chart. Recharts pre-renders `.recharts-default-tooltip`
 * inside a `visibility: hidden` wrapper and only activates it on its own internal mouse handling,
 * which does not respond reliably to a synthetic move — three separate hover strategies produced a
 * wrapper that stayed hidden. `getComputedStyle` reads a hidden element perfectly well, so the real
 * element in the real app is still what gets measured; only the theatre is skipped.
 */
test.describe('the chart tooltip', () => {
  // Explore's Retention tab mounts two Recharts tooltips, one of each kind.
  const ROUTE = './explore?tab=cohorts';

  /** Resolved value of a custom property, read off `:root`. */
  const token = (page: import('@playwright/test').Page, name: string) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  /**
   * Computed surface of a `.chart-tip`. The class is only in the DOM while a bespoke tooltip is
   * active, so mount a bare probe carrying it — the point is what the STYLESHEET resolves the class
   * to in this document, with this scheme and these media queries live.
   */
  async function classSurface(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      document.querySelector('#tip-probe')?.remove();
      const el = document.createElement('div');
      el.id = 'tip-probe';
      el.className = 'chart-tip';
      el.textContent = 'probe';
      document.body.appendChild(el);
    });
    return readSurface(page.locator('#tip-probe'));
  }

  test('resolves to one look, not two copies of it', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'networkidle' });
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible({ timeout: 60_000 });

    const bg = await token(page, '--tip-bg');
    const blur = await token(page, '--tip-blur');
    expect(bg, 'the tooltip surface is no longer defined as a token, so the two twins have nothing to share')
      .not.toBe('');

    // 1. The class the eight bespoke tooltips use.
    const klass = await classSurface(page);
    expect(klass.filter, `.chart-tip stopped reading --tip-blur (${blur})`).toMatch(/blur\(/);
    expect(klass.alpha, `.chart-tip went opaque (${klass.bg})`).toBeLessThan(0.9);
    expect(klass.shadow, '.chart-tip lost its specular — the sheen is what separates glass from a weak fill')
      .toContain('inset');

    // 2. The real Recharts-owned tooltip, styled by the TIP_STYLE object.
    const stock = page.locator('.recharts-default-tooltip').first();
    await expect(stock, 'no Recharts default tooltip is mounted on this route').toHaveCount(1);
    const inline = await readSurface(stock);

    expect(inline.bg, `the two tooltip definitions have drifted: class resolves ${klass.bg}, TIP_STYLE resolves ${inline.bg}`)
      .toBe(klass.bg);
    expect(inline.filter, `the two tooltip definitions filter differently: class ${klass.filter}, TIP_STYLE ${inline.filter}`)
      .toBe(klass.filter);
    expect(inline.shadow, 'the Recharts-owned tooltip has no specular, so the twins disagree')
      .toContain('inset');
  });

  /**
   * The fallback pair was missing outright. It matters more on a tooltip than on the hero panel: a
   * tooltip is READ, and a translucent surface with nothing filtering it puts the chart underneath
   * straight through the number the reader is trying to read.
   *
   * `TIP_STYLE` is CSS-in-JS, so a media query can never reach it directly — but the variable it
   * reads is rewritten by one, which is the whole reason the values were moved into tokens.
   */
  test('goes solid for a reader who asked for less transparency — both twins', async ({ page }) => {
    const transparency = await transparencyEmulator(page);
    await page.goto(ROUTE, { waitUntil: 'networkidle' });
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible({ timeout: 60_000 });
    const stock = page.locator('.recharts-default-tooltip').first();

    await transparency('no-preference');
    expect((await classSurface(page)).filter, 'the class stopped filtering').toMatch(/blur\(/);
    expect((await readSurface(stock)).filter, 'TIP_STYLE stopped filtering').toMatch(/blur\(/);

    await transparency('reduce');
    const klass = await classSurface(page);
    const inline = await readSurface(stock);
    expect(klass.filter, '.chart-tip still filters for a visitor who asked for less transparency').toBe('none');
    expect(klass.alpha, `.chart-tip's fallback is still translucent (${klass.bg}) — a washed-out tooltip over a chart is the worst of both`)
      .toBe(1);
    expect(inline.filter, 'TIP_STYLE still filters — the CSS-in-JS twin never got the fallback')
      .toBe('none');
    expect(inline.alpha, `TIP_STYLE's fallback is still translucent (${inline.bg})`).toBe(1);
    await transparency('no-preference');
  });
});

/**
 * SVG `<defs>` ids are document-global. Two charts sharing a literal id would both define
 * `#trend-area-grad`, and every `url(#…)` in the document would resolve to whichever mounted first —
 * so one chart would silently paint with the other's gradient, or with nothing.
 *
 * `barGradientDefs` was already called with `useId()` at all four of its sites; `lineGlowDefs` was
 * passed the literals 'trend' and 'expltrend', safe only by the accident of living on different
 * routes. This asserts the property rather than the fix: every reference resolves, and no id is
 * defined twice — which stays true however the ids are generated.
 */
test.describe('chart gradient ids', () => {
  for (const [name, route] of [
    ['explore trends', './explore?tab=trends'],
    ['explore changes', './explore?tab=changes'],
    ['explore retention', './explore?tab=cohorts'],
    // Not /compare or /paycheck: both render an empty state until something is selected, so they
    // carry no gradients and the vacuity check below (correctly) refuses them.
    ['school distribution', `./school/${encodeURIComponent('School of Medicine and Public Health')}?tab=dist`],
  ] as const) {
    test(`resolve, and none is defined twice: ${name}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2_000);

      const report = await page.evaluate(() => {
        const refs: string[] = [];
        for (const el of document.querySelectorAll('[fill],[filter],[stroke]')) {
          for (const attr of ['fill', 'filter', 'stroke']) {
            const v = el.getAttribute(attr) ?? '';
            const m = /^url\(#(.+?)\)$/.exec(v.trim());
            if (m) refs.push(m[1]);
          }
        }
        const ids = [...document.querySelectorAll('linearGradient[id], radialGradient[id], filter[id]')]
          .map((e) => e.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        const dangling = [...new Set(refs)].filter((id) => !document.getElementById(id));
        return { refs: refs.length, ids: ids.length, dupes: [...new Set(dupes)], dangling };
      });

      // A route with no gradient references would pass both checks vacuously.
      expect(report.refs, `${name} references no gradients at all — this route cannot prove anything`)
        .toBeGreaterThan(0);
      expect(report.dangling, `${name} references gradient ids that do not exist: ${report.dangling.join(', ')}`)
        .toEqual([]);
      expect(report.dupes, `${name} defines the same gradient id twice (${report.dupes.join(', ')}) — whichever mounted first wins for the whole document`)
        .toEqual([]);
    });
  }
});
