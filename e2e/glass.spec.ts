import { test, expect } from '@playwright/test';
import { deltaE, readSurface, samplePixels, setScheme, transparencyEmulator } from './glass';

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
 * The glow filter was once passed the literals 'trend' and 'expltrend', safe only by the accident of
 * living on different routes. This asserts the property rather than the fix: every reference
 * resolves, and no id is defined twice — which stays true however the ids are generated.
 */
test.describe('chart gradient ids', () => {
  // The two trend charts are what still define a gradient (the wash under the line, `areaGradDef`):
  // the bars went flat and the glow line went, so the changes, retention and school-distribution
  // routes now carry none and the vacuity check below would (correctly) refuse them.
  for (const [name, route] of [
    ['explore trends', './explore?tab=trends'],
    ['person trend', `./person/${encodeURIComponent('aaronsmetana|2014-10-15')}?tab=trends`],
  ] as const) {
    test(`resolve, and none is defined twice: ${name}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });

      const read = () => page.evaluate(() => {
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

      // The charts draw only once DuckDB has booted and answered, and on a slow runner the network
      // goes quiet while the wasm is still compiling — a fixed 2s after networkidle once read the
      // changes tab with nothing drawn. Wait for the references to appear and then hold still, since
      // the charts mount one after another (4, then 35 on the changes tab).
      let report = await read();
      await expect.poll(async () => {
        const prev = report.refs;
        report = await read();
        return report.refs > 0 && report.refs === prev;
      }, { message: `${name} references no gradients at all — this route cannot prove anything`, timeout: 60_000, intervals: [1_000] })
        .toBe(true);

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

/**
 * Home's hero distribution was the one chart bypassing `chartDefs` entirely: hand-written stops under a
 * hardcoded id. Its fill is the people themselves now, a square each on one canvas (StrataField), and it
 * defines no gradient at all — no wash to drift from the shared `areaGradDef`.
 */
test('the hero distribution draws its people as squares, with no area fill of its own', async ({ page }) => {
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  await expect(page.locator('.hero-dots canvas.strata-base')).toHaveCount(1);
  await expect(page.locator('.hero-dist linearGradient, .hero-dist radialGradient')).toHaveCount(0);
});

/**
 * The plot surface.
 *
 * A chart card used to carry a bloom across its whole face — an inset shadow lit from the top edge,
 * over the title and the footer as much as the plot. What a chart needs is narrower: the rectangle
 * where its data lives, marked off from the card by a faint tint (`GRID`'s `fill`, `--plot-surface`).
 */
test.describe('the plot surface', () => {
  /**
   * It has to be SEEN, in both schemes, and stay faint. The floor is the ~2.3 JND: a token that
   * applies and composites to nothing is the white-on-white failure. The ceiling keeps it a surface
   * rather than a band a reader might take for data.
   */
  for (const scheme of ['light', 'dark'] as const) {
    test(`is visible and faint (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto('./explore?tab=changes', { waitUntil: 'networkidle' });
      await setScheme(page, scheme);
      const card = page.locator('.raise-dist-card');
      await expect(card.locator('.recharts-cartesian-grid-bg')).toBeAttached({ timeout: 60_000 });
      // Centred, not merely in view: at the top edge the sticky header covers the plot, and both
      // samples read the header's white.
      await card.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(1_000);
      const cardBox = (await card.boundingBox())!;
      const plot = (await card.locator('.recharts-cartesian-grid-bg').boundingBox())!;
      // Between the plot's top two gridlines, just inside its left edge (no bar starts there — the
      // first bin is the "< −10%" catch-all), against the card face in its left padding.
      // Inside the plot only: a capped chart draws one gridline above it.
      const lines = (await card.locator('.recharts-cartesian-grid-horizontal line').evaluateAll((ls) =>
        ls.map((l) => l.getBoundingClientRect().y).sort((a, b) => a - b)))
        .filter((ly) => ly >= plot.y && ly <= plot.y + plot.height);
      expect(lines.length, 'the chart drew fewer than two gridlines in its plot').toBeGreaterThanOrEqual(2);
      const y = Math.round((lines[0] + lines[1]) / 2);
      // Nothing but the card in front of either point: not the sticky header, not a tooltip.
      const hits = await page.evaluate(([px, fx, yy]) => [px, fx].map((x) =>
        document.elementFromPoint(x, yy)?.closest('.raise-dist-card') ? 'card' : 'covered'), [Math.round(plot.x + 3), Math.round(cardBox.x + 6), y]);
      expect(hits, 'the samples are not on the card').toEqual(['card', 'card']);
      // Read again until the chart has settled in the scheme: on a slow runner the first reading caught the
      // plot before its surface was painted (dE 0 against the card), which is not what a reader sees.
      let inside: [number, number, number] = [0, 0, 0], face: [number, number, number] = [0, 0, 0], d = 0;
      await expect.poll(async () => {
        [inside, face] = await samplePixels(page, [
          { x: Math.round(plot.x + 3), y },
          { x: Math.round(cardBox.x + 6), y },
        ]);
        return (d = deltaE(inside, face));
      }, { message: `the plot surface is invisible in ${scheme}`, timeout: 10_000, intervals: [250] }).toBeGreaterThan(2.3);
      expect(d, `the plot surface is too strong in ${scheme} (dE ${d.toFixed(2)}): past ~6 it reads as a band, not a surface`)
        .toBeLessThan(6);
    });
  }

  /**
   * Every Recharts grid has one, and it lies under the data — with no tick marks or value-axis rule
   * drawn over it (app.css). A chart that spreads its own grid
   * props instead of `GRID` would lose it; a grid drawn after a reference area paints the tint over
   * it — the person trend's title-era bands sat under the grid until it moved first.
   */
  for (const [name, route, charts] of [
    ['explore changes', './explore?tab=changes', 2],
    ['person trend', `./person/${encodeURIComponent('aaronsmetana|2014-10-15')}?tab=trends`, 2],
  ] as const) {
    test(`is on every grid, under the marks, and the card itself is not lit: ${name}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      // Every chart drawn, with its data: a chart puts up its grid before its query returns and its
      // ticks after, and on a slow CI runner the first grid stood tickless for over two seconds — a
      // fixed wait read that as "no tick marks rendered". Wait for the ticks themselves.
      await expect.poll(() => page.evaluate(() => {
        const withGrid = [...document.querySelectorAll('.recharts-wrapper')].filter((w) => w.querySelector('.recharts-cartesian-grid'));
        return withGrid.filter((w) => w.querySelector('.recharts-cartesian-axis-tick')).length;
      }), { timeout: 60_000, message: `${name}: fewer than ${charts} charts drew their ticks` }).toBeGreaterThanOrEqual(charts);
      const report = await page.evaluate(() => {
        const grids = [...document.querySelectorAll<SVGGElement>('.recharts-cartesian-grid')];
        const bare = grids.filter((g) => !g.querySelector('.recharts-cartesian-grid-bg')).length;
        const over: string[] = [];
        for (const g of grids) {
          const svg = g.ownerSVGElement!;
          for (const m of svg.querySelectorAll('.recharts-reference-area, .recharts-bar, .recharts-line, .recharts-area')) {
            if (m.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) over.push(m.getAttribute('class') ?? '');
          }
        }
        const lit = grids.map((g) => g.closest('.mantine-Paper-root[data-with-border]'))
          .filter((c) => c && getComputedStyle(c).boxShadow.includes('inset')).length;
        const all = (sel: string) => [...document.querySelectorAll(sel)];
        const shown = (sel: string) => all(sel).filter((e) => getComputedStyle(e).display !== 'none').length;
        return {
          grids: grids.length, bare, over, lit,
          tickLines: all('.recharts-cartesian-axis-tick-line').length,
          ticksShown: shown('.recharts-cartesian-axis-tick-line'),
          yRules: shown('.recharts-yAxis .recharts-cartesian-axis-line'),
          xRules: shown('.recharts-xAxis .recharts-cartesian-axis-line'),
        };
      });
      expect(report.grids, `${name} drew no grid, so it cannot prove anything`).toBeGreaterThan(0);
      expect(report.bare, `${name}: ${report.bare} of ${report.grids} grids have no plot surface`).toBe(0);
      expect(report.over, `${name}: the plot surface is painted over ${report.over.join(', ')}`).toEqual([]);
      expect(report.lit, `${name}: a chart card carries an inset bloom again — the surface belongs to the plot`).toBe(0);
      // The gridlines and the surface carry the scale, so the axes draw no second copy of it: no tick
      // marks, and no rule up the value axis. The category axis keeps the baseline the marks stand on.
      expect(report.tickLines, `${name} renders no tick marks, so hiding them cannot be checked`).toBeGreaterThan(0);
      expect(report.ticksShown, `${name}: tick marks are drawn again`).toBe(0);
      expect(report.yRules, `${name}: the value axis has its rule again`).toBe(0);
      expect(report.xRules, `${name}: the baseline under the marks is gone`).toBeGreaterThan(0);
    });
  }
});

/**
 * Elevation in dark mode.
 *
 * All three tiers in theme.ts are `rgba(16, 24, 32, …)` — a dark ink picked against a white page and
 * never redefined for dark, where the canvas is #08090b. So the selection tray and the back-to-top
 * button, whose entire job is to read as floating over the page, had no elevation cue at all.
 *
 * The assertion is about the INK, not about the strings being unequal: two different-but-equally-
 * invisible values would pass a string comparison. A shadow only separates a surface from its
 * background by being darker than it, so that is what gets measured.
 */
test.describe('dark-mode elevation', () => {
  const parseInk = (shadow: string): [number, number, number] | null => {
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(shadow);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const relLum = ([r, g, b]: [number, number, number]) => {
    const f = (c: number) => (c /= 255, c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  test('is not ink the canvas swallows', async ({ page }) => {
    await page.goto('./', { waitUntil: 'networkidle' });

    const read = () => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        lg: cs.getPropertyValue('--mantine-shadow-lg').trim(),
        md: cs.getPropertyValue('--mantine-shadow-md').trim(),
        merged: cs.getPropertyValue('--shadow-merged-card').trim(),
        page: cs.getPropertyValue('--page-bg').trim(),
      };
    });

    await setScheme(page, 'light');
    const light = await read();
    await setScheme(page, 'dark');
    const dark = await read();

    expect(dark.lg, 'the dark canvas is still using the light theme shadow')
      .not.toBe(light.lg);
    expect(dark.merged, 'the merged input+menu shadow has no dark value, so it is the one floating surface still invisible')
      .not.toBe(light.merged);

    // The real property: on a #08090b canvas a shadow must be darker than the page to read at all.
    const pageRgb = await page.evaluate(() => {
      const c = document.createElement('div');
      c.style.background = getComputedStyle(document.documentElement).getPropertyValue('--page-bg');
      document.body.appendChild(c);
      const v = getComputedStyle(c).backgroundColor;
      c.remove();
      const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number] : null;
    });
    expect(pageRgb, 'could not resolve the dark page background').not.toBeNull();

    for (const [name, value] of [['lg', dark.lg], ['md', dark.md], ['merged', dark.merged]] as const) {
      const ink = parseInk(value);
      expect(ink, `could not read an ink colour out of the dark ${name} shadow: ${value}`).not.toBeNull();
      expect(
        relLum(ink!),
        `the dark ${name} shadow (${value}) is not darker than the #08090b canvas it casts on — this is the defect, not a lighter version of it`,
      ).toBeLessThan(relLum(pageRgb!));
    }
  });
});

