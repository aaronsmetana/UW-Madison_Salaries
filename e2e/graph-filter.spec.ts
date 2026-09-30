import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, spots, plotShape, barOverPlot, places, people, ranks } from './homeDots';
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

/** The group's curve and campus's, as the plot draws them — each point's x and its height off the floor —
 *  and where the group's label ends, in the plot's own px. */
function shape(page: Page) {
  return page.evaluate(() => {
    const pts = (d: string) => d.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => p.split(',').map(Number) as [number, number]);
    const svg = document.querySelector('.hero-dist-full .hero-dist-plot')!;
    const H = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const paths = [...svg.querySelectorAll('g > path')];
    const campus = paths.find((p) => !p.classList.contains('hero-dist-curve-glow') && !p.classList.contains('hero-dist-group-curve'))!;
    const group = document.querySelector('.hero-dist-group-curve');
    const main = document.querySelector('.hero-dist-full .hero-dist-main')!.getBoundingClientRect();
    const flag = document.querySelector('.hero-dist-group-flag')?.getBoundingClientRect();
    const line = document.querySelector('.hero-dist-group-median');
    const campusPts = pts(campus.getAttribute('d')!);
    const groupPts = group ? pts(group.getAttribute('d')!) : [];
    // Off the floor: the plot's baseline is 2px above its bottom.
    const up = (p: [number, number][]) => p.map(([x, y]) => [x, H - 2 - y] as [number, number]);
    return {
      campus: up(campusPts),
      group: group ? up(groupPts) : null,
      groupFrom: groupPts.length ? Math.min(...groupPts.map((p) => p[0])) : null,
      groupTo: groupPts.length ? Math.max(...groupPts.map((p) => p[0])) : null,
      campusPeak: Math.min(...campusPts.map((p) => p[1])),
      flagBottom: flag ? flag.bottom - main.top : null,
      lineX: line ? Number(line.getAttribute('x1')) : null,
      lineShown: !!line,
      plotW: main.width,
    };
  });
}

/** How wide a group's curve is smoothed, restated: Silverman's rule of thumb over the pays under the cap,
 *  halved, and never under the campus kernel's $1,200. */
function sigmaOf(pays: number[]) {
  const v = pays.filter((p) => p > 0 && p < HOME_STATS.bin_cap).sort((a, b) => a - b), n = v.length;
  if (n < 2) return 1200;
  const mean = v.reduce((t, p) => t + p, 0) / n;
  const sd = Math.sqrt(v.reduce((t, p) => t + (p - mean) ** 2, 0) / (n - 1));
  const iqr = (v[Math.floor(0.75 * (n - 1))] - v[Math.floor(0.25 * (n - 1))]) / 1.34;
  return Math.max(1200, 0.45 * (iqr > 0 ? Math.min(sd, iqr) : sd) * n ** -0.2);
}

/** Everyone the plot draws under the cap. */
const UNDER_CAP = counts.reduce((t, n) => t + n, 0);

