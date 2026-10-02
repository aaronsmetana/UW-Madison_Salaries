import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot, PAY } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * The chart marks (src/components/markers.tsx and the tokens behind them in app.css), checked as a
 * reader meets them: the colour a mark actually renders in, flattened over the card it sits on.
 */

const AARON = 'aaronsmetana|2014-10-15';

/** People whose full name is unique in the data, so a name search finds exactly them. */
const UNIQUE_NAME = `(SELECT person_key FROM (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln FROM $SAL GROUP BY person_key)
   QUALIFY count(*) OVER (PARTITION BY lower(fn), lower(ln)) = 1)`;

/** A mark's contrast against the card behind it, with its fill- and element-opacity applied. */
async function markContrast(page: Page, selector: string, paint: 'fill' | 'stroke', card: number[]) {
  const el = page.locator(selector).first();
  await expect(el).toBeAttached();
  // The strip fades its marks in; measure the settled mark, not a frame of the fade.
  await expect.poll(() => el.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  const { colour, alpha } = await el.evaluate((e, p) => {
    const cs = getComputedStyle(e);
    return { colour: p === 'fill' ? cs.fill : cs.stroke, alpha: Number(p === 'fill' ? cs.fillOpacity : cs.strokeOpacity) };
  }, paint);
  const [r, g, b, a] = parseColor(colour);
  return contrast(flatten([r, g, b, a * alpha], card), card);
}

async function cardOf(page: Page, selector: string): Promise<number[]> {
  const bg = await page.locator(selector).first().evaluate((e) => getComputedStyle(e.closest('.mantine-Card-root')!).backgroundColor);
  return parseColor(bg).slice(0, 3);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`your overview's marks keep their order and their contrast (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    await expect(page.locator('.peer-strip-marker')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tenure-fit line')).toBeAttached({ timeout: 30_000 });
    const card = await cardOf(page, '.peer-strip');
    const got = {
      self: await markContrast(page, '.peer-strip-marker', 'fill', card),
      sameSchool: await markContrast(page, '.peer-strip circle[data-mark="same-school"]', 'fill', card),
      peer: await markContrast(page, '.peer-strip circle[data-mark="peer"]', 'fill', card),
      trendLine: await markContrast(page, '.tenure-fit line', 'stroke', card),
      bandEdge: await markContrast(page, '.peer-strip .band-iqr-edge', 'stroke', card),
    };
    const r = (x: number) => Math.round(x * 100) / 100;
    const summary = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, r(v)]));
    // The subject is the loudest thing on the chart, a same-school peer can be found, and everyone
    // else is context — in that order, in both schemes. Dark mode used to run it backwards.
    expect(got.self, JSON.stringify(summary)).toBeGreaterThanOrEqual(4.5);
    expect(got.sameSchool, JSON.stringify(summary)).toBeGreaterThanOrEqual(3);
    expect(got.peer, JSON.stringify(summary)).toBeGreaterThanOrEqual(1.5);
    expect(got.peer, JSON.stringify(summary)).toBeLessThanOrEqual(2.5);
    expect(got.self, 'the subject outranks a same-school peer').toBeGreaterThan(got.sameSchool);
    expect(got.sameSchool, 'a same-school peer outranks everyone else').toBeGreaterThan(got.peer);
    expect(got.trendLine, JSON.stringify(summary)).toBeGreaterThanOrEqual(3);
    expect(got.bandEdge, JSON.stringify(summary)).toBeGreaterThanOrEqual(3);
  });

  test(`the Titles box plot's middle 50% has edges a reader can see (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./explore?tab=titles');
    const box = page.locator('rect.band-iqr').first();
    await expect(box).toBeVisible({ timeout: 60_000 });
    const card = await box.evaluate((e) => {
      // The row's own background where it has one (striping, hover), else the card's.
      for (let el: Element | null = e.closest('td'); el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    });
    const ground = parseColor(card).slice(0, 3);
    const edge = await box.evaluate((e) => getComputedStyle(e).stroke);
    expect(contrast(parseColor(edge).slice(0, 3), ground)).toBeGreaterThanOrEqual(3);
  });
}

