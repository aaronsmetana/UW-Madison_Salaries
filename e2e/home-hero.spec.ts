import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle, usd } from './oracle';

/**
 * The landing page's first screen and its search (H1–H8), and the timeline's controls (H3, H4, I11–I13).
 *
 * The search is in the hero, beside the title where the two fit and under it where they do not: it was under the
 * graph, below the first screen at 1280×800. Its list lies over the plot's top, two columns wide, hanging from the
 * box's right edge and stopping halfway down. Under the graph, Play and its speed are one control, what a step's
 * colours show is with its other settings, and at rest the chip's place says why to press Play. The graph has a
 * count scale and a break before its pile; the figures under it say what the page does not already say; on a phone
 * the plot is in the first screen and its controls are 44px to the touch. A title in the search says which
 * employees hold it.
 */

const SUMMARY = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/summary.json', import.meta.url)), 'utf8')) as {
  snapshots: { id: string; label: string; date: string; median: number }[];
  latest: { median: number; median_prior?: number };
};
/** The landing's precomputed figures: the ones under the graph, and each type's people and median (the legend's). */
const HOME_STATS = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/home-stats.json', import.meta.url)), 'utf8')) as {
  p90: number; median_tenure_years: number; pay_counts: { categories: { name: string; n: number; median: number }[] };
};
const INDEX = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/search-index.json', import.meta.url)), 'utf8')) as {
  snapshot: string; titles: [string, string, number, number | null, string | null, string[]?][];
};
const SNAPS = SUMMARY.snapshots;

const searchBox = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
const field = (page: Page) => page.locator('.strata-field').first();
const bar = (page: Page) => page.locator('.strata-timeline');