/** Each of the group's points with campus's at the same x: the two share one grid. */
function paired(s: { campus: [number, number][]; group: [number, number][] | null }) {
  const at = new Map(s.campus.map(([x, h]) => [x.toFixed(1), h]));
  return (s.group ?? []).map(([x, h]) => ({ x, h, campus: at.get(x.toFixed(1)) }));
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
    // Above the curve's highest point there are no dots, so a label that ends there covers none.
    expect(s.flagBottom!, `${c.name}: its label reaches down over the dots`).toBeLessThan(s.campusPeak);
    expect(Math.abs(((s.lineX! - xOf(med)) / 1000) * s.plotW), `${c.name}: its median line is off its median`).toBeLessThan(0.5);
    // On campus's scale: how many of them there are at each pay, so never above everyone, and all of it
    // together the share of everyone under the cap they are. Scaled to its own peak, it drew any group at
    // campus's height, and the share test fails by a factor of ten and more.
    const under = who.map((p) => p.pay).filter((p) => p < HOME_STATS.bin_cap);
    const pairs = paired(s);
    expect(pairs.length, `${c.name}: no curve drawn`).toBeGreaterThan(10);
    for (const q of pairs) {
      expect(q.campus, `${c.name}: its point at ${q.x} is off campus's grid`).toBeDefined();
      expect(q.h, `${c.name}: its curve rises above everyone at ${q.x}`).toBeLessThanOrEqual(q.campus! + 0.1);
    }
    const area = pairs.reduce((t, q) => t + q.h, 0) / s.campus.reduce((t, [, h]) => t + h, 0);
    expect(area / (under.length / UNDER_CAP), `${c.name}: its curve holds ${area.toFixed(4)} of everyone, not their ${(under.length / UNDER_CAP).toFixed(4)}`).toBeGreaterThan(0.97);
    expect(area / (under.length / UNDER_CAP), `${c.name}: its curve holds ${area.toFixed(4)} of everyone, not their ${(under.length / UNDER_CAP).toFixed(4)}`).toBeLessThan(1.03);
    // Its own people's curve, not anyone's: it runs only as far as their pays do, and its kernel's reach
    // past them — a kernel as wide as a group its size needs.
    const reach = 5 * sigmaOf(under);
    expect(s.groupFrom!, `${c.name}: its curve starts below anyone in it`).toBeGreaterThanOrEqual(xOf(Math.min(...under) - reach));
    expect(s.groupTo!, `${c.name}: its curve runs on past anyone in it`).toBeLessThanOrEqual(xOf(Math.max(...under) + reach));
  }
});

/**
 * Where nearly everyone is a Professor, a Professor's curve all but meets everyone's: at $200k–$240k it
 * stands, on the average, at the share of everyone paid there who holds the title, and never above them. A
 * curve at its own scale stood there at twice campus's height and more; one smoothed as narrowly as campus's
 * zigzagged through it.
 */
test('where most are a title, its curve stands at their share of everyone, smoothly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Professor');
  await put(page, 'professor', `t:${code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  const who = await covered({ code });
  const [all] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY 1)
     WHERE pay >= 200000 AND pay < 240000`,
  );
  const share = who.filter((p) => p.pay >= 200_000 && p.pay < 240_000).length / Number(all.n);
  expect(share, 'the premise: most paid $200k–$240k are Professors').toBeGreaterThan(0.5);
  const all2 = paired(await shape(page));
  // Here, where the title is most of everyone, a wider kernel than campus's would lift it over a narrow dip
  // in everyone's: held to everyone, it never is.
  for (const q of all2) expect(q.h, `its curve rises above everyone at ${q.x}`).toBeLessThanOrEqual(q.campus! + 0.1);
  const pairs = all2.filter((q) => q.x >= xOf(200_000) && q.x < xOf(240_000));
  const mean = (xs: number[]) => xs.reduce((t, v) => t + v, 0) / xs.length;
  const stands = mean(pairs.map((q) => q.h)) / mean(pairs.map((q) => q.campus!));
  expect(Math.abs(stands - share), `its curve stands at ${stands.toFixed(2)} of campus's, their share is ${share.toFixed(2)}`).toBeLessThan(0.1);
  // Smoothed as a group its size needs, it rises and falls a few times: through the campus kernel it had 14
  // peaks standing a pixel or more over the ground either side, chance in a thousand people; now 3.
  const h = all2.map((q) => q.h);
  let peaks = 0;
  for (let k = 1; k < h.length - 1; k++) {
    if (!(h[k] > h[k - 1] && h[k] >= h[k + 1])) continue;
    let l = h[k], r = h[k];
    for (let j = k - 1; j >= 0 && h[j] <= h[k]; j--) l = Math.min(l, h[j]);
    for (let j = k + 1; j < h.length && h[j] <= h[k]; j++) r = Math.min(r, h[j]);
    if (h[k] - Math.max(l, r) > 1) peaks++;
  }
  expect(peaks, `its curve zigzags: ${peaks} peaks`).toBeLessThanOrEqual(6);
});

/** A group too small to rise far off the floor still draws its curve: low, along the floor, on campus's scale,
 *  with its median line and its label. It used to be left out under 12px, and half of the largest titles
 *  (Professor, Assistant Professor…) then showed a median line alone beside Research Associate's shape. */