/** Someone paid well under what tenure predicts for their title (15% or more), in a title large enough
 *  to fit: the page's verdict for them is "below". */
async function belowTheCurve(): Promise<string> {
  const snap = await latestSnapshot();
  const [p] = await oracle<{ pk: string }>(
    `WITH pp AS (SELECT person_key, any_value(job_code) job, sum(${PAY}) FILTER (WHERE salary > 0) pay,
                        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 t
                 FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key HAVING count(*) = 1),
          fit AS (SELECT job, regr_slope(pay, t) b, regr_intercept(pay, t) a FROM pp WHERE pay > 0 AND t IS NOT NULL
                  GROUP BY job HAVING count(*) >= 30)
     SELECT person_key pk FROM pp JOIN fit USING (job)
     WHERE pp.pay > 0 AND pp.pay < 0.85 * (fit.a + fit.b * pp.t) AND person_key IN ${UNIQUE_NAME}
     ORDER BY person_key LIMIT 1`
  );
  return p.pk;
}

/** The scatter's "on the curve" band and the subject's dot, in dollars: each edge of the band at the
 *  dot's tenure, read off the pay axis's own tick labels, and where the dot sits between them. */
async function bandAtSelf(page: Page) {
  // The scatter draws after the callout above it: wait for what is read, not for a clock.
  await expect(page.locator('.tenure-fit-band polygon')).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('.tenure-plot .tenure-self circle').first()).toBeAttached();
  await expect(page.locator('.tenure-plot .recharts-yAxis .recharts-cartesian-axis-tick text').nth(1)).toBeAttached();
  const g = await page.locator('.tenure-plot').evaluate((el) => {
    const poly = el.querySelector('.tenure-fit-band polygon');
    const pts = (poly?.getAttribute('points') ?? '').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const dot = [...el.querySelectorAll<SVGCircleElement>('.tenure-self circle')].pop()!;
    const ticks = [...el.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text')].map((t) => ({
      y: Number(t.getAttribute('y')),
      v: Number((t.textContent ?? '').replace(/[$,k]/g, '')) * ((t.textContent ?? '').includes('k') ? 1000 : 1),
    }));
    return { pts, cx: Number(dot.getAttribute('cx')), cy: Number(dot.getAttribute('cy')), ticks };
  });
  expect(g.pts.length, 'the scatter draws no "on the curve" band').toBe(4);
  expect(g.ticks.length, 'no pay-axis ticks to read the band by').toBeGreaterThanOrEqual(2);
  const [a, b] = [g.ticks[0], g.ticks[g.ticks.length - 1]];
  const dollars = (y: number) => a.v + ((y - a.y) / (b.y - a.y)) * (b.v - a.v);
  const along = (p: number[], q: number[]) => p[1] + ((g.cx - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
  // The polygon runs along the top edge (0 → 1), then back along the bottom (2 → 3).
  const top = along(g.pts[0], g.pts[1]), bottom = along(g.pts[3], g.pts[2]);
  return { hi: dollars(top), lo: dollars(bottom), top, bottom, dotY: g.cy };
}

/**
 * The band round the tenure line is the callout's "on the tenure curve", drawn: its edges are exactly
 * `expected / 0.98` and `expected / 1.02` (lib/stats `onCurveBand`), the subject the callout calls "on"
 * sits inside it, and one it calls "below" under it. A band drawn to its own rule would be a second,
 * disagreeing definition of the same words.
 */
test('the scatter shades exactly what the callout calls "on the tenure curve"', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const callout = page.locator('.tenure-callout');
  await expect(callout).toHaveAttribute('data-verdict', 'on', { timeout: 60_000 });
  const expected = Number((await callout.innerText()).match(/typically pays \$([\d,]+)/)![1].replace(/,/g, ''));
  const on = await bandAtSelf(page);
  // Half a pixel of the axis either way: the band is drawn to a tenth of one.
  const tol = (on.hi - on.lo) * 0.1;
  expect(Math.abs(on.hi - expected / 0.98), `the band's top is $${Math.round(on.hi)}, not $${Math.round(expected / 0.98)}`).toBeLessThan(tol);
  expect(Math.abs(on.lo - expected / 1.02), `the band's bottom is $${Math.round(on.lo)}, not $${Math.round(expected / 1.02)}`).toBeLessThan(tol);
  expect(on.dotY, 'the subject is "on the curve" but drawn above its band').toBeGreaterThan(on.top);
  expect(on.dotY, 'the subject is "on the curve" but drawn below its band').toBeLessThan(on.bottom);

  await page.goto(`./person/${encodeURIComponent(await belowTheCurve())}`);
  await expect(page.locator('.tenure-callout')).toHaveAttribute('data-verdict', 'below', { timeout: 60_000 });
  const below = await bandAtSelf(page);
  expect(below.dotY, 'the subject is "below the curve" but drawn inside or over its band').toBeGreaterThan(below.bottom);
});

