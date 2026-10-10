import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle, PAY, usd } from './oracle';
import { HOME_STATS, people, spots } from './homeDots';
import { atCiPace, FRAME_MS } from './pace';
import { parseColor } from './color';

/**
 * The landing graph's timeline (mockup 3a §8, lib/timeline): under the plot, Play, the speed (Slow, Medium,
 * Fast), how a step shows (raises and cuts, or employment type), its settings, and a track of the snapshots. Each
 * snapshot is drawn from its own people, as the landing counts a person — total pay over paid appointments, in the
 * category of their highest-paid one — with its own headcount, median, quartiles, pile and types; a step from one
 * to the next carries each person from where they were, fades in who joined and fades out who left, each in their
 * own place. Raising and cutting, it counts who moved up a $5k column, down one, joined and left, and at Slow and
 * Medium stages it: the move, a countdown that holds it, the re-sort. Every figure here is restated from the data
 * in SQL, not taken from the page's code.
 */

const SUMMARY = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/summary.json', import.meta.url)), 'utf8')) as { snapshots: { id: string; label: string }[] };
const SNAPS = SUMMARY.snapshots;
const LAST = SNAPS.length - 1;
const CAP = HOME_STATS.bin_cap;
const num = (n: number) => n.toLocaleString('en-US');
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;
/** The category spellings that are one category, and the pre-2024 codes that are a kind of their own. */
const FOLD: Record<string, string> = { 'Employee-In-Training': 'Employees in Training', 'Employee-in-Training': 'Employees in Training', 'Limited Appointee': 'Limited' };
const NAMED = HOME_STATS.pay_counts.categories.map((c) => c.name);
const CODED = 'Coded only (CP, CL, CJ, ET)';

const field = (page: Page) => page.locator('.strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
const bar = (page: Page) => page.locator('.strata-timeline');
const dot = (page: Page, i: number) => page.locator('.strata-track-dot').nth(i);

async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
/** To snapshot `i` by its dot, and on until the squares are at rest there. */
/** Played on to snapshot `i` or past it. Watched every frame: at Fast a snapshot shows for a quarter second, which
 *  an assertion's polling (backing off to a second apart) can miss altogether. */
const reached = (page: Page, i: number, timeout = 60_000) => page.waitForFunction(
  ([ids, i]) => ids.indexOf((document.querySelector('.strata-timeline') as HTMLElement | null)?.dataset.snap ?? '') >= i,
  [SNAPS.map((s) => s.id), i] as const, { timeout },
);
/** The speed, and how a step shows. */
async function pace(page: Page, p: 'Slow' | 'Medium' | 'Fast') {
  await page.getByRole('radiogroup', { name: 'Speed' }).getByText(p, { exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Speed' }).getByRole('radio', { name: p })).toBeChecked();
}
async function mode(page: Page, m: 'Raises & cuts' | 'Employment type') {
  await page.getByRole('radiogroup', { name: 'Show each step by' }).getByText(m, { exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Show each step by' }).getByRole('radio', { name: m })).toBeChecked();
}
/** From now on, each change of the bar's snapshot and phase and of the field's rest, with when. */
const logSteps = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { log: [string, number][] | undefined };
  // Watched once a page; again, the log starts over.
  if (w.log) { w.log = []; return; }
  w.log = [];
  const bar = document.querySelector('.strata-timeline') as HTMLElement, f = document.querySelector('.strata-field') as HTMLElement;
  new MutationObserver(() => w.log!.push([`snap ${bar.dataset.snap}`, performance.now()])).observe(bar, { attributes: true, attributeFilter: ['data-snap'] });
  new MutationObserver(() => w.log!.push([`phase ${bar.dataset.phase ?? ''}`, performance.now()])).observe(bar, { attributes: true, attributeFilter: ['data-phase'] });
  new MutationObserver(() => w.log!.push([`settled ${f.dataset.settled}`, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
});
const readLog = (page: Page) => page.evaluate(() => (window as unknown as { log: [string, number][] }).log);
/** How long each phase of the log's first step lasted, ms, in order. */
function phases(log: [string, number][]) {
  const ph = log.filter(([e]) => e.startsWith('phase '));
  return ph.slice(0, -1).map(([e, t], k) => [e.slice(6), Math.round(ph[k + 1][1] - t)] as const);
}
async function goTo(page: Page, i: number) {
  await dot(page, i).click();
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[i].id, { timeout: 60_000 });
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
}

/** Everyone in snapshot `id`: their pay, and their kind as the graph names it. */
async function peopleIn(id: string) {
  const rows = await oracle<{ k: string; pay: number; cat: string }>(
    `WITH r AS (SELECT person_key, coalesce(employee_category, 'Other') ct, ${PAY} rp FROM $SAL WHERE snapshot_id = '${id}' AND salary > 0)
     SELECT person_key k, sum(rp) pay, first(ct ORDER BY rp DESC, ct) cat FROM r GROUP BY person_key HAVING sum(rp) > 0`,
  );
  return rows.map((r) => { const c = FOLD[r.cat] ?? r.cat; return { ...r, kind: NAMED.includes(c) ? c : CODED }; });
}
const quantile = (sorted: number[], q: number) => { const at = (sorted.length - 1) * q, lo = Math.floor(at); return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo); };

test('the landing page loads no database until the timeline is asked for; Play then steps through every snapshot to the latest', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await home(page);
  await expect(bar(page)).toHaveAttribute('data-timeline', 'off');
  await expect(page.locator('.strata-play')).toHaveText(`Play ${SNAPS[0].label.slice(4, 8)} → ${SNAPS[LAST].label.slice(-4)}`);
  expect(requests.filter((u) => /\.parquet|duckdb/i.test(u)), 'the page fetched the database before it was asked').toEqual([]);
  // Every snapshot the bar shows, in order, as Play goes.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const el = document.querySelector('.strata-timeline')!;
    new MutationObserver(() => { const s = (el as HTMLElement).dataset.snap!; if (seen[seen.length - 1] !== s) seen.push(s); }).observe(el, { attributes: true, attributeFilter: ['data-snap'] });
  });
  await page.locator('.strata-play').click();
  await expect(bar(page)).toHaveAttribute('data-timeline', 'ready', { timeout: 60_000 });
  await expect(bar(page)).toHaveAttribute('data-playing', 'true');
  await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[LAST].id);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen).toEqual(SNAPS.map((s) => s.id));
  expect(requests.some((u) => /\.parquet/i.test(u)), 'the timeline came from somewhere other than the data').toBe(true);
});

