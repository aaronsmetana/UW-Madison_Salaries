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

/**
 * The chart-card specular.
 *
 * A card holding a plotted figure is lit from its top edge; every other card in the app stays flat.
 * That distinction is the whole design: the inset highlight that once sat on all 86 bordered
 * surfaces was removed as "the single most dated thing the app was doing", and this only earns its
 * place by being narrower than that — so a test that the ~28 figure cards are lit is only half the
 * contract, and the other half is that nothing else is.
 */
test.describe('the chart-card specular', () => {
  const MARKERS = '.recharts-responsive-container, .hist-plot, .peer-strip, .chart-plot';

  /**
   * It has to be SEEN, in both schemes. `--glass-sheen` was unusable here precisely because white
   * over the white light card composites to dE 0.00 — a rule that applies, computes, and shows
   * nothing. The floor catches that; the ceiling is what keeps "restrained" enforceable, since a
   * wash past ~8 stops reading as light and starts reading as a coloured panel.
   */
  for (const scheme of ['light', 'dark'] as const) {
    test(`is actually visible on a rendered card (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto('./explore?tab=changes', { waitUntil: 'networkidle' });
      await setScheme(page, scheme);
      await page.waitForTimeout(3_000);

      const card = page.locator('.mantine-Paper-root[data-with-border]')
        .filter({ has: page.locator('.recharts-responsive-container') }).first();
      await expect(card).toBeVisible({ timeout: 60_000 });
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const box = (await card.boundingBox())!;

      // A clean strip inside the left padding: card face top to bottom, no text, no marks. The lit
      // sample sits 2px in; the reference is far enough down that the bloom has fully decayed.
      const x = Math.round(box.x + 6);
      const [lit, face] = await samplePixels(page, [
        { x, y: Math.round(box.y + 2) },
        { x, y: Math.round(box.y + 150) },
      ]);
      const d = deltaE(lit, face);

      expect(d, `the specular is invisible in ${scheme} — rgb(${lit}) against rgb(${face}) is dE ${d.toFixed(2)}, at or under the ~2.3 JND. A rule that applies and shows nothing is the white-on-white failure this token exists to avoid.`)
        .toBeGreaterThan(2.5);
      expect(d, `the specular is too strong in ${scheme} (dE ${d.toFixed(2)}) — past ~8 it stops reading as light on a surface and starts reading as a tinted card`)
        .toBeLessThan(8);
    });
  }

  /**
   * Tests the EFFECT, not the class: a card can only pass by actually resolving an inset shadow, so
   * this fails if the selector stops reaching it for any reason at all.
   *
   * The routes are chosen to exercise all four markers between them, and the assertion below
   * enforces that. An earlier version used three Explore/School routes that between them contained
   * only `.recharts-responsive-container` — so deleting `.hist-plot` from the marker set left the
   * whole suite green, which is a coverage test that does not cover.
   */
  const REACH: Array<[string, string, (p: import('@playwright/test').Page) => Promise<void>, string[]]> = [
    ['explore changes', './explore?tab=changes', async () => {}, ['recharts-responsive-container']],
    ['school distribution', `./school/${encodeURIComponent('School of Medicine and Public Health')}?tab=dist`, async () => {}, ['recharts-responsive-container']],
    /**
     * SalaryHistogram is the only source of `.hist-plot`, and it needs a title chosen.
     *
     * KNOWN GAP, stated rather than papered over: deleting `.hist-plot` from the rule does NOT fail
     * this test. Above 60 holders the histogram renders through Recharts, so its card is already
     * matched by `.recharts-responsive-container` and the marker is redundant. It is only
     * load-bearing on the unit-mode path (`MAX_FOR_UNIT_MODE = 60` in SalaryHistogram), which draws
     * absolutely-positioned divs and no Recharts container at all — and no title reachable through
     * the picker in a test lands under that threshold (the rarest the dropdown offers has 75, and
     * filtering the list renders no histogram to select). So `.hist-plot` stays in the set because
     * it is correct for that path, not because anything here proves it.
     */
    ['titles with a title', './paycheck', async (p) => {
      const title = p.getByRole('textbox', { name: 'Title' });
      await expect(title).toBeVisible({ timeout: 60_000 });
      await title.click();
      const first = p.getByRole('option').first();
      await expect(first).toBeVisible({ timeout: 30_000 });
      await first.click();
      await expect(p.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
    }, ['hist-plot']],
    // PeerStrip on the overview tab; PercentileBar (`.chart-plot`) on the pay tab.
    ['person', './', async (p) => {
      await p.getByRole('combobox', { name: 'Search a person' }).fill('Kenneth Poss');
      await p.getByRole('option').first().click();
      await expect(p.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });
    }, ['peer-strip']],
    ['person pay tab', './', async (p) => {
      await p.getByRole('combobox', { name: 'Search a person' }).fill('Kenneth Poss');
      await p.getByRole('option').first().click();
      await expect(p.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });
      await p.getByRole('tab', { name: 'Pay & standing' }).click();
      await expect(p.locator('.chart-plot').first()).toBeVisible({ timeout: 30_000 });
    }, ['chart-plot']],
  ];

  for (const [name, route, prepare, expectMarkers] of REACH) {
    test(`reaches every card holding a figure: ${name}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await prepare(page);
      await page.waitForTimeout(2_500);

      // The marker this route exists to exercise must actually be here, or dropping it from the
      // rule would leave this test green — which is the bug this list was rewritten to fix.
      for (const marker of expectMarkers) {
        expect(
          await page.locator('.' + marker).filter({ visible: true }).count(),
          `${name} was chosen to cover .${marker} and does not contain one`,
        ).toBeGreaterThan(0);
      }

      const report = await page.evaluate((sel) => {
        const cards = new Map<Element, string>();
        for (const plot of document.querySelectorAll(sel)) {
          const card = plot.closest('.mantine-Paper-root[data-with-border]');
          if (!card || card.getBoundingClientRect().height === 0) continue;
          cards.set(card, card.querySelector('h2, h3, .mantine-Title-root')?.textContent?.trim() ?? '(untitled)');
        }
        const unlit: string[] = [];
        for (const [card, title] of cards) {
          if (!getComputedStyle(card).boxShadow.includes('inset')) unlit.push(title);
        }
        return { total: cards.size, unlit };
      }, MARKERS);

      expect(report.total, `${name} has no figure cards, so it cannot prove the rule reaches anything`)
        .toBeGreaterThan(0);
      expect(report.unlit, `${name}: ${report.unlit.length} of ${report.total} figure cards are unlit — ${report.unlit.join(' | ')}`)
        .toEqual([]);
    });
  }

  /**
   * `.report-brief` is a bordered Card that WRAPS two chart cards, so an unqualified `:has()` would
   * light the whole 2,000px report sheet as well as the figures inside it. It is the only such
   * wrapper today; this is what notices if a second one appears.
   */
  test('does not light a card that merely contains a figure card', async ({ page }) => {
    await page.goto('./reports?type=comparison', { waitUntil: 'networkidle' });
    const search = page.getByPlaceholder('Search yourself by name to begin…');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill('Kenneth Poss');
    const hit = page.getByRole('option').first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    const brief = page.locator('.report-brief');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    const shadow = await brief.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow, 'the report sheet is lit as though it were itself a figure — it only contains them')
      .not.toContain('inset');

    // ...and the figure cards inside it still are.
    const inner = await page.evaluate(() => {
      const c = document.querySelector('.report-brief .recharts-responsive-container')
        ?.closest('.mantine-Paper-root[data-with-border]');
      return c ? getComputedStyle(c).boxShadow : '(no chart card inside the brief)';
    });
    expect(inner, 'excluding the report sheet also switched off the figure cards inside it')
      .toContain('inset');
  });
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