test('a group of about twenty draws its curve, low, with its median and label', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  // A title of about twenty, named once in the index, so the bar finds it by name.
  const rows = await oracle<{ code: string; title: string; n: number }>(
    `SELECT job_code code, any_value(title) title, count(DISTINCT person_key) n FROM $SAL
     WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY 1 HAVING n BETWEEN 18 AND 24 ORDER BY n DESC, 1`,
  );
  const t = rows.find((r) => INDEX.titles.filter(([, name]) => name === r.title).length === 1 && /^[A-Za-z ]+$/.test(r.title))!;
  expect(t, 'no title of about twenty to try').toBeDefined();
  await put(page, t.title.toLowerCase(), `t:${t.code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-group-flag')).toContainText(`${t.title} · ${t.n} · median`);
  const s = await shape(page);
  expect(s.group, `${t.title}: no curve drawn`).not.toBeNull();
  // Low, as twenty people are against everyone: the case the old 12px cut left out.
  const top = Math.max(...s.group!.map(([, h]) => h));
  expect(top, `${t.title}: its curve is not the low one this test is about`).toBeLessThan(12);
  expect(top, `${t.title}: its curve lies flat on the floor`).toBeGreaterThan(0);
  expect(s.lineShown, `${t.title}: its median line is missing`).toBe(true);
});

/**
 * Point at a row until it is chosen: once the page and the list have stopped scrolling, onto it from just
 * inside its edge, so the move has movement over it. The list chooses a row only on a pointer that moves
 * onto it (SearchBox `chooseOnMove`), not on a row slid under a resting one. On CI one hover once left the
 * previous row chosen for the whole wait; that did not reproduce here, even with the CPU slowed six times.
 * What is tested here is what a chosen row draws; how a row is chosen is search-suggestions'.
 */
async function pointAt(page: Page, row: Locator) {
  await expect(async () => {
    await moveOnto(page, row);
    await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }, 'pointing at the row did not choose it').toPass({ timeout: 20_000 });
}
async function moveOnto(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => new Promise<boolean>((done) => {
    const at = () => scrollY + [...document.querySelectorAll('.search-dropdown, .search-dropdown *')].reduce((t, e) => t + e.scrollTop, 0);
    const was = at();
    requestAnimationFrame(() => requestAnimationFrame(() => done(at() === was)));
  }));
  const b = (await row.boundingBox())!;
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
}

/**
 * Pointing at a suggested title or division draws its group: the dashed outline of how many of its people
 * are at each pay, its median line and its label. Professor and Assistant Professor are spread over a wide
 * range and rise only a few pixels on campus's scale, so under the old 12px cut they showed a median line
 * alone while Research Associate showed its shape.
 */
test('every suggested title and division draws its outline, median and label when pointed at', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.click();
  const rows = page.locator('[data-suggestions] [role="option"]');
  await expect(rows).toHaveCount(6, { timeout: 60_000 });
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const row = rows.nth(i);
    const name = ((await row.locator('p, .mantine-Text-root').first().textContent()) ?? '').trim();
    await pointAt(page, row);
    await expect(page.locator('.hero-dist-group-flag'), `${name}: no label`).toContainText(name, { timeout: 30_000 });
    await expect(page.locator('.hero-dist-group-flag'), `${name}: its label is still waiting`).not.toHaveAttribute('data-pending', /./, { timeout: 30_000 });
    await expect(page.locator('.hero-dist-group-curve'), `${name}: no outline`).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.hero-dist-group-median'), `${name}: no median line`).toHaveCount(1);
    seen.push(name);
  }
  expect(seen, 'the thin titles this is about are not among the suggestions').toEqual(expect.arrayContaining(['Professor', 'Assistant Professor']));
});

/** Where the dots of the field and the pile are laid out, full page. */
const FIELDS = { main: '.hero-dist-full .hero-dots', pile: '.hero-dist-full .hero-dots-over' } as const;
async function laidOut(page: Page) {
  return { main: await places(page, FIELDS.main), pile: await places(page, FIELDS.pile) };
}
/** Columns where one of the group sits above anyone else in it — among the dots `shown` keeps — and dots
 *  moved across from `was`. A column is the dots at one x, where the field packs them. */
function unsettled(now: { main: number[]; pile: number[] }, was: { main: number[]; pile: number[] }, lit: { main: Set<number>; pile: Set<number> },
  shown: (field: 'main' | 'pile', i: number) => boolean = () => true) {
  const bad: string[] = [];
  for (const field of ['main', 'pile'] as const) {
    const pts = now[field];
    const cols = new Map<number, { low: number; high: number }>();
    for (let i = 0; i < pts.length / 2; i++) {
      if (pts[2 * i] !== was[field][2 * i]) bad.push(`${field} dot ${i} moved across`);
      if (!shown(field, i)) continue;
      const c = cols.get(pts[2 * i]) ?? { low: Infinity, high: -Infinity };
      // y runs down: the group's highest is its least y, and everyone else's lowest their greatest.
      if (lit[field].has(i)) c.low = Math.min(c.low, pts[2 * i + 1]);
      else c.high = Math.max(c.high, pts[2 * i + 1]);
      cols.set(pts[2 * i], c);
    }
    for (const [x, c] of cols) if (c.low < c.high) bad.push(`${field} column at ${x}: one of the group above someone else`);
  }
  return bad;
}
/** Pixel columns whose dots' ranks (the rain's order, and what shading reads as a column's floor and top) do
 *  not count up from the floor: in each, rank k must be the k-th lowest dot. */
function misranked(pts: number[], rk: number[]) {
  const cols = new Map<number, number[]>();
  for (let i = 0; i < rk.length; i++) {
    const c = Math.floor(pts[2 * i]);
    const list = cols.get(c);
    if (list) list.push(i); else cols.set(c, [i]);
  }
  const bad = new Set<string>();
  for (const [c, ids] of cols) {
    const up = [...ids].sort((a, b) => rk[a] - rk[b]);
    up.forEach((i, k) => {
      if (rk[i] !== k) bad.add(`column ${c}: its ranks are not 0 to ${ids.length - 1}`);
      else if (k > 0 && pts[2 * i + 1] > pts[2 * up[k - 1] + 1] + 1e-6) bad.add(`column ${c}: rank ${k} sits below rank ${k - 1}`);
    });
  }
  return [...bad].slice(0, 5);
}
/** A field's lit dots as the page prints them (`data-lit`): how many, and the sum and sum of squares of places. */
const printOf = (lit: Set<number>) => { let n = 0, sum = 0, sq = 0; for (const i of lit) { n++; sum += i; sq += i * i; } return `${n}:${sum}:${sq}`; };
/** Which dots of each field a filter's people are. */
function litOf(who: { person_key: string }[], at: Map<string, { field: 'main' | 'pile'; index: number }>) {
  const lit = { main: new Set<number>(), pile: new Set<number>() };
  for (const p of who) { const s = at.get(p.person_key); if (s) lit[s.field].add(s.index); }
  return lit;
}

/**
 * Full page, a filter settles its group to the floor: in every column of the field and the pile none of
 * them sits above anyone else, and no dot moves across — the group becomes a shape of its own inside
 * everyone's, on the same scale. Taken off, every dot is back exactly where it was. In both colourings,
 * and with an employment type seen alone, where its own group settles under the rest of it. On the page, a
 * preview moves nothing (search-suggestions.spec).
 */
test('a filter settles its group to the floor of each column, and taking it off puts every dot back', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const at = await spots();
  const ra = await codeOf('Research Associate');
  const prof = await codeOf('Professor');
  const dots = page.locator(FIELDS.main);
  const settled = async (lit: string | null) => {
    if (lit) await expect(dots).toHaveAttribute('data-lit', lit, { timeout: 60_000 });
    else await expect(dots).not.toHaveAttribute('data-lit', /./);
    await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    await expect(page.locator(FIELDS.pile)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  };
  for (const colouring of ['By employment type', 'Generic']) {
    if (colouring === 'Generic') {
      await page.locator('.hero-dist-full .hero-dist-toggle').getByText('Generic', { exact: true }).click();
      await expect(dots).toHaveAttribute('data-stack', 'off');
      await settled(null);
    }
    const was = await laidOut(page);
    for (const [label, on, f] of [
      ['Research Associate', () => put(page, 'research assoc', `t:${ra}`), { code: ra }],
      ['Professor', () => put(page, 'professor', `t:${prof}`), { code: prof }],
      [SCHOOL, async () => { await page.locator('.search-token-x').click(); await put(page, 'medicine', `d:${SCHOOL}`); }, { school: SCHOOL }],
    ] as const) {
      await on();
      const lit = litOf(await covered(f), at);
      await settled(printOf(lit.main));
      const now = await laidOut(page);
      expect(unsettled(now, was, lit), `${colouring}, ${label}`).toEqual([]);
      // Ranked afresh from the floor, as settled: the rain and the group's own crest read these.
      expect(misranked(now.main, await ranks(page, FIELDS.main)), `${colouring}, ${label}: ranks`).toEqual([]);
      let moved = 0;
      for (let i = 0; i < now.main.length; i++) if (now.main[i] !== was.main[i]) moved++;
      expect(moved, `${colouring}, ${label}: nothing moved, so nothing here is tested`).toBeGreaterThan(100);
    }
    await page.locator('.search-token-x').click();
    await settled(null);
    expect(await laidOut(page), `${colouring}: taking the filter off left dots out of place`).toEqual(was);
  }
  // One employment type alone, and a filter within it: Faculty, and Professor.
  await page.locator('.hero-dist-full .hero-dist-toggle').getByText('By employment type', { exact: true }).click();
  await expect(dots).toHaveAttribute('data-stack', 'on');
  await settled(null);
  const cats = HOME_STATS.pay_counts.categories.map((c) => c.name);
  const faculty = cats.indexOf('Faculty');
  await page.locator('.hero-dist-full .hero-dist-legend-item[data-category="Faculty"]').click();
  await expect(dots).toHaveAttribute('data-solo', String(faculty));
  await expect(dots).toHaveAttribute('data-flight', 'idle', { timeout: 10_000 });
  const was = await laidOut(page);
  await put(page, 'professor', `t:${prof}`);
  const lit = litOf(await covered({ code: prof }), at);
  await settled(printOf(lit.main));
  const everyone = await people();
  const isFaculty = { main: new Set<number>(), pile: new Set<number>() };
  for (const p of everyone) { const s = at.get(p.person_key); if (s && p.cat === 'Faculty') isFaculty[s.field].add(s.index); }
  expect(unsettled(await laidOut(page), was, lit, (field, i) => isFaculty[field].has(i)), 'Faculty alone, Professor on').toEqual([]);
  // And a group across the types: the School of Medicine is faculty and staff alike. The type seen alone
  // keeps the bottom of every column, and the school's part of it settles to the floor under the rest of it.
  await page.locator('.search-token-x').click();
  await put(page, 'medicine', `d:${SCHOOL}`);
  const med = litOf(await covered({ school: SCHOOL }), at);
  await settled(printOf(med.main));
  const now = await laidOut(page);
  expect(unsettled(now, was, med, (field, i) => isFaculty[field].has(i)), 'Faculty alone, Medicine on').toEqual([]);
  expect(unsettled(now, was, isFaculty), 'Faculty alone, Medicine on: someone else under the type seen alone').toEqual([]);
});

/**
 * The names the search hangs on its dots follow them when a filter settles or lifts the field — under
 * Reduce Motion too, where the dots jump and no moving ever ends to say read them again: each leader still
 * starts at its own dot's rim. Taking the filter off with names up moves every marked dot it touches.
 */
test('the search’s names follow their dots when a filter comes off, under Reduce Motion too', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await fullPage(page);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(page.locator(FIELDS.main)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await bar(page).fill('smith');
  await expect(page.locator('.hero-found-label').first()).toBeVisible({ timeout: 60_000 });
  const marksWere = await page.locator(FIELDS.main).getAttribute('data-marks');
  // Off with its ×, the names still up.
  await page.locator('.search-token-x').click();
  await expect(page.locator(FIELDS.main)).not.toHaveAttribute('data-lit', /./);
  await expect(bar(page)).toHaveValue('smith');
  await page.waitForTimeout(400);
  const marks = (await page.locator(FIELDS.main).getAttribute('data-marks'))!;
  expect(marks, 'no marked dot moved when the filter came off, so nothing here is tested').not.toBe(marksWere);
  const r = Number(await page.locator(FIELDS.main).getAttribute('data-mark-r'));
  const dots = marks.split(' ').map((m) => m.split(':').slice(1).map(Number));
  const starts = await page.locator('.hero-found-leaders line').evaluateAll((ls) => ls.map((l) => [Number(l.getAttribute('x1')), Number(l.getAttribute('y1'))]));
  expect(starts.length, 'no names were hung on the dots').toBeGreaterThan(2);
  for (const [x, y] of starts) {
    const d = Math.min(...dots.map(([dx, dy]) => Math.hypot(dx - x, dy - y)));
    expect(d, `a name's leader starts ${d.toFixed(1)}px from any marked dot: it points where the dot was`).toBeLessThan(r * 2 + 3);
  }
  await ctx.close();
});