test('each snapshot shows its own people: headcount, median and quartiles, the pile, and the types — the codes before 2024 a type of their own', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  for (const i of [2, 6]) {
    const s = SNAPS[i];
    const who = await peopleIn(s.id);
    const pays = who.map((p) => p.pay).sort((a, b) => a - b);
    await goTo(page, i);
    await expect(page.locator('.strata-timeline-said')).toHaveText(`${s.label} · ${num(who.length)} people · median ${usd(quantile(pays, 0.5))}`);
    await expect(page.locator('.strata-count')).toHaveText(`${num(who.length)} people · ${s.label}`);
    // The median with its change since the snapshot before, each from its own people.
    const before = (await peopleIn(SNAPS[i - 1].id)).map((p) => p.pay).sort((a, b) => a - b);
    const moved = quantile(pays, 0.5) - quantile(before, 0.5);
    const pins = await page.locator('.strata-pin').allTextContents();
    expect(pins).toEqual([
      `Median ${usd(quantile(pays, 0.5))} ${moved >= 0 ? '+' : '−'}${usd(Math.abs(moved))} since ${SNAPS[i - 1].label.replace(/\s*\(.*\)\s*$/, '')}`,
      `25th percentile ${fmtK(quantile(pays, 0.25))}`, `75th percentile ${fmtK(quantile(pays, 0.75))}`,
    ]);
    await expect(page.locator('.strata-pile-toggle')).toHaveText(`${num(who.filter((p) => p.pay >= CAP).length)} at ${fmtK(CAP)}+`);
    await expect(plot(page)).toHaveAttribute('data-squares', `${who.filter((p) => p.pay < CAP).length}:${who.filter((p) => p.pay >= CAP).length}`);
    // The types: each with its people, as spelled now; the codes only where there are any.
    const want = new Map<string, number>();
    for (const p of who) want.set(p.kind, (want.get(p.kind) ?? 0) + 1);
    const got = await page.locator('.strata-legend-item').evaluateAll((els) => els.map((e) => [e.getAttribute('data-category'), Number(e.getAttribute('data-n'))]));
    expect(new Map(got as [string, number][]), s.label).toEqual(want);
    expect(want.has(CODED), `${s.label}: the codes`).toBe(s.id < '2024-04');
  }
});

test('raising and cutting, a step counts who moved up a $5k column, down one, joined and left — in the legend and drawn in their inks while it holds — then back to the types', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  const [a, b] = [7, 8];
  // Each person's group: their $5k column, the pile past the cap after the last.
  const group = (pay: number) => (pay >= CAP ? CAP / 5000 : Math.min(CAP / 5000 - 1, Math.floor(pay / 5000)));
  const was = new Map((await peopleIn(SNAPS[a].id)).map((p) => [p.k, group(p.pay)]));
  const now = await peopleIn(SNAPS[b].id);
  const keys = new Set(now.map((p) => p.k));
  const up = now.filter((p) => was.has(p.k) && group(p.pay) > was.get(p.k)!).length;
  const down = now.filter((p) => was.has(p.k) && group(p.pay) < was.get(p.k)!).length;
  const joined = now.filter((p) => !was.has(p.k)).length;
  const left = [...was.keys()].filter((k) => !keys.has(k)).length;
  expect(up && down && joined && left, 'a step with no one to count proves nothing').toBeTruthy();
  await goTo(page, a);
  await pace(page, 'Slow');
  await dot(page, b).click();
  await expect(bar(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  await expect(bar(page)).toHaveAttribute('data-step', `${up}:${down}:${joined}:${left}`);
  const legend = page.locator('.strata-change-legend');
  await expect(legend).toContainText(`since ${SNAPS[a].label.replace(/ \(.*\)$/, '')}`);
  for (const [k, v, label] of [['up', up, 'moved up'], ['down', down, 'moved down'], ['new', joined, 'joined'], ['left', left, 'left']] as const) {
    await expect(legend.locator(`.strata-change-item[data-change="${k}"]`)).toHaveText(`${num(v)}${label}`);
  }
  await expect(page.locator('.strata-legend-types')).toBeHidden();
  // Held, each mover stands in its own ink: so many squares at least in each.
  const ink = (v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, v);
  const inks = await Promise.all(['--strata-up', '--strata-down', '--strata-new'].map(async (v) => parseColor(await ink(v))));
  const counts = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement, inks) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const n = inks.map(() => 0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) continue;
      const k = inks.findIndex((a) => Math.hypot(d[i] - a[0], d[i + 1] - a[1], d[i + 2] - a[2]) < 3);
      if (k >= 0) n[k]++;
    }
    return n;
  }, inks);
  expect(counts, 'pixels in the up, down and joined inks').toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
  expect(counts[0], 'too few squares in the up ink').toBeGreaterThanOrEqual(up);
  expect(counts[1], 'too few squares in the down ink').toBeGreaterThanOrEqual(down);
  expect(counts[2], 'too few squares in the joined ink').toBeGreaterThanOrEqual(joined);
  // Re-sorted and at rest: the types again.
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
  await expect(legend).toBeHidden();
  await expect(page.locator('.strata-legend-types')).toBeVisible();
});

