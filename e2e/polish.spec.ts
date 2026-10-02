import { test, expect, type Page } from '@playwright/test';

/**
 * The polish sweep: properties measured on every page as rendered, each held to its one value or its
 * short scale (plan "Polish: how to evaluate it"). Measured first, they had drifted as the type sizes had
 * (typescale.spec): three greens for "up", three near-blacks, two body line heights, four eyebrow
 * letter-spacings, paragraphs 185 characters wide, fields with no focus ring. A rendered check catches
 * what a source search cannot: a Mantine default, a colour resolved through three variables, a size set
 * by a stylesheet.
 *
 * Every page state the app has, at 1440x900, in both schemes where colour is the question: inks, body line
 * height, eyebrows, figures, running text, card shadows, corners, control heights, icon sizes, focus rings.
 * Motion is held by src/lib/motion.test.ts, which reads the stylesheet.
 */

const AARON = encodeURIComponent('aaronsmetana|2014-10-15');
const SMPH = encodeURIComponent('School of Medicine and Public Health');
const TRAY = encodeURIComponent([
  ['p', encodeURIComponent('aaronsmetana|2014-10-15'), encodeURIComponent('Aaron Smetana')].join(','),
  ['p', encodeURIComponent('adamkoch|2009-05-26'), encodeURIComponent('Adam Koch')].join(','),
].join('|'));

export const PAGES: [string, string][] = [
  ['home', './'],
  ['person', `./person/${AARON}`],
  ['person, pay & standing', `./person/${AARON}?tab=pay`],
  ['person, salary trend', `./person/${AARON}?tab=trends`],
  ['person, history', `./person/${AARON}?tab=history`],
  ['a title', './paycheck?code=IT040'],
  ['Divisions', './explore'],
  ['Divisions, trends', './explore?tab=trends'],
  ['Divisions, changes', './explore?tab=changes'],
  ['Divisions, titles', './explore?tab=titles'],
  ['a division', `./school/${SMPH}`],
  ['Compare', `./compare?sel=${TRAY}`],
  ['Compare, empty', './compare'],
  ['Raises', `./raises?sch=${SMPH}&dept=Neurology`],
  ['Reports, one person', `./reports?type=person&person=${AARON}`],
  ['Reports, raise case', `./reports?type=comparison&subject=${AARON}`],
  ['Screening', './screening?run=1&flag=below-min'],
  // With people in the tray, so its bar (and its grey "Clear") is on the page.
  ['Screening, with the tray', './screening?run=1&flag=below-min'],
  ['Data', './data'],
  ['not found', './nope'],
];

/** Page states that need people in the tray first. */
const TRAY_FIRST = new Set(['Reports, raise case', 'Screening, with the tray']);

/** Loaded: nothing visibly loading for a second (spinners, skeletons, the loading bar), fonts in. */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const w = window as unknown as { quiet?: number };
    const now = performance.now();
    const busy = [...document.querySelectorAll('.global-loading-bar, .mantine-Loader-root, .mantine-Skeleton-root')]
      .some((e) => e.getBoundingClientRect().width > 0 && (e as HTMLElement).checkVisibility({ visibilityProperty: true }));
    if (busy) { w.quiet = now; return false; }
    w.quiet ??= now;
    return now - w.quiet >= 1000;
  }, null, { timeout: 60_000, polling: 100 });
}

