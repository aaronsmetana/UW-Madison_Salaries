import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, spots, plotShape, barOverPlot } from './homeDots';
import { atCiPace, FRAME_MS } from './pace';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Full page, the bar filters the graph by a title, a school, or a title within a school: that group's dots
 * stay lit and the rest dim, its own curve and median are drawn beside everyone's, and a label says how many
 * they are and how their median sits against campus. Everything here is checked against the data directly —
 * who is covered, where their dots are, their median, the words for the gap — each restated from its rule
 * rather than taken from the page's code.
 */

const SNAP = HOME_STATS.snapshot_id;
const SCHOOL = 'School of Medicine and Public Health';
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;
const num = (n: number) => n.toLocaleString('en-US');
/** The gap between a group's median and campus's, in the page's words: whole percent, rounded the same way
 *  either side, and "about the campus median" within a point. */
function vs(group: number, campus: number) {
  const gap = (100 * (group - campus)) / campus;
  const p = Math.sign(gap) * Math.round(Math.abs(gap));
  return Math.abs(p) <= 1 ? 'about the campus median' : p < 0 ? `${-p}% below campus` : `${p}% above campus`;
}
/** The continuous median: the middle one, or halfway between the middle two. */
function medianOf(xs: number[]) {
  const a = [...xs].sort((p, q) => p - q), n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
/** A pay's x on the plot's 1000-wide box: the curve runs $200 by $200 over `pay_counts`' range. */
const { lo100, counts } = HOME_STATS.pay_counts;
const LO = Math.floor(lo100 / 2) * 200;
const HI = Math.floor((lo100 + counts.length - 1) / 2) * 200;
const xOf = (v: number) => ((v - LO) / (HI - LO)) * 1000;

/** The search's index of titles, as the page loads it. */
const INDEX = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/search-index.json', import.meta.url)), 'utf8')) as {
  titles: [string, string | null, number, number | null][];
  divisions: [string, number, number | null][];
};
/** A title as a filter names it: with its code, where another title in the index has the same name —
 *  "Research Associate" is PD012 and PD012N, and picked, the filter must still say which. */
function titleName(title: string, code: string) {
  return INDEX.titles.filter(([, t]) => t === title).length > 1 ? `${title} (${code})` : title;
}

/** The title code most people in the graph's snapshot hold under this name. */
async function codeOf(title: string) {
  const [r] = await oracle<{ code: string }>(
    `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND title = '${title.replace(/'/g, "''")}'
     GROUP BY job_code ORDER BY count(DISTINCT person_key) DESC, job_code LIMIT 1`,
  );
  return r.code;
}

/** Who a filter covers, restated: everyone paid in the graph's snapshot, at their total pay, with a paid
 *  appointment that has the code, is in the school, or — both given — is both. */
function covered(f: { code?: string; school?: string }) {
  const cond = [
    f.code ? `job_code = '${f.code}'` : null,
    f.school ? `school = '${f.school.replace(/'/g, "''")}'` : null,
  ].filter(Boolean).join(' AND ');
  return oracle<{ person_key: string; pay: number }>(
    `WITH p AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key)
     SELECT person_key, pay FROM p WHERE pay > 0 AND person_key IN
       (SELECT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND ${cond})`,
  );
}

/** The lit dots of each field as the page prints them: how many, and the sum and sum of squares of their
 *  places — so a single dot lit in the wrong place changes the print. */
function prints(who: { person_key: string }[], at: Map<string, { field: 'main' | 'pile'; index: number }>) {
  const f = { main: [0, 0, 0], pile: [0, 0, 0] };
  for (const p of who) {
    const s = at.get(p.person_key);
    if (!s) continue;
    f[s.field][0]++;
    f[s.field][1] += s.index;
    f[s.field][2] += s.index * s.index;
  }
  return { main: f.main.join(':'), pile: f.pile.join(':') };
}

/** The landing graph gone full page, its dots at rest and the panel done growing. */
async function fullPage(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
}

const bar = (page: Page) => page.locator('.hero-dist-full .search-bar-field input');
const tokens = (page: Page) => page.locator('.hero-dist-full .search-token-label');

