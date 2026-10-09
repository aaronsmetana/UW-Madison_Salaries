import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, spots, plotShape, barOverPlot, places, people } from './homeDots';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Full page, the bar filters the graph by a title, a school, or a title within a school: that group's squares
 * stay lit where they stand, the rest fade, nobody moves, a pin marks the group's median, and the
 * toolbar's chip says how many they are and how their median sits against campus. Everything here is checked
 * against the data directly — who is covered, which squares are theirs, their median, the words for the gap —
 * each restated from its rule rather than taken from the page's code.
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
/** A pay's x on the plot, CSS px: its $1k column's share of the axis (the field prints its column width). */
async function xOf(page: Page, pay: number) {
  const colW = Number(await page.locator('.hero-dist-full .hero-dots').getAttribute('data-col-w'));
  return (pay / 5000) * colW;
}
/** The chip in the toolbar that names what is shown: "{name} · {n} people · median {$Nk} · {against campus}". */
const chip = (page: Page) => page.locator('.strata-chip > span');
const chipText = (name: string, who: { pay: number }[]) => {
  const med = medianOf(who.map((p) => p.pay));
  return `${name} · ${num(who.length)} ${who.length === 1 ? 'person' : 'people'} · median ${fmtK(med)} · ${vs(med, HOME_STATS.p50)}`;
};

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
 *  appointment that has the code, is in the school, or — both given — is both. A name typed: whose name
 *  on such an appointment contains it, any case. */
function covered(f: { code?: string; school?: string; name?: string }) {
  const cond = [
    f.code ? `job_code = '${f.code}'` : null,
    f.school ? `school = '${f.school.replace(/'/g, "''")}'` : null,
    f.name ? `contains(lower(first_name || ' ' || last_name), '${f.name.toLowerCase().replace(/'/g, "''")}')` : null,
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
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
}
/** The field full page, which prints both its lit squares under the cap (`data-lit`) and in the pile (`data-pile-lit`). */
const FIELD = '.hero-dist-full .hero-dots';

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
    await expect(page.locator(FIELD), `${c.name}: the lit squares under the cap`).toHaveAttribute('data-lit', want.main, { timeout: 60_000 });
    await expect(page.locator(FIELD), `${c.name}: the lit squares in the pile`).toHaveAttribute('data-pile-lit', want.pile);
    await expect(chip(page), `${c.name}: its chip`).toHaveText(chipText(c.name, who));
    // Its median's pin: labelled, and its line at the median's pay.
    const med = medianOf(who.map((p) => p.pay));
    await expect(page.locator('.hero-dist-full .strata-pin-label-filter'), `${c.name}: its pin`).toHaveText(`${c.name} median ${fmtK(med)}`);
    const lineX = Number(await page.locator('.hero-dist-full .strata-pin-filter').getAttribute('x1'));
    expect(Math.abs(lineX - (await xOf(page, med))), `${c.name}: its pin is off its median`).toBeLessThan(0.5);
  }
});
/**
 * A name typed lights everyone it names on the graph, as a title's people are lit: "aaron" lights every
 * Aaron with a dot, where the list can name only six. Full page, within the filters on: "wang" among the
 * Research Associates. A title typed for names nobody, and lights nothing until its row is gone to.
 */
