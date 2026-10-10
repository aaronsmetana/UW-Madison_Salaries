import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, latestSnapshot } from './oracle';
import { HOME_STATS, people, spots } from './homeDots';
import { atCiPace, FRAME_MS } from './pace';
import { parseColor, flatten, contrast } from './color';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The landing graph (mockup 3a, components/strata): one square per person in $5k columns, sorted by salary from
 * the baseline up and coloured by employment type, each square on whole pixels with a gap round it; a lens that
 * magnifies where the pointer is and names the square under it, reaching further where the people it can name
 * are few; a type isolated from the legend, lit where its people stand. Who is where is checked against the
 * data through the same indexing the search's marks use (homeDots `spots`), each rule restated here. The pile
 * past the cap, and its unrolling, are strata-tail.spec's.
 */

const SNAP = HOME_STATS.snapshot_id;
const CAP = HOME_STATS.bin_cap;
const { counts, categories } = HOME_STATS.pay_counts;
const UNDER = counts.reduce((t, n) => t + n, 0);
const OVER = categories.reduce((t, c) => t + c.over, 0);
/** A column's width. */
const COL = 5000;
/** The snapshots, oldest first, each with its median. */
const SUMMARY = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/summary.json', import.meta.url)), 'utf8')) as { snapshots: { label: string; median: number }[] };
const num = (n: number) => n.toLocaleString('en-US');
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

type Field = 'main' | 'pile';
const field = (page: Page) => page.locator('.hero-dist:not([data-full="on"]) .strata-field, .hero-dist-full .strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
/** Every square's resting centre, x then y, in the plot's px. */
const placesOf = (page: Page, f: Field) =>
  field(page).evaluate((el, f) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces(f), f);
/** Every square's slot up its column, 0 at the floor. */
const slotsOf = (page: Page, f: Field) =>
  field(page).evaluate((el, f) => (el as HTMLElement & { squareSlots: (f: string) => number[] }).squareSlots(f), f);

/** The landing page with its squares at rest; the drop already seen this session unless asked for. */
async function home(page: Page, { drop = false } = {}) {
  if (!drop) await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}

/** Everyone's $5k column (under the cap) and category, by their square's index. */
async function byIndex() {
  const at = await spots();
  const rows = await people();
  const main: { key: string; col: number; cat: string; pay: number }[] = [];
  const pile: { key: string; cat: string; pay: number }[] = [];
  for (const p of rows) {
    const s = at.get(p.person_key);
    if (!s) continue;
    if (s.field === 'main') main[s.index] = { key: p.person_key, col: Math.floor(p.pay / COL), cat: p.cat, pay: p.pay };
    else pile[s.index] = { key: p.person_key, cat: p.cat, pay: p.pay };
  }
  return { main, pile, rows };
}

test('the landing page draws one square for each person, under the cap and in the pile, and loads no database', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await home(page);
  await expect(plot(page)).toHaveAttribute('data-squares', `${UNDER}:${OVER}`);
  expect((await placesOf(page, 'main')).length / 2).toBe(UNDER);
  expect((await placesOf(page, 'pile')).length / 2).toBe(OVER);
  // Everyone paid is a square: the counts are everyone in the snapshot with pay.
  const [r] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL WHERE snapshot_id = '${SNAP}' GROUP BY person_key) WHERE pay > 0`,
  );
  expect(UNDER + OVER).toBe(r.n);
  expect(requests.filter((u) => /\.parquet|duckdb/i.test(u)), 'the landing page fetched the database').toEqual([]);
});

test('each column stands its own people from the baseline up, a few a row, sorted by salary — the same on every load', async ({ page }) => {
  await home(page);
  const { main } = await byIndex();
  const pts = await placesOf(page, 'main');
  const slots = await slotsOf(page, 'main');
  const per = Number(await field(page).getAttribute('data-per'));
  const rowPitch = Number(await field(page).getAttribute('data-row-pitch'));
  // A column is $5k: every square of column c lies in its own share of the axis, before the next one's.
  const lefts = new Map<number, number>();
  for (let i = 0; i < main.length; i++) {
    const c = Math.min(49, main[i].col);
    lefts.set(c, Math.min(lefts.get(c) ?? Infinity, pts[2 * i]));
  }
  const sorted = [...lefts.entries()].sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < sorted.length; k++) expect(sorted[k][1], `column ${sorted[k][0]} starts before ${sorted[k - 1][0]}`).toBeGreaterThan(sorted[k - 1][1]);
  // Slots fill each column from the floor with no gaps, `per` a row, and by pay from the floor up — to the $100 the
  // page's counts know a pay by.
  const cols = new Map<number, number[]>();
  for (let i = 0; i < main.length; i++) cols.set(main[i].col, [...(cols.get(main[i].col) ?? []), i]);
  for (const [c, idx] of cols) {
    const bySlot = idx.sort((a, b) => slots[a] - slots[b]);
    expect(bySlot.map((i) => slots[i]), `column ${c}'s slots`).toEqual(bySlot.map((_, k) => k));
    const pays = bySlot.map((i) => Math.floor(main[i].pay / 100));
    expect(pays, `column ${c} is not sorted by salary`).toEqual([...pays].sort((a, b) => a - b));
    // Up a row every `per` squares.
    const y0 = pts[2 * bySlot[0] + 1];
    bySlot.forEach((i, k) => expect(Math.abs(pts[2 * i + 1] - (y0 - Math.floor(k / per) * rowPitch))).toBeLessThan(0.01));
  }
  // Each square in its type's ink: a few of each, read off the canvas at their centres.
  const inkOf: Record<string, string> = { 'Academic Staff': '--cat-academic', 'University Staff': '--cat-university', Faculty: '--cat-faculty', 'Employees in Training': '--cat-training', Limited: '--cat-limited' };
  for (const [cat, token] of Object.entries(inkOf)) {
    const want = parseColor(await page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, token));
    const some = main.map((p, k) => (p.cat === cat ? k : -1)).filter((k) => k >= 0).filter((_, n) => n % 397 === 0).slice(0, 6);
    const got = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement, pts) => {
      const k = c.width / c.getBoundingClientRect().width;
      const ctx = c.getContext('2d')!;
      return pts.map(([x, y]) => [...ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data].slice(0, 3));
    }, some.map((k) => [pts[2 * k], pts[2 * k + 1]] as [number, number]));
    for (const g of got) expect(Math.hypot(g[0] - want[0], g[1] - want[1], g[2] - want[2]), `a ${cat} square is painted ${g}, not ${want}`).toBeLessThan(4);
  }
  // And the same again on another load.
  const again = await page.context().newPage();
  await home(again);
  expect(await placesOf(again, 'main')).toEqual(pts);
  await again.close();
});