/** Put a filter on from the bar, as a reader does: type, and press its chip. */
async function put(page: Page, query: string, key: string) {
  await bar(page).fill(query);
  const chip = page.locator(`.hero-dist-full [role="option"][data-key="${key}"]`);
  await expect(chip, `no chip ${key} for "${query}"`).toBeVisible({ timeout: 60_000 });
  await chip.click();
  await expect(bar(page)).toHaveValue('');
}

/** The group's shape against campus's, and where its label ends, in the plot's own px. */
function shape(page: Page) {
  return page.evaluate(() => {
    const minY = (d: string) => Math.min(...d.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => Number(p.split(',')[1])));
    const paths = [...document.querySelectorAll('.hero-dist-full .hero-dist-plot g > path')];
    const campus = paths.find((p) => !p.classList.contains('hero-dist-curve-glow') && !p.classList.contains('hero-dist-group-curve'))!;
    const group = document.querySelector('.hero-dist-group-curve');
    const main = document.querySelector('.hero-dist-full .hero-dist-main')!.getBoundingClientRect();
    const flag = document.querySelector('.hero-dist-group-flag')?.getBoundingClientRect();
    const line = document.querySelector('.hero-dist-group-median');
    const xs = group ? group.getAttribute('d')!.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => Number(p.split(',')[0])) : [];
    return {
      groupFrom: xs.length ? Math.min(...xs) : null,
      groupTo: xs.length ? Math.max(...xs) : null,
      campusPeak: minY(campus.getAttribute('d')!),
      groupPeak: group ? minY(group.getAttribute('d')!) : null,
      flagBottom: flag ? flag.bottom - main.top : null,
      lineX: line ? Number(line.getAttribute('x1')) : null,
      plotW: main.width,
    };
  });
}

test('a title, a school, and a title within a school light exactly their people, and say how many and how their median sits', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const at = await spots();
  const code = await codeOf('Research Associate');
  const ra = titleName('Research Associate', code);
  const cases = [
    { on: () => put(page, 'research assoc', `t:${code}`), f: { code }, name: ra },
    { on: async () => { await page.locator('.search-token-x').click(); await put(page, 'medicine', `d:${SCHOOL}`); }, f: { school: SCHOOL }, name: SCHOOL },
    { on: () => put(page, 'research assoc', `t:${code}`), f: { code, school: SCHOOL }, name: `${ra} in ${SCHOOL}` },
  ];
  for (const c of cases) {
    await c.on();
    const who = await covered(c.f);
    expect(who.length, `${c.name}: nobody to light, so nothing here is tested`).toBeGreaterThan(20);
    const want = prints(who, at);
    await expect(page.locator('.hero-dist-full .hero-dots'), `${c.name}: the lit dots under the curve`).toHaveAttribute('data-lit', want.main, { timeout: 60_000 });
    await expect(page.locator('.hero-dist-full .hero-dots-over'), `${c.name}: the lit dots in the pile`).toHaveAttribute('data-lit', want.pile);

    const med = medianOf(who.map((p) => p.pay));
    await expect(page.locator('.hero-dist-group-flag'), `${c.name}: its label`)
      .toHaveText(`${c.name} · ${num(who.length)} · median ${fmtK(med)} · ${vs(med, HOME_STATS.p50)}`);

    const s = await shape(page);
    expect(s.groupPeak, `${c.name}: its curve does not peak at campus's height`).toBeCloseTo(s.campusPeak, 1);
    // Above the curve's highest point there are no dots, so a label that ends there covers none.
    expect(s.flagBottom!, `${c.name}: its label reaches down over the dots`).toBeLessThan(s.campusPeak);
    expect(Math.abs(((s.lineX! - xOf(med)) / 1000) * s.plotW), `${c.name}: its median line is off its median`).toBeLessThan(0.5);
    // Its own people's curve, not anyone's: it runs only as far as their pays do, and the kernel's
    // reach (σ $1,200) past them. Everyone's curve at the group's height would pass every check above.
    const under = who.map((p) => p.pay).filter((p) => p < HOME_STATS.bin_cap);
    expect(s.groupFrom!, `${c.name}: its curve starts below anyone in it`).toBeGreaterThanOrEqual(xOf(Math.min(...under) - 6000));
    expect(s.groupTo!, `${c.name}: its curve runs on past anyone in it`).toBeLessThanOrEqual(xOf(Math.max(...under) + 6000));
  }
});