test('a name typed lights exactly the people it names, within the filters full page; a title typed lights nothing', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const at = await spots();
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const pageBox = page.getByRole('combobox', { name: 'Search a person, title or division' });

  await pageBox.fill('aaron');
  const aarons = await covered({ name: 'aaron' });
  expect(aarons.length, 'more Aarons than the graph names, so lighting them all is a real check').toBeGreaterThan(20);
  const lit = prints(aarons, at);
  await expect(page.locator('.hero-dots'), 'the lit squares under the cap').toHaveAttribute('data-lit', lit.main, { timeout: 60_000 });
  await expect(page.locator('.hero-dots'), 'the lit squares in the pile').toHaveAttribute('data-pile-lit', lit.pile);
  await expect(chip(page)).toHaveText(chipText('“aaron”', aarons));

  // A title typed for: nobody's name, so nothing lit and no label, until its row is gone to.
  await pageBox.fill('research assoc');
  await expect(page.locator('[role="option"][data-kind="title"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hero-dist-main').first(), 'a title typed lit a group').not.toHaveAttribute('data-filter', /./);
  await expect(page.locator('.hero-dots')).not.toHaveAttribute('data-lit', /./);

  // Full page, within a filter: the name's people who are in it.
  await pageBox.fill('');
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const code = await codeOf('Research Associate');
  await put(page, 'research assoc', `t:${code}`);
  const wangs = await covered({ code, name: 'wang' });
  expect(wangs.length, 'too few Wangs among the Research Associates to test within a filter').toBeGreaterThan(3);
  await bar(page).fill('wang');
  const within = prints(wangs, at);
  await expect(page.locator(FIELD), 'full page, the lit squares').toHaveAttribute('data-lit', within.main, { timeout: 60_000 });
  await expect(page.locator(FIELD)).toHaveAttribute('data-pile-lit', within.pile);
  await expect(chip(page)).toHaveText(chipText(`“wang” in ${titleName('Research Associate', code)}`, wangs));
  // Emptied, the filter's own people are lit again.
  await bar(page).fill('');
  const ras = prints(await covered({ code }), at);
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', ras.main, { timeout: 60_000 });
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
 * Pointing at a suggested title or division shows its group where they stand: its squares lit and the rest
 * faded, none moved, and the chip naming it.
 */
test('every suggested title and division lights its people where they stand when pointed at, and names them', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.click();
  const rows = page.locator('[data-suggestions] [role="option"]');
  await expect(rows).toHaveCount(6, { timeout: 60_000 });
  const was = await places(page, '.hero-dots', 'main');
  for (let i = 0; i < 6; i++) {
    const row = rows.nth(i);
    const name = ((await row.locator('p, .mantine-Text-root').first().textContent()) ?? '').trim();
    await pointAt(page, row);
    await expect(chip(page), `${name}: not named`).toContainText(name, { timeout: 30_000 });
    await expect(page.locator('.strata-chip'), `${name}: still waiting`).not.toHaveAttribute('data-pending', /./, { timeout: 30_000 });
    await expect(page.locator('.hero-dots'), `${name}: nothing lit`).toHaveAttribute('data-lit', /^[1-9]/);
    expect(await places(page, '.hero-dots', 'main'), `${name}: a preview moved the squares`).toEqual(was);
  }
});

