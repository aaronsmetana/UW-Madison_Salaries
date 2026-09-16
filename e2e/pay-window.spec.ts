import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, latestSnapshot, usd } from './oracle';

/**
 * A title's pay window (src/lib/payWindow.ts) on the person page: where the middle 90% of everyone with
 * the title is paid, when a few far out squeeze the rest. The strip zooms to it with the people outside
 * piled at each end (a pile lists them in the table below), and the tenure scatter zooms to the same
 * window, pins the rest to bands along its edges, and nudges its crowd apart. Expected values from SQL
 * written here and the rule restated here.
 */

// Research Associate: 653 people, $495 to $133,676, half of them between $60k and $65k.
const KENDALL = 'kendallbarrett|2017-05-28';
// The lowest-paid Research Associate ($495): outside the window, under it.
const LOWEST = 'jianzhicheong|2017-08-01';
// Clinical Assistant Professor: its middle 90% spans just over half its range, so it is drawn whole.
const WHOLE = 'amymuchow|2006-07-01';

/** Each person holding `jobCode` in the latest snapshot at their pay in it (several appointments in the
 *  title summed), their school, and whether a hire date is recorded. */
async function holders(jobCode: string) {
  const snap = await latestSnapshot();
  return oracle<{ person_key: string; pay: number; school: string | null; hired: boolean }>(
    `SELECT person_key, pay, school, hired FROM (
       SELECT person_key,
              CASE WHEN count(*) FILTER (WHERE salary > 0) > 1 THEN sum(${PAY}) FILTER (WHERE salary > 0)
                   ELSE any_value(${PAY}) FILTER (WHERE salary > 0) END pay,
              any_value(school) school, any_value(date_of_hire) IS NOT NULL hired
       FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${jobCode}' GROUP BY person_key)
     WHERE pay > 0`,
  );
}

/** The rule, restated: the 5th and 95th percentiles (interpolated) rounded out to a 1, 2, 2.5 or 5 × 10ⁿ
 *  step at or above a twentieth of the span between them; applied when that span is under half the
 *  whole range and the title has 40 people. */
function windowOf(pays: number[]) {
  const s = [...pays].sort((a, b) => a - b);
  const q = (p: number) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const p5 = q(0.05), p95 = q(0.95);
  if (s.length < 40 || !(p95 - p5 < 0.5 * (s[s.length - 1] - s[0]))) return null;
  const want = (p95 - p5) / 20;
  const mag = 10 ** Math.floor(Math.log10(want));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= want - 1e-9)!;
  return { lo: Math.floor(p5 / step) * step, hi: Math.ceil(p95 / step) * step };
}
const k = (v: number) => `$${Math.round(v / 1000)}k`;

