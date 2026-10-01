import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, places, spots } from './homeDots';

/**
 * The landing search's suggestions — with the box empty, the most common titles and largest divisions —
 * and its title and division results. A press on a row opens its page (on a desktop the list closed from
 * under the press, and nothing happened). A row the reader goes to, by pointer or arrow, is shown on the
 * graph above: its dots lit and the rest faded, as a filter shows it full page. "Show on full page graph"
 * puts it there.
 */

const SNAP = HOME_STATS.snapshot_id;

/** Everyone paid in the graph's snapshot, at their total pay, with a paid appointment in the title or school. */
function covered(f: { code?: string; school?: string }) {
  const cond = f.code ? `job_code = '${f.code}'` : `school = '${f.school!.replace(/'/g, "''")}'`;
  return oracle<{ person_key: string; pay: number }>(
    `WITH p AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key)
     SELECT person_key, pay FROM p WHERE pay > 0 AND person_key IN
       (SELECT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND ${cond})`,
  );
}

/** The main field's lit dots as the page prints them: how many, and the sum and sum of squares of places. */
async function mainPrint(who: { person_key: string }[]) {
  const at = await spots();
  const f = [0, 0, 0];
  for (const p of who) {
    const s = at.get(p.person_key);
    if (!s || s.field !== 'main') continue;
    f[0]++; f[1] += s.index; f[2] += s.index * s.index;
  }
  return f.join(':');
}

const box = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
const main = (page: Page) => page.locator('.hero-dist-main').first();
const dots = (page: Page) => page.locator('.hero-dist-main .hero-dots').first();
const row = (page: Page, key: string) => page.locator(`[data-suggestions] [role="option"][data-key="${key}"]`);

/** The page, the dots at rest, the box engaged and its suggestions open. */
async function suggestions(page: Page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots').first()).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await box(page).click();
  await expect(page.locator('[data-suggestions] [role="option"]').first()).toBeVisible({ timeout: 60_000 });
  return (await page.locator('[data-suggestions] [role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')!)));
}

test('a press on a suggestion opens its page; a press on the list elsewhere leaves it open', async ({ page }) => {
  const keys = await suggestions(page);
  const title = keys.find((k) => k.startsWith('t:'))!;
  const division = keys.find((k) => k.startsWith('d:'))!;
  await page.getByText('Most common titles').click();
  await expect(row(page, title), 'a press on the list’s heading closed it').toBeVisible();
  await row(page, title).locator('.mantine-Text-root').first().click();
  await expect(page).toHaveURL(new RegExp(`/paycheck\\?code=${title.slice(2)}$`));
  await page.goBack();
  await box(page).click();
  await expect(row(page, division)).toBeVisible({ timeout: 60_000 });
  await row(page, division).locator('.mantine-Text-root').first().click();
  await expect(page).toHaveURL(new RegExp(`/school/${encodeURIComponent(division.slice(2)).replace(/[()]/g, '\\$&')}$`));
});

test('a suggestion the reader goes to is shown on the graph — its dots lit, exactly — and only then', async ({ page }) => {
  test.setTimeout(180_000);
  const keys = await suggestions(page);
  // Opened, nothing is shown: the list starts on its first row, which the reader has not gone to.
  await page.waitForTimeout(800);
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
  await expect(dots(page)).not.toHaveAttribute('data-lit', /./);
  // Nor by a row sliding under a pointer at rest: opening the list can scroll the page, and Chrome then
  // sends a mousemove that has not moved.
  await row(page, keys[2]).dispatchEvent('mousemove', { movementX: 0, movementY: 0, bubbles: true });
  await page.waitForTimeout(600);
  await expect(main(page), 'a still pointer chose a row').not.toHaveAttribute('data-filter', /./);

  // A pointer on the second title.
  const t = keys.filter((k) => k.startsWith('t:'))[1];
  const who = await covered({ code: t.slice(2) });
  await row(page, t).hover();
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(who), { timeout: 60_000 });
  await expect(main(page)).toHaveAttribute('data-group-count', String(who.length));

  // The arrow keys to the first division.
  const d = keys.find((k) => k.startsWith('d:'))!;
  const whoD = await covered({ school: d.slice(2) });
  for (let k = 0; k < keys.length && (await row(page, d).getAttribute('aria-selected')) !== 'true'; k++) await box(page).press('ArrowDown');
  await expect(row(page, d)).toHaveAttribute('aria-selected', 'true');
  await expect(main(page)).toHaveAttribute('data-filter', d.slice(2), { timeout: 60_000 });
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(whoD), { timeout: 60_000 });

  // Put away, it goes.
  await box(page).press('Escape');
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
  await expect(dots(page)).not.toHaveAttribute('data-lit', /./);

  // And by a press away from the list.
  await box(page).click();
  await row(page, t).hover();
  await expect(main(page)).toHaveAttribute('data-filter', /./, { timeout: 60_000 });
  await page.mouse.click(5, 450);
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
});