/** Where the squares under the cap and in the pile rest, full page. */
async function laidOut(page: Page) {
  return { main: await places(page, FIELD, 'main'), pile: await places(page, FIELD, 'pile') };
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
 * Full page, a filter lights its group where they stand: exactly its people lit, and not one square moved — in
 * any column, or the pile — nor a frame of motion drawn, on or off. With a type isolated in the legend too, the
 * two together: only those who are both are lit.
 */
test('a filter lights its group where they stand, moving no one, and taking it off leaves every square where it was', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const at = await spots();
  const ra = await codeOf('Research Associate');
  const prof = await codeOf('Professor');
  const field = page.locator(FIELD);
  const lights = async (lit: string | null) => {
    if (lit) await expect(field).toHaveAttribute('data-lit', lit, { timeout: 60_000 });
    else await expect(field).not.toHaveAttribute('data-lit', /./);
    await expect(field).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  };
  const was = await laidOut(page);
  const frames = () => page.evaluate(() => performance.getEntriesByName('strata-frame').length);
  const f0 = await frames();
  for (const [label, on, f] of [
    ['Research Associate', () => put(page, 'research assoc', `t:${ra}`), { code: ra }],
    ['Professor', () => put(page, 'professor', `t:${prof}`), { code: prof }],
    [SCHOOL, async () => { await page.locator('.search-token-x').click(); await put(page, 'medicine', `d:${SCHOOL}`); }, { school: SCHOOL }],
  ] as const) {
    await on();
    const lit = litOf(await covered(f), at);
    await lights(printOf(lit.main));
    await expect(field, `${label}: the lit squares in the pile`).toHaveAttribute('data-pile-lit', printOf(lit.pile));
    expect(await laidOut(page), `${label}: squares moved`).toEqual(was);
  }
  await page.locator('.search-token-x').click();
  await lights(null);
  expect(await laidOut(page), 'taking the filter off moved squares').toEqual(was);
  expect(await frames(), 'a filter set the squares moving').toBe(f0);

  // Faculty isolated in the legend, and Professor on: those who are both.
  await page.locator('.hero-dist-full .strata-legend-item[data-category="Faculty"]').click();
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-filter', 'Faculty');
  await put(page, 'professor', `t:${prof}`);
  const everyone = await people();
  const both = litOf(everyone.filter((p) => p.cat === 'Faculty'), at);
  const profs = litOf(await covered({ code: prof }), at);
  for (const fld of ['main', 'pile'] as const) for (const i of [...both[fld]]) if (!profs[fld].has(i)) both[fld].delete(i);
  await lights(printOf(both.main));
  expect(await laidOut(page), 'Faculty alone, Professor on: squares moved').toEqual(was);
});

/**
 * The names the search hangs on its squares stay on them when a filter comes off — under Reduce Motion too:
 * nothing moves, so each leader still starts at its own square's rim.
 */
test('the search’s names stay on their squares when a filter comes off, under Reduce Motion too', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await fullPage(page);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(page.locator(FIELD)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await bar(page).fill('smith');
  await expect(page.locator('.hero-found-label').first()).toBeVisible({ timeout: 60_000 });
  // Off with its ×, the names still up, and every Smith lit: the typed name is a group of its own.
  await page.locator('.search-token-x').click();
  await expect(page.locator(FIELD)).toHaveAttribute('data-lit', prints(await covered({ name: 'smith' }), await spots()).main, { timeout: 60_000 });
  await expect(bar(page)).toHaveValue('smith');
  await page.waitForTimeout(400);
  const marks = (await page.locator(FIELD).getAttribute('data-marks'))!;
  // A leader starts 7px out from its square's centre, past the 9px mark drawn on it.
  const r = 4.5;
  const dots = marks.split(' ').map((m) => m.split(':').slice(1).map(Number));
  const starts = await page.locator('.hero-found-leaders line').evaluateAll((ls) => ls.map((l) => [Number(l.getAttribute('x1')), Number(l.getAttribute('y1'))]));
  expect(starts.length, 'no names were hung on the squares').toBeGreaterThan(2);
  for (const [x, y] of starts) {
    const d = Math.min(...dots.map(([dx, dy]) => Math.hypot(dx - x, dy - y)));
    expect(d, `a name's leader starts ${d.toFixed(1)}px from any marked square: it points where the square was`).toBeLessThan(r * 2 + 3);
  }
  await ctx.close();
});

/** What a filter is not about is drawn faded, not hidden: past the group's top pay, where none of them is, every
 *  square stays where it was, in the faded ink. `data-lit` only says which squares the mask lights; this is the paint. */