/**
 * The dots a filter is not about are drawn faint, not left alone and not hidden: over a stretch of pay with
 * none of the group in it, the field's ink falls to about a fifth. `data-lit` only says which dots the mask
 * lights; this is the paint.
 */
test('what a filter is not about is drawn faint, not hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  const who = await covered({ code });
  const top = Math.max(...who.map((p) => p.pay).filter((p) => p < HOME_STATS.bin_cap));
  const from = top + 10_000;
  expect(from, 'the group runs to the top of the plot, leaving nowhere without it').toBeLessThan(HI - 20_000);
  const ink = () => page.evaluate(([a, b]) => {
    const c = document.querySelector('.hero-dist-full .hero-dots canvas') as HTMLCanvasElement;
    const k = c.width / c.getBoundingClientRect().width;
    const x0 = Math.round((a / 1000) * c.getBoundingClientRect().width * k), x1 = Math.round((b / 1000) * c.getBoundingClientRect().width * k);
    const d = c.getContext('2d')!.getImageData(x0, 0, x1 - x0, c.height).data;
    let t = 0;
    for (let i = 3; i < d.length; i += 4) t += d[i];
    return t;
  }, [xOf(from), 1000]);
  const before = await ink();
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const after = await ink();
  expect(before, 'no ink to compare').toBeGreaterThan(0);
  expect(after / before, 'the field past the group was not dimmed').toBeLessThan(0.3);
  expect(after / before, 'the field past the group was hidden, not dimmed').toBeGreaterThan(0.08);
});

test('the readout counts the filter’s people within its window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  const who = await covered({ code });
  const main = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
  await page.mouse.move(main.x + (xOf(62000) / 1000) * main.width, main.y + main.height * 0.6);
  const pill = page.locator('.chart-value-pill');
  await expect(pill).toContainText('in the filter');
  const text = (await pill.textContent())!;
  // The window is the readout's: every $1k bucket within ±$5k of the one under the pointer.
  const bucket = Number(/^\$(\d+)k/.exec(text)![1]) * 1000;
  const want = who.filter((p) => p.pay < HOME_STATS.bin_cap && Math.abs(Math.floor(p.pay / 1000) * 1000 - bucket) <= 5000).length;
  expect(want, 'nobody of the group near the pointer, so nothing here is tested').toBeGreaterThan(5);
  expect(text).toContain(` · ${num(want)} in the filter`);
});