/**
 * A peer dot carries a 1px rim of the card colour, painted under its fill, so dots that touch or
 * overlap read as separate people rather than one grey blob. A crowd's 2px dots carry none: the rim
 * would be most of the dot.
 */
test("a peer dot is rimmed in the card's colour, and a crowd's are not", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('.tenure-plot .chart-dot').first()).toBeAttached({ timeout: 60_000 });
  const card = await cardOf(page, '.peer-strip');
  for (const sel of ['.peer-strip circle.chart-dot', '.tenure-plot circle.chart-dot']) {
    const rim = await page.locator(sel).first().evaluate((c) => {
      const cs = getComputedStyle(c);
      return { stroke: cs.stroke, width: cs.strokeWidth, order: cs.paintOrder };
    });
    expect(rim.stroke, `${sel}: the dot has no rim`).not.toBe('none');
    expect(parseColor(rim.stroke).slice(0, 3), `${sel}: rim ${rim.stroke}`).toEqual(card);
    expect(rim.width, sel).toBe('3px');
    // Under the fill: only the outer 1.5px shows, and the dot keeps the radius the packer reserved.
    expect(rim.order, sel).toMatch(/^stroke/);
  }
  await page.goto(`./person/${encodeURIComponent('kennethposs|2024-07-01')}`);
  await expect(page.locator('.tenure-plot .chart-dot').first()).toBeAttached({ timeout: 60_000 });
  expect(await page.locator('.tenure-plot circle.chart-dot').first().evaluate((c) => getComputedStyle(c).stroke)).toBe('none');
});

test('the tenure callout is never a warning, even when the verdict is "below"', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(await belowTheCurve())}`);
  const callout = page.locator('.tenure-callout');
  await expect(callout).toHaveAttribute('data-verdict', 'below', { timeout: 60_000 });
  // A warning hue is saturated; the callout's surface and rule are neutral greys. Chroma is the
  // spread between the strongest and weakest channel.
  const paints = await callout.evaluate((e) => {
    const cs = getComputedStyle(e);
    return [cs.backgroundColor, cs.borderLeftColor, cs.color];
  });
  for (const c of paints) {
    const [r, g, b] = parseColor(c);
    expect(Math.max(r, g, b) - Math.min(r, g, b), `${c} reads as a colour, not a neutral`).toBeLessThan(40);
  }
});

test('a pay cut draws a down arrow, and a rise an up one', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, min(snapshot_date) d, sum(${PAY}) pay, count(*) k FROM $SAL GROUP BY 1, 2),
          f AS (SELECT person_key, arg_min(pay, d) p0, arg_max(pay, d) p1, max(k) k FROM s GROUP BY 1 HAVING count(*) >= 3)
     SELECT person_key pk FROM f WHERE k = 1 AND p0 > 0 AND p1 < 0.8 * p0 AND person_key IN ${UNIQUE_NAME}
     ORDER BY person_key LIMIT 1`
  );
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  await expect(page.locator('[data-trend]')).toHaveAttribute('data-trend', 'down', { timeout: 60_000 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('[data-trend]')).toHaveAttribute('data-trend', 'up', { timeout: 60_000 });
});