async function openPerson(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}`);
  await expect(page.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

test('a title squeezed by a few far out zooms to its middle 90%, with the rest piled at each end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = await holders('PD012');
  const w = windowOf(people.map((p) => p.pay))!;
  expect(w, 'Research Associate no longer squeezes: pick another fixture').not.toBeNull();
  const self = people.find((p) => p.person_key === KENDALL)!;
  const below = people.filter((p) => p.pay < w.lo), above = people.filter((p) => p.pay > w.hi);
  expect(self.pay).toBeGreaterThanOrEqual(w.lo);

  await openPerson(page, KENDALL);
  const strip = page.locator('.peer-strip');
  await expect(strip).toHaveAttribute('data-window', `${w.lo}-${w.hi}`);
  const low = strip.locator('[data-pile="-1"]'), high = strip.locator('[data-pile="1"]');
  await expect(low).toHaveAttribute('data-n', String(below.length));
  await expect(high).toHaveAttribute('data-n', String(above.length));
  await expect(strip.locator('.peer-strip-pile-label')).toHaveText([`${below.length} under ${k(w.lo)}`, `${above.length} over ${k(w.hi)}`]);
  // The piles hold their people and the plot everyone else: one dot each, the subject on their own mark.
  await expect(strip.locator('.strip-dots').first()).toHaveAttribute('data-dots', String(people.length - below.length - above.length - 1));
  await expect(low.locator('.strip-dots')).toHaveAttribute('data-dots', String(below.length));
  await expect(high.locator('.strip-dots')).toHaveAttribute('data-dots', String(above.length));
  // The whole range is not on the axis any more.
  const text = await strip.innerText();
  expect(text).not.toContain(usd(Math.min(...people.map((p) => p.pay))));
  // The piles sit outside the plot at either end, and the subject's mark over the plot.
  const plot = (await strip.locator('svg').first().boundingBox())!;
  const lb = (await low.boundingBox())!, hb = (await high.boundingBox())!;
  expect(lb.x + lb.width, 'the low pile runs into the plot').toBeLessThanOrEqual(plot.x);
  expect(hb.x, 'the high pile runs into the plot').toBeGreaterThanOrEqual(plot.x + plot.width);
  const mark = (await strip.locator('.peer-strip-marker').boundingBox())!;
  expect(mark.x + mark.width / 2).toBeGreaterThan(plot.x);
  expect(mark.x + mark.width / 2).toBeLessThan(plot.x + plot.width);

  // Same school: the axis holds (the window is the title's), and the piles count the school's people.
  const school = people.filter((p) => p.school === self.school && p.school != null);
  await page.getByText(`Same school ${school.length}`).click();
  await expect(strip).toHaveAttribute('data-window', `${w.lo}-${w.hi}`);
  // (A side with nobody past it has no pile.)
  for (const [pile, n] of [[low, school.filter((p) => p.pay < w.lo).length], [high, school.filter((p) => p.pay > w.hi).length]] as const) {
    if (n) await expect(pile).toHaveAttribute('data-n', String(n));
    else await expect(pile).toHaveCount(0);
  }
  expect(school.some((p) => p.pay < w.lo) || school.some((p) => p.pay > w.hi), 'no same-school pile to check').toBe(true);
});

test('someone paid outside the window is marked over their pile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = await holders('PD012');
  const w = windowOf(people.map((p) => p.pay))!;
  const self = people.find((p) => p.person_key === LOWEST)!;
  expect(self.pay, 'the fixture is no longer under the window').toBeLessThan(w.lo);
  await openPerson(page, LOWEST);
  const strip = page.locator('.peer-strip');
  const low = strip.locator('[data-pile="-1"]');
  const lb = (await low.boundingBox())!;
  const mark = (await strip.locator('.peer-strip-marker').boundingBox())!;
  const cx = mark.x + mark.width / 2;
  expect(cx, 'the mark is not over the low pile').toBeGreaterThanOrEqual(lb.x);
  expect(cx).toBeLessThanOrEqual(lb.x + lb.width);
  await expect(strip.locator('.peer-strip-you')).toContainText(usd(self.pay));
  // The pile draws everyone in it but the subject, who has their own mark.
  await expect(low.locator('.strip-dots')).toHaveAttribute('data-dots', String(people.filter((p) => p.pay < w.lo).length - 1));
});

test('a title whose middle 90% already fills its axis is drawn whole', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = await holders('IC011');
  const pays = people.map((p) => p.pay).sort((a, b) => a - b);
  expect(people.length).toBeGreaterThanOrEqual(40);
  expect(windowOf(pays), 'Clinical Assistant Professor now squeezes: pick another fixture').toBeNull();
  await openPerson(page, WHOLE);
  const strip = page.locator('.peer-strip');
  await expect(strip).not.toHaveAttribute('data-window', /.*/);
  await expect(strip.locator('[data-pile]')).toHaveCount(0);
  await expect(strip).toContainText(usd(pays[0]));
  await expect(strip).toContainText(usd(pays[pays.length - 1]));
  await expect(page.locator('.tenure-plot')).not.toHaveAttribute('data-window', /.*/);
  await expect(page.locator('.tenure-band')).toHaveCount(0);
});

test('a pile lists its people in the table below, and shows everyone again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = await holders('PD012');
  const w = windowOf(people.map((p) => p.pay))!;
  const above = people.filter((p) => p.pay > w.hi);
  await openPerson(page, KENDALL);
  const high = page.locator('.peer-strip [data-pile="1"]');
  await expect(high).toHaveAccessibleName(`List the ${above.length} people over ${k(w.hi)}`);
  // Everyone, before: the subject ranks past the first page, so the table opens with all of them.
  const everyone = await page.locator('.peer-table-card tbody tr').count();
  expect(everyone).toBe(people.length);
  await high.click();
  await expect(high).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('.peer-table-card');
  await expect(card.locator('.peer-pile-filter')).toContainText(`Showing the ${above.length} people paid over ${k(w.hi)}`);
  const rows = card.locator('tbody tr');
  await expect(rows).toHaveCount(above.length);
  const pays = (await rows.evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    const money = cells.map((c) => c.textContent ?? '').filter((t) => /^\$[\d,]+$/.test(t.trim()));
    return Number((money[money.length - 1] ?? '').replace(/[$,]/g, ''));
  })));
  expect(pays.every((p) => p > w.hi), `a listed pay is not over the window: ${pays.join(', ')}`).toBe(true);
  // Brought into view.
  await expect(card).toBeInViewport();
  // Everyone again.
  await card.getByRole('button', { name: 'Show everyone' }).click();
  await expect(high).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(everyone);
  // By keyboard, the low pile.
  const low = page.locator('.peer-strip [data-pile="-1"]');
  await low.focus();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(people.filter((p) => p.pay < w.lo).length);
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(everyone);
});

test('the tenure scatter zooms to the same window, pins the rest to its edges, and gives its crowd room', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = await holders('PD012');
  const w = windowOf(people.map((p) => p.pay))!;
  const plotted = people.filter((p) => p.hired);
  const above = plotted.filter((p) => p.pay > w.hi), below = plotted.filter((p) => p.pay < w.lo);
  await openPerson(page, KENDALL);
  const plot = page.locator('.tenure-plot');
  await plot.scrollIntoViewIfNeeded();
  await expect(plot).toHaveAttribute('data-window', `${w.lo}-${w.hi}`);
  await expect(plot.locator('.chart-dot').first()).toBeAttached({ timeout: 30_000 });

  // The pay axis stays inside the window, on round steps.
  const ticks = (await plot.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents()).map((t) => Number(t.replace(/[$k]/g, '')) * 1000);
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...ticks)).toBeGreaterThanOrEqual(w.lo);
  expect(Math.max(...ticks)).toBeLessThanOrEqual(w.hi);
  // The bands: who is in them, and where.
  const top = plot.locator('.tenure-band[data-side="1"]'), bottom = plot.locator('.tenure-band[data-side="-1"]');
  await expect(top).toHaveAttribute('data-n', String(above.length));
  await expect(bottom).toHaveAttribute('data-n', String(below.length));
  await expect(top.locator('text')).toHaveText(`${above.length} over ${k(w.hi)}`);
  await expect(plot.locator('.chart-dot[data-side="1"]')).toHaveCount(above.length);
  await expect(plot.locator('.chart-dot[data-side="-1"]')).toHaveCount(below.length);
  const geo = await plot.evaluate((el) => {
    const grid = el.querySelector('.recharts-cartesian-grid')!.getBoundingClientRect();
    const dots = [...el.querySelectorAll<SVGCircleElement>('.chart-dot')].map((c) => {
      const b = c.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2, side: Number(c.dataset.side ?? 0) };
    });
    return { top: grid.y, bottom: grid.y + grid.height, dots };
  });
  const inside = geo.dots.filter((d) => !d.side);
  const topBand = geo.dots.filter((d) => d.side > 0), bottomBand = geo.dots.filter((d) => d.side < 0);
  expect(Math.max(...topBand.map((d) => d.y)), 'a dot over the window sits below the top band').toBeLessThan(Math.min(...inside.map((d) => d.y)));
  expect(Math.min(...bottomBand.map((d) => d.y)), 'a dot under the window sits above the bottom band').toBeGreaterThan(Math.max(...inside.map((d) => d.y)));
  // The tenure axis ends at the next five years past the longest tenure (31.5), not the next ten: the
  // 30y tick sits 30/35 of the way across the plot.
  const longest = await oracle<{ t: number }>(`SELECT max(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) t FROM $SAL WHERE snapshot_id = '${await latestSnapshot()}' AND job_code = 'PD012'`);
  const end = Math.ceil(longest[0].t / 5) * 5;
  expect(end % 10, 'the longest tenure now ends on a ten: the check below cannot tell five from ten').not.toBe(0);
  const at30 = await plot.evaluate((el) => {
    const grid = el.querySelector('.recharts-cartesian-grid')!.getBoundingClientRect();
    const tick = [...el.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick')].find((t) => t.textContent === '30y')!;
    const line = tick.querySelector('line')!.getBoundingClientRect();
    return (line.x - grid.x) / grid.width;
  });
  expect(at30).toBeCloseTo(30 / end, 2);

  // Room: most drawn dots stand clear of every other, and none was moved further than a nudge may.
  // (Not all: 103 Research Associates are on exactly $60,416, most in their first two years, and there is
  // not room for them all within 10px of it. 75% at this width; 51% with no nudge at all.)
  const room = await ownRoom(page);
  expect(room.share, `only ${room.clear} of ${room.n} dots have their own room`).toBeGreaterThan(0.65);
  const layer = plot.locator('.tenure-dots');
  expect(Number(await layer.getAttribute('data-max-shift'))).toBeLessThanOrEqual(10);
  expect(Number(await layer.getAttribute('data-max-shift')), 'nothing was nudged: the crowd was not given room').toBeGreaterThan(0);
  // The Professors, a crowd that spreads: every one of their 1,151 dots in the window has room.
  await openPerson(page, 'kennethposs|2024-07-01');
  await expect(page.locator('.tenure-plot .chart-dot').first()).toBeAttached({ timeout: 30_000 });
  const prof = await ownRoom(page);
  expect(prof.share, `only ${prof.clear} of ${prof.n} Professors' dots have their own room`).toBeGreaterThan(0.95);
});

