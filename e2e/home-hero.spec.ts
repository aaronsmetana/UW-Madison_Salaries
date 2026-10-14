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
 * colours show is beside the legend, and the chip at rest is a sort mark, not an empty ring. The facts at the foot
 * are all there at once. A title in the search says which employees hold it.
 */

const SUMMARY = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/summary.json', import.meta.url)), 'utf8')) as {
  snapshots: { id: string; label: string; date: string; median: number }[];
  latest: { median: number; median_prior?: number };
};
const INDEX = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/search-index.json', import.meta.url)), 'utf8')) as {
  snapshot: string; titles: [string, string, number, number | null, string | null, string[]?][];
};
const SNAPS = SUMMARY.snapshots;

const searchBox = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
const field = (page: Page) => page.locator('.strata-field').first();
const bar = (page: Page) => page.locator('.strata-timeline');

async function home(page: Page, width = 1280, height = 800) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
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
  test('Play and its speed are one control, Medium to start; what a step shows is over the legend; the settings keep the rest', async ({ page }) => {
    await home(page);
    const group = page.getByRole('group', { name: 'Play the timeline' });
    await expect(group.locator('.strata-play')).toBeVisible();
    const speed = group.getByRole('radiogroup', { name: 'Speed' });
    await expect(speed.getByRole('radio', { name: 'Medium' })).toBeChecked();
    // What a step's colours show: over the legend's right end, in the toolbar, not the timeline's row.
    const modeToggle = page.locator('.strata-toolbar').getByRole('radiogroup', { name: 'Show each step by' });
    await expect(modeToggle).toBeVisible();
    await expect(bar(page).getByRole('radiogroup', { name: 'Show each step by' })).toHaveCount(0);
    const [m, l] = [(await modeToggle.boundingBox())!, await box(page, '.strata-legend')];
    expect(Math.abs(m.x + m.width - (l.x + l.width)), 'not over the legend’s right end').toBeLessThanOrEqual(200);
    // The legend's row is one line at 1280 (the plot never moves for it).
    const legend = await box(page, '.strata-legend');
    expect(legend.height).toBeLessThanOrEqual(34);
    await page.getByRole('button', { name: 'Timeline settings' }).click();
    const panel = page.locator('.strata-settings-panel');
    await expect(panel.getByRole('radiogroup', { name: 'Sort each column by' }).getByRole('radio', { name: 'Type, then salary' })).toBeChecked();
    await expect(panel.getByRole('slider', { name: 'Slow’s countdown, seconds' })).toBeVisible();
    await expect(panel.getByRole('radiogroup', { name: 'Speed' })).toHaveCount(0);
  });

  test('Play holds its width and its words: "Pause" while the timeline loads, never a blank button', async ({ page }) => {
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
    await page.waitForFunction(() => (window as unknown as { texts: string[] }).texts.length >= 120);
    const { texts, widths } = await page.evaluate(() => { const w = window as unknown as { texts: string[]; widths: number[] }; return { texts: w.texts, widths: w.widths }; });
    expect(texts.filter((t) => !t.trim()), 'a blank Play button').toEqual([]);
    // Its words, then "Pause" from the press on: while the timeline loaded too.
    const from = texts.indexOf('Pause');
    expect(from).toBeGreaterThan(0);
    expect(new Set(texts.slice(0, from))).toEqual(new Set([texts[0]]));
    expect(new Set(texts.slice(from))).toEqual(new Set(['Pause']));
    expect(Math.max(...widths) - Math.min(...widths), 'Play changed width').toBeLessThanOrEqual(1);
    expect(Math.abs(widths[0] - w0)).toBeLessThanOrEqual(1);
  });

  test('at rest the chip shows a sort mark, not an empty ring; while a step moves, its ring', async ({ page }) => {
    await home(page);
    const ring = page.locator('.strata-status-ring');
    await expect(ring).toHaveAttribute('data-idle', 'true');
    await expect(ring.locator('svg')).toBeVisible();
    await expect(page.locator('.strata-status-label')).toHaveText('Sorted by type, then salary');
    // A step: the ring is back while it moves.
    await page.locator('.strata-track-dot').nth(SNAPS.length - 2).click();
    await expect(bar(page)).toHaveAttribute('data-snap', SNAPS[SNAPS.length - 2].id, { timeout: 60_000 });
    await expect(ring).not.toHaveAttribute('data-idle', /./, { timeout: 60_000 });
    await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });
    await expect(ring).toHaveAttribute('data-idle', 'true', { timeout: 15_000 });
  });

  test('a step’s legend sets each swatch against its own words, the count before it', async ({ page }) => {
    await home(page);
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

test('the facts at the foot are all there at once, and stay as they are', async ({ page }) => {
  await home(page);
  const facts = page.locator('.home-facts li');
  await expect(facts.first()).not.toHaveText(/^\s*$/, { timeout: 30_000 });
  const first = SNAPS[0], latest = SUMMARY.latest;
  await expect(facts.filter({ hasText: /^Median pay rose/ })).toHaveText(new RegExp(`^Median pay rose from ${usd(first.median).replace(/\$/g, '\\$')} \\(${first.date.slice(0, 4)}\\) to ${usd(latest.median).replace(/\$/g, '\\$')}`));
  expect(await facts.count()).toBeGreaterThanOrEqual(5);
  const before = await facts.allTextContents();
  await page.waitForTimeout(7_000);
  expect(await facts.allTextContents()).toEqual(before);
  await expect(page.locator('.home-facts [aria-live], .home-facts[aria-live]')).toHaveCount(0);
});