test('with reduced motion the squares are simply there; otherwise the drop stays inside the frame budget and lands every one', async ({ browser }) => {
  const still = await browser.newContext({ reducedMotion: 'reduce' });
  const p1 = await still.newPage();
  await home(p1, { drop: true });
  expect(await p1.evaluate(() => performance.getEntriesByName('strata-frame').length), 'frames were animated').toBe(0);
  await expect(p1.locator('.hero-dist-drop'), '"Drop again" under reduced motion').toHaveCount(0);
  const rest = await placesOf(p1, 'main');
  await still.close();

  const moving = await browser.newContext({ reducedMotion: 'no-preference' });
  const p2 = await moving.newPage();
  await atCiPace(p2);
  await home(p2, { drop: true });
  const frames = await p2.evaluate(() => performance.getEntriesByName('strata-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the drop played').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(FRAME_MS);
  expect(await placesOf(p2, 'main'), 'the squares landed somewhere else').toEqual(rest);
  // "Drop again" plays it once more, and they land where they were.
  const before = frames.length;
  await p2.locator('.hero-dist-drop').click();
  await expect(field(p2)).toHaveAttribute('data-settled', 'false');
  await expect(field(p2)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  expect(await p2.evaluate(() => performance.getEntriesByName('strata-frame').length)).toBeGreaterThan(before + 5);
  await moving.close();
});

/** The lens on a square: the pointer over the plot at a share of its width and height, held still until the
 *  names are in and a square is picked. */
async function pointAt(page: Page, fx: number, fy: number) {
  const box = (await plot(page).boundingBox())!;
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x - 12, y);
  await page.mouse.move(x, y, { steps: 4 });
  await expect(plot(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  await page.mouse.move(x + 0.5, y);
  await expect(plot(page)).toHaveAttribute('data-pick', /^(main|pile):\d+$/, { timeout: 5_000 });
  // Until the lens has come to rest on the pointer: on its way, the square under the pointer changes.
  let was = '';
  await expect.poll(async () => { const now = await plot(page).getAttribute('data-pick') ?? ''; const same = now === was; was = now; return same; }, { intervals: [250] }).toBe(true);
  return { x, y };
}

test('the loupe names the square under it (3a): who, their title, department and type, their pay and how it moved, and their pay in every snapshot', async ({ page }) => {
  await home(page);
  await pointAt(page, 0.3, 0.85);
  const [f, i] = (await plot(page).getAttribute('data-pick'))!.split(':') as [Field, string];
  const { main, pile } = await byIndex();
  const who = (f === 'main' ? main : pile)[Number(i)];
  // Their name and title: the appointment their square is coloured by — the highest-paid.
  const [n] = await oracle<{ fn: string; ln: string; title: string; department: string | null; school: string | null }>(
    `SELECT first_name fn, last_name ln, title, department, school FROM (SELECT first_name, last_name, title, department, school,
       row_number() OVER (ORDER BY ${PAY} DESC, coalesce(employee_category, 'Other'), title, school) k
       FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND person_key = '${who.key.replace(/'/g, "''")}') WHERE k = 1`,
  );
  const snaps = await oracle<{ id: string }>(`SELECT DISTINCT snapshot_id id FROM $SAL ORDER BY id`);
  const prevId = snaps[snaps.findIndex((s) => s.id === SNAP) - 1].id;
  // Named as the site names a snapshot: "Mar 2026".
  const prevLabel = new Date(`${prevId}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const [prev] = await oracle<{ pay: number | null }>(
    `SELECT sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${prevId}' AND salary > 0 AND person_key = '${who.key.replace(/'/g, "''")}'`,
  );
  const card = page.locator('.strata-card');
  await expect(card).toHaveAttribute('data-who', who.key);
  await expect(card.locator('.strata-card-name')).toHaveText(new RegExp(`^${n.fn}\\s+${n.ln}$`, 'i'));
  await expect(card.locator('.strata-card-title')).toHaveText(n.title);
  await expect(card.locator('.strata-card-dept')).toHaveText((n.department || n.school)!);
  await expect(card.locator('.strata-card-meta')).toHaveText(who.cat);
  await expect(card.locator('.strata-card-pay > span').first()).toHaveText(`$${Math.round(who.pay).toLocaleString('en-US')}`);
  // How it moved, in dollars: joined, no change, or up or down by so much.
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  const d = prev.pay == null || !(prev.pay > 0) ? null : who.pay - prev.pay;
  const change = d == null ? `Joined since ${prevLabel}` : Math.abs(d) < 1 ? `No change since ${prevLabel}` : `${d > 0 ? '+' : '−'}${usd(Math.abs(d))} since ${prevLabel}`;
  await expect(card.locator('.strata-card-change')).toHaveText(change);
  await expect(card.locator('.strata-card-change')).toHaveAttribute('data-tone', d == null ? 'new' : Math.abs(d) < 1 ? 'flat' : d > 0 ? 'up' : 'down');
  // Their pay in every snapshot they were paid in, the one shown marked; the first and last snapshots named.
  const [{ n: paidIn }] = await oracle<{ n: number }>(
    `SELECT count(*) n FROM (SELECT snapshot_id FROM $SAL WHERE salary > 0 AND person_key = '${who.key.replace(/'/g, "''")}' GROUP BY 1 HAVING sum(${PAY}) > 0)`,
  );
  await expect(card.locator('.strata-card-spark')).toHaveAttribute('data-points', String(paidIn), { timeout: 60_000 });
  await expect(card.locator('.strata-card-spark-dot[data-now]')).toHaveCount(1);
  await expect(card.locator('.strata-card-spark-ends')).toHaveText(/^Nov 2021Sep 2026$/);
  // The card inside the plot (3a), and clear of the readout over the loupe.
  const cb = (await card.boundingBox())!, pb = (await plot(page).boundingBox())!, rb = (await page.locator('.strata-readout').boundingBox())!;
  expect(cb.y).toBeGreaterThanOrEqual(pb.y - 0.5);
  expect(cb.y + cb.height, 'the card runs past the plot').toBeLessThanOrEqual(pb.y + pb.height + 0.5);
  expect(cb.x + cb.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
  const apart = rb.x + rb.width <= cb.x || cb.x + cb.width <= rb.x || rb.y + rb.height <= cb.y || cb.y + cb.height <= rb.y;
  expect(apart, 'the readout lies under the card').toBe(true);
});

test('the loupe magnifies 4× over the histogram and 2.5× over the floors, the square it names that much larger', async ({ page }) => {
  await home(page);
  for (const [view, zoom] of [['Histogram', 4], ['Floors', 2.5]] as const) {
    if (view === 'Floors') {
      await page.getByRole('radiogroup', { name: 'View' }).getByText('Floors').click();
      await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    }
    await expect(plot(page)).toHaveAttribute('data-zoom', String(zoom));
    await pointAt(page, 0.3, 0.85);
    const sq = Number(await field(page).getAttribute('data-sq'));
    const size = Number(await plot(page).getAttribute('data-pick-size'));
    expect(size, `${view}: the square named is drawn ${size}px against the field's ${sq}px`).toBeCloseTo(Math.max(7, zoom * sq), 1);
    await page.mouse.move(1, 1);
  }
});

/**
 * Every square on whole device pixels (3a): along the bottom rows of the crowded floor, $55k to $115k, every square
 * the pitch less a pixel wide, a pixel between squares in a bar, and a wider gutter between one $5k column's bar and
 * the next — read off the canvas a device pixel at a time. At 2200x1300 both a 1x and a 2x screen have room for a
 * pitch of two pixels or more; narrower, a 1x screen's bars are solid runs (strataGrid's fallback).
 */
for (const dpr of [1, 2]) {
  test(`every square lies on whole pixels, a pixel apart in its bar, a gutter between bars (${dpr}x)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 2200, height: 1300 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await home(page);
    const f = field(page);
    const gap = Number(await f.getAttribute('data-gap')), per = Number(await f.getAttribute('data-per'));
    const base = Number(await f.getAttribute('data-base')), rowPitch = Number(await f.getAttribute('data-row-pitch'));
    const pitch = Number(await f.getAttribute('data-pitch')), colW = Number(await f.getAttribute('data-col-w'));
    expect(gap, 'no gap at this size, so nothing here is tested').toBe(1);
    expect(pitch * dpr, 'a pitch off whole pixels').toBeCloseTo(Math.round(pitch * dpr), 9);
    const rows = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement, a) => {
      const k = c.width / c.getBoundingClientRect().width;
      const ctx = c.getContext('2d')!;
      const x0 = Math.round(11 * a.colW * k), x1 = Math.round(23 * a.colW * k);
      const out: { inks: number[]; gaps: number[] }[] = [];
      for (let r = 0; r < 20; r++) {
        const y = Math.floor((a.base - (r + 1) * a.rowPitch) * k + 0.5 - 1e-6);
        const d = ctx.getImageData(x0, y, x1 - x0, 1).data;
        const row = { inks: [] as number[], gaps: [] as number[] };
        let run = 0, on = d[3] !== 0;
        for (let i = 0; i <= x1 - x0; i++) {
          const ink = i < x1 - x0 && d[4 * i + 3] !== 0;
          if (ink === on && i < x1 - x0) { run++; continue; }
          (on ? row.inks : row.gaps).push(run);
          on = ink;
          run = 1;
        }
        // The first and last runs are cut by the window.
        row.inks = row.inks.slice(1, -1);
        row.gaps = row.gaps.slice(1, -1);
        out.push(row);
      }
      return out;
    }, { colW, base, rowPitch });
    const pd = Math.round(pitch * dpr);
    for (const [r, row] of rows.entries()) {
      expect(new Set(row.inks), `row ${r}: a square not ${pd - 1} pixels wide`).toEqual(new Set([pd - 1]));
      const within = row.gaps.filter((g) => g === 1).length, between = row.gaps.filter((g) => g > 1).length;
      expect(within + between, `row ${r}: a gap of no pixels`).toBe(row.gaps.length);
      // Twelve columns' bars, $55k–$115k: a gutter between each, a pixel between the squares inside.
      expect(between, `row ${r}: gutters`).toBeGreaterThanOrEqual(10);
      expect(within, `row ${r}: gaps inside the bars`).toBeGreaterThanOrEqual(10 * (per - 1));
    }
    await ctx.close();
  });
}

test('the lens follows a mouse with the cursor put away, magnifies what is under it, and goes when the pointer leaves', async ({ page }) => {
  await home(page);
  const box = (await plot(page).boundingBox())!;
  // Low over the crowded middle, where every column has people.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.93);
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  await expect(plot(page)).toHaveCSS('cursor', 'none');
  // Magnified: the square under the pointer is drawn several times the field's own size (4× in the loupe).
  await expect(plot(page)).toHaveAttribute('data-pick', /^main:\d+$/);
  // A square's size is its side; where a 1x screen draws solid bars of single-pixel columns, the mean of its sides.
  const sq = (Number(await field(page).getAttribute('data-sq')) + Number(await field(page).getAttribute('data-sq-w'))) / 2;
  const size = Number(await plot(page).getAttribute('data-pick-size'));
  expect(size, `the square under the lens is drawn ${size}px against the field's ${sq}px`).toBeGreaterThanOrEqual(3.9 * sq);
  await page.mouse.move(box.x + box.width * 0.4, box.y - 60);
  await expect(plot(page)).toHaveAttribute('data-lens', 'off');
});

test('hovering moves no square: only the lens redraws', async ({ page }) => {
  await home(page);
  const before = await placesOf(page, 'main');
  const frames = () => page.evaluate(() => performance.getEntriesByName('strata-frame').length);
  const f0 = await frames();
  const box = (await plot(page).boundingBox())!;
  for (let k = 0; k <= 20; k++) await page.mouse.move(box.x + box.width * (0.1 + k * 0.04), box.y + box.height * 0.7);
  await page.waitForTimeout(300);
  expect(await frames(), 'the squares moved while pointing').toBe(f0);
  expect(await placesOf(page, 'main')).toEqual(before);
  expect(await page.evaluate(() => performance.getEntriesByName('lens-frame').length), 'the lens never drew').toBeGreaterThan(5);
});

test('the lens redraws inside the frame budget', async ({ page }) => {
  await atCiPace(page);
  await home(page);
  const box = (await plot(page).boundingBox())!;
  for (let k = 0; k <= 30; k++) { await page.mouse.move(box.x + box.width * (0.2 + k * 0.01), box.y + box.height * 0.75); await page.waitForTimeout(16); }
  const frames = await page.evaluate(() => performance.getEntriesByName('lens-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length).toBeGreaterThan(10);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(FRAME_MS);
});

test('the readout names the $5k column under the lens, counts everyone within ±$5k of it and says where that pay stands', async ({ page }) => {
  await home(page);
  await pointAt(page, 0.3, 0.9);
  const c = Number(await plot(page).getAttribute('aria-valuenow')) / COL;
  const rows = await people();
  const under = rows.filter((p) => p.pay < CAP);
  const near = under.filter((p) => Math.abs(Math.floor(p.pay / COL) - c) <= 1).length;
  const below = under.filter((p) => Math.floor(p.pay / COL) < c).length;
  const own = under.filter((p) => Math.floor(p.pay / COL) === c).length;
  const headcount = rows.length;
  const pct = Math.min(99, Math.max(1, Math.round(((below + own / 2) / headcount) * 100)));
  await expect(page.locator('.strata-readout')).toHaveText(`${fmtK(c * COL)}–${fmtK((c + 1) * COL)} · ${num(near)} people within ±$5k · ${pct}% paid less`);
});

test('the legend sits over the plot (3a): each type in order, with its people in the snapshot shown', async ({ page }) => {
  await home(page);
  const legend = (await page.locator('.strata-legend').boundingBox())!, box = (await plot(page).boundingBox())!;
  expect(legend.y + legend.height, 'the legend is not over the plot').toBeLessThanOrEqual(box.y + 0.5);
  const items = await page.locator('.strata-legend-item').evaluateAll((els) => els.map((e) => [e.getAttribute('data-category'), e.textContent]));
  const want = ['Academic Staff', 'University Staff', 'Faculty', 'Employees in Training', 'Limited'];
  expect(items.map(([c]) => c)).toEqual(want);
  const n = new Map(categories.map((c) => [c.name, (c as unknown as { n: number }).n]));
  for (const [c, text] of items) expect(text).toBe(`${c}${num(n.get(c!)!)}`);
});

test('isolating a type lights its people where they stand, moves no one, and the lens names only them', async ({ page }) => {
  await home(page);
  const { main, pile } = await byIndex();
  const before = await placesOf(page, 'main');
  const frames = () => page.evaluate(() => performance.getEntriesByName('strata-frame').length);
  const f0 = await frames();
  await page.getByRole('button', { name: /^Faculty/ }).click();
  const print = (list: { cat: string }[]) => { let n = 0, s = 0, q = 0; list.forEach((p, i) => { if (p.cat === 'Faculty') { n++; s += i; q += i * i; } }); return `${n}:${s}:${q}`; };
  await expect(field(page)).toHaveAttribute('data-lit', print(main));
  await expect(field(page)).toHaveAttribute('data-pile-lit', print(pile));
  await page.waitForTimeout(300);
  expect(await placesOf(page, 'main'), 'a square moved').toEqual(before);
  expect(await frames(), 'the squares were set moving').toBe(f0);
  // The chip says how many and where their median sits, from the artifact's own figures for the type.
  const cat = categories.find((x) => x.name === 'Faculty') as unknown as { n: number; median: number };
  const gap = (100 * (cat.median - HOME_STATS.p50)) / HOME_STATS.p50;
  await expect(page.locator('.strata-chip')).toContainText(`Faculty · ${num(cat.n)} people · median ${fmtK(cat.median)} · ${Math.round(gap)}% above campus`);
  // Under a filter the lens names only its people: wherever it is pointed, a Faculty member or no one — never
  // someone the filter fades. Low over the crowded floor, where the bands under Faculty stand, it still finds one.
  // (The legend is below the plot: pressing it scrolled the page. The plot is brought back to the middle.)
  await plot(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const pb = (await plot(page).boundingBox())!;
  let named = 0;
  for (const [fx, fy] of [[0.75, 0.97], [0.24, 0.82], [0.3, 0.97], [0.5, 0.9], [0.62, 0.95]]) {
    await page.mouse.move(pb.x + pb.width * fx, pb.y + pb.height * fy, { steps: 4 });
    await page.waitForTimeout(400);
    const at = await plot(page).getAttribute('data-pick');
    if (!at) continue;
    named++;
    const [f, i] = at.split(':') as [Field, string];
    expect((f === 'main' ? main : pile)[Number(i)].cat, `pointed at ${fx}, ${fy}`).toBe('Faculty');
  }
  expect(named, 'the lens named no one anywhere, so nothing here is tested').toBeGreaterThan(1);
  // Pressed again, everyone is as they were.
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: /^Faculty/ }).click();
  await expect(field(page)).not.toHaveAttribute('data-lit', /./);
  expect(await placesOf(page, 'main')).toEqual(before);
});

/**
 * Lit where they stand, a filter's people are scattered through the faded field; on a 1x screen a square is a
 * pixel, a speck. So under a filter each of them is drawn at least three pixels each way: read off the canvas
 * round a Faculty member who is the only one in their column.
 */
test('under a filter, each of its people is drawn big enough to see on a 1x screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1260 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await home(page);
  const { main } = await byIndex();
  // Faculty members with no other round them in their bar, $20k–$200k: where each lit square is seen on its own.
  const slots = await slotsOf(page, 'main'), per = Number(await field(page).getAttribute('data-per'));
  const at = new Map<string, number>();
  main.forEach((p, i) => at.set(`${p.col}:${slots[i]}`, i));
  const alone = main.flatMap((p, i) => {
    if (p.cat !== 'Faculty' || p.col <= 4 || p.col >= 40) return [];
    const s0 = slots[i], x = s0 % per;
    const round = [-per - 1, -per, -per + 1, -1, 1, per - 1, per, per + 1].filter((d) => { const x1 = x + (((d % per) + per + 1) % per) - 1; return x1 >= 0 && x1 < per; });
    return round.every((d) => main[at.get(`${p.col}:${s0 + d}`) ?? -1]?.cat !== 'Faculty') ? [i] : [];
  });
  expect(alone.length, 'no Faculty member alone in their bar').toBeGreaterThan(2);
  await page.getByRole('button', { name: /^Faculty/ }).click();
  await expect(field(page)).toHaveAttribute('data-lit', /^\d+:/);
  await page.waitForTimeout(300);
  const pts = await placesOf(page, 'main');
  const ink = parseColor(await page.evaluate(() => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = 'var(--cat-faculty)'; const c = getComputedStyle(s).color; s.remove(); return c; }));
  const counts = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement, a) => {
    const ctx = c.getContext('2d')!;
    return a.at.map(([x, y]) => {
      const d = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - a.ink[0], d[i + 1] - a.ink[1], d[i + 2] - a.ink[2]) < 6) n++;
      return n;
    });
  }, { at: alone.slice(0, 6).map((i) => [pts[2 * i], pts[2 * i + 1]]), ink });
  for (const n of counts) expect(n, 'a lit square is a speck').toBeGreaterThanOrEqual(9);
  await ctx.close();
});

