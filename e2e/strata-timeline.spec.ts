import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle, PAY, usd } from './oracle';
import { HOME_STATS } from './homeDots';
import { atCiPace, FRAME_MS } from './pace';
import { parseColor } from './color';

/**
 * The landing graph's timeline (mockup 3a §8, lib/timeline): under the plot, Play and a track of the
 * snapshots. Each snapshot is drawn from its own people, as the landing counts a person — total pay over paid
 * appointments, in the category of their highest-paid one — with its own headcount, median, quartiles, pile
 * and types; a step from one to the next carries each person from where they were, fades in who joined and
 * fades out who left, each in their own place, and between neighbours names who moved pay by 8% or more. Every figure here is restated from
 * the data in SQL, not taken from the page's code.
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

test('a step between neighbours carries each person over, fades in who joined, fades out who left, and names who moved pay by 8% or more', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  const [a, b] = [7, 8];
  const was = new Map((await peopleIn(SNAPS[a].id)).map((p) => [p.k, p.pay]));
  const now = await peopleIn(SNAPS[b].id);
  const joined = now.filter((p) => !was.has(p.k)).length;
  const left = [...was.keys()].filter((k) => !now.some((p) => p.k === k)).length;
  const up = now.filter((p) => (was.get(p.k) ?? 0) > 0 && p.pay >= was.get(p.k)! * 1.08).length;
  const down = now.filter((p) => (was.get(p.k) ?? 0) > 0 && p.pay * 1.08 <= was.get(p.k)!).length;
  await goTo(page, a);
  await goTo(page, b);
  await expect(bar(page)).toHaveAttribute('data-step', `${joined}:${left}`);
  await expect(bar(page)).toHaveAttribute('data-movers', String(up + down));
  await expect(page.locator('.strata-movers')).toHaveText(`${num(up + down)} people changed pay by 8%+ this step · green up, red down`);
  // Drawn in the up and down inks, on top: both are on the canvas.
  const ink = (v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c; }, v);
  const [pos, neg] = [parseColor(await ink('--text-pos')), parseColor(await ink('--text-neg'))];
  const counts = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement, a) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let u = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.hypot(d[i] - a.pos[0], d[i + 1] - a.pos[1], d[i + 2] - a.pos[2]) < 4) u++;
      else if (Math.hypot(d[i] - a.neg[0], d[i + 1] - a.neg[1], d[i + 2] - a.neg[2]) < 4) n++;
    }
    return { u, n };
  }, { pos, neg });
  expect(counts.u, 'no square in the up ink').toBeGreaterThan(up);
  expect(counts.n, 'no square in the down ink').toBeGreaterThan(down);
  // Not neighbours: no one is named as a mover.
  await goTo(page, 2);
  await expect(page.locator('.strata-movers')).toHaveCount(0);
});

test('a step fades out who left where they stood and fades in who joined where they stand: nothing drops in or lifts out', async ({ page }) => {
  test.setTimeout(120_000);
  await home(page);
  await goTo(page, 7);
  // How high the squares stand at rest, CSS px from the top.
  const top = async () => {
    const pts = await field(page).evaluate((el) => ['main', 'pile'].flatMap((f) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces(f)));
    let y = Infinity;
    for (let i = 1; i < pts.length; i += 2) y = Math.min(y, pts[i]);
    return y;
  };
  const before = await top();
  // Every frame of a step to a snapshot that is not a neighbour (so no one arcs): how high any ink reaches, and
  // how many pixels are part-way faded, by how far into the step.
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
          if (!d[i]) continue;
          if (d[i] < 255) part++;
          if (top === c.height) top = Math.floor((i >> 2) / c.width);
        }
        w.frames.push({ t: performance.now() - w.t0, top, part });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await goTo(page, 2);
  const frames = await page.evaluate(() => { const w = window as unknown as { frames: { t: number; top: number; part: number }[]; stop: boolean }; w.stop = true; return w.frames; });
  const k = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width);
  const highest = Math.floor(Math.min(before, await top()) * k) - 1;
  expect(frames.length, 'no frames of the step seen').toBeGreaterThan(10);
  expect(frames.filter((f) => f.top < highest).map((f) => `${Math.round(f.t)} ms: ink at ${f.top}px`).slice(0, 3), `a square above the tallest column (${highest}px), on its way in or out`).toEqual([]);
  // Who left fade in the first part of the step, before any joiner has begun; who joined in the last, after.
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
  await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[2].id, { timeout: 60_000 });
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
  await still.locator('.strata-play').click();
  // Started (the bar shows the latest before as well as after), then through to the end.
  await expect(bar(still)).toHaveAttribute('data-snap', SNAPS[0].id, { timeout: 60_000 });
  await expect(bar(still)).toHaveAttribute('data-snap', SNAPS[LAST].id, { timeout: 30_000 });
  await expect(bar(still)).not.toHaveAttribute('data-playing', /./, { timeout: 30_000 });
  expect(await still.evaluate(() => performance.getEntriesByName('strata-frame').length), 'squares moved under reduced motion').toBe(0);
  await ctx.close();
});

test('a step moves in frames inside the frame budget, at CI’s pace', async ({ page }) => {
  await atCiPace(page);
  await home(page);
  await goTo(page, 7);
  await page.evaluate(() => performance.clearMeasures('strata-frame'));
  await goTo(page, 8);
  const frames = await page.evaluate(() => performance.getEntriesByName('strata-frame').map((e) => e.duration).sort((a, b) => a - b));
  expect(frames.length, 'the step never moved').toBeGreaterThan(5);
  expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(FRAME_MS);
});

test('in an older snapshot the lens names someone with that snapshot’s title and pay, its change since the one before, and their rank then', async ({ page }) => {
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
  const change = prev.pay == null || !(prev.pay > 0) ? 'New this snapshot'
    : `${me.pay >= prev.pay ? '+' : '−'}${Math.abs(((me.pay - prev.pay) / prev.pay) * 100).toFixed(1)}% since ${SNAPS[i - 1].label}`;
  await expect(card.locator('.strata-card-change')).toHaveText(change);
  const rank = 1 + who.filter((p) => p.pay > me.pay).length;
  await expect(card.locator('.strata-card-rank')).toContainText(`#${num(rank)} of ${num(who.length)}`);
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

  test('the speed is a radio group of 1×, 2× and 4×: at 4× Play shows a snapshot every 375 ms, each step’s motion as much faster', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    const speed = page.getByRole('radiogroup', { name: 'Playback speed' });
    await expect(speed.getByRole('radio')).toHaveCount(3);
    await expect(speed.getByRole('radio', { name: '1×' })).toBeChecked();
    // In from the first snapshot at 1× (the timeline loads), then 4× from there.
    await goTo(page, 0);
    await speed.getByText('4×').click();
    await expect(speed.getByRole('radio', { name: '4×' })).toBeChecked();
    await page.evaluate(() => {
      const log: [string, number][] = [];
      (window as unknown as { log: typeof log }).log = log;
      const bar = document.querySelector('.strata-timeline') as HTMLElement, f = document.querySelector('.strata-field') as HTMLElement;
      new MutationObserver(() => log.push([`snap ${bar.dataset.snap}`, performance.now()])).observe(bar, { attributes: true, attributeFilter: ['data-snap'] });
      new MutationObserver(() => log.push([`settled ${f.dataset.settled}`, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
    });
    const t0 = await page.evaluate(() => performance.now());
    await page.locator('.strata-play').click();
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[LAST].id);
    const log = await page.evaluate(() => (window as unknown as { log: [string, number][] }).log);
    const steps = log.flatMap(([e, t], k) => (e.startsWith('snap ') ? [{ t, k }] : []));
    expect(steps.length).toBe(LAST);
    const gaps = [steps[0].t - t0], rests: number[] = [], moves: number[] = [];
    for (let s = 1; s < steps.length; s++) {
      gaps.push(steps[s].t - steps[s - 1].t);
      const settled = log.slice(steps[s - 1].k, steps[s].k).filter(([e]) => e === 'settled true').pop();
      rests.push(settled ? steps[s].t - settled[1] : -1);
      if (settled) moves.push(settled[1] - steps[s - 1].t);
    }
    for (const g of gaps) expect(g, `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeGreaterThanOrEqual(360);
    gaps.sort((a, b) => a - b);
    expect(gaps[gaps.length >> 1], `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeLessThan(600);
    // Each step's motion a quarter of 1×'s too (a step there moves for 1.1 s and more), so each lands before the next.
    moves.sort((a, b) => a - b);
    expect(moves.length, `rests ${rests.map(Math.round).join(', ')} ms: steps began before the last had landed`).toBeGreaterThanOrEqual((LAST - 1) / 2);
    expect(moves[moves.length >> 1], `steps moving for ${moves.map(Math.round).join(', ')} ms`).toBeLessThan(450);
  });

  test('Play shows a snapshot every 1.5 s, each step’s motion over a second and more, and each at rest before the next', async ({ page }) => {
    test.setTimeout(120_000);
    await home(page);
    await page.evaluate(() => {
      const log: [string, number][] = [];
      (window as unknown as { log: typeof log }).log = log;
      const bar = document.querySelector('.strata-timeline') as HTMLElement, f = document.querySelector('.strata-field') as HTMLElement;
      new MutationObserver(() => log.push([`snap ${bar.dataset.snap}`, performance.now()])).observe(bar, { attributes: true, attributeFilter: ['data-snap'] });
      new MutationObserver(() => log.push([`settled ${f.dataset.settled}`, performance.now()])).observe(f, { attributes: true, attributeFilter: ['data-settled'] });
    });
    await page.locator('.strata-play').click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[0].id, { timeout: 60_000 });
    await expect(bar(page)).not.toHaveAttribute('data-playing', /./, { timeout: 60_000 });
    const log = await page.evaluate(() => (window as unknown as { log: [string, number][] }).log);
    // From the first snapshot on, one step after another.
    const first = log.findIndex(([e]) => e === `snap ${SNAPS[0].id}`);
    const steps = log.slice(first).flatMap(([e, t], k) => (e.startsWith('snap ') ? [{ t, k: first + k }] : []));
    expect(steps.length).toBe(SNAPS.length);
    const gaps: number[] = [], rests: number[] = [], moves: number[] = [];
    for (let s = 1; s < steps.length; s++) {
      gaps.push(steps[s].t - steps[s - 1].t);
      // When the field came to rest in between, and how long it stayed so.
      const between = log.slice(steps[s - 1].k, steps[s].k);
      const settled = between.filter(([e]) => e === 'settled true').pop();
      rests.push(settled ? steps[s].t - settled[1] : -1);
      if (settled) moves.push(settled[1] - steps[s - 1].t);
    }
    for (const g of gaps) expect(g, `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeGreaterThanOrEqual(1450);
    moves.sort((a, b) => a - b);
    expect(moves[moves.length >> 1], `steps moving for ${moves.map(Math.round).join(', ')} ms`).toBeGreaterThanOrEqual(1100);
    expect(Math.min(...rests), `rests ${rests.map(Math.round).join(', ')} ms: a step began before the last had landed`).toBeGreaterThan(0);
    rests.sort((a, b) => a - b);
    expect(rests[rests.length >> 1], 'each snapshot is barely seen at rest').toBeGreaterThanOrEqual(150);
  });
});