test('every table header shares one style, chart data tables included', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const open = page.getByRole('button', { name: "Table of this chart's data" }).first();
  await expect(open).toBeVisible({ timeout: 60_000 });
  await open.click();
  await expect(page.getByRole('button', { name: 'Sort by Salary' })).toBeVisible({ timeout: 60_000 });
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('table')]
      .filter((t) => {
        // Screen-reader copies (ChartData's VisuallyHidden table) are clipped to a 1px box and drawn
        // for no one; every table a reader can see must match.
        for (let el: HTMLElement | null = t.parentElement; el; el = el.parentElement) if (el.clientWidth <= 1) return false;
        return t.offsetParent !== null && !!t.querySelector('thead th');
      })
      .map((t) => {
        const cs = getComputedStyle(t.querySelector('thead th')!);
        return `${cs.fontSize} ${cs.textTransform} ${cs.letterSpacing} ${cs.fontWeight}`;
      })
  );
  expect(styles.length, 'the chart table and the peer table are both measured').toBeGreaterThanOrEqual(2);
  expect(new Set(styles).size, styles.join(' | ')).toBe(1);
});

/**
 * A chart of two or three lines names each one where it ends (`EndLabels`), in place of Recharts'
 * default legend — a row of swatches under the plot that had to be matched back to the lines by
 * colour and dash. Checked as a reader meets them: one name per drawn line, no two names on top of
 * one another, inside the chart, and legible text over the halo they are drawn on.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`a line chart names its lines where they end (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const charts: Array<[string, string, number, ((page: Page) => Promise<void>)?]> = [
      // The report's dashboard trend: pay, the title median and pay had raises been typical.
      [`./reports?person=${encodeURIComponent(AARON)}`, '.print-area', 3],
      // The headcount panel under the median, whose two lines end 10px apart at the top of the plot.
      ['./explore?tab=trends', 'body', 2],
      // The raise case's pay history: pay and the title median. It kept a hand-drawn legend under the
      // plot after every other chart lost theirs.
      ['./reports?type=comparison', '.report-brief', 2, async (p) => {
        const start = p.getByPlaceholder('Search yourself by name to begin…');
        await expect(start).toBeVisible({ timeout: 60_000 });
        await start.fill('Kenneth Poss');
        await p.getByRole('option').first().click();
      }],
    ];
    for (const [route, scope, lines, setup] of charts) {
      await page.goto(route);
      await setup?.(page);
      const labels = page.locator(`${scope} .end-label`);
      await expect(labels).toHaveCount(lines, { timeout: 60_000 });
      await page.waitForTimeout(1_000);
      const report = await page.locator(scope).evaluate((root) => {
        const svg = root.querySelector<SVGTextElement>('.end-label')!.ownerSVGElement!;
        const box = svg.getBoundingClientRect();
        const drawn = [...svg.querySelectorAll('.recharts-line-curve')].length;
        const texts = [...svg.querySelectorAll<SVGTextElement>('.end-label')].map((t) => {
          const r = t.getBoundingClientRect();
          const cs = getComputedStyle(t);
          return { text: t.textContent, l: r.left, r: r.right, t: r.top, b: r.bottom, fill: cs.fill, halo: cs.stroke };
        });
        const inside = texts.every((t) => t.l >= box.left && t.r <= box.right && t.t >= box.top && t.b <= box.bottom);
        const overlaps = texts.flatMap((a, i) => texts.slice(i + 1)
          .filter((b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).map((b) => `${a.text} / ${b.text}`));
        // A legend drawn by hand beside the chart: a line's name again, outside the plot, in its card.
        const card = svg.closest('.mantine-Card-root, .mantine-Paper-root') ?? svg.parentElement!;
        const names = new Set(texts.map((t) => t.text));
        const handDrawn = [...card.querySelectorAll('*')]
          .filter((e) => !e.closest('svg, table') && e.children.length === 0 && names.has(e.textContent?.trim() ?? '')
            && (e as HTMLElement).checkVisibility())
          .map((e) => e.textContent);
        return { drawn, texts, inside, overlaps, legend: document.querySelectorAll('.recharts-legend-wrapper').length, handDrawn };
      });
      expect(report.texts.length, `${route}: a name for each of the ${report.drawn} lines drawn`).toBe(report.drawn);
      expect(report.overlaps, `${route}: names drawn over one another`).toEqual([]);
      expect(report.inside, `${route}: a name runs out of its chart`).toBe(true);
      expect(report.legend, `${route}: Recharts' default legend is back`).toBe(0);
      expect(report.handDrawn, `${route}: a legend beside the chart names its lines again`).toEqual([]);
      for (const t of report.texts) {
        const ratio = contrast(parseColor(t.fill).slice(0, 3), parseColor(t.halo).slice(0, 3));
        expect(ratio, `${route}: "${t.text}" reads at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

/**
 * The tooltip was the only way into a chart's values short of its data table, and it answered only
 * a pointer. `chartKeys` makes a chart one Tab stop whose left and right arrow keys walk the tooltip
 * through its points in order — the order of the chart's own data table.
 */