test('a step fades out who left where they stood and fades in who joined where they stand: nothing drops in or lifts out', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await goTo(page, 6);
  // How high the squares stand at rest, CSS px from the top.
  const top = async () => {
    const pts = await field(page).evaluate((el) => ['main', 'pile'].flatMap((f) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces(f)));
    let y = Infinity;
    for (let i = 1; i < pts.length; i += 2) y = Math.min(y, pts[i]);
    return y;
  };
  const before = await top();
  // By employment type (raises and cuts leave fading trails behind the movers, on purpose), at Medium.
  await mode(page, 'Employment type');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  await pace(page, 'Medium');
  // Every frame of a step on to the next snapshot: how high any part-way faded ink reaches (the big movers arc high
  // on purpose, drawn whole), and how many pixels are part-way faded, by how far into the step. (Back is a
  // cross-fade, with nothing in flight: the jumps' own test.)
  await page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => {
    const w = window as unknown as { frames: { t: number; top: number; part: number }[]; t0: number | null; stop: boolean };
    w.frames = [];
    w.t0 = null;
    w.stop = false;
    const f = document.querySelector('.strata-field') as HTMLElement;
    new MutationObserver(() => { if (f.dataset.settled === 'false' && w.t0 == null) w.t0 = performance.now(); }).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
    const ctx = c.getContext('2d')!;
    const frame = () => {
      if (w.stop) return;
      if (w.t0 != null) {
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let top = c.height, part = 0;
        for (let i = 3; i < d.length; i += 4) {
          if (!d[i] || d[i] === 255) continue;
          part++;
          if (top === c.height) top = Math.floor((i >> 2) / c.width);
        }
        w.frames.push({ t: performance.now() - w.t0, top, part });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await goTo(page, 7);
  const frames = await page.evaluate(() => { const w = window as unknown as { frames: { t: number; top: number; part: number }[]; stop: boolean }; w.stop = true; return w.frames; });
  const k = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width);
  const highest = Math.floor(Math.min(before, await top()) * k) - 1;
  expect(frames.length, 'no frames of the step seen').toBeGreaterThan(10);
  expect(frames.filter((f) => f.top < highest).map((f) => `${Math.round(f.t)} ms: faded ink at ${f.top}px`).slice(0, 3), `a square fading above the tallest column (${highest}px), on its way in or out`).toEqual([]);
  // Who left fade in the first part of the step's 1.7 s, before any joiner has begun; who joined in the last, after.
  expect(frames.some((f) => f.t < 300 && f.part > 0), 'who left did not fade out').toBe(true);
  expect(frames.some((f) => f.t > 900 && f.part > 0), 'who joined did not fade in').toBe(true);
  expect(frames[frames.length - 1].part, 'part-faded squares left once the step was over').toBe(0);
});

test('a step lands every square where the snapshot lays them out, however it was reached', async ({ browser }) => {
  const places = async (path: number[]) => {
    const page = await browser.newPage();
    await home(page);
    for (const i of path) await goTo(page, i);
    const pts = await field(page).evaluate((el) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces('main'));
    await page.close();
    return pts;
  };
  expect(await places([4, 5])).toEqual(await places([5]));
});

test('Pause holds the snapshot and Resume goes on; under reduced motion each step is simply there', async ({ browser }) => {
  const page = await browser.newPage();
  await home(page);
  await page.locator('.strata-play').click();
  await reached(page, 2);
  await page.locator('.strata-play').click();
  await expect(page.locator('.strata-play')).toHaveText('Resume');
  const held = await bar(page).getAttribute('data-snap');
  await page.waitForTimeout(1500);
  await expect(bar(page)).toHaveAttribute('data-snap', held!);
  await page.locator('.strata-play').click();
  await expect(bar(page)).not.toHaveAttribute('data-snap', held!, { timeout: 5_000 });
  await page.close();

  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const still = await ctx.newPage();
  await home(still);
  await logSteps(still);
  await still.locator('.strata-play').click();
  // Started from the first (the bar shows the latest before as well as after), then through to the end.
  await expect(bar(still)).toHaveAttribute('data-playing', 'true', { timeout: 60_000 });
  await expect(bar(still)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
  await expect(bar(still)).toHaveAttribute('data-snap', SNAPS[LAST].id);
  const shown = (await readLog(still)).filter(([e]) => e.startsWith('snap ')).map(([e]) => e.slice(5));
  expect(shown.slice(shown.indexOf(SNAPS[0].id)), 'not every snapshot from the first').toEqual(SNAPS.map((sn) => sn.id));
  expect(await still.evaluate(() => performance.getEntriesByName('strata-frame').length), 'squares moved under reduced motion').toBe(0);
  await ctx.close();
});

test('a step moves in frames inside the frame budget, at CI’s pace', async ({ page }) => {
  test.setTimeout(90_000);
  await atCiPace(page);
  await home(page);
  await goTo(page, 7);
  // Staged (Medium): the move, with its arcs and trails, and the re-sort.
  await pace(page, 'Medium');
  await page.evaluate(() => performance.clearMeasures('strata-frame'));
  await goTo(page, 8);
  const frames = await page.evaluate(() => performance.getEntriesByName('strata-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the step never moved').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(FRAME_MS);
});

// Fast never stops between snapshots (3a §10): the next step is taken in the frame the last one ends in, so every
// animation frame while it plays draws the squares moving — none stands still at a snapshot.
test('Fast’s play draws the squares moving in every frame, never standing still between snapshots', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await goTo(page, 0);
  await page.evaluate(() => {
    const w = window as unknown as { frames: [number, number][]; snaps: number[] };
    w.frames = [];
    w.snaps = [];
    const bar = document.querySelector('.strata-timeline') as HTMLElement;
    new MutationObserver(() => w.snaps.push(performance.now())).observe(bar, { attributes: true, attributeFilter: ['data-snap'] });
    const f = (t: number) => {
      w.frames.push([t, performance.getEntriesByName('strata-frame').length]);
      if (bar.dataset.playing || w.frames.length < 5) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.locator('.strata-play').click();
  await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
  const { frames, snaps } = await page.evaluate(() => {
    const w = window as unknown as { frames: [number, number][]; snaps: number[] };
    return { frames: w.frames, snaps: w.snaps };
  });
  expect(snaps.length).toBe(LAST);
  // From the first snapshot change to the last: each frame, at least one moving frame drawn since the one before.
  const still = frames.filter(([t, k], i) => i > 0 && t > snaps[0] && t < snaps[snaps.length - 1] && k === frames[i - 1][1]);
  expect(frames.filter(([t]) => t > snaps[0] && t < snaps[snaps.length - 1]).length, 'frames of the play seen').toBeGreaterThan(20);
  expect(still.length, `frames standing still at ${still.map(([t]) => Math.round(t - snaps[0])).join(', ')} ms`).toBe(0);
});

// Fast's flow at sixty frames a second (3a §13): each moving frame inside the budget at CI's pace, on a 1x screen
// and a 2x one (four times the pixels to write).
for (const dpr of [1, 2]) {
  test(`Fast’s flow draws each frame inside the frame budget at CI’s pace, at ${dpr}x`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await atCiPace(page);
    await home(page);
    await goTo(page, 0);
    await page.evaluate(() => performance.clearMeasures('strata-frame'));
    await page.locator('.strata-play').click();
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    const frames = await page.evaluate(() => performance.getEntriesByName('strata-frame').map((e) => e.duration).sort((a, b) => a - b));
    expect(frames.length, 'the flow never moved').toBeGreaterThan(10);
    expect(frames[Math.floor(frames.length / 2)], `median of ${frames.length} frames`).toBeLessThan(FRAME_MS);
    await ctx.close();
  });
}

test('in an older snapshot the loupe names someone with that snapshot’s title and pay, and its change since the one before', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  const i = 4;
  await goTo(page, i);
  const box = (await plot(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3 - 12, box.y + box.height * 0.9);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.9, { steps: 4 });
  const card = page.locator('.strata-card');
  await expect(card.locator('.strata-card-name')).toBeVisible({ timeout: 60_000 });
  // Until the lens has come to rest on the pointer: on its way, the square under the pointer changes.
  let was = '';
  await expect.poll(async () => { const now = await card.getAttribute('data-who') ?? ''; const same = now === was; was = now; return same; }, { intervals: [300] }).toBe(true);
  const key = (await card.getAttribute('data-who'))!;
  const who = await peopleIn(SNAPS[i].id);
  const me = who.find((p) => p.k === key)!;
  const [prev] = await oracle<{ pay: number | null }>(`SELECT sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAPS[i - 1].id}' AND salary > 0 AND person_key = '${key.replace(/'/g, "''")}'`);
  const [named] = await oracle<{ title: string }>(
    `SELECT title FROM (SELECT title, row_number() OVER (ORDER BY ${PAY} DESC, coalesce(employee_category, 'Other'), title, school) k
       FROM $SAL WHERE snapshot_id = '${SNAPS[i].id}' AND salary > 0 AND person_key = '${key.replace(/'/g, "''")}') WHERE k = 1`,
  );
  await expect(card.locator('.strata-card-title')).toHaveText(named.title);
  await expect(card.locator('.strata-card-pay > span').first()).toHaveText(usd(me.pay));
  const before = SNAPS[i - 1].label.replace(/\s*\(.*\)\s*$/, '');
  const d = prev.pay == null || !(prev.pay > 0) ? null : me.pay - prev.pay;
  const change = d == null ? `Joined since ${before}` : Math.abs(d) < 1 ? `No change since ${before}` : `${d > 0 ? '+' : '−'}${usd(Math.abs(d))} since ${before}`;
  await expect(card.locator('.strata-card-change')).toHaveText(change);
  // The snapshot shown is the marked point of their history.
  await expect(card.locator('.strata-card-spark-dot[data-now]')).toHaveCount(1);
  expect(who.length).toBeGreaterThan(0);
});

test('a group is its people: in another snapshot they are lit wherever they stand then, and counted there', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await page.getByRole('combobox', { name: /Search a person/ }).fill('aaron');
  await expect(plot(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
  const latest = await oracle<{ k: string }>(
    `SELECT DISTINCT person_key k FROM $SAL WHERE snapshot_id = '${SNAPS[LAST].id}' AND salary > 0 AND lower(first_name || ' ' || last_name) LIKE '%aaron%'`,
  );
  const keys = new Set(latest.map((r) => r.k));
  await page.keyboard.press('Tab');
  await goTo(page, 6);
  const then = (await peopleIn(SNAPS[6].id)).filter((p) => keys.has(p.k));
  await expect(plot(page)).toHaveAttribute('data-group-count', String(then.length));
  await expect(field(page)).toHaveAttribute('data-lit', new RegExp(`^${then.filter((p) => p.pay < CAP).length}:`));
});

test('the track is a radio group: arrows step between snapshots, Home and End go to the ends', async ({ page }) => {
  await home(page);
  await dot(page, LAST).focus();
  await expect(dot(page, LAST)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[LAST - 1].id, { timeout: 60_000 });
  await expect(dot(page, LAST - 1)).toBeFocused();
  await expect(dot(page, LAST - 1)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[0].id);
  await page.keyboard.press('End');
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[LAST].id);
});

test.describe('one scale for every snapshot, and the pace', () => {
  // At two device pixels a pixel, where it shows: each snapshot fitted to its own tallest column drew the same
  // headcount taller in one than the next, and every square moved with the scale at each step. In $5k columns the
  // tallest in any snapshot (Apr 2024's, 2,099) is a little over the latest's (1,895): it sets the one scale.
  test.use({ deviceScaleFactor: 2 });

  test('every snapshot draws a person the same height, to the scale of the tallest $5k column in any, which it fills', async ({ page }) => {
    test.setTimeout(120_000);
    const cols = await oracle<{ s: string; b: number; n: number }>(
      `WITH p AS (SELECT snapshot_id s, person_key, sum(${PAY}) pay FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING sum(${PAY}) > 0)
       SELECT s, least(floor(pay / 5000), ${CAP / 5000}) b, count(*) n FROM p GROUP BY 1, 2`,
    );
    const peakOf = (id: string) => Math.max(...cols.filter((c) => c.s === id).map((c) => c.n));
    const byPeak = SNAPS.map((sn, i) => ({ i, peak: peakOf(sn.id) })).sort((a, b) => b.peak - a.peak);
    const tallest = byPeak[0].i, lowest = byPeak[byPeak.length - 1].i;
    expect(byPeak[0].peak, 'the snapshots no longer differ in their tallest column, so this proves nothing').toBeGreaterThan(byPeak[byPeak.length - 1].peak * 1.1);
    await home(page);
    await expect(field(page)).toHaveAttribute('data-peak', String(byPeak[0].peak));
    const grid = () => field(page).evaluate((el) => ['per', 'pitch', 'rowPitch', 'gap'].map((k) => `${k} ${(el as HTMLElement).dataset[k]}`).join(', '));
    // The highest ink on the canvas, device px from the top.
    const inkTop = () => page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return Math.floor((i >> 2) / c.width);
      return c.height;
    });
    const opened = await grid();
    const [base, rowPitch, per] = await Promise.all(['data-base', 'data-row-pitch', 'data-per'].map(async (a) => Number(await field(page).getAttribute(a))));
    const scaleTop = Math.round((base - Math.ceil(byPeak[0].peak / per) * rowPitch) * 2);
    for (const i of [lowest, tallest, LAST]) {
      if ((await bar(page).getAttribute('data-snap')) !== SNAPS[i].id) await goTo(page, i);
      expect(await grid(), `${SNAPS[i].label} is drawn to a scale of its own`).toBe(opened);
      const top = await inkTop();
      expect(top, `${SNAPS[i].label}: a square above the scale`).toBeGreaterThanOrEqual(scaleTop);
      if (i === tallest) expect(top, `${SNAPS[i].label}'s tallest column does not reach the top of the scale`).toBe(scaleTop);
    }
  });

});

/**
 * The speed, the mode and the settings (3a): Fast, the default, a snapshot every quarter second straight through;
 * Medium and Slow stage each raises-and-cuts step — move, countdown, re-sort — and rest before the next, as
 * lib/strata `pacePlan` times them; by employment type no countdown or re-sort; a change of speed while held goes on
 * to the re-sort; a change of mode plays the last step again; the settings sort each column by type then salary,
 * and set Slow's countdown.
 */
test.describe('speed, mode and settings', () => {
  test('the speed is a radio group of Slow, Medium and Fast, Fast first: Play goes a snapshot every quarter second, never held', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    const speed = page.getByRole('radiogroup', { name: 'Speed' });
    await expect(speed.getByRole('radio')).toHaveCount(3);
    await expect(speed.getByRole('radio', { name: 'Fast' })).toBeChecked();
    await goTo(page, 0);
    await logSteps(page);
    await page.locator('.strata-play').click();
    // While it plays, the legend counts each step's changes.
    await expect(page.locator('.strata-change-legend')).toBeVisible({ timeout: 5_000 });
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[LAST].id);
    const log = await readLog(page);
    const steps = log.filter(([e]) => e.startsWith('snap ')).map(([, t]) => t);
    expect(steps.length).toBe(LAST);
    // As the page shows them, a little early or late on a slow runner: the steps' own clock is the flow test's.
    const gaps = steps.slice(1).map((t, k) => t - steps[k]).sort((x, y) => x - y);
    expect(gaps[gaps.length >> 1], `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeGreaterThanOrEqual(200);
    expect(gaps[gaps.length >> 1], `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeLessThan(500);
    expect(log.filter(([e]) => e === 'phase hold' || e === 'phase sort'), 'Fast held or re-sorted a step').toEqual([]);
    // At rest, the types again.
    await expect(page.locator('.strata-change-legend')).toBeHidden();
  });

  test('Fast plays as one flow: each step’s clock runs on from the last one’s end, the track fills at one steady pace, and the counts hold still', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 0);
    await page.evaluate(() => {
      const w = window as unknown as { starts: number[]; fills: number[]; boxes: Record<string, number[]> };
      w.starts = [];
      w.fills = [];
      w.boxes = {};
      const bar = document.querySelector('.strata-timeline') as HTMLElement, fill = document.querySelector('.strata-track-fill') as HTMLElement;
      new MutationObserver(() => {
        if (bar.dataset.phase !== 'move') return;
        w.starts.push(Number(bar.dataset.phaseAt));
        // Where each count stands, as each step's come in.
        for (const el of document.querySelectorAll<HTMLElement>('.strata-change-item')) (w.boxes[el.dataset.change!] ??= []).push(Math.round(el.getBoundingClientRect().x * 2) / 2);
      }).observe(bar, { attributes: true, attributeFilter: ['data-phase-at'] });
      const frame = () => {
        if (bar.dataset.playing) w.fills.push(new DOMMatrix(getComputedStyle(fill).transform).a);
        if (w.starts.length < 10 || bar.dataset.playing) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.locator('.strata-play').click();
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    const { starts, fills, boxes } = await page.evaluate(() => {
      const w = window as unknown as { starts: number[]; fills: number[]; boxes: Record<string, number[]> };
      return { starts: w.starts, fills: w.fills, boxes: w.boxes };
    });
    // t0 += duration: each step's clock starts where the last one's ended, 250 ms on, not when it was drawn.
    const gaps = starts.slice(1).map((t, k) => t - starts[k]);
    expect(gaps.length).toBe(LAST - 1);
    expect(gaps.filter((g) => Math.abs(g - 250) <= 2).length, `steps ${gaps.join(', ')} ms apart`).toBeGreaterThanOrEqual(gaps.length - 1);
    // The fill never goes back, and never stops while it plays: it moves every frame.
    const steps = fills.slice(1).map((f, k) => f - fills[k]);
    expect(Math.min(...steps), 'the fill went back').toBeGreaterThanOrEqual(-1e-6);
    const mid = steps.slice(5, -5), stalled = mid.filter((d) => d < 1e-6).length;
    // Enough frames to judge by — not 60 a second: a CI runner draws about 23.
    expect(mid.length, 'frames of the play seen').toBeGreaterThan(20);
    expect(stalled, `${stalled} of ${mid.length} frames with the fill standing still`).toBeLessThanOrEqual(2);
    // The counts change in place: each stands where it stood at every step.
    for (const k of ['up', 'down', 'new', 'left']) expect(new Set(boxes[k]), `the ${k} count moved: ${boxes[k]}`).toEqual(new Set([boxes[k][0]]));
  });

  test('on a phone the legend is as tall counting a step’s changes as listing the types: the plot never moves under it', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await home(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await goTo(page, 7);
    const plotTop = () => plot(page).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const [h0, top0] = [(await page.locator('.strata-legend').boundingBox())!.height, await plotTop()];
    // The changes shown (Fast's play): caught the frame they show.
    await page.locator('.strata-play').click();
    const during = await page.waitForFunction(() => {
      if (!document.querySelector('.strata-change-legend[data-on]')) return null;
      const l = document.querySelector('.strata-legend')!.getBoundingClientRect().height;
      return { l, top: document.querySelector('.strata-plot')!.getBoundingClientRect().top + window.scrollY };
    }, null, { timeout: 30_000 }).then((h) => h.jsonValue());
    expect(during!.l, 'the legend changed height').toBeCloseTo(h0, 0);
    expect(during!.top, 'the plot moved').toBeCloseTo(top0, 0);
    await ctx.close();
  });

  test('Fast’s movers go straight, in the up and down inks raising and cutting, in their types’ by employment type', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 7);
    const ink = (v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const up = parseColor(await ink('--strata-up'));
    // Every frame of a step: the most pixels in the up ink, and the highest ink, against where the columns stand at
    // rest either side (the flow never arcs or overshoots).
    const midStep = async (go: () => Promise<unknown>) => {
      await page.evaluate((up) => {
        const w = window as unknown as { seen: { n: number; top: number; frames: number; done: boolean } };
        const c = document.querySelector('.strata-base') as HTMLCanvasElement, f = document.querySelector('.strata-field') as HTMLElement;
        w.seen = { n: 0, top: c.height, frames: 0, done: false };
        let began = false;
        const tick = () => {
          const moving = f.dataset.settled === 'false';
          if (moving) {
            began = true;
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            let n = 0, top = c.height;
            for (let i = 0; i < d.length; i += 4) {
              if (!d[i + 3]) continue;
              if (top === c.height) top = Math.floor((i >> 2) / c.width);
              if (d[i + 3] === 255 && Math.hypot(d[i] - up[0], d[i + 1] - up[1], d[i + 2] - up[2]) < 3) n++;
            }
            w.seen.n = Math.max(w.seen.n, n);
            w.seen.top = Math.min(w.seen.top, top);
            w.seen.frames++;
          }
          if (began && !moving) w.seen.done = true;
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, up);
      await go();
      await page.waitForFunction(() => (window as unknown as { seen: { done: boolean } }).seen.done, null, { timeout: 10_000 });
      return page.evaluate(() => (window as unknown as { seen: { n: number; top: number; frames: number } }).seen);
    };
    const topAtRest = () => page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return Math.floor((i >> 2) / c.width);
      return c.height;
    });
    const before = await topAtRest();
    const change = await midStep(() => dot(page, 8).click());
    const after = await topAtRest();
    // A quarter-second step: about six frames at a CI runner's 23 a second.
    expect(change.frames, 'frames of the step seen').toBeGreaterThanOrEqual(3);
    expect(change.n, 'no mover in the up ink on the way').toBeGreaterThan(100);
    expect(change.top, 'a square above both snapshots’ tallest columns').toBeGreaterThanOrEqual(Math.min(before, after));
    // The same step again by employment type: no one in the up ink.
    const type = await midStep(() => mode(page, 'Employment type'));
    expect(type.n, 'squares in the up ink by employment type').toBe(0);
  });

  test('Medium stages a raises-and-cuts step — 1.5 s moving, a 1 s countdown, 0.9 s re-sorting — and Play rests 0.7 s before the next', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 3);
    await pace(page, 'Medium');
    await logSteps(page);
    await page.locator('.strata-play').click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[5].id, { timeout: 30_000 });
    await page.locator('.strata-play').click();
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    const log = await readLog(page);
    const ph = phases(log);
    expect(ph.slice(0, 3).map(([p]) => p)).toEqual(['move', 'hold', 'sort']);
    const [mv, cd, so] = ph.slice(0, 3).map(([, ms]) => ms);
    expect(mv).toBeGreaterThan(1400); expect(mv).toBeLessThan(1700);
    expect(cd).toBeGreaterThan(900); expect(cd).toBeLessThan(1200);
    expect(so).toBeGreaterThan(800); expect(so).toBeLessThan(1100);
    // Landed (the phase over), then the rest, then the next snapshot.
    const end = log.find(([e]) => e === 'phase ')![1], next = log.filter(([e]) => e.startsWith('snap '))[1][1];
    expect(next - end, 'the rest between steps').toBeGreaterThan(600);
    expect(next - end).toBeLessThan(1100);
  });

  test('by employment type a step moves straight to its sorted places — no countdown, no re-sort — and a change of mode plays the last step again', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 6);
    await pace(page, 'Medium');
    await logSteps(page);
    await mode(page, 'Employment type');
    await expect(bar(page)).toHaveAttribute('data-mode', 'type');
    // The step into this snapshot again, now by type: the squares move, the snapshot stays.
    await expect(field(page)).toHaveAttribute('data-settled', 'false', { timeout: 2_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    let log = await readLog(page);
    expect(log.filter(([e]) => e.startsWith('snap ')), 'the snapshot changed').toEqual([]);
    expect(phases(log).map(([p, ms]) => `${p} ${ms > 1550 && ms < 1950 ? '1.7 s' : `${ms} ms`}`)).toEqual(['move 1.7 s']);
    await expect(page.locator('.strata-change-legend'), 'by type, the legend counts no changes').toBeHidden();
    await logSteps(page);
    await goTo(page, 7);
    log = await readLog(page);
    expect(phases(log).map(([p]) => p)).toEqual(['move']);
  });

  test('a change of speed while a step is held goes straight on to the re-sort', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 5);
    await pace(page, 'Slow');
    await logSteps(page);
    await dot(page, 6).click();
    await expect(bar(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
    const held = await page.evaluate(() => performance.now());
    await page.getByRole('radiogroup', { name: 'Speed' }).getByText('Medium', { exact: true }).click();
    await expect(bar(page)).toHaveAttribute('data-phase', 'sort', { timeout: 1_000 });
    expect(await page.evaluate(() => performance.now()) - held, 'the countdown ran on').toBeLessThan(1_500);
  });

  test('the settings: Slow’s countdown, 1 to 8 seconds; and each column by type, then salary', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    const settings = page.getByRole('button', { name: 'Timeline settings' });
    await settings.click();
    const cd = page.getByRole('slider', { name: 'Slow’s countdown, seconds' });
    await expect(cd).toHaveAttribute('aria-valuenow', '3');
    await cd.focus();
    await page.keyboard.press('Home');
    await expect(cd).toHaveAttribute('aria-valuenow', '1');
    // Each column by type, then salary: up every column the types in the legend's order, each by pay.
    await page.getByRole('radiogroup', { name: 'Sort each column by' }).getByText('Type, then salary').click();
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    const at = await spots(), rows = await people();
    const order = ['Academic Staff', 'University Staff', 'Faculty', 'Employees in Training', 'Limited'];
    const slot = await field(page).evaluate((el) => (el as unknown as { squareSlots: (f: string) => number[] }).squareSlots('main'));
    const cols = new Map<number, { slot: number; rank: number; pay: number }[]>();
    for (const p of rows) {
      const s = at.get(p.person_key);
      if (s?.field !== 'main') continue;
      const c = Math.floor(p.pay / 5000);
      cols.set(c, [...(cols.get(c) ?? []), { slot: slot[s.index], rank: order.indexOf(p.cat), pay: Math.floor(p.pay / 100) }]);
    }
    let checked = 0;
    for (const [c, list] of cols) {
      list.sort((x, y) => x.slot - y.slot);
      for (let k = 1; k < list.length; k++) {
        const [x, y] = [list[k - 1], list[k]];
        expect(x.rank < y.rank || (x.rank === y.rank && x.pay <= y.pay), `column ${c}: slot ${k} out of order`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    // And Slow's countdown, as set: a second.
    await goTo(page, 7);
    await pace(page, 'Slow');
    await logSteps(page);
    await goTo(page, 8);
    const ph = phases(await readLog(page));
    expect(ph.map(([p]) => p)).toEqual(['move', 'hold', 'sort']);
    expect(ph[1][1]).toBeGreaterThan(900);
    expect(ph[1][1]).toBeLessThan(1300);
  });
});

