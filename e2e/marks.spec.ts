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

test('the tenure callout is never a warning, even when the verdict is "below"', async ({ page }) => {
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
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
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
  const open = page.getByRole('button', { name: 'View chart data as a table' }).first();
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
    const charts: Array<[string, string, number]> = [
      // The report's dashboard trend: pay, the title median and pay had raises been typical.
      [`./reports?person=${encodeURIComponent(AARON)}`, '.print-area', 3],
      // The headcount panel under the median, whose two lines end 10px apart at the top of the plot.
      ['./explore?tab=trends', 'body', 2],
    ];
    for (const [route, scope, lines] of charts) {
      await page.goto(route);
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
        return { drawn, texts, inside, overlaps, legend: document.querySelectorAll('.recharts-legend-wrapper').length };
      });
      expect(report.texts.length, `${route}: a name for each of the ${report.drawn} lines drawn`).toBe(report.drawn);
      expect(report.overlaps, `${route}: names drawn over one another`).toEqual([]);
      expect(report.inside, `${route}: a name runs out of its chart`).toBe(true);
      expect(report.legend, `${route}: Recharts' default legend is back`).toBe(0);
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
  const button = card.getByRole('button', { name: 'How to read this chart' });
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