/**
 * The lens's reach follows how many it could name there: with no filter, pointed at the sky well above the
 * skyline, where the nearest of thousands is far below, it names no one; with a search that lights one person,
 * pointed well off them inside the lens, it names them all the same.
 */
test('the lens names no one in the empty sky, and reaches across itself for the one lit person in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const pb = (await plot(page).boundingBox())!;
  // The sky: 45px over the short columns of the long right tail at $200k — with a few hundred of them low in the
  // lens, but the nearest well off the pointer.
  const all = await placesOf(page, 'main');
  const { main: who } = await byIndex();
  let top = Infinity, cx = 0;
  for (let i = 0; i < who.length; i++) if (who[i].col === 40) { top = Math.min(top, all[2 * i + 1]); cx = all[2 * i]; }
  await page.mouse.move(pb.x + cx, pb.y + top - 45, { steps: 4 });
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  await page.waitForTimeout(500);
  expect(await plot(page).getAttribute('data-pick'), 'the lens named someone far below it in the empty sky').toBeNull();
  // Someone whose name no one else's contains, paid in the crowded middle.
  const rows = await people();
  const at = await spots();
  const names = await oracle<{ key: string; name: string }>(
    `SELECT person_key AS "key", lower(first_name || ' ' || last_name) AS "name" FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY 1, 2 ORDER BY 1`,
  );
  const pay = new Map(rows.map((r) => [r.person_key, r.pay]));
  const lone = names.find((n) => n.name.length >= 14 && (pay.get(n.key) ?? 0) > 70_000 && (pay.get(n.key) ?? 0) < 120_000
    && at.get(n.key)?.field === 'main' && names.filter((o) => o.name.includes(n.name)).length === 1);
  expect(lone, 'no one with a name of their own to search for').toBeTruthy();
  const i = at.get(lone!.key)!.index;
  const box = page.getByRole('combobox', { name: /Search a person/ });
  await box.fill(lone!.name);
  await expect(field(page)).toHaveAttribute('data-lit', `1:${i}:${i * i}`, { timeout: 60_000 });
  await page.waitForTimeout(400);
  // Pointed about 14px up and to the left of their square: inside the loupe, which shows 76 / 4 = 19px of the field
  // each way, and well off them — several squares away. (Typing scrolled the box into view: the plot is measured
  // again.)
  const pts = await placesOf(page, 'main');
  const nb = (await plot(page).boundingBox())!;
  const x = nb.x + pts[2 * i] - 10, y = nb.y + pts[2 * i + 1] - 10;
  await page.mouse.move(x - 20, y);
  await page.mouse.move(x, y, { steps: 4 });
  await expect(plot(page)).toHaveAttribute('data-pick', `main:${i}`, { timeout: 5_000 });
});

