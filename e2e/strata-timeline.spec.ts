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
 * and types; a step from one to the next carries each person from where they were, drops in who joined, lifts
 * out who left, and between neighbours names who moved pay by 8% or more. Every figure here is restated from
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
    const pins = await page.locator('.strata-pin').allTextContents();
    expect(pins).toEqual([`Median ${usd(quantile(pays, 0.5))}`, `25th percentile ${fmtK(quantile(pays, 0.25))}`, `75th percentile ${fmtK(quantile(pays, 0.75))}`]);
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

test('a step between neighbours carries each person over, drops in who joined, lifts out who left, and names who moved pay by 8% or more', async ({ page }) => {
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

test.describe('one scale for every snapshot, at half the pace', () => {
  // At two device pixels a pixel, where it shows: each snapshot fitted to its own tallest column drew Apr 2024's
  // (742 people in one $1k column) with rows 2px tall and the latest's (576) with rows 2.5px — the same headcount
  // a quarter taller in one snapshot than the next, and every square moving with the scale at each step.
  test.use({ deviceScaleFactor: 2 });

  test('every snapshot draws a person the same height as the latest does as the page opens', async ({ page }) => {
    test.setTimeout(120_000);
    const peaks = await oracle<{ s: string; peak: number }>(
      `WITH p AS (SELECT snapshot_id s, person_key, sum(${PAY}) pay FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING sum(${PAY}) > 0)
       SELECT s, max(n) peak FROM (SELECT s, floor(pay / 1000) b, count(*) n FROM p WHERE pay < ${CAP} GROUP BY 1, 2) GROUP BY 1 ORDER BY peak DESC, s`,
    );
    const tallest = SNAPS.findIndex((x) => x.id === peaks[0].s), lowest = SNAPS.findIndex((x) => x.id === peaks[peaks.length - 1].s);
    expect(peaks[0].peak, 'the snapshots no longer differ in their tallest column, so this proves nothing').toBeGreaterThan(peaks[peaks.length - 1].peak * 1.1);
    await home(page);
    const grid = () => field(page).evaluate((el) => ['per', 'pitch', 'rowPitch', 'gap'].map((k) => `${k} ${(el as HTMLElement).dataset[k]}`).join(', '));
    const opened = await grid();
    for (const i of [tallest, lowest, LAST]) {
      await goTo(page, i);
      expect(await grid(), `${SNAPS[i].label} is drawn to a scale of its own`).toBe(opened);
    }
  });

  test('Play shows a snapshot every 1.2 s, each at rest before the next', async ({ page }) => {
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
    const gaps: number[] = [], rests: number[] = [];
    for (let s = 1; s < steps.length; s++) {
      gaps.push(steps[s].t - steps[s - 1].t);
      // When the field came to rest in between, and how long it stayed so.
      const between = log.slice(steps[s - 1].k, steps[s].k);
      const settled = between.filter(([e]) => e === 'settled true').pop();
      rests.push(settled ? steps[s].t - settled[1] : -1);
    }
    for (const g of gaps) expect(g, `steps ${gaps.map(Math.round).join(', ')} ms apart`).toBeGreaterThanOrEqual(1150);
    expect(Math.min(...rests), `rests ${rests.map(Math.round).join(', ')} ms: a step began before the last had landed`).toBeGreaterThan(0);
    rests.sort((a, b) => a - b);
    expect(rests[rests.length >> 1], 'each snapshot is barely seen at rest').toBeGreaterThanOrEqual(150);
  });
});
