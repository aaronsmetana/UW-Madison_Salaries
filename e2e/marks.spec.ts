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