/**
 * The compare set, floating over the foot of every page: the page's inverse, as a chart's readout is.
 * It was glass (a 55% tint over a blur) until the person-page redesign; an ink pill is opaque, so what
 * it must still prove is that it reads as floating (its shadow; in dark, the raised surface and its
 * edge, since an ink pill on a near-black page would not be seen) and that every word on it is
 * readable on the ground it sits on, a chip's faint white and the two filled buttons included.
 */
test.describe('the compare bar', () => {
  const AARON = 'aaronsmetana|2014-10-15';
  const SET = encodeURIComponent([
    ['p', encodeURIComponent(AARON), encodeURIComponent('Aaron Smetana')].join(','),
    ['p', encodeURIComponent('adamkoch|2009-05-26'), encodeURIComponent('Adam Koch')].join(','),
  ].join('|'));

  /** Aaron and Adam in the set (Compare's link puts them there), then Aaron's page under the bar. */
  async function fill(page: import('@playwright/test').Page) {
    await page.goto(`./compare?sel=${SET}`, { waitUntil: 'networkidle' });
    await page.goto(`./person/${encodeURIComponent(AARON)}`, { waitUntil: 'networkidle' });
    const bar = page.getByRole('region', { name: 'Compare set' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    return bar;
  }

  const lum = ([r, g, b]: number[]) => {
    const f = (c: number) => (c /= 255, c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  for (const scheme of ['light', 'dark'] as const) {
    test(`is the page's inverse, solid and floating (${scheme})`, async ({ page }) => {
      const bar = await fill(page);
      await setScheme(page, scheme);
      await page.waitForTimeout(500);
      const s = await readSurface(bar);
      expect(s.alpha, `the bar is see-through (${s.bg})`).toBe(1);
      expect(s.filter === '' || s.filter === 'none', `the bar still blurs the page (${s.filter})`).toBe(true);
      const nums = (v: string) => (v.match(/-?[\d.]+px/g) ?? []).join(' ');
      expect(nums(s.shadow), `the bar lost its float shadow (${s.shadow})`).toContain('0px 12px 32px 0px');

      const grounds = await bar.evaluate((el) => {
        // `color-mix()` computes to `color(srgb r g b)`, its channels 0–1.
        const rgb = (c: string) => {
          const n = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          return c.startsWith('color(') ? n.map((v) => v * 255) : n;
        };
        const body = getComputedStyle(document.body).backgroundColor;
        // The bar's 1px edge: the first shadow, a spread with no offset or blur.
        const edge = /^(rgba?\([^)]*\)|transparent) 0px 0px 0px 1px/.exec(getComputedStyle(el).boxShadow)?.[1] ?? '';
        return { bar: rgb(getComputedStyle(el).backgroundColor), page: rgb(body), edge };
      });
      if (scheme === 'light') {
        // Ink on a light page: the darkest thing on it.
        expect(lum(grounds.bar), `the bar is not ink (rgb(${grounds.bar}))`).toBeLessThan(0.02);
      } else {
        // Dark: the raised surface, lighter than the page, with an edge that shows.
        expect(lum(grounds.bar), 'the dark bar is not lighter than the page it floats on').toBeGreaterThan(lum(grounds.page));
        expect(deltaE(grounds.bar as [number, number, number], grounds.page as [number, number, number]), 'the dark bar is lost on the page').toBeGreaterThan(3);
        const alpha = /^rgba\(.*,\s*([\d.]+)\)$/.exec(grounds.edge)?.[1];
        expect(grounds.edge.startsWith('rgb(') || Number(alpha) >= 0.1, `the dark bar has no edge (${grounds.edge})`).toBe(true);
      }
    });

    test(`every word on it is readable on its own ground (${scheme})`, async ({ page }) => {
      const bar = await fill(page);
      await setScheme(page, scheme);
      await page.waitForTimeout(500);
      // Each word's ground: its own and every ancestor's background, laid over one another from the bar
      // down (a chip is a faint white over the ink).
      const pairs = await bar.evaluate((root) => {
        // `rgb()`, `rgba()`, or what `color-mix()` computes to, `color(srgb r g b / a)` with channels 0–1.
        const parse = (c: string) => {
          const n = (c.match(/[\d.]+/g) ?? []).map(Number);
          const k = c.startsWith('color(') ? 255 : 1;
          return { rgb: n.slice(0, 3).map((v) => v * k), a: c.startsWith('rgba') || c.includes('/') ? (n[3] ?? 1) : c === 'transparent' ? 0 : 1 };
        };
        const out: { text: string; ink: number[]; ground: number[] }[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement!;
          const text = (n.textContent ?? '').trim();
          if (!text || !el.checkVisibility({ visibilityProperty: true }) || el.closest('[data-disabled]')) continue;
          const layers: { rgb: number[]; a: number }[] = [];
          for (let a: Element | null = el; a; a = a.parentElement) {
            const l = parse(getComputedStyle(a).backgroundColor);
            if (l.a > 0) layers.push(l);
            if (l.a >= 1 || a === root) break;
          }
          let g = [255, 255, 255];
          for (const l of layers.reverse()) g = g.map((c, i) => l.rgb[i] * l.a + c * (1 - l.a));
          out.push({ text, ink: parse(getComputedStyle(el).color).rgb, ground: g });
        }
        return out;
      });
      expect(pairs.map((p) => p.text), 'the bar shows its count, both names, Clear, Compare and Raise case')
        .toEqual(expect.arrayContaining(['Compare set', 'Aaron Smetana', 'Adam Koch', 'Clear', 'Compare', 'Raise case']));
      const low = pairs.map((p) => {
        const [x, y] = [lum(p.ink), lum(p.ground)];
        return { text: p.text, ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) };
      }).filter((p) => p.ratio < 4.5).map((p) => `"${p.text}" ${p.ratio.toFixed(2)}:1`);
      expect(low, `words under 4.5:1 on the ${scheme} bar`).toEqual([]);
    });
  }

  test('lists the set, says what it can build, and clears with an undo', async ({ page }) => {
    const bar = await fill(page);
    // No star: the raise case's subject is chosen in its own setup, not here.
    await expect(bar.getByRole('button', { name: /subject|primary|star/i })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Remove Aaron Smetana' })).toBeVisible();
    const kase = bar.getByRole('link', { name: 'Raise case' });
    // The case starts from these people, in its link; the set itself is never the case's to change.
    await expect(kase).toHaveAttribute('href', /\/reports\?type=comparison&sel=p%2C/);
    await expect(bar.getByRole('link', { name: 'Compare' })).not.toHaveAttribute('aria-disabled', 'true');

    await bar.getByRole('button', { name: 'Clear' }).click();
    await expect(bar).toContainText('Compare set cleared');
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(bar.getByRole('button', { name: 'Remove Aaron Smetana' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Remove Adam Koch' })).toBeVisible();

    // With both in the set, its first person (Aaron, not Adam) is the raise case's subject: the report
    // writes it into its link. (Reports, like Compare, hides the bar.)
    await kase.click();
    await expect(page).toHaveURL(/\/reports\?.*subject=aaronsmetana%7C2014-10-15/, { timeout: 30_000 });
    await expect(bar).toBeHidden();
    await page.goBack();

    // One person: nothing to compare yet, though a raise case can still be built for them.
    await bar.getByRole('button', { name: 'Remove Adam Koch' }).click();
    await expect(bar.getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-disabled', 'true');
    await expect(kase).not.toHaveAttribute('aria-disabled', 'true');
  });
});