/**
 * A settled group is shaded as a shape of its own: in each column its top dot takes the crest's light and
 * its foot the floor's shade, as everyone's do in theirs. Shaded by the whole column's height, the group
 * would sit at the foot of every column and all of it would be the field's darkest. On a dark page, in one
 * ink, so light is all that differs between dots; read at each dot's middle, inside its neighbours' reach.
 */
test('a settled group is shaded from its own floor to its own top', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await fullPage(page);
  const dots = page.locator(FIELDS.main);
  await page.locator('.hero-dist-full .hero-dist-toggle').getByText('Generic', { exact: true }).click();
  await expect(dots).toHaveAttribute('data-stack', 'off');
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  const at = await spots();
  await put(page, 'medicine', `d:${SCHOOL}`);
  const lit = litOf(await covered({ school: SCHOOL }), at).main;
  await expect(dots).toHaveAttribute('data-lit', printOf(lit), { timeout: 60_000 });
  await expect(dots).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  await page.waitForTimeout(600);
  const pts = await places(page, FIELDS.main);
  const r = Number(await dots.getAttribute('data-r'));
  // Each column's group, top and foot.
  const cols = new Map<number, number[]>();
  for (const i of lit) cols.set(pts[2 * i], [...(cols.get(pts[2 * i]) ?? []), i]);
  const ends = [...cols.values()].filter((c) => c.length >= 6).map((c) => {
    c.sort((a, b) => pts[2 * a + 1] - pts[2 * b + 1]);
    return [c[0], c[c.length - 1]];
  });
  expect(ends.length, 'too few columns hold enough of the group to have a top and a foot').toBeGreaterThan(40);
  const light = await page.evaluate(([sel, xy, w]) => {
    const cv = document.querySelector(`${sel} canvas`) as HTMLCanvasElement;
    const k = cv.width / cv.getBoundingClientRect().width;
    const ctx = cv.getContext('2d')!;
    return xy.map(([x, y]) => {
      const x0 = Math.floor((x - w) * k), y0 = Math.floor((y - w) * k), s = Math.ceil(2 * w * k) + 1;
      const d = ctx.getImageData(x0, y0, s, s).data;
      let t = 0, n = 0;
      for (let q = 0; q < s * s; q++) {
        const px = x0 + (q % s) + 0.5, py = y0 + Math.floor(q / s) + 0.5;
        if (Math.hypot(px - x * k, py - y * k) > w * k) continue;
        t += ((0.2126 * d[4 * q] + 0.7152 * d[4 * q + 1] + 0.0722 * d[4 * q + 2]) * d[4 * q + 3]) / 255;
        n++;
      }
      return t / Math.max(1, n);
    });
  }, [FIELDS.main, ends.flatMap(([top, foot]) => [[pts[2 * top], pts[2 * top + 1]], [pts[2 * foot], pts[2 * foot + 1]]] as [number, number][]), 0.6 * r] as const);
  const ratios = ends.map((_, q) => light[2 * q] / Math.max(1, light[2 * q + 1])).sort((a, b) => a - b);
  // Measured: about 1.4 shaded as its own, about 1.05 shaded by the column (the foot of every column is
  // about as dark as the next dot up).
  const median = ratios[ratios.length >> 1];
  expect(median, `the group's top is not lit above its foot (top ÷ foot ${median.toFixed(2)}, at the median of ${ends.length} columns)`).toBeGreaterThan(1.25);
  await ctx.close();
});