test('the keyboard walks the lens a column at a time, and Escape puts it away', async ({ page }) => {
  await home(page);
  const median = Math.floor(HOME_STATS.p50 / COL) * COL;
  // Reached by Tab from the legend over it, the lens comes up at the median's column.
  await page.locator('.strata-legend-item').last().focus();
  await page.keyboard.press('Tab');
  await expect(plot(page)).toBeFocused();
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(median));
  await page.keyboard.press('ArrowRight');
  const at = median + COL;
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(at));
  await page.keyboard.press('Shift+ArrowRight');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(at + 5 * COL));
  await page.keyboard.press('ArrowLeft');
  await expect(plot(page)).toHaveAttribute('aria-valuenow', String(at + 4 * COL));
  await expect(plot(page)).toHaveAttribute('aria-valuetext', new RegExp(`^${fmtK(at + 4 * COL).replace('$', '\\$')}–${fmtK(at + 5 * COL).replace('$', '\\$')} · [\\d,]+ people within ±\\$5k`));
  await page.keyboard.press('Escape');
  await expect(plot(page)).toHaveAttribute('data-lens', 'off');
});

test('on a phone a finger held still brings up the lens above it and moves it, lifting leaves it with a way in; one that moves scrolls', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await home(page);
  await plot(page).scrollIntoViewIfNeeded();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const box = (await plot(page).boundingBox())!;
  // Near the floor, where every column has people: the lens shows what is under the fingertip.
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.95;
  const scrolled = () => page.evaluate(() => window.scrollY);
  const before = await scrolled();
  await touch('touchStart', x, y);
  await page.waitForTimeout(650);
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  const [lx, ly] = (await plot(page).getAttribute('data-lens-at'))!.split(',').map(Number);
  expect(ly + box.y, 'the lens is not above the finger').toBeLessThan(y - 40);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', x + 8 * k, y); await page.waitForTimeout(16); }
  expect(await scrolled(), 'the page scrolled under the lens').toBe(before);
  const [mx] = (await plot(page).getAttribute('data-lens-at'))!.split(',').map(Number);
  expect(mx - lx, 'the lens did not follow the finger').toBeGreaterThan(30);
  await touch('touchEnd', x + 48, y);
  await expect(plot(page)).toHaveAttribute('data-pinned', 'true');
  await expect(plot(page)).toHaveAttribute('data-lens', 'on');
  await expect(plot(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  await expect(page.locator('.strata-card').getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(page.locator('.strata-card').getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
  // A tap off the plot puts it away.
  await page.locator('.home-lead').tap();
  await expect(plot(page)).toHaveAttribute('data-lens', 'off');

  // A finger that moves at once is scrolling: the page moves and no lens comes up.
  const start = await scrolled();
  await touch('touchStart', x, y);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', x, y - 20 * k); await page.waitForTimeout(10); }
  await touch('touchEnd', x, y - 160);
  await page.waitForTimeout(500);
  expect(await scrolled()).toBeGreaterThan(start);
  await expect(plot(page)).toHaveAttribute('data-lens', 'off');
  await ctx.close();
});

test('after a window resize the squares are laid out for the width they are drawn at, as a fresh load lays them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await home(page);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  await page.waitForTimeout(300);
  const resized = await placesOf(page, 'main');
  const fresh = await page.context().newPage();
  await fresh.setViewportSize({ width: 1000, height: 900 });
  await home(fresh);
  expect(resized).toEqual(await placesOf(fresh, 'main'));
  await fresh.close();
});

test('the pins sit over the skyline, clear of each other and inside the plot, each line down to its column; the median says how it moved, and is marked under the baseline', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await home(page);
    const pins = await page.evaluate(() => [...document.querySelectorAll('.strata-pin')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent ?? '', l: r.left, r: r.right, t: r.top, b: r.bottom };
    }));
    const box = (await plot(page).boundingBox())!;
    // Named in full where there is room; a phone keeps the shorthand.
    expect(pins.map((p) => p.text.split(' ')[0])).toEqual(width > 480 ? ['Median', '25th', '75th'] : ['Median', 'P25', 'P75']);
    // With the change since the snapshot before, from the data's own medians.
    const prev = SUMMARY.snapshots[SUMMARY.snapshots.length - 2], moved = HOME_STATS.p50 - prev.median;
    expect(pins[0].text).toBe(`Median $${Math.round(HOME_STATS.p50).toLocaleString('en-US')} ${moved >= 0 ? '+' : '−'}$${Math.round(Math.abs(moved)).toLocaleString('en-US')} since ${prev.label}`);
    for (const p of pins) { expect(p.l).toBeGreaterThanOrEqual(box.x - 0.5); expect(p.r).toBeLessThanOrEqual(box.x + box.width + 0.5); }
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i], b = pins[j];
      expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, `${a.text} lies on ${b.text}`).toBe(true);
    }
    // Each line runs from under its label down to just over its column, at the pay it names.
    const lines = await page.evaluate(() => [...document.querySelectorAll('.strata-pin-line')].map((l) => ({ x: Number(l.getAttribute('x1')), y2: Number(l.getAttribute('y2')) })));
    const pts = await placesOf(page, 'main');
    const { main } = await byIndex();
    const tops = new Map<number, number>();
    for (let i = 0; i < main.length; i++) tops.set(main[i].col, Math.min(tops.get(main[i].col) ?? Infinity, pts[2 * i + 1]));
    const medCol = Math.floor(HOME_STATS.p50 / COL);
    expect(lines[0].y2).toBeLessThan(tops.get(medCol)!);
    expect(tops.get(medCol)! - lines[0].y2).toBeLessThan(8);
    // The median's mark under the baseline, under its line.
    const mark = (await page.locator('.strata-median-mark').boundingBox())!;
    expect(Math.abs(mark.x + mark.width / 2 - (box.x + lines[0].x))).toBeLessThan(1);
    expect(mark.y).toBeGreaterThan(box.y + box.height - 1);
  }
});