/** Text that is drawn: in the page, not in a chart's SVG, not disabled, visible and not see-through. */
function drawnText() {
  const out: { el: Element; text: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim();
    const el = n.parentElement;
    if (!text || !el || el.closest('svg, :disabled, [data-disabled], .visually-hidden, .skip-link')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    out.push({ el, text });
  }
  return out;
}

/** The inks text may be in, resolved from the page's own tokens in the scheme it is showing. */
async function textOffTokens(page: Page) {
  return page.evaluate(`(() => {
    const drawn = (${drawnText.toString()})();
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const ink = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
    // The ink, the dimmed grey, the faint label grey, a link's teal and accent text, up, down, caution, white
    // on a fill, and the words on the person's own colour (their name's pill: near-black on dark's teal).
    const allowed = new Set(['--mantine-color-text', '--mantine-color-dimmed', '--text-faint', '--mantine-color-anchor', '--text-accent', '--mark-self-on',
      '--text-pos', '--text-neg', '--text-warn', '--mantine-color-white'].map(ink));
    probe.remove();
    const off = {};
    for (const { el, text } of drawn) {
      const c = getComputedStyle(el).color;
      if (allowed.has(c)) continue;
      const k = c + ' ' + el.tagName.toLowerCase() + '.' + ([...el.classList].find((x) => x.startsWith('mantine-')) ?? el.classList[0] ?? '');
      off[k] ??= text.slice(0, 30);
    }
    return Object.entries(off).map(([k, t]) => k + ' "' + t + '"');
  })()`) as Promise<string[]>;
}

async function setScheme(page: Page, scheme: 'light' | 'dark') {
  await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
  // Past colour transitions, Mantine's own included (its segmented labels ease over 200ms).
  await page.waitForTimeout(500);
}

test.use({ viewport: { width: 1440, height: 900 } });

for (const [name, route] of PAGES) {
  test(`${name}: one ink per meaning, one body spacing, one eyebrow, one figure weight, readable lines`, async ({ page }) => {
    // A raise case is built from the tray: Compare's link puts Aaron and Adam in it.
    if (TRAY_FIRST.has(name)) {
      await page.goto(`./compare?sel=${TRAY}`);
      await settle(page);
    }
    await page.goto(route);
    await settle(page);
    if (name === 'Reports, raise case') await expect(page.locator('.report-brief')).toBeVisible({ timeout: 60_000 });

    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme);
      expect(await textOffTokens(page), `${name}, ${scheme}: text in an ink that is not a token`).toEqual([]);
    }
    await setScheme(page, 'light');

    const got = await page.evaluate(`(() => {
      const drawn = (${drawnText.toString()})();
      const bodyLh = new Set(), eyebrows = new Set(), figures = new Set();
      for (const { el, text } of drawn) {
        const cs = getComputedStyle(el);
        const px = parseFloat(cs.fontSize);
        // Body text long enough to wrap: one line height.
        if (px === 15 && text.length > 60) bodyLh.add((parseFloat(cs.lineHeight) / px).toFixed(2) + ' ' + text.slice(0, 24));
        // Every small-caps label: 11px, semibold, 0.06em. A footnote number inside one is its own thing.
        if (cs.textTransform === 'uppercase' && !el.closest('.footnote-ref'))
          eyebrows.add(px + 'px w' + cs.fontWeight + ' ' + (parseFloat(cs.letterSpacing) / px).toFixed(2) + 'em');
        // A figure: 24px or more and not a heading.
        if (px >= 24 && !el.closest('h1, h2, h3')) figures.add(px + 'px w' + cs.fontWeight);
      }
      const ctx = document.createElement('canvas').getContext('2d');
      const wide = [], offCentre = [];
      for (const e of document.querySelectorAll('p.mantine-Text-root, .mantine-List-item, .mantine-Alert-message, blockquote')) {
        const t = (e.textContent ?? '').trim();
        const r = e.getBoundingClientRect();
        if (t.length < 90 || r.width === 0 || e.closest('table, svg') || e.querySelector('p, li')) continue;
        const cs = getComputedStyle(e);
        ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const ch = (r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / ctx.measureText('0').width;
        const range = document.createRange(); range.selectNodeContents(e);
        const lines = new Set([...range.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top))).size;
        if (lines > 1 && ch > 80) wide.push(Math.round(ch) + 'ch "' + t.slice(0, 40) + '"');
        if (cs.textAlign === 'center') {
          const p = e.parentElement.getBoundingClientRect(), ps = getComputedStyle(e.parentElement);
          const mid = p.left + parseFloat(ps.paddingLeft) + (p.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)) / 2;
          if (Math.abs(r.left + r.width / 2 - mid) > 2) offCentre.push('"' + t.slice(0, 40) + '"');
        }
      }
      // A bordered card is not floating, so it casts no shadow; what floats (fixed, sticky or absolute, or
      // inside something that is, as the tray is) may.
      const floats = (e) => { for (let a = e; a; a = a.parentElement) if (/fixed|sticky|absolute/.test(getComputedStyle(a).position)) return true; return false; };
      const shadowed = [...document.querySelectorAll('.mantine-Card-root, .mantine-Paper-root')].filter((e) => {
        const cs = getComputedStyle(e);
        return parseFloat(cs.borderTopWidth) > 0 && cs.boxShadow !== 'none' && !floats(e) && e.getBoundingClientRect().width > 0;
      }).map((e) => (e.textContent ?? '').trim().slice(0, 30));
      const segCorners = [...new Set([...document.querySelectorAll('.mantine-SegmentedControl-root')].map((e) => getComputedStyle(e).borderTopLeftRadius))];
      // Controls at one of three heights: compact 28, default 36, and the landing's own search. A chip's
      // own buttons are the chip's (the tray's, a filter badge's), and what floats (back to top) is apart.
      const shown = (e) => e.getBoundingClientRect().width > 0 && e.checkVisibility({ visibilityProperty: true });
      const controls = new Set();
      for (const e of document.querySelectorAll('.mantine-Button-root, .mantine-ActionIcon-root, input.mantine-Input-input, .mantine-SegmentedControl-root, .mantine-Tabs-tab')) {
        if (!shown(e) || e.closest('.tray-chip, .mantine-Pill-root, .mantine-Badge-root') || floats(e)) continue;
        const h = Math.round(e.getBoundingClientRect().height * 2) / 2;
        controls.add(h + 'px ' + ([...e.classList].find((c) => c.startsWith('mantine-')) ?? '') + ' "' + (e.getAttribute('aria-label') || e.placeholder || e.textContent || '').trim().slice(0, 24) + '"');
      }
      // Icons at one of four sizes.
      const icons = new Set([...document.querySelectorAll('svg.tabler-icon')].filter(shown).map((e) => {
        const b = e.closest('button, a, label, p, div');
        return Math.round(e.getBoundingClientRect().width * 2) / 2 + 'px "' + (b?.getAttribute('aria-label') || b?.textContent || '').trim().slice(0, 24) + '"';
      }));
      return { bodyLh: [...bodyLh], eyebrows: [...eyebrows], figures: [...figures], wide, offCentre, shadowed, segCorners, controls: [...controls], icons: [...icons] };
    })()`) as { bodyLh: string[]; eyebrows: string[]; figures: string[]; wide: string[]; offCentre: string[]; shadowed: string[]; segCorners: string[]; controls: string[]; icons: string[] };

    expect(got.bodyLh.filter((l) => !l.startsWith('1.55')), `${name}: body text at another line height`).toEqual([]);
    expect(got.eyebrows.filter((e) => e !== '11px w600 0.06em'), `${name}: a small-caps label off the eyebrow style`).toEqual([]);
    // The landing's own figures are fluid (its approved design); everywhere else a figure is 24 or 40.
    expect(got.figures.filter((f) => !f.endsWith(' w700')), `${name}: a figure not at weight 700`).toEqual([]);
    if (name !== 'home') expect(got.figures.filter((f) => !/^(24|40)px/.test(f)), `${name}: a figure off the 24/40 steps`).toEqual([]);
    expect(got.wide, `${name}: running text wider than 80 characters`).toEqual([]);
    expect(got.offCentre, `${name}: a centred paragraph pushed off centre by the measure`).toEqual([]);
    expect(got.shadowed, `${name}: a bordered card with a shadow`).toEqual([]);
    expect(got.segCorners.filter((r) => r !== '10px'), `${name}: a segmented control off the control corner`).toEqual([]);
    const heights = name === 'home' ? /^(28|36|60)px/ : /^(28|36)px/;
    expect(got.controls.filter((c) => !heights.test(c)), `${name}: a control off the compact 28 / default 36 heights`).toEqual([]);
    expect(got.icons.filter((i) => !/^(14|16|20|22)px/.test(i)), `${name}: an icon off the 14/16/20/22 sizes`).toEqual([]);

    // Every Tab stop shows the ring, fields and dropdowns included.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const noRing = new Set<string>();
    let stops = 0;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        const cs = getComputedStyle(e);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || /0px 0px 0px [2-9]/.test(cs.boxShadow);
        return { ring, what: `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || (e as HTMLInputElement).placeholder || e.textContent || '').trim().slice(0, 30)}"` };
      });
      if (!r) continue;
      stops++;
      if (!r.ring) noRing.add(r.what);
    }
    expect(stops, `${name}: nothing to Tab to`).toBeGreaterThan(3);
    expect([...noRing], `${name}: a Tab stop with no focus ring`).toEqual([]);
  });
}