/**
 * While a group is shown, the wash under everyone's curve fades to half, so the group's own shape at the
 * floor is what reads as filled; everyone's curve itself stays. Taken off, the wash comes back.
 */
test('the wash under everyone’s curve fades to half while a group is shown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const wash = page.locator('.hero-dist-full .hero-dist-wash');
  await expect(wash).toHaveCount(1);
  const opacity = () => wash.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(await opacity()).toBe(1);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(page.locator(FIELDS.main)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect.poll(opacity).toBeCloseTo(0.5, 2);
  expect(await page.locator('.hero-dist-full .hero-dist-plot').evaluate((el) => Number(getComputedStyle(el).opacity)), 'everyone’s curve faded too').toBe(1);
  await page.locator('.search-token-x').click();
  await expect.poll(opacity).toBe(1);
});

/**
 * The dots a filter is not about are drawn faint, not left alone and not hidden: over a stretch of pay with
 * none of the group in it, the field's ink falls to about a fifth. `data-lit` only says which dots the mask
 * lights; this is the paint.
 */
/**
 * While a filter settles its group the whole field is painted in squares, until it rests. Where none of the
 * group is — the dense middle, filtered to a title all paid over $100k — the faint dots do not move, and in
 * squares they must weigh what they do as beads at rest, as a moving field's still dots do (dots.spec). Sized
 * from the field's full-size bead, a faint square laid down 13% more than its faint bead (measured 1.135),
 * and the context darkened for the length of every settle; sized from its own bead, 1.003.
 */