test('a title typed for is shown on the graph as its row is gone to', async ({ page }) => {
  test.setTimeout(120_000);
  await suggestions(page);
  const [c] = await oracle<{ code: string }>(
    `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND title = 'Research Associate'
     GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`,
  );
  await box(page).fill('research assoc');
  const r = page.locator(`[role="option"][data-key="t:${c.code}"]`);
  await expect(r).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await expect(main(page), 'typing alone showed a row').not.toHaveAttribute('data-filter', /./);
  await r.hover();
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(await covered({ code: c.code })), { timeout: 60_000 });
});

test('the group’s label keeps off the panel’s controls, for every suggestion', async ({ page }) => {
  test.setTimeout(240_000);
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    const keys = await suggestions(page, size);
    for (const k of keys) {
      await row(page, k).hover();
      await expect(main(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
      await expect(page.locator('.hero-dist-group-flag')).not.toHaveAttribute('data-pending', /./);
      await page.waitForTimeout(100);
      const hit = await page.evaluate(() => {
        const f = document.querySelector('.hero-dist-group-flag')!.getBoundingClientRect();
        const c = document.querySelector('.hero-dist-controls')!.getBoundingClientRect();
        return f.left < c.right && f.right > c.left && f.top < c.bottom && f.bottom > c.top;
      });
      expect(hit, `${size.width}px: ${k}'s label lies on the controls`).toBe(false);
      // Moving off a row onto the next shows the next; here, to be sure it changed, wait for its name.
    }
  }
});

test('"Show on full page graph" puts the group on full page, and a preview never shows there', async ({ page }) => {
  const keys = await suggestions(page);
  const t = keys.find((k) => k.startsWith('t:'))!;
  await row(page, t).hover();
  await expect(main(page)).toHaveAttribute('data-filter', /./, { timeout: 60_000 });
  const name = await main(page).getAttribute('data-filter');
  await row(page, t).locator('.search-show-on-graph').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .search-token-label')).toHaveText([name!]);
  await expect(page.locator('.search-show-on-graph')).toHaveCount(0);
  // Full page, the bar's own suggestions are filters to put on, not previews: going to one leaves the
  // graph showing the filter that is on.
  const fullMain = page.locator('.hero-dist-full .hero-dist-main');
  await expect(fullMain).toHaveAttribute('data-filter', name!, { timeout: 60_000 });
  const chip = page.locator('.hero-dist-full [role="option"]').first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await chip.hover();
  await page.waitForTimeout(800);
  await expect(fullMain).toHaveAttribute('data-filter', name!);
});

test('"Show on full page graph" is in the accent on every row, and leaves every name its whole width', async ({ page }) => {
  const keys = await suggestions(page);
  const looks = await page.evaluate(() => [...document.querySelectorAll('[data-suggestions] [role="option"]')].map((r) => {
    const chip = r.querySelector('.search-show-on-graph')!;
    const name = r.querySelector('.mantine-Text-root')!;
    const cs = getComputedStyle(chip);
    // The name's text, not its element: a block that runs the row's width, and its line's leading.
    const range = document.createRange();
    range.selectNodeContents(name);
    const nb = range.getBoundingClientRect(), cb = chip.getBoundingClientRect();
    // Down to the glyphs: the line box's half-leading below them is space, not name.
    const ncs = getComputedStyle(name);
    const glyphBottom = nb.bottom - (parseFloat(ncs.lineHeight) - parseFloat(ncs.fontSize)) / 2;
    return {
      tinted: !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor),
      truncated: name.scrollWidth > name.clientWidth + 1,
      overName: nb.right > cb.left && nb.left < cb.right && glyphBottom > cb.top && nb.top < cb.bottom,
    };
  }));
  expect(looks).toHaveLength(keys.length);
  for (const [i, l] of looks.entries()) {
    expect(l.tinted, `${keys[i]}: the button is quiet`).toBe(true);
    expect(l.truncated, `${keys[i]}: the name is cut short`).toBe(false);
    expect(l.overName, `${keys[i]}: the button lies beside the name`).toBe(false);
  }
});

/**
 * The dots of a group shown on the graph are drawn bigger, and everyone else's smaller and fainter — the
 * group is what the eye finds even where its dots are few among many — and on the page nothing moves: a
 * pointer passing over the list only repaints. Read from the canvas round dots of each, before and after,
 * at 2x, where a dot is some pixels across and a packed field's dots never overlap; on the light page, whose
 * dots have no glow round them to measure too. A dot's size is read from the pixels it covers at least half
 * of, whose edge is its disc's.
 */