/**
 * For a screen reader the plot, a slider over pay, is described in a sentence — how many, the median and the
 * middle half, the pile and the top salary, each type — and its columns follow as a table, $10k at a time.
 */
test('a screen reader hears what the graph shows in a sentence, and can read its columns as a table', async ({ page }) => {
  await home(page);
  const rows = await people();
  const pays = rows.map((p) => p.pay);
  const top = Math.max(...pays);
  const id = (await plot(page).getAttribute('aria-describedby'))!;
  const said = (await page.locator(`[id="${id}"]`).textContent())!;
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  expect(said).toContain(`${num(rows.length)} people paid in Sep 2026`);
  expect(said).toContain(`The median is ${usd(HOME_STATS.p50)}`);
  expect(said).toContain(`${num(OVER)} are paid ${fmtK(CAP)} or more; the top salary is ${usd(top)}`);
  for (const c of categories) expect(said).toContain(`${c.name}, ${num((c as unknown as { n: number }).n)}`);
  // The table: every $10k band and the pile, each band's people, and each type's.
  const cells = await page.locator('.strata-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent ?? '')));
  expect(cells.length).toBe(26);
  const n = (t: string) => Number(t.replace(/,/g, ''));
  expect(cells.reduce((t, r) => t + n(r[1]), 0)).toBe(rows.length);
  const band = cells.find((r) => r[0] === '$60k–$70k')!;
  expect(n(band[1])).toBe(rows.filter((p) => p.pay >= 60_000 && p.pay < 70_000).length);
  const heads = await page.locator('.strata-table thead th').allTextContents();
  const fac = heads.indexOf('Faculty');
  expect(n(cells[25][fac])).toBe(rows.filter((p) => p.pay >= CAP && p.cat === 'Faculty').length);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every type's square, and a search's, clears 3:1 against the panel (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await home(page);
    const panel = await page.locator('.hero-dist').evaluate((el) => {
      const out: string[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) out.push(getComputedStyle(e).backgroundColor);
      return out.reverse();
    });
    let ground = [255, 255, 255];
    for (const c of panel) { const [r, g, b, a] = parseColor(c); if (a > 0) ground = flatten([r, g, b, a], ground); }
    const inks = await page.locator('.hero-dist').evaluate((el) => {
      const probe = document.createElement('span');
      el.appendChild(probe);
      const read = (v: string) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const out = ['--cat-academic', '--cat-university', '--cat-faculty', '--cat-training', '--cat-limited', '--strata-match'].map((v) => [v, read(`var(${v})`)]);
      probe.remove();
      return out;
    });
    for (const [name, c] of inks) {
      const [r, g, b] = parseColor(c);
      expect(contrast([r, g, b], ground), `${name} on the panel`).toBeGreaterThanOrEqual(3);
    }
  });
}

/**
 * The graph uses its room: the latest's tallest $5k column stands at least 70% of the plot's height, on a 1x screen
 * as on a 2x one. Whole-pixel squares at their widest (3a) stood it at 56% of a 1440x900 plot: as few a row as fit
 * the tallest column in any snapshot stand it at 76% (lib/strata `strataGrid`).
 */
test('the tallest column stands at least 70% of the plot, at 1x as at 2x', async ({ browser }) => {
  const snap = await latestSnapshot();
  const [{ peak }] = await oracle<{ peak: number }>(
    `SELECT max(n) peak FROM (SELECT floor(pay / ${COL}) b, count(*) n FROM (SELECT person_key, sum(${PAY}) pay FROM $SAL
       WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1) WHERE pay > 0 AND pay < 250000 GROUP BY 1)`,
  );
  const share: number[] = [];
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1804, height: 1300 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await home(page);
    const f = field(page);
    const [per, rowPitch, room] = await Promise.all(['data-per', 'data-row-pitch', 'data-room'].map(async (a) => Number(await f.getAttribute(a))));
    const tall = Math.ceil(peak / per) * rowPitch;
    share.push(tall / room);
    expect(tall / room, `${dpr}x: the tallest of ${peak} stands ${Math.round(tall)}px of ${Math.round(room)}`).toBeGreaterThanOrEqual(0.7);
    expect(tall, `${dpr}x: past the plot`).toBeLessThanOrEqual(room + 1e-6);
    await ctx.close();
  }
  expect(Math.abs(share[0] - share[1]), 'a 1x screen draws it a different height from a 2x one').toBeLessThan(0.15);
});