for (const scheme of ['light', 'dark'] as const) test(`while a filter settles, the faint dots it leaves in place weigh what they do at rest (${scheme})`, async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await fullPage(page);
  const code = await codeOf('System Engineer IV');
  const lowest = Math.min(...(await covered({ code })).map((p) => p.pay));
  const band = [xOf(45_000), xOf(Math.min(85_000, lowest - 10_000))];
  expect(band[1] - band[0], 'the premise: a stretch of the dense middle with none of the title in it').toBeGreaterThan(40);
  // The ink over the band, on a scale of the plot's width in thousandths; read in the page the moment the
  // field is moving — two frames after `data-settled` goes false, so squares are what is on the canvas.
  await page.evaluate(([a, b]) => {
    const w = window as unknown as { inkOver: (a: number, b: number) => number; movingInk?: number };
    const field = document.querySelector('.hero-dist-full .hero-dots')!;
    w.inkOver = (x0, x1) => {
      const c = field.querySelector('canvas') as HTMLCanvasElement;
      const k = c.width / c.clientWidth, cw = c.clientWidth;
      const l = Math.round((x0 / 1000) * cw * k), r = Math.round((x1 / 1000) * cw * k);
      const d = c.getContext('2d')!.getImageData(l, 0, r - l, c.height).data;
      let t = 0;
      for (let i = 3; i < d.length; i += 4) t += d[i];
      return t;
    };
    new MutationObserver(() => {
      if (field.getAttribute('data-settled') !== 'false' || w.movingInk != null) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (field.getAttribute('data-settled') === 'false' && w.movingInk == null) w.movingInk = w.inkOver(a, b);
      }));
    }).observe(field, { attributes: true, attributeFilter: ['data-settled'] });
  }, band);
  await put(page, 'system engineer iv', `t:${code}`);
  await expect(page.locator(FIELDS.main)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator(FIELDS.main)).toHaveAttribute('data-settled', 'true');
  await page.waitForTimeout(600);
  const [moving, rest] = await page.evaluate(([a, b]) => {
    const w = window as unknown as { inkOver: (a: number, b: number) => number; movingInk?: number };
    return [w.movingInk ?? null, w.inkOver(a, b)];
  }, band);
  expect(moving, 'the field was never read while it moved, so nothing here is tested').not.toBeNull();
  expect(Math.abs(moving! / rest - 1), `the faint dots in squares against at rest: ${Math.round(moving!)} of ${Math.round(rest)}`).toBeLessThan(0.06);
  await ctx.close();
});

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
    // And searching with both on. Its results drop in a list under the box, which lies on the graph while
    // the box is in use — that is the list's to answer for (search-bar-list.spec) — and must not move the
    // plot; once the box is left, nothing of the bar may lie there.
    await bar(page).fill('aaron');
    await expect(page.locator('.hero-dist-full .search-bar-list [role="option"]').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(300);
    expect(await plotShape(page), `${width}px: searching with two filters on moved the plot`).toEqual(before);
    await bar(page).blur();
    await check('searching with two filters on, the box left');
    await bar(page).focus();
    await bar(page).fill('');
    await bar(page).press('Escape');
    await bar(page).press('Escape');
    await expect(tokens(page)).toHaveCount(0);
    await check('taking them off');
    await ctx.close();
  }
});