test('what a filter is not about is drawn faint, not hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  const who = await covered({ code });
  const top = Math.max(...who.map((p) => p.pay).filter((p) => p < HOME_STATS.bin_cap));
  const from = top + 10_000;
  expect(from, 'the group runs to the top of the plot, leaving nowhere without it').toBeLessThan(HOME_STATS.bin_cap - 20_000);
  const band = [await xOf(page, from), Number(await page.locator(FIELD).getAttribute('data-pile-left')) - 20];
  const paint = () => page.evaluate(([a, b]) => {
    const c = document.querySelector('.hero-dist-full .strata-base') as HTMLCanvasElement;
    const k = c.width / c.getBoundingClientRect().width;
    const d = c.getContext('2d')!.getImageData(Math.round(a * k), 0, Math.round((b - a) * k), c.height).data;
    let n = 0, r = 0, g = 0, bl = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { n++; r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
    return { n, rgb: [r / Math.max(1, n), g / Math.max(1, n), bl / Math.max(1, n)] };
  }, band);
  const before = await paint();
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator(FIELD)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator(FIELD)).toHaveAttribute('data-settled', 'true');
  const after = await paint();
  expect(before.n, 'no squares to compare').toBeGreaterThan(100);
  expect(after.n, 'the squares past the group were hidden or moved').toBe(before.n);
  const dim = await page.locator(FIELD).evaluate((el) => { const s = document.createElement('span'); el.appendChild(s); s.style.color = 'var(--strata-dim)'; const c = getComputedStyle(s).color; s.remove(); return c; });
  const [dr, dg, db] = dim.match(/[\d.]+/g)!.map(Number);
  expect(Math.hypot(after.rgb[0] - dr, after.rgb[1] - dg, after.rgb[2] - db), `past the group the squares are not in the faded ink ${dim}`).toBeLessThan(3);
});

test('the readout counts the filter’s people within its window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  const code = await codeOf('Research Associate');
  await put(page, 'research assoc', `t:${code}`);
  await expect(page.locator(FIELD)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  const who = await covered({ code });
  const main = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
  await page.mouse.move(main.x + (await xOf(page, 62_500)), main.y + main.height * 0.6);
  const pill = page.locator('.strata-readout');
  await expect(pill).toContainText('in the filter');
  const text = (await pill.textContent())!;
  // The window is the readout's: the $5k column under the pointer and its neighbours either side (±$5k).
  const bucket = Number(/^\$(\d+)k–/.exec(text)![1]) * 1000;
  const want = who.filter((p) => p.pay < HOME_STATS.bin_cap && Math.abs(Math.floor(p.pay / 5000) * 5000 - bucket) <= 5000).length;
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
  await expect(chip(page)).toHaveText(`No one on the graph is ${raName} in ${none.school}`);
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

test('the search’s names keep below the pins’ rows, and none lies on a pin', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  await put(page, 'research assoc', `t:${await codeOf('Research Associate')}`);
  await bar(page).fill('smith');
  await expect(page.locator('.hero-found-label').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  expect(await page.locator('.hero-found-label').count(), 'nobody was named, so nothing here is tested').toBeGreaterThan(2);
  const hits = await page.evaluate(() => {
    const pins = [...document.querySelectorAll('.hero-dist-full .strata-pin')].map((p) => p.getBoundingClientRect());
    return [...document.querySelectorAll('.hero-found-label')].filter((l) => {
      const r = l.getBoundingClientRect();
      return pins.some((f) => r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top);
    }).map((l) => l.textContent);
  });
  expect(hits, 'a name lies on a pin').toEqual([]);
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
  await expect(page.locator(FIELD), 'someone holding the title only unpaid was lit')
    .toHaveAttribute('data-lit', prints(who, at).main, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-group-count', String(who.length));
});

test('with two filters on, the bar and the group’s chip pass a strict accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullPage(page);
  await put(page, 'research assoc', `t:${await codeOf('Research Associate')}`);
  await put(page, 'medicine', `d:${SCHOOL}`);
  await expect(page.locator(FIELD)).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator('.strata-chip')).toBeVisible();
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
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
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
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.getByRole('combobox', { name: /Search a person/ }).fill('medicine');
  await expect(page.locator('.search-show-on-graph').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page }).include('.search-dropdown').include('[role="combobox"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(await page.getByRole('combobox', { name: /Search a person/ }).getAttribute('aria-describedby'), 'the keyboard’s way to it is not said').toBeTruthy();
});