async function home(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test.describe('the search, in the hero', () => {
  test('at 1280×800, beside the title in the half it left empty, above the graph, the graph where it was', async ({ page }) => {
    await home(page);
    const input = (await searchBox(page).boundingBox())!;
    const title = await box(page, '.home-title'), lead = await box(page, '.home-lead'), panel = await box(page, '.hero-dist');
    expect(input.x, 'the box is not beside the title').toBeGreaterThanOrEqual(lead.x + lead.width);
    expect(input.x, 'the box is not beside the title').toBeGreaterThanOrEqual(title.x + title.width);
    // On the title block's own lines: its foot within the lead's.
    expect(input.y).toBeGreaterThanOrEqual(title.y - 1);
    expect(input.y + input.height).toBeLessThanOrEqual(lead.y + lead.height + 2);
    expect(input.y + input.height, 'the box is not above the graph').toBeLessThanOrEqual(panel.y);
    // Its right edge the graph's.
    expect(Math.abs(input.x + input.width - (panel.x + panel.width))).toBeLessThanOrEqual(2);
    // The graph starts no lower than the title block's foot leaves it: the box took no line of its own.
    expect(panel.y - (lead.y + lead.height), 'the hero grew to hold the box').toBeLessThan(40);
    // And the box has the caret, its list shut until the reader turns to it.
    await expect(searchBox(page)).toBeFocused();
    await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
  });

  for (const [width, height] of [[768, 1024], [375, 812]] as const) {
    test(`at ${width}px, under the lead, the hero's width, above the graph, in the first screen`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { hasTouch: true, isMobile: true } : {}) });
      const page = await ctx.newPage();
      await home(page, width, height);
      const input = (await searchBox(page).boundingBox())!;
      const lead = await box(page, '.home-lead'), head = await box(page, '.home-head'), panel = await box(page, '.hero-dist');
      expect(input.y).toBeGreaterThanOrEqual(lead.y + lead.height);
      expect(input.y + input.height).toBeLessThanOrEqual(panel.y);
      expect(input.y + input.height).toBeLessThanOrEqual(height);
      expect(Math.abs(input.width - head.width), 'not the hero’s width').toBeLessThanOrEqual(2);
      await ctx.close();
    });
  }

  test('its list hangs from the box’s right edge two columns wide, over the plot’s top, and stops halfway down it', async ({ page }) => {
    await home(page);
    await searchBox(page).fill('smith');
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
    await expect(page.locator('.search-groups [data-group="titles"], .search-groups [data-group="divisions"]').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    const input = (await searchBox(page).boundingBox())!;
    const list = await box(page, '.search-dropdown'), plot = await box(page, '.hero-dist-main');
    expect(list.width, 'one column').toBeGreaterThanOrEqual(760);
    expect(Math.abs(list.x + list.width - (input.x + input.width))).toBeLessThanOrEqual(2);
    expect(list.y).toBeGreaterThanOrEqual(input.y + input.height);
    expect(list.y + list.height, 'the list reaches past the middle of the plot').toBeLessThanOrEqual(plot.y + plot.height / 2 + 1);
    const cols = await page.locator('.search-groups').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    // The page did not move to make room.
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // Away from the box, the list goes; its marks stay.
    await page.locator('.home-lead').click();
    await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-marks', /./);
  });

  test('a title says which employees hold it; a non-exempt twin says so (Outreach Specialist, OE009 and OE009N)', async ({ page }) => {
    await home(page);
    const [code, twin] = ['OE009', 'OE009N'];
    const cats = await oracle<{ code: string; cat: string }>(
      `WITH k AS (SELECT job_code, employee_category c, count(DISTINCT person_key) n FROM $SAL
                  WHERE snapshot_id = '${INDEX.snapshot}' AND salary > 0 AND employee_category IS NOT NULL AND job_code IN ('${code}', '${twin}') GROUP BY ALL)
       SELECT job_code code, first(c ORDER BY n DESC, c) cat FROM k GROUP BY job_code`,
    );
    const want = (c: string) => {
      const row = INDEX.titles.find((t) => t[0] === c)!;
      const cat = cats.find((r) => r.code === c)!.cat;
      return `${cat}${c === twin ? ', non-exempt' : ''} · ${row[2].toLocaleString('en-US')} people · median ${usd(row[3]!)}`;
    };
    await searchBox(page).fill('outreach spec');
    const titles = page.locator('.search-groups [data-group="titles"]');
    for (const c of [code, twin]) {
      const row = titles.locator('[role="option"]').filter({ has: page.locator('.code-pill', { hasText: new RegExp(`^${c}$`) }) });
      await expect(row.locator('.search-row-sub')).toHaveText(want(c), { timeout: 10_000 });
    }
  });

  test('"Show on full page graph" is an icon on each title and division row, its words on hover', async ({ page }) => {
    await home(page);
    await searchBox(page).fill('engineer');
    const marks = page.locator('.search-show-on-graph');
    await expect(marks.first()).toBeVisible({ timeout: 10_000 });
    for (const m of await marks.evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width, spill: e.scrollWidth - e.clientWidth })))) {
      expect(m.w).toBeLessThanOrEqual(32);
      expect(m.spill, 'words spill out of the icon').toBeLessThanOrEqual(1);
    }
    await marks.first().hover();
    await expect(page.getByRole('tooltip', { name: 'Show on full page graph' })).toBeVisible();
  });
});