/**
 * Putting a filter on and taking it off, full page, the group settles to the floor and back: each column's
 * places are dealt again with its lit dots first, every dot eases up or down its own column in squares, and the
 * field goes back into beads a strip a frame. Each of those is timed, at CI's pace. What this guards
 * against is the field repainted whole in beads at once — about 55ms at that pace, which the end of a
 * re-stack did until it swept in strips.
 */
test('putting a filter on and taking it off settle and repaint within a frame, at CI’s pace', async ({ page }) => {
  await atCiPace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  const marks = ['dim-paint', 'dot-frame', 'pile-frame', 'dot-layout'];
  await page.evaluate((m) => m.forEach((n) => performance.clearMeasures(n)), marks);
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true');
  await page.waitForTimeout(800);
  await page.locator('.search-token-x').click();
  await expect(page.locator('.hero-dist-full .hero-dots')).not.toHaveAttribute('data-lit', /./);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true');
  await page.waitForTimeout(800);
  const t = await page.evaluate((m) => Object.fromEntries(m.map((n) => [n, performance.getEntriesByName(n).map((e) => e.duration)])), marks);
  expect(t['dim-paint'].length, 'the field never went back into beads in strips, so nothing was timed').toBeGreaterThanOrEqual(2 * 8);
  expect(t['dot-frame'].length, 'the dots never moved, so no frame was timed').toBeGreaterThanOrEqual(4);
  expect(t['dot-layout'].length, 'the field was never packed again').toBeGreaterThanOrEqual(2);
  // The frames of the move are judged as every moving frame in this suite is, by the median (dots.spec,
  // tail.spec), and none may hold two frames: every dot of the field is in each of them, and at this pace
  // they run close to the budget throughout, so the slowest of twenty is the machine's as often as not.
  for (const [what, ds] of [['moving frame', t['dot-frame']], ['moving frame of the pile', t['pile-frame']]] as const) {
    if (!ds.length) continue;
    const sorted = [...ds].sort((a, b) => a - b);
    const all = `${ds.map((d) => d.toFixed(1)).join(', ')}ms`;
    expect(sorted[Math.floor(sorted.length / 2)], `a ${what}, ms, at the median: ${all}`).toBeLessThan(FRAME_MS);
    expect(sorted[sorted.length - 1], `a ${what} held two frames: ${all}`).toBeLessThan(2 * FRAME_MS);
  }
  // The repaints and the packings are each one piece of work: one of each may run over, by less than a
  // frame; no two may. A deploy failed on a single 14.4ms repaint among thirty-odd of 0.1–10.4 on a shared
  // runner, a hiccup of the machine and not of the code.
  for (const [what, ds] of [['repaint', t['dim-paint']], ['packing', t['dot-layout']]] as const) {
    const slow = [...ds].sort((a, b) => b - a);
    const all = `${ds.map((d) => d.toFixed(1)).join(', ')}ms`;
    expect(slow[0], `a ${what} held two frames: ${all}`).toBeLessThan(2 * FRAME_MS);
    if (slow.length > 1) expect(slow[1], `more than one ${what} held a frame: ${all}`).toBeLessThan(FRAME_MS);
  }
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
 * The way in from the page's own search: a title or school row offers "Show on full page graph" beside opening its
 * page. It opens the graph full page with that group put on and the box emptied, leaving no list behind; the
 * keyboard's way is Shift+Enter on the row; the row itself still opens the title's page.
 */
test('"Show on full page graph" in the page’s search opens the graph full page with that group on', async ({ page }) => {
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

test('the page’s search list, with "Show on full page graph" on its rows, passes a strict accessibility scan', async ({ page }) => {
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