/**
 * The status chip (3a §11): what the graph is doing — moving people, the countdown in whole seconds inside a ring
 * that unwinds, re-sorting, Play's rest before the next snapshot, Fast's play, a step back, a jump ahead, a change
 * of view — and, while it plays, when the timeline ends. Every label it shows is logged as it changes (some last a
 * quarter second).
 */
test.describe('the status chip', () => {
  const chipLog = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { chip: [string, string, number][] };
    w.chip = [];
    const bar = document.querySelector('.strata-timeline') as HTMLElement;
    const read = () => {
      const label = bar.querySelector('.strata-status-label')?.textContent ?? '', count = bar.querySelector('.strata-status-count')?.textContent ?? '';
      const last = w.chip[w.chip.length - 1];
      if (!last || last[0] !== label || last[1] !== count) w.chip.push([label, count, performance.now()]);
    };
    read();
    new MutationObserver(read).observe(bar, { subtree: true, childList: true, characterData: true });
  });
  const chipSeen = (page: Page) => page.evaluate(() => (window as unknown as { chip: [string, string, number][] }).chip);
  /** Each label as it came, once a run. */
  const runs = (seen: [string, string, number][]) => seen.map(([l]) => l).filter((l, k, all) => k === 0 || l !== all[k - 1]);
  const label = (page: Page) => page.locator('.strata-status-label');

  test('names each phase of a staged step, and counts the countdown down in whole seconds as its ring unwinds', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 7);
    await pace(page, 'Slow');
    await expect(label(page)).toHaveText('Sorted by salary');
    await chipLog(page);
    await dot(page, 8).click();
    await expect(bar(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
    // The ring unwinds through the countdown.
    const ring = () => page.locator('.strata-status-ring').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--ring')));
    const r0 = await ring();
    await page.waitForTimeout(600);
    expect(await ring(), 'the ring did not unwind').toBeLessThan(r0 - 30);
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    const seen = await chipSeen(page);
    const labels = runs(seen);
    expect(labels).toEqual([
      'Sorted by salary', `Moving people · ${SNAPS[7].label} → ${SNAPS[8].label}`, 'Sorting by salary in', 'Sorting by salary…', 'Sorted by salary',
    ]);
    expect(seen.filter(([l]) => l === 'Sorting by salary in').map(([, c]) => c), 'the countdown’s seconds').toEqual(['3', '2', '1']);
  });

  test('while it plays, counts the rest to the next snapshot and says when the timeline ends; at Fast, how many a second', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 6);
    await pace(page, 'Medium');
    await chipLog(page);
    await page.locator('.strata-play').click();
    // The rest lasts 0.7 s: caught the frame it shows, not by polling.
    const resting = await page.waitForFunction((next) => {
      const l = document.querySelector('.strata-status-label')?.textContent;
      return l === `Next: ${next} in` ? { count: document.querySelector('.strata-status-count')?.textContent, eta: document.querySelector('.strata-status-eta')?.textContent } : null;
    }, SNAPS[8].label, { timeout: 15_000 }).then((h) => h.jsonValue());
    expect(resting!.count).toBe('1');
    // Then the step to it, three to go after it at Medium's 4.1 s each: about 12 to 16 s in all.
    expect(resting!.eta).toMatch(/^Timeline ends \(Sep 2026\) in 0:\d\d$/);
    const eta = page.locator('.strata-status-eta');
    const secs = async () => Number((await eta.textContent())!.match(/0:(\d\d)$/)![1]);
    const s0 = Number(resting!.eta!.match(/0:(\d\d)$/)![1]);
    expect(s0).toBeGreaterThanOrEqual(10);
    expect(s0).toBeLessThanOrEqual(17);
    await page.waitForTimeout(1_500);
    expect(await secs(), 'the time left did not go down').toBeLessThan(s0);
    await page.locator('.strata-play').click();
    await expect(eta).toHaveCount(0);
    await expect(label(page)).toHaveText('Paused · sorted by salary', { timeout: 15_000 });
    // Fast.
    await pace(page, 'Fast');
    await page.locator('.strata-play').click();
    await expect(label(page)).toHaveText('Playing · 4 snapshots a second');
  });

  test('says when it rewinds to an earlier snapshot, skips ahead through several, and switches view', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 6);
    await chipLog(page);
    await goTo(page, 2);
    await goTo(page, 5);
    await page.getByRole('radiogroup', { name: 'View' }).getByText('Floors').click();
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    const labels = runs(await chipSeen(page));
    expect(labels).toContain(`Rewinding to ${SNAPS[2].label.replace(/ \(.*\)$/, '')}`);
    expect(labels).toContain(`Skipping ahead · ${SNAPS[2].label.replace(/ \(.*\)$/, '')} → ${SNAPS[3].label}`);
    expect(labels).toContain('Switching view');
    expect(labels[labels.length - 1]).toBe('Sorted by salary');
  });

  test('on a phone, takes Play’s row while it plays — Play down to its icon — and the row never changes height', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await home(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await bar(page).scrollIntoViewIfNeeded();
    await expect(page.locator('.strata-status')).toHaveCount(0);
    const h0 = (await bar(page).boundingBox())!.height;
    await page.locator('.strata-play').click();
    await expect(page.locator('.strata-status')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.strata-play')).toHaveAttribute('aria-label', 'Pause');
    expect((await bar(page).boundingBox())!.height, 'the row grew').toBeCloseTo(h0, 0);
    await expect(page.locator('.strata-status-eta'), 'no room for when it ends on a phone').toHaveCount(0);
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    await expect(page.locator('.strata-status')).toHaveCount(0);
    expect((await bar(page).boundingBox())!.height).toBeCloseTo(h0, 0);
    await ctx.close();
  });
});