/**
 * Every page holds still while it loads: its layout shift, from the first paint until nothing is loading,
 * under 0.1 (the threshold Google calls good). Measured first, Raises scored 0.46 ("How to read this", on the
 * page from the start, pushed a screen and a half down as each section filled), Divisions 0.23 (a loading
 * tile half its loaded height) and a person's pay tab 0.21 (Standing arriving above the band). Each now waits
 * whole, or waits at its final size.
 */
test('every page holds still while it loads', async ({ browser }) => {
  test.setTimeout(600_000);
  const over: string[] = [];
  for (const [name, route] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (TRAY_FIRST.has(name)) { await page.goto(`./compare?sel=${TRAY}`); await settle(page); }
    await page.addInitScript(() => {
      const w = window as unknown as { shift: number; moved: string[] };
      w.shift = 0; w.moved = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
          if (e.hadRecentInput) continue;
          w.shift += e.value;
          for (const s of e.sources ?? []) {
            const n = s.node as HTMLElement | undefined;
            if (n?.className) w.moved.push(`${String(n.className).split(' ').slice(-1)[0]} "${(n.textContent ?? '').trim().slice(0, 24)}"`);
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(route);
    await settle(page);
    await page.waitForTimeout(1_000);
    const { shift, moved } = await page.evaluate(() => {
      const w = window as unknown as { shift: number; moved: string[] };
      return { shift: w.shift, moved: w.moved };
    });
    expect(typeof shift, `${name}: no layout-shift reading`).toBe('number');
    if (shift >= 0.1) over.push(`${name}: ${shift.toFixed(3)} (${[...new Set(moved)].slice(0, 3).join('; ')})`);
    await ctx.close();
  }
  expect(over, 'a page that moves under the reader while it loads').toEqual([]);
});

/**
 * On a phone every target a finger can reach is at least 24px each way (WCAG 2.5.8): what a finger hits,
 * measured by hitting it, so an invisible hit area counts and a neighbour that steals part of it does not.
 * Each target under 24px is brought to the middle of the window and touched 11.5px either side of its centre,
 * across and down. Exempt, as WCAG has it: a link inside a sentence, a number field's stepper (the field takes
 * the number), a checkbox or radio whose label is the target.
 */
test('on a phone, every target a finger can reach is 24px or more each way', async ({ browser }) => {
  test.setTimeout(900_000);
  const small: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [name, route] of PAGES) {
    if (TRAY_FIRST.has(name)) { await page.goto(`./compare?sel=${TRAY}`); await settle(page); }
    await page.goto(route);
    await settle(page);
    const misses = await page.evaluate(() => {
      const out: string[] = [];
      const targets = document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex="0"]');
      for (const e of targets) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || !e.checkVisibility({ visibilityProperty: true })) continue;
        if (r.width >= 24 && r.height >= 24) continue;
        if (e.matches('p a, li a, .mantine-NumberInput-control, .visually-hidden, .skip-link')) continue;
        if (e.matches('input[type="checkbox"], input[type="radio"]') && (e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)))) continue;
        e.scrollIntoView({ block: 'center', inline: 'center' });
        const b = e.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const hits = [[cx - 11.5, cy], [cx + 11.5, cy], [cx, cy - 11.5], [cx, cy + 11.5]].every(([x, y]) => {
          const at = document.elementFromPoint(x, y);
          return !!at && (at === e || e.contains(at));
        });
        if (!hits) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].find((c) => !c.startsWith('m_')) ?? ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}"`);
      }
      return [...new Set(out)];
    });
    if (misses.length) small.push(`${name}: ${misses.slice(0, 6).join('; ')}${misses.length > 6 ? ` (+${misses.length - 6})` : ''}`);
  }
  await ctx.close();
  expect(small, 'a target under 24px for a finger').toEqual([]);
});