/** How many of the scatter's dots inside the window stand clear of every other: centres at least their
 *  two radii apart, read off the drawn circles. */
async function ownRoom(page: Page) {
  return page.locator('.tenure-plot').evaluate((el) => {
    const dots = [...el.querySelectorAll<SVGCircleElement>('.chart-dot')]
      .filter((c) => !c.dataset.side)
      .map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; });
    let clear = 0;
    for (const d of dots) if (dots.every((o) => o === d || Math.hypot(o.x - d.x, o.y - d.y) >= o.r + d.r - 0.01)) clear++;
    return { n: dots.length, clear, share: clear / Math.max(1, dots.length) };
  });
}

test('pointing at the tenure scatter names the nearest person, and a click opens them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPerson(page, KENDALL);
  const plot = page.locator('.tenure-plot');
  await plot.scrollIntoViewIfNeeded();
  const self = plot.locator('.tenure-self circle').last();
  await expect(self).toBeAttached({ timeout: 30_000 });
  const sb = (await self.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2 + 3, sb.y + sb.height / 2 + 2);
  await expect(plot.locator('.tenure-tip')).toContainText('Kendall Barrett (this person)');
  // A lone peer: the dot furthest from any other, so the nearest person to it is certainly it.
  const lone = await plot.evaluate((el) => {
    const dots = [...el.querySelectorAll<SVGCircleElement>('.chart-dot')].map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    let best = dots[0], far = -1;
    for (const d of dots) {
      const near = Math.min(...dots.filter((o) => o !== d).map((o) => Math.hypot(o.x - d.x, o.y - d.y)));
      if (near > far) { far = near; best = d; }
    }
    return best;
  });
  await page.mouse.move(lone.x + 6, lone.y);
  const tip = plot.locator('.tenure-tip');
  await expect(tip).toBeVisible();
  const name = (await tip.locator('p').first().innerText()).trim();
  expect(name).not.toContain('this person');
  await page.mouse.click(lone.x + 6, lone.y);
  await expect(page).toHaveURL(/\/person\//);
  await expect(page.locator('h1')).toHaveText(name, { timeout: 60_000 });
});