test.describe('at 2x', () => {
  test.use({ deviceScaleFactor: 2, colorScheme: 'light' });

  test('a group shown on the graph is drawn bigger, everyone else smaller, and no dot moves', async ({ page }) => {
    test.setTimeout(120_000);
    await suggestions(page);
    const [c] = await oracle<{ code: string }>(
      `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND title = 'Professor'
       GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`,
    );
    const who = await covered({ code: c.code });
    const at = await spots();
    const lit = new Set(who.map((p) => at.get(p.person_key)).filter((s) => s?.field === 'main').map((s) => s!.index));
    const field = '.hero-dist-main .hero-dots';
    const before = await places(page, field);
    const n = before.length / 2;
    // A small part of the field, whose dots are grown the most.
    expect(lit.size / n, 'the premise: Professor is a small part of the field').toBeLessThan(0.06);
    expect(await dots(page).getAttribute('data-alpha'), 'the premise: the field is packed, its dots apart').toBe('1');
    const r = Number(await dots(page).getAttribute('data-r'));
    // How near the nearest of `among` is to dot i.
    const near = (i: number, among: Iterable<number>) => {
      let d = Infinity;
      for (const j of among) if (j !== i) d = Math.min(d, Math.hypot(before[2 * j] - before[2 * i], before[2 * j + 1] - before[2 * i + 1]));
      return d;
    };
    const litList = [...lit];
    // The group's dots with none of the group near enough to reach into a window round one grown half again;
    // everyone else's with none of the group near enough to reach into its own.
    const mine = litList.filter((i) => near(i, litList) > 3 * r + 1).slice(0, 40);
    const rest: number[] = [];
    for (let i = 0; i < n && rest.length < 40; i += 97) if (!lit.has(i) && near(i, litList) > 2.5 * r + 1) rest.push(i);
    expect(mine.length, 'too few of the group stand clear of each other to measure').toBeGreaterThanOrEqual(10);
    expect(rest.length).toBeGreaterThanOrEqual(10);
    const ink = (idx: number[], w: number) => page.evaluate(([sel, pts, w]) => {
      const cv = document.querySelector(`${sel} canvas`) as HTMLCanvasElement;
      const k = cv.width / cv.getBoundingClientRect().width;
      const ctx = cv.getContext('2d')!;
      return pts.map(([x, y]) => {
        const x0 = Math.floor((x - w) * k), y0 = Math.floor((y - w) * k), s = Math.ceil(2 * w * k) + 1;
        const d = ctx.getImageData(x0, y0, s, s).data;
        let half = 0, any = 0, sum = 0;
        for (let q = 0; q < s * s; q++) {
          // Only within the window's circle: its corners reach toward the neighbours.
          const px = x0 + (q % s) + 0.5, py = y0 + Math.floor(q / s) + 0.5;
          if (Math.hypot(px - x * k, py - y * k) > w * k) continue;
          const al = d[4 * q + 3];
          sum += al;
          if (al >= 128) half++;
          if (al > 8) any++;
        }
        return { half, any, sum, k };
      });
    }, [field, idx.map((i) => [before[2 * i], before[2 * i + 1]] as [number, number]), w] as const);
    const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[xs.length >> 1];
    // A dot's radius as drawn, as a share of the field's own, from the pixels it half covers.
    const size = (m: { half: number; k: number }) => Math.sqrt(m.half / Math.PI) / (r * m.k);
    const edge = 0.5 / 2;
    const mineWas = await ink(mine, r + edge);
    const restWas = await ink(rest, r + edge);
    expect(median(mineWas.map(size)), 'the measure does not read an unfiltered dot at its own size').toBeGreaterThan(0.85);
    expect(median(mineWas.map(size)), 'the measure does not read an unfiltered dot at its own size').toBeLessThan(1.15);

    await box(page).fill('professor');
    const row = page.locator(`[role="option"][data-key="t:${c.code}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.hover();
    await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(who), { timeout: 60_000 });
    await expect(dots(page), 'a mark over the field would be measured with it').not.toHaveAttribute('data-marks', /./);
    await page.waitForTimeout(500);
    const mineNow = await ink(mine, 1.5 * r + edge);
    const restNow = await ink(rest, r + edge);
    // Half as big again across. The rest 0.6 as big across at 0.3 of their ink: a third of the pixels, and
    // about a tenth of the ink.
    expect(median(mineNow.map(size)), 'the group’s dots were not drawn bigger').toBeGreaterThan(1.3);
    expect(median(mineNow.map(size)), 'the group’s dots were drawn bigger than half again').toBeLessThan(1.7);
    expect(median(restNow.map((m, q) => m.any / restWas[q].any)), 'everyone else’s dots were not drawn smaller').toBeLessThan(0.65);
    expect(median(restNow.map((m, q) => m.sum / restWas[q].sum)), 'everyone else’s dots were not drawn faint').toBeLessThan(0.2);
    expect(median(restNow.map((m, q) => m.sum / restWas[q].sum)), 'everyone else’s dots were hidden, not drawn faint').toBeGreaterThan(0.04);
    expect(await places(page, field), 'a preview moved the dots').toEqual(before);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the suggestions, with one shown on the graph, pass a strict accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const keys = await suggestions(page);
    await row(page, keys[1]).hover();
    await expect(main(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page }).include('.search-dropdown').include('[role="combobox"]').include('.hero-dist-group-flag').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await expect(row(page, keys[1]).locator('.search-show-on-graph')).toHaveText('Show on full page graph');
  });
}