test.describe('the timeline’s controls', () => {
  test('Play and its speed are one control, Medium to start; the settings keep the rest, what a step shows among them', async ({ page }) => {
    await home(page);
    const group = page.getByRole('group', { name: 'Play the timeline' });
    await expect(group.locator('.strata-play')).toBeVisible();
    const speed = group.getByRole('radiogroup', { name: 'Speed' });
    await expect(speed.getByRole('radio', { name: 'Medium' })).toBeChecked();
    // Skip, beside Play: nowhere to go from the latest.
    await expect(group.getByRole('button', { name: /^Skip to / })).toBeDisabled();
    // The toolbar over the plot holds what is shown and the way to full page, an icon named on its title: what a
    // step's colours show was a labelled toggle there, at the far end of the panel from Play.
    const toolbar = page.locator('.strata-toolbar');
    await expect(toolbar.getByRole('radiogroup')).toHaveCount(0);
    const fullPage = toolbar.getByRole('button', { name: 'Full page graph' });
    await expect(fullPage).toHaveAttribute('title', 'Full page graph');
    await expect(fullPage).toHaveText('');
    await expect(toolbar.getByRole('button')).toHaveCount(1);
    // The legend's row is one line at 1280 (the plot never moves for it).
    const legend = await box(page, '.strata-legend');
    expect(legend.height).toBeLessThanOrEqual(34);
    await page.getByRole('button', { name: 'Timeline settings' }).click();
    const panel = page.locator('.strata-settings-panel');
    // By employment type to start: Play's first run keeps the colours the page opened with.
    await expect(panel.getByRole('radiogroup', { name: 'Show each step by' }).getByRole('radio', { name: 'Type' })).toBeChecked();
    await expect(panel.getByRole('radiogroup', { name: 'Sort each column by' }).getByRole('radio', { name: 'Type, then salary' })).toBeChecked();
    await expect(panel.getByRole('slider', { name: 'Slow’s countdown, seconds' })).toBeVisible();
    await expect(panel.getByRole('radiogroup', { name: 'Speed' })).toHaveCount(0);
  });

  test('Play holds its width and its words: that it is loading while the timeline loads, then "Pause" — never a blank button', async ({ page }) => {
    await home(page);
    const play = page.locator('.strata-play');
    const w0 = (await play.boundingBox())!.width;
    await page.evaluate(() => {
      const w = window as unknown as { texts: string[]; widths: number[] };
      w.texts = []; w.widths = [];
      const el = document.querySelector('.strata-play') as HTMLElement;
      const tick = () => { w.texts.push(el.hasAttribute('data-loading') ? '' : el.textContent ?? ''); w.widths.push(el.getBoundingClientRect().width); if (w.texts.length < 400) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await play.click();
    await expect(bar(page)).toHaveAttribute('data-playing', 'true', { timeout: 60_000 });
    await page.waitForFunction(() => (window as unknown as { texts: string[] }).texts.length >= 60);
    const { texts, widths } = await page.evaluate(() => { const w = window as unknown as { texts: string[]; widths: number[] }; return { texts: w.texts, widths: w.widths }; });
    expect(texts.filter((t) => !t.trim()), 'a blank Play button').toEqual([]);
    // Its words; from the press, that the timeline is loading; then "Pause" (the frames are read until the play has
    // begun, and a little on: not as far as its end, where Play's own words come back).
    const runs = texts.filter((t, k) => k === 0 || t !== texts[k - 1]);
    expect(runs.slice(0, 3)).toEqual([texts[0], 'Loading timeline…', 'Pause']);
    expect(texts[0]).toMatch(/^Play \d{4} → \d{4}$/);
    expect(Math.max(...widths) - Math.min(...widths), 'Play changed width').toBeLessThanOrEqual(1);
    expect(Math.abs(widths[0] - w0)).toBeLessThanOrEqual(1);
  });

  test('at rest the chip’s place says why to press Play; the chip is there while a step moves, and held at Pause with a sort mark, not an empty ring', async ({ page }) => {
    await home(page);
    // At rest: how far the median has come, like for like where the reporting changed on the way — not "Sorted by
    // type, then salary", which the hint over the plot says.
    const first = SNAPS[0], latest = SUMMARY.latest as { median: number; median_prior?: number };
    const lfl = latest.median_prior ?? latest.median, up = Math.round(((lfl - first.median) / first.median) * 100);
    expect(up, 'the median has not risen, so there is nothing to say').toBeGreaterThan(0);
    const hook = page.locator('.strata-hook');
    await expect(page.locator('.strata-status')).toHaveCount(0);
    await expect(hook.locator('.strata-hook-figure')).toHaveText(`Median pay up ~${up}% since ${first.date.slice(0, 4)}`);
    await expect(hook.locator('.strata-hook-note')).toHaveText(`${lfl !== latest.median ? 'Like for like · ' : ''}press Play to watch it move`);
    // Said once on a wide screen: the figures under the graph keep it for a phone, which has no room beside Play.
    await expect(page.locator('.home-stat[data-only="phone"]')).toBeHidden();
    // A step: the chip, with its ring, in the very place — the track beside it never moves.
    const trackAt = async () => (await box(page, '.strata-track')).width;
    const w0 = await trackAt();
    await page.locator('.strata-track-dot').nth(SNAPS.length - 2).click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[SNAPS.length - 2].id, { timeout: 60_000 });
    const ring = page.locator('.strata-status-ring');
    await expect(ring).not.toHaveAttribute('data-idle', /./, { timeout: 60_000 });
    await expect(hook).toHaveCount(0);
    expect(await trackAt(), 'the track changed width as the chip came').toBeCloseTo(w0, 0);
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    await expect(page.locator('.strata-status')).toHaveCount(0, { timeout: 15_000 });
    await expect(hook).toBeVisible();
    expect(await trackAt(), 'the track changed width as the chip went').toBeCloseTo(w0, 0);
    // Held at Pause, the chip says so, a sort mark where its ring was.
    await page.locator('.strata-play').click();
    await expect(bar(page)).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
    await page.locator('.strata-play').click();
    await expect(page.locator('.strata-status-label')).toHaveText('Paused · sorted by type, then salary', { timeout: 15_000 });
    await expect(ring).toHaveAttribute('data-idle', 'true');
    await expect(ring.locator('svg')).toBeVisible();
  });

  test('a step’s legend sets each swatch against its own words, the count before it', async ({ page }) => {
    await home(page);
    // Raises and cuts, asked for (in Play's settings): by employment type, as it starts, a step counts no changes.
    await page.getByRole('button', { name: 'Timeline settings' }).click();
    await page.locator('.strata-settings-panel').getByRole('radiogroup', { name: 'Show each step by' }).getByText('Raises & cuts', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.strata-settings-panel')).toHaveCount(0);
    await page.locator('.strata-track-dot').nth(SNAPS.length - 2).click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[SNAPS.length - 2].id, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    await page.locator('.strata-track-dot').nth(SNAPS.length - 1).click();
    const legend = page.locator('.strata-change-legend');
    await expect(legend).toHaveAttribute('data-on', 'true', { timeout: 15_000 });
    const items = await legend.locator('.strata-change-item').evaluateAll((els) => els.map((el) => {
      const n = el.querySelector('.strata-change-n')!.getBoundingClientRect(), sw = el.querySelector('.strata-change-swatch')!.getBoundingClientRect();
      const words = el.lastElementChild!.getBoundingClientRect();
      return { n: [n.left, n.right], sw: [sw.left, sw.right], words: [words.left, words.right] };
    }));
    expect(items.map((i) => i.sw[0] >= i.n[1] && i.words[0] >= i.sw[1])).toEqual([true, true, true, true]);
    for (let k = 0; k < items.length; k++) {
      const own = items[k].words[0] - items[k].sw[1];
      expect(own, 'the swatch is far from its words').toBeLessThanOrEqual(6);
      if (k) expect(items[k].sw[0] - items[k - 1].words[1], 'a swatch nearer the words before it than its own').toBeGreaterThan(own * 2);
    }
  });
});

for (const width of [1280, 1440]) {
  test(`at ${width}px the legend’s row is one height in every snapshot, so the plot never moves as it plays`, async ({ page }) => {
    test.setTimeout(120_000);
    await home(page, width, 900);
    // The plot's place on the page, not in the window: pressing a dot near the window's foot may scroll it.
    const read = async () => ({ legend: (await box(page, '.strata-legend')).height, plot: await page.locator('.hero-dist-main').evaluate((e) => e.getBoundingClientRect().top + scrollY) });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const latest = await read();
    // The first snapshot has a type more (the codes before 2024): its legend is the widest.
    await page.locator('.strata-track-dot').first().click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[0].id, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    const first = await read();
    expect(first.legend, 'the legend’s row grew').toBeCloseTo(latest.legend, 0);
    expect(first.plot, 'the plot moved').toBeCloseTo(latest.plot, 0);
    expect(latest.legend, 'the legend’s row wraps').toBeLessThanOrEqual(34);
  });
}

test('the figures under the graph say what the page does not already say, and hold still', async ({ page }) => {
  await home(page);
  const labels = page.locator('.home-stat:visible .home-stat-label');
  // Not the headcount a third time (the heading's, the graph's) nor the median a second (its pin on the graph).
  await expect(labels).toHaveText(['payroll', 'starts the top 10%', 'median tenure', 'divisions', 'titles']);
  const values = page.locator('.home-stat:visible .home-stat-value');
  await expect(values.first()).not.toHaveText('—', { timeout: 30_000 });
  const top10 = page.locator('.home-stat').filter({ hasText: 'starts the top 10%' }).locator('.home-stat-value');
  await expect(top10).toHaveText(usd(HOME_STATS.p90));
  await expect(page.locator('.home-stat').filter({ hasText: 'median tenure' }).locator('.home-stat-value')).toHaveText(`${HOME_STATS.median_tenure_years.toFixed(1)} years`);
  // The bullets that were at the page's foot are gone: three of them are here, one is beside Play, and each type's
  // median is on its name in the legend.
  await expect(page.locator('.home-facts')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'More tools' })).toBeVisible();
  const before = await values.allTextContents();
  await page.waitForTimeout(3_000);
  expect(await values.allTextContents()).toEqual(before);
});

/**
 * The graph reads without being pointed at: how many people a column holds (a count scale), that the last column is
 * everyone past the axis's end and not a spike at $250k (a break before it), and that a type in the legend can be
 * shown alone (a hairline round each, and what a press does on its title, with the type's median).
 */
test.describe('the graph reads without pointing at it', () => {
  test('a count scale: faint lines at round numbers of people, each at the height of a column of that many', async ({ page }) => {
    await home(page);
    const labels = page.locator('.strata-scale-label');
    await expect(labels).toHaveText(['500', '1,000', '1,500', '2,000 people']);
    const [base, rowPitch, per] = await Promise.all(['data-base', 'data-row-pitch', 'data-per'].map(async (a) => Number(await field(page).getAttribute(a))));
    const lines = await page.locator('.strata-scale line').evaluateAll((els) => els.map((e) => Number(e.getAttribute('y1'))));
    expect(lines.length).toBe(4);
    [500, 1000, 1500, 2000].forEach((n, k) => expect(Math.abs(lines[k] - (base - Math.ceil(n / per) * rowPitch)), `the ${n} line is not at ${n} people’s height`).toBeLessThanOrEqual(1));
    // Each number over its own line, at the plot's left, clear of the columns: the lowest-paid are a few squares tall.
    const plot = await box(page, '.strata-plot');
    for (let k = 0; k < 4; k++) {
      const b = (await labels.nth(k).boundingBox())!;
      expect(Math.abs(b.y + b.height - (plot.y + lines[k])), 'a number off its line').toBeLessThanOrEqual(3);
      expect(b.x - plot.x).toBeLessThanOrEqual(1);
    }
    // The same in every snapshot (one scale): the lines stand still as the timeline goes.
    await page.locator('.strata-track-dot').first().click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[0].id, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    expect(await page.locator('.strata-scale line').evaluateAll((els) => els.map((e) => Number(e.getAttribute('y1'))))).toEqual(lines);
    // The floors have their own counts, at each floor's end.
    await page.getByRole('radiogroup', { name: 'View' }).getByText('Floors').click();
    await expect(page.locator('.strata-plot')).toHaveAttribute('data-view', 'floors');
    await expect(labels).toHaveCount(0);
  });

  test('a break before the pile, and gone with it once it is unrolled', async ({ page }) => {
    await home(page);
    const rule = page.locator('.strata-pile-break');
    await expect(rule).toHaveCount(1);
    // Between the last $5k column and the pile's.
    const x = Number(await rule.getAttribute('x1'));
    const { lastRight, pileLeft } = await field(page).evaluate((el) => {
      const f = el as HTMLElement & { squarePlaces: (f: string) => number[] };
      const main = f.squarePlaces('main'), pile = f.squarePlaces('pile');
      let lastRight = 0, pileLeft = Infinity;
      for (let i = 0; i < main.length; i += 2) lastRight = Math.max(lastRight, main[i]);
      for (let i = 0; i < pile.length; i += 2) pileLeft = Math.min(pileLeft, pile[i]);
      return { lastRight, pileLeft };
    });
    expect(x, 'the break is not past the last column').toBeGreaterThan(lastRight);
    expect(x, 'the break is not before the pile').toBeLessThan(pileLeft);
    await page.locator('.strata-pile-toggle').click();
    await expect(page.locator('.strata-plot')).toHaveAttribute('data-tail', 'on');
    await expect(rule).toHaveCount(0);
  });

  test('each type in the legend looks like the button it is, and says what a press does and the type’s median', async ({ page }) => {
    await home(page);
    const items = page.locator('.strata-legend-item');
    expect(await items.count()).toBeGreaterThanOrEqual(4);
    for (const [k, c] of HOME_STATS.pay_counts.categories.entries()) {
      const item = items.nth(k);
      await expect(item).toHaveAttribute('title', `${c.name}: ${c.n.toLocaleString('en-US')} people, median ${usd(c.median)}. Click to show them alone`);
      expect(await item.evaluate((e) => getComputedStyle(e).boxShadow), `${c.name} has no outline at rest`).not.toBe('none');
    }
  });
});

/**
 * A phone: the plot is in the first screen, with less said over it (one sentence of lead, one line of hint, the
 * types on one line that scrolls), and every control of the graph is 44px to a thumb.
 */
test('on a phone the plot is in the first screen, and every control of the graph is 44px to the touch', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'not a touch screen, so this proves nothing').toBe(true);
  // The lead's first sentence alone; the search is the next thing down.
  await expect(page.locator('.home-lead-more')).toBeHidden();
  const plot = await box(page, '.strata-plot');
  expect(plot.y + plot.height, 'the plot runs off the first screen').toBeLessThanOrEqual(844);
  expect(plot.y, 'the plot begins past the middle of the first screen').toBeLessThan(844 * 0.56);
  // The types: one line, scrolled along.
  const types = page.locator('.strata-legend-types');
  expect((await types.boundingBox())!.height).toBeLessThanOrEqual(46);
  expect(await types.evaluate((e) => e.scrollWidth > e.clientWidth), 'the types all fit, so nothing scrolls').toBe(true);
  // Every control a thumb is given: its own box, or the hit area laid over it, 44px tall — and as wide, but for the
  // views' two halves, Skip and the snapshots' dots, which stand side by side in a row of that height. Not the
  // axis's own words for the pile ("651 at $250k+"): a text link, with the 26px every link on the site is given —
  // 44px there would reach up over the plot's lowest squares.
  const short = await page.locator('.strata').evaluate((panel) => {
    const out: string[] = [];
    for (const el of panel.querySelectorAll<HTMLElement>('button, .mantine-SegmentedControl-label')) {
      if (el.offsetParent === null || el.closest('.visually-hidden') || el.classList.contains('hero-dist-pile-label')) continue;
      const b = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
      const h = Math.max(b.height, a.content !== 'none' ? parseFloat(a.height) || 0 : 0);
      if (h < 43.5) out.push(`${el.className.toString().split(' ').filter((c) => /strata|hero/.test(c)).join('.') || el.tagName} ${Math.round(h)}px`);
    }
    return out;
  });
  expect(short, 'controls under 44px to the touch').toEqual([]);
  // The median's rise is on the figures' line here: there is no room for it beside Play.
  await expect(page.locator('.strata-hook')).toHaveCount(0);
  await expect(page.locator('.home-stat[data-only="phone"]')).toBeVisible();
  await expect(page.locator('.home-stat[data-only="phone"] .home-stat-value')).toHaveText(/^\+\d+%$/);
  await ctx.close();
});