test('the keyboard steps a chart through its points, in order', async ({ page }) => {
  await page.goto('./explore?tab=trends');
  const chart = page.locator('svg.recharts-surface[role="application"]').first();
  await expect(chart).toBeAttached({ timeout: 60_000 });
  await expect(chart).toHaveAttribute('aria-label', /^Median salary over time\. Left and right arrow keys/);
  const table = page.locator('table').filter({ has: page.locator('caption', { hasText: /^Median salary, headcount/ }) });
  const snaps = (await table.locator('tbody tr td:first-child').allTextContents()).slice(0, 3);
  expect(snaps.length, 'the data table lists fewer than three snapshots').toBe(3);
  const tip = page.locator('.recharts-tooltip-wrapper').first();

  await chart.focus();
  await expect(chart, 'focus from the keyboard shows where it is').toHaveCSS('outline-style', 'solid');
  await expect(tip).toContainText(snaps[0]);
  await page.keyboard.press('ArrowRight');
  await expect(tip).toContainText(snaps[1]);
  await page.keyboard.press('ArrowRight');
  await expect(tip).toContainText(snaps[2]);
  await page.keyboard.press('ArrowLeft');
  await expect(tip).toContainText(snaps[1]);
});

/**
 * How to read a chart — what a bin holds, what each colour means — is one click away in the chart's
 * footer, not a paragraph under every plot. A fact about THIS data stays on the card: the broken bar's
 * note is checked in divisions.spec.
 */
test("a chart's how-to-read note opens from its footer", async ({ page }) => {
  await page.goto('./explore?tab=changes');
  const card = page.locator('.raise-dist-card');
  await expect(card.locator('.recharts-bar-rectangle').first()).toBeAttached({ timeout: 60_000 });
  await expect(card.getByText(/1% bins of raises/)).toHaveCount(0);
  const button = card.getByRole('button', { name: 'About this chart' });
  await button.click();
  const note = page.locator('.chart-about-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('1% bins of raises');
  await expect(note).toContainText('the dashed line marks the median');
  // Closed from the keyboard too, and back where it was opened from.
  await expect(note).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(note).toBeHidden();
  await expect(button).toBeFocused();
});
