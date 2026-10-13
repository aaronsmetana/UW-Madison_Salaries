import { test, expect, type Page } from '@playwright/test';
import { oracle } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * The Report tab (P37, P38): the Overview's own headline cells, giving the same figures under the same names; and
 * the title's histogram with every column's count, inside the top of a column tall enough to hold it, and no label
 * drawn on another.
 */

const AARON = 'aaronsmetana|2014-10-15';
test.use({ viewport: { width: 1440, height: 1000 } });

async function report(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}?tab=report`);
  await expect(page.locator('.print-area [data-figure="growth"]')).toBeVisible({ timeout: 60_000 });
}
/** Each headline figure on both tabs: the Overview stays mounted beside the Report. */
async function figures(page: Page, scope: string) {
  const f = (k: string) => page.locator(`${scope} [data-figure="${k}"]`).first().evaluate((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
  return { pay: await f('pay'), growth: await f('growth'), tenure: await f('tenure') };
}

test('the Report’s headline figures are the Overview’s, under the Overview’s names', async ({ page }) => {
  await report(page, AARON);
  const heads = await page.locator('.print-area .stat-row').first().locator('.stat-cell-head').allInnerTexts();
  expect(heads.map((h) => h.split('\n')[0].trim().toLowerCase())).toEqual(['actual pay', 'actual pay growth', 'tenure']);
  await expect(page.locator('.person-figures [data-figure="growth"]')).toBeAttached();
  expect(await figures(page, '.print-area')).toEqual(await figures(page, '.person-figures'));
  expect((await figures(page, '.print-area')).growth).toMatch(/^[+−]/);
  // And the line under the growth: the same snapshots, since the same one.
  const span = (scope: string) => page.locator(`${scope} .growth-span`).first().evaluate((e) => (e.textContent ?? '').trim());
  const [inReport, onOverview] = await Promise.all([span('.print-area'), span('.person-figures')]);
  expect(inReport).toMatch(/^\d+ snapshots? since/);
  expect(inReport).toBe(onOverview);
});

test('a 9-month member’s growth is like for like on both, with the figure as reported beside it', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH one AS (SELECT snapshot_id, person_key, any_value(job_code) job, any_value(comp_basis) basis FROM $SAL
                  WHERE salary > 0 GROUP BY ALL HAVING count(*) = 1)
     SELECT a.person_key pk FROM one a JOIN one b USING (person_key)
     WHERE a.snapshot_id = '2025-04' AND b.snapshot_id = '2025-09' AND a.job = b.job
       AND a.basis = 'Academic' AND b.basis = '9 Month' ORDER BY pk LIMIT 1`
  );
  await report(page, p.pk);
  expect(await figures(page, '.print-area')).toEqual(await figures(page, '.person-figures'));
  await expect(page.locator('.print-area [data-reporting-note]')).toContainText('as reported');
});

test('where the FTE moved, both give the full-time rate’s growth and say so', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, any_value(snapshot_date) d, count(*) k, any_value(fte) f FROM $SAL WHERE salary > 0 GROUP BY 1, 2),
          q AS (SELECT person_key, max(k) mk, count(*) n, arg_min(f, d) f0, arg_max(f, d) f1 FROM s GROUP BY 1)
     SELECT person_key pk FROM q WHERE mk = 1 AND n >= 6 AND f0 > 0 AND f1 > 0 AND abs(f0 - f1) > 0.1 ORDER BY pk LIMIT 1`
  );
  await report(page, p.pk);
  expect(await figures(page, '.print-area')).toEqual(await figures(page, '.person-figures'));
  await expect(page.locator('.print-area .growth-fte')).toContainText(/^Full-time rate · FTE \d+% → \d+% · actual pay [+−]/);
});

test('the Report’s histogram counts every column, inside the top where it fits, and no label lands on another', async ({ page }) => {
  await report(page, AARON);
  const plot = page.locator('.print-area .hist-plot').first();
  await expect(plot.locator('.hist-col').first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const g = await plot.evaluate((root) => {
    const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const cols = [...root.querySelectorAll('.hist-col')].map((c) => {
      const bricks = [...c.querySelectorAll('.hist-brick')].map(rect);
      const count = c.querySelector('.hist-count');
      return {
        n: bricks.length,
        count: count ? { text: count.textContent ?? '', place: (count as HTMLElement).dataset.place, box: rect(count) } : null,
        stack: bricks.length ? { left: Math.min(...bricks.map((b) => b.left)), right: Math.max(...bricks.map((b) => b.right)), top: Math.min(...bricks.map((b) => b.top)), bottom: Math.max(...bricks.map((b) => b.bottom)) } : null,
        bricks,
      };
    });
    const labels = [...root.querySelectorAll('.hist-count, .hist-pin-label, .hist-median-label')].map((e) => ({ what: e.className.includes('hist-count') ? `count ${e.textContent}` : e.textContent ?? '', box: rect(e) }));
    const pin = root.querySelector('.hist-pin-label');
    return { cols, labels, pin: pin ? rect(pin) : null };
  });
  expect(g.pin, 'no "this person" on the chart').not.toBeNull();
  for (const c of g.cols) {
    if (!c.n) { expect(c.count).toBeNull(); continue; }
    expect(c.count?.text, 'a column without its count').toBe(String(c.n));
    if (c.count!.place === 'in') {
      expect(c.count!.box.top).toBeGreaterThanOrEqual(c.stack!.top - 0.5);
      expect(c.count!.box.bottom).toBeLessThanOrEqual(c.stack!.bottom + 0.5);
      expect(c.count!.box.left).toBeGreaterThanOrEqual(c.stack!.left - 0.5);
      expect(c.count!.box.right).toBeLessThanOrEqual(c.stack!.right + 0.5);
    }
  }
  expect(g.cols.filter((c) => c.count?.place === 'in').length, 'no count inside a column').toBeGreaterThan(0);
  const hit = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (let i = 0; i < g.labels.length; i++) {
    for (let j = i + 1; j < g.labels.length; j++) {
      expect(hit(g.labels[i].box, g.labels[j].box), `"${g.labels[i].what}" on "${g.labels[j].what}"`).toBe(false);
    }
  }
  for (const b of g.cols.flatMap((c) => c.bricks)) expect(hit(g.pin!, b), '"this person" on a brick').toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`a count reads at 4.5:1 on its column or beside it (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await report(page, AARON);
    const counts = page.locator('.print-area .hist-plot .hist-count');
    await expect(counts.first()).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(600);
    const seen = await counts.evaluateAll((cs) => cs.map((c) => {
      const card = getComputedStyle(c.closest('.mantine-Card-root')!).backgroundColor;
      const cs2 = getComputedStyle(c);
      return { text: c.textContent ?? '', fg: cs2.color, bg: cs2.backgroundColor, card, place: (c as HTMLElement).dataset.place };
    }));
    expect(seen.length).toBeGreaterThan(3);
    for (const c of seen) {
      const card = parseColor(c.card).slice(0, 3);
      const bg = flatten(parseColor(c.bg), card);
      const fg = flatten(parseColor(c.fg), bg);
      expect(contrast(fg, bg), `the ${c.place} count ${c.text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