/**
 * The track's jumps (3a §7): several snapshots on, a quick step through each between — at 40% of a step's time —
 * and back, a cross-fade straight there with no one moving; Play at the last snapshot starts again from the first
 * the same way; and out of sight, playing holds where it is.
 */
test.describe('jumps along the track', () => {
  const log = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { log: [string, number][] };
    w.log = [];
    const bar = document.querySelector('.strata-timeline') as HTMLElement, f = document.querySelector('.strata-field') as HTMLElement;
    new MutationObserver(() => w.log.push([`snap ${bar.dataset.snap}`, performance.now()])).observe(bar, { attributes: true, attributeFilter: ['data-snap'] });
    new MutationObserver(() => w.log.push([`settled ${f.dataset.settled}`, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
  });
  const read = (page: Page) => page.evaluate(() => (window as unknown as { log: [string, number][] }).log);

  test('several snapshots on, a quick step through each between', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 2);
    await log(page);
    await dot(page, 6).click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[6].id, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    const l = await read(page);
    // Every snapshot between, in order, each landed before the next.
    expect(l.filter(([e]) => e.startsWith('snap ')).map(([e]) => e.slice(5))).toEqual([3, 4, 5, 6].map((k) => SNAPS[k].id));
    const steps = l.flatMap(([e, t], k) => (e.startsWith('snap ') ? [{ t, k }] : []));
    for (let s = 1; s < steps.length; s++) {
      const between = l.slice(steps[s - 1].k, steps[s].k).map(([e]) => e);
      expect(between, `the step to ${SNAPS[3 + s].label} went before the last had landed`).toContain('settled true');
    }
    // Each quick: a step's own time is 1,175 ms; at 40%, about 470.
    const took = (steps[steps.length - 1].t - steps[0].t) / (steps.length - 1);
    expect(took, 'each catch-up step took').toBeLessThan(800);
  });

  test('back, a cross-fade straight there: no one moves on the way', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 6);
    await log(page);
    // Every frame from the click: how opaque the picture before is, and whether any square is off its resting place.
    // Watched frame by frame, not read once: on a slow runner an assertion's polling can see the snapshot change
    // only after the 0.8 s cross-fade is over.
    await page.evaluate(() => {
      const w = window as unknown as { fades: number[]; off: number };
      w.fades = [];
      w.off = 0;
      const c = document.querySelector('.strata-fade') as HTMLElement, bar = document.querySelector('.strata-timeline') as HTMLElement;
      const f = document.querySelector('.strata-field') as HTMLElement & { squareNow: (f: string) => number[]; squarePlaces: (f: string) => number[] };
      const start = bar.dataset.snap;
      const tick = () => {
        if (bar.dataset.snap !== start) {
          w.fades.push(Number(getComputedStyle(c).opacity));
          if (w.fades.length % 10 === 1) { const a = f.squareNow('main'), b = f.squarePlaces('main'); if (a.some((v, i) => v !== b[i])) w.off++; }
        }
        if (w.fades.length < 90) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await dot(page, 2).click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[2].id, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    const { fades, off } = await page.evaluate(() => { const w = window as unknown as { fades: number[]; off: number }; return { fades: w.fades, off: w.off }; });
    // Straight there: where the squares are drawn is where they rest, while the picture before fades out over them.
    expect(off, 'frames with a square on its way').toBe(0);
    expect(fades.filter((o) => o > 0.05 && o < 0.95).length, `the picture before is not fading out: ${fades.slice(0, 12).map((o) => o.toFixed(2))}`).toBeGreaterThan(5);
    const l = await read(page);
    expect(l.filter(([e]) => e.startsWith('snap ')).map(([e]) => e.slice(5)), 'snapshots between were shown').toEqual([SNAPS[2].id]);
    const took = l.filter(([e]) => e === 'settled true').pop()![1] - l.find(([e]) => e === 'settled false')![1];
    expect(took, 'the cross-fade took').toBeGreaterThan(600);
    expect(took).toBeLessThan(1500);
    await expect.poll(() => page.locator('.strata-fade').evaluate((c) => Number(getComputedStyle(c).opacity))).toBe(0);
  });

  test('out of sight, playing holds where it is, and goes on when it is back', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await goTo(page, 1);
    await page.locator('.strata-play').click();
    await reached(page, 2, 10_000);
    // A page long enough to leave the plot behind (the landing page itself is barely taller than the window).
    await page.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.body.appendChild(d); window.scrollTo(0, document.body.scrollHeight); });
    await expect.poll(() => plot(page).evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThan(0);
    await page.waitForTimeout(300);
    const held = await bar(page).getAttribute('data-snap');
    await page.waitForTimeout(3_500);
    await expect(bar(page)).toHaveAttribute('data-snap', held!);
    await expect(bar(page)).toHaveAttribute('data-playing', 'true');
    await plot(page).scrollIntoViewIfNeeded();
    await expect(bar(page)).not.toHaveAttribute('data-snap', held!, { timeout: 5_000 });
  });
});