test('filters come off one at a time — ×, Backspace, Escape before full page closes — a second title replaces the first, and a combination with nobody says so', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const ra = await codeOf('Research Associate');
  const prof = await codeOf('Professor');
  const raName = titleName('Research Associate', ra);
  const profName = titleName('Professor', prof);

  await put(page, 'research assoc', `t:${ra}`);
  await expect(tokens(page)).toHaveText([raName]);
  await put(page, 'professor', `t:${prof}`);
  await expect(tokens(page), 'a second title sat beside the first instead of replacing it').toHaveText([profName]);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(tokens(page)).toHaveText([profName, SCHOOL]);

  // Backspace in the empty box takes off the last one put on.
  await bar(page).press('Backspace');
  await expect(tokens(page), 'Backspace took off the wrong filter').toHaveText([profName]);
  await put(page, 'medicine', `d:${SCHOOL}`);

  // Escape: the text, then each filter, last on first off, and only then full page.
  const full = page.locator('.hero-dist');
  await bar(page).fill('ab');
  await bar(page).press('Escape');
  await expect(bar(page)).toHaveValue('');
  await expect(tokens(page), 'the Escape that emptied the box took a filter too').toHaveCount(2);
  await bar(page).press('Escape');
  await expect(tokens(page)).toHaveText([profName]);
  await expect(full, 'Escape left full page with a filter still on').toHaveAttribute('data-full', 'on');
  await bar(page).press('Escape');
  await expect(tokens(page)).toHaveCount(0);
  await expect(full).toHaveAttribute('data-full', 'on');
  await bar(page).press('Escape');
  await expect(full).toHaveAttribute('data-full', 'off');

  // Escape from the graph itself, not the box: the panel peels the filter as the box would.
  await page.locator('.hero-dist-full-toggle').click();
  await expect(full).toHaveAttribute('data-full', 'on');
  await put(page, 'research assoc', `t:${ra}`);
  await page.locator('.hero-dist-full .hero-dist-main').focus();
  await page.keyboard.press('Escape');
  await expect(tokens(page), 'Escape on the graph did not take the filter off').toHaveCount(0);
  await expect(full, 'Escape on the graph left full page with a filter on').toHaveAttribute('data-full', 'on');

  // Its own ×.
  await put(page, 'research assoc', `t:${ra}`);
  await page.getByRole('button', { name: `Remove filter: ${raName}` }).click();
  await expect(tokens(page)).toHaveCount(0);
  await expect(page.locator('.hero-dist-full .hero-dots')).not.toHaveAttribute('data-lit', /./);

  // A title within a school that has none of them: said, not left as a field dimmed to nothing.
  const [none] = await oracle<{ school: string }>(
    `SELECT school FROM (SELECT school, count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND school IS NOT NULL GROUP BY school)
     WHERE n > 50 AND school NOT IN (SELECT school FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND job_code = '${ra}' AND school IS NOT NULL)
     ORDER BY n DESC, school LIMIT 1`,
  );
  await put(page, 'research assoc', `t:${ra}`);
  await put(page, none.school, `d:${none.school}`);
  await expect(page.locator('.hero-dist-group-flag')).toHaveText(`No one on the graph is ${raName} in ${none.school}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', '0:0:0');
});

/**
 * A filter changes what is lit and nothing else: the plot keeps its place and size, its dots stay laid out
 * as they were, and nothing the bar or the label draws lies on a dot — on a desktop and a phone, where two
 * filters once wrapped the strip onto a line of its own and pushed the plot down.
 */
test('filtering never moves the plot, and nothing it draws lies on a dot', async ({ browser }) => {
  test.setTimeout(240_000);
  const ra = await codeOf('Research Associate');
  for (const [width, height] of [[1280, 800], [1440, 900], [375, 812]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    const page = await ctx.newPage();
    await fullPage(page);
    const before = await plotShape(page);
    const check = async (when: string) => {
      expect(await plotShape(page), `${width}px: ${when} moved the plot`).toEqual(before);
      expect(await barOverPlot(page), `${width}px: ${when}, the bar lies on the graph`).toEqual([]);
      const s = await shape(page);
      if (s.flagBottom != null) expect(s.flagBottom, `${width}px: ${when}, the label reaches down over the dots`).toBeLessThan(s.campusPeak);
    };
    await put(page, 'research assoc', `t:${ra}`);
    await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
    await check('one filter');
    await put(page, 'medicine', `d:${SCHOOL}`);
    await expect(tokens(page)).toHaveCount(2);
    await page.waitForTimeout(400);
    await check('two filters');
    // And searching with both on: a strip full of results beside two filters is what could wrap a line.
    await bar(page).fill('aaron');
    await expect(page.locator('.hero-dist-full [role="option"]').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(300);
    await check('searching with two filters on');
    await bar(page).fill('');
    await bar(page).press('Escape');
    await bar(page).press('Escape');
    await expect(tokens(page)).toHaveCount(0);
    await check('taking them off');
    await ctx.close();
  }
});

test('putting a filter on and taking it off repaint within a frame, at CI’s pace', async ({ page }) => {
  await atCiPace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  await page.evaluate(() => performance.clearMeasures('dim-paint'));
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.locator('.search-token-x').click();
  await page.waitForTimeout(800);
  const paints = await page.evaluate(() => performance.getEntriesByName('dim-paint').map((e) => e.duration));
  expect(paints.length, 'the dimming was never repainted, so nothing was timed').toBeGreaterThanOrEqual(2);
  expect(Math.max(...paints), `a repaint held a frame: ${paints.map((d) => d.toFixed(1)).join(', ')}ms`).toBeLessThan(FRAME_MS);
});

test('the search’s names start below the group’s label, and none touches it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  await put(page, 'research assoc', `t:${await codeOf('Research Associate')}`);
  await bar(page).fill('smith');
  await expect(page.locator('.hero-found-label').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const hits = await page.evaluate(() => {
    const f = document.querySelector('.hero-dist-group-flag')!.getBoundingClientRect();
    return [...document.querySelectorAll('.hero-found-label')].filter((l) => {
      const r = l.getBoundingClientRect();
      return r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
    }).map((l) => l.textContent);
  });
  expect(await page.locator('.hero-found-label').count(), 'nobody was named, so nothing here is tested').toBeGreaterThan(2);
  expect(hits, 'a name lies on the group’s label').toEqual([]);
  // Where the names may go at all: below the label. With real searches a name all but never climbs that
  // high — the highest of five crowded searches on a phone sat at 104px, the label ends at 25.5 — so the
  // check above has little to find, and the bound the names are placed within is what carries the rule:
  // it is the box the placement itself reads (Home `namesBox`), not a copy of it.
  const bound = Number(await page.locator('.hero-found-leaders').getAttribute('data-names-top'));
  const flag = await page.evaluate(() => {
    const f = document.querySelector('.hero-dist-group-flag')!.getBoundingClientRect();
    return f.bottom - document.querySelector('.hero-dist-full .hero-dist-main')!.getBoundingClientRect().top;
  });
  expect(bound, 'the names may be placed over the group’s label').toBeGreaterThanOrEqual(flag);
});

/**
 * A filter covers paid appointments, as the dots do: someone who holds a title only unpaid, and is on the
 * graph for pay somewhere else, is not one of that title's. In the current data exactly one person is that
 * case, so no big group can show the rule; this finds whatever title does, and skips, saying so, if none.
 */
test('a title covers paid appointments only: someone holding it unpaid, and paid elsewhere, stays unlit', async ({ page }) => {
  const [c] = await oracle<{ code: string }>(
    `WITH paid AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0),
          paidin AS (SELECT DISTINCT person_key, job_code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0)
     SELECT u.job_code code FROM $SAL u JOIN paid USING (person_key)
     WHERE u.snapshot_id = '${SNAP}' AND NOT (u.salary > 0)
       AND NOT EXISTS (SELECT 1 FROM paidin p WHERE p.person_key = u.person_key AND p.job_code = u.job_code)
       AND EXISTS (SELECT 1 FROM paidin p WHERE p.job_code = u.job_code)
     ORDER BY u.job_code LIMIT 1`,
  );
  test.skip(!c, 'nobody in this snapshot holds a title only unpaid while paid elsewhere');
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const at = await spots();
  await put(page, c.code.toLowerCase(), `t:${c.code}`);
  const who = await covered({ code: c.code });
  await expect(page.locator('.hero-dist-full .hero-dots'), 'someone holding the title only unpaid was lit')
    .toHaveAttribute('data-lit', prints(who, at).main, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-group-count', String(who.length));
});

test('with two filters on, the bar and the group’s label pass a strict accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  await put(page, 'research assoc', `t:${await codeOf('Research Associate')}`);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-group-flag')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('.hero-full').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

/** The options the full page's strip is showing, by key. */
const stripKeys = (page: Page) => page.locator('.hero-dist-full [role="option"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key));

/**
 * With nothing typed the strip is not empty: it offers groups to put on. Nothing on, the index's largest
 * schools and titles, turn about; a school on, the titles most of its people are paid in; a title on, the
 * schools that pay most of it; both on, nothing left to add. Each restated here from its rule.
 */
test('with nothing typed the strip offers groups to filter by, and what it offers follows the filters', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const byN = <T extends [string, ...unknown[]]>(n: (r: T) => number) => (a: T, b: T) => n(b) - n(a) || (a[0] < b[0] ? -1 : 1);
  const schools = [...INDEX.divisions].sort(byN((r) => r[1])).slice(0, 3).map((r) => `d:${r[0]}`);
  const titles = [...INDEX.titles].filter((r) => r[1]).sort(byN((r) => r[2])).slice(0, 3).map((r) => `t:${r[0]}`);
  await expect.poll(() => stripKeys(page), { message: 'nothing on: not the largest schools and titles', timeout: 30_000 })
    .toEqual(schools.flatMap((s, i) => [s, titles[i]]));
  await expect(page.locator('.search-strip-note', { hasText: 'Try' })).toBeVisible();

  // A school on: the titles most of its people are paid in, as far as the index knows them.
  await page.locator(`.hero-dist-full [role="option"][data-key="d:${SCHOOL}"]`).click();
  await expect(tokens(page)).toHaveText([SCHOOL]);
  const inSchool = await oracle<{ code: string }>(
    `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND school = '${SCHOOL}'
     GROUP BY job_code ORDER BY count(DISTINCT person_key) DESC, job_code LIMIT 5`,
  );
  const known = new Set(INDEX.titles.map((r) => r[0]));
  await expect.poll(() => stripKeys(page), { message: 'a school on: not its largest titles', timeout: 60_000 })
    .toEqual(inSchool.filter((r) => known.has(r.code)).map((r) => `t:${r.code}`));

  // Pressing one puts it on beside the school: both on, and nothing more to offer.
  const first = inSchool.find((r) => known.has(r.code))!.code;
  await page.locator(`.hero-dist-full [role="option"][data-key="t:${first}"]`).click();
  await expect(tokens(page)).toHaveCount(2);
  await expect.poll(() => stripKeys(page), { message: 'both on, and still offering more' }).toEqual([]);
  await expect(page.locator('.search-strip-note', { hasText: 'Try' })).toHaveCount(0);

  // The school off, the title alone: the schools that pay most of it. Reached by the keys, and put on with Enter.
  await page.getByRole('button', { name: `Remove filter: ${SCHOOL}` }).click();
  const forTitle = await oracle<{ school: string }>(
    `SELECT school FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND job_code = '${first}' AND school IS NOT NULL
     GROUP BY school ORDER BY count(DISTINCT person_key) DESC, school LIMIT 4`,
  );
  const knownSchools = new Set(INDEX.divisions.map((r) => r[0]));
  const want = forTitle.filter((r) => knownSchools.has(r.school)).map((r) => `d:${r.school}`);
  await expect.poll(() => stripKeys(page), { message: 'a title on: not the schools that pay most of it', timeout: 60_000 }).toEqual(want);
  await bar(page).focus();
  await bar(page).press('ArrowDown');
  await bar(page).press('Enter');
  await expect(tokens(page), 'Enter on a starter did not put it on').toHaveCount(2);
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-filter', new RegExp(` in ${want[1].slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
});

/**
 * The way in from the page's own search: a title or school row offers "Show on graph" beside opening its
 * page. It opens the graph full page with that group put on and the box emptied, leaving no list behind; the
 * keyboard's way is Shift+Enter on the row; the row itself still opens the title's page.
 */
test('"Show on graph" in the page’s search opens the graph full page with that group on', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const code = await codeOf('Research Associate');
  const name = titleName('Research Associate', code);
  const box = page.getByRole('combobox', { name: /Search a person/ });
  const row = page.locator(`[role="option"][data-key="t:${code}"]`);

  // By pointer.
  await box.fill('research assoc');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.locator('.search-show-on-graph').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(tokens(page)).toHaveText([name]);
  await expect(bar(page), 'the query went full page with the group').toHaveValue('');
  await expect(page.locator('.search-dropdown'), 'the page’s list was left over the graph').toHaveCount(0);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  expect(new URL(page.url()).pathname, 'it opened the title’s page instead').toMatch(/\/UW-Madison_Salaries\/$/);

  // By keyboard: back out, and Shift+Enter on the row.
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await box.fill('research assoc');
  await expect(row).toBeVisible({ timeout: 60_000 });
  for (let k = 0; k < 8 && (await row.getAttribute('aria-selected')) !== 'true'; k++) await box.press('ArrowDown');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await box.press('Shift+Enter');
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(tokens(page)).toHaveText([name]);

  // And the row itself still opens the title's page. Full page closes over a moment ("closing"), with its
  // own box still the one on screen: type only once it is gone.
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await box.fill('research assoc');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click({ position: { x: 20, y: 10 } });
  await expect(page).toHaveURL(new RegExp(`/paycheck\\?code=${code}`));
});

test('the page’s search list, with "Show on graph" on its rows, passes a strict accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.getByRole('combobox', { name: /Search a person/ }).fill('medicine');
  await expect(page.locator('.search-show-on-graph').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page }).include('.search-dropdown').include('[role="combobox"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(await page.getByRole('combobox', { name: /Search a person/ }).getAttribute('aria-describedby'), 'the keyboard’s way to it is not said').toBeTruthy();
});
