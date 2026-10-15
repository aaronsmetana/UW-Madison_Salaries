import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * About the data as the person page is shaped (header, fact strip, tabs of cards). The header, the strip of seven
 * facts and six tabs on every tab; Overview by default; the tab in the address. The old page's "Jump to" chips, its
 * side index and (here) the release tag are gone. Each tab holds what it promises — Overview's five summaries, all
 * eleven caveats, the seven steps and six rules, every grade on one axis and every minimum as a tile, a snapshot
 * table of eight columns with two charts over it, renames a release at a time and the flagged duplicates first.
 * Every figure is read from the data, the five copy checks hold, and nothing scrolls the page sideways on a phone.
 */

const DATA = new URL('../public/data/', import.meta.url);
const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')) as T;
const n = (x: number) => x.toLocaleString('en-US');
const TABS = ['Overview', 'Accuracy & privacy', 'How it’s built', 'Salary ranges', 'Snapshots', 'Renames & duplicates'];

async function open(page: Page, tab = '', ready = 'h1') {
  await page.goto(`./data${tab ? `?tab=${tab}` : ''}`);
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
}

test.use({ viewport: { width: 1440, height: 900 } });

test('the header, seven facts and six tabs; Overview by default, and the tab in the address', async ({ page }) => {
  const manifest = read<{ total_rows: number; snapshots: { row_count: number; snapshot_label: string; snapshot_date: string }[] }>('manifest.json');
  const summary = read<{ latest: { headcount: number } }>('summary.json');
  const ingested = manifest.snapshots.filter((s) => s.row_count).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  await open(page, '', '.whats-new-change');
  await expect(page.getByRole('heading', { level: 1, name: 'About the data' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/^Home\s*\/?\s*About the data$/);
  await expect(page.getByRole('link', { name: 'Source on GitHub' }).first()).toHaveAttribute('href', /github\.com/);
  await expect(page.locator('.about-download')).toHaveAttribute('href', /data\/salaries\.parquet$/);
  const facts = page.locator('.fact-strip .fact-cell');
  await expect(facts).toHaveCount(7);
  const strip = page.locator('.fact-strip');
  await expect(strip).toContainText(`Snapshots${ingested.length}`);
  await expect(strip).toContainText(`Records${n(manifest.total_rows)} rows`);
  await expect(strip).toContainText(`People now${n(summary.latest.headcount)}`);
  await expect(strip).toContainText(`Fields16 per row`);
  await expect(page.getByRole('tab')).toHaveText(TABS);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Snapshots' }).click();
  await expect(page).toHaveURL(/\/data\?tab=snapshots$/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Snapshots');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/data$/);
  // Gone: the "Jump to" chips, the side index, and the release tag (What's new says it).
  await expect(page.locator('.data-jumpnav, .data-jump-chip')).toHaveCount(0);
  await expect(page.locator('.page-top .release-tag')).toHaveCount(0);
});

test('Overview sums up everything, at about a quarter of the old page', async ({ page }) => {
  await open(page, '', '.whats-new-change');
  for (const id of ['whats-new', 'rely', 'pay-views', 'source', 'privacy-summary', 'pipeline-summary']) await expect(page.locator(`#${id}`), id).toBeVisible();
  await expect(page.locator('#whats-new .stat-cell')).toHaveCount(4);
  await expect(page.locator('#rely .caveat-list li')).toHaveCount(9);
  await expect(page.locator('#pipeline-summary .pipeline-tile')).toHaveCount(7);
  await expect(page.locator('#privacy-summary .field-chip')).toHaveCount(11);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height, 'Overview should be about 2,600px; the old page was 11,800').toBeLessThan(3_200);
});

test('Accuracy lists all eleven caveats, grouped, each group a chip away', async ({ page }) => {
  await open(page, 'accuracy', '#identity');
  await expect(page.locator('#disclaimer .rule-row')).toHaveCount(11);
  await expect(page.locator('#disclaimer .caveat-group')).toHaveCount(3);
  const chips = page.locator('.caveat-jumps .jump-chip');
  await expect(chips).toHaveText([/^What the pay figure leaves out\s*4$/, /^Who a row really describes\s*4$/, /^When the source itself changed\s*3$/]);
  await chips.nth(2).click();
  await expect(page.locator('#source-changed')).toBeInViewport();
  await expect(page.locator('#privacy')).toContainText('Nothing beyond the released report is stored.');
});

test('How it’s built holds the seven steps in full, the six rules, and the downloads', async ({ page }) => {
  await open(page, 'method', '.pipeline-step');
  await expect(page.locator('#pipeline .pipeline-step')).toHaveCount(7);
  await expect(page.locator('#how-it-works .rule-row')).toHaveCount(6);
  await expect(page.locator('#how-it-works .pay-view')).toHaveCount(2);
  await expect(page.locator('#methodology .field-chip')).toHaveCount(16);
  await expect(page.locator('#methodology .data-dl-btn').first()).toHaveAttribute('href', /salaries\.parquet$/);
  // Its cross-links open the tab that holds what they name.
  await page.getByRole('link', { name: /^Each sheet.s mapping →$/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Snapshots' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mapping')).toBeInViewport({ timeout: 30_000 });
});

test('every grade with a range is a row on one axis, every minimum a tile, and nothing is lost', async ({ page }) => {
  type Grade = { grade: number; basis: string; min: number; max: number | null };
  const grades = read<Grade[]>('grades.json').filter((g) => g.basis === 'annual_12mo');
  const ranges = grades.filter((g) => g.max != null);
  await open(page, 'ranges', '.range-table tbody tr');
  const usd = (x: number) => `$${n(Math.round(x))}`;
  for (const g of ranges) {
    await expect(page.locator(`.range-table tr[data-grade="${g.grade}"]`)).toHaveText(`${g.grade}${usd(g.min)}${usd((g.min + g.max!) / 2)}${usd(g.max!)}`);
  }
  await expect(page.locator('.floor-tile')).toHaveCount(grades.length - ranges.length);
  // Grade 59, outside the 15–35 series, under its own label, after the series.
  await expect(page.locator('.range-outside')).toHaveText(/^Outside the \d+–\d+ series$/);
  // The axis: one scale, $0 to the top in $100k steps, every bar on it.
  const axis = await page.locator('.range-axis span').allInnerTexts();
  expect(axis[0]).toBe('$0');
  const top = Number(axis.at(-1)!.replace(/[$k]/g, '')) * 1000;
  expect(top).toBeGreaterThanOrEqual(Math.max(...ranges.map((g) => g.max!)));
  // The coverage bar says its whole sentence.
  await expect(page.locator('.coverage-bar')).toHaveAttribute('aria-label', /^Of [\d,]+ graded appointments: \d+% have a published range, \d+% a minimum only, \d+% none\.$/);
});

test('Snapshots draws both charts with their axes', async ({ page }) => {
  await open(page, 'snapshots', '.snap-note-row');
  const charts = page.locator('#snapshot-glance .recharts-wrapper');
  await expect(charts).toHaveCount(2);
  await expect(charts.nth(0).locator('.recharts-yAxis .recharts-cartesian-axis-tick-value')).toContainText(['0', '10k', '20k']);
  await expect(charts.nth(1).locator('.recharts-yAxis .recharts-cartesian-axis-tick-value')).toContainText(['0', '$25k', '$50k', '$75k', '$100k']);
  await expect(charts.nth(1).locator('.recharts-label-list text').first()).toHaveText(/^\$\d+k$/);
  // A snapshot's mapping, chosen.
  await page.getByRole('textbox', { name: 'Snapshot' }).click();
  await page.getByRole('option', { name: 'Mar 2022', exact: true }).click();
  await expect(page.locator('.mapping-grid')).toHaveAttribute('data-snapshot', '2022-03');
});

test('renames go a release at a time: ten rows, a filter, a release resets both, and the ended list opens', async ({ page }) => {
  const depts = read<{ steps: { from: string; to: string; carried: unknown[]; mergers: unknown[]; gone: unknown[] }[] }>('departments.json');
  const big = [...depts.steps].reverse().findIndex((s) => s.carried.length > 10);
  expect(big, 'no release renames more than ten, so pagination is untested').toBeGreaterThanOrEqual(0);
  const step = [...depts.steps].reverse()[big];
  await open(page, 'renames', '.rename-release');
  // The totals are the releases' own counts summed (copy check 2).
  const sum = (k: 'carried' | 'mergers' | 'gone') => depts.steps.reduce((t, s) => t + s[k].length, 0);
  await expect(page.locator('.rename-totals')).toHaveText(new RegExp(`Renamed\\s*${n(sum('carried'))}\\s*Merged\\s*${n(sum('mergers'))}\\s*Ended\\s*${n(sum('gone'))}`));
  const releases = page.locator('.rename-release');
  await expect(releases).toHaveCount(depts.steps.length);
  await expect(releases.first()).toHaveAttribute('aria-pressed', 'true');
  await releases.nth(big).click();
  await expect(releases.nth(big)).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('.rename-detail .dept-table tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.locator('.rename-detail .show-all')).toContainText(`Showing 10 of ${n(step.carried.length)}`);
  // A filter narrows the list, and one that matches nothing says so.
  const filter = page.getByRole('textbox', { name: 'Filter renames' });
  const firstSchool = (await rows.first().locator('td').first().innerText()).trim();
  await filter.fill(firstSchool);
  await expect(rows.first()).toContainText(firstSchool);
  await filter.fill('zzzz no such department');
  await expect(page.locator('.rename-empty')).toHaveText('No rename matches that filter.');
  // The ended list opens; another release resets the filter and closes it.
  const toggle = page.locator('.rename-ended-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.rename-ended-list li')).toHaveCount(step.gone.length);
  await releases.first().click();
  await expect(filter).toHaveValue('');
  await expect(page.locator('.rename-ended-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('duplicates show the flagged groups first, each with why', async ({ page }) => {
  await open(page, 'renames', '.dup-row');
  const rows = page.locator('.dup-table tbody tr.dup-row');
  const flagged = await page.locator('.dup-table tbody tr.dup-row[data-flagged]').count();
  expect(flagged).toBeGreaterThan(0);
  await expect(rows).toHaveCount(flagged);
  for (let i = 0; i < flagged; i++) await expect(rows.nth(i).locator('td').nth(2)).toHaveText(/^(Hire dates \d+ days? apart|Same title and school)$/);
  await expect(page.locator('[data-figure="flagged"]')).toContainText(String(flagged));
  await page.getByRole('button', { name: /^Show all/ }).click();
  expect(await rows.count()).toBeGreaterThan(flagged);
  await expect(rows.nth(flagged)).not.toHaveAttribute('data-flagged', /.*/);
});

test('the five copy checks hold', async ({ page }) => {
  // 1. The raise base: the What's new figure and the Sep 2026 note are one number, the raise steps'.
  type Steps = { hist_step: number; metrics: { fte: { from_id: string; to_id: string; hist: [number, number][] }[] } };
  const steps = read<Steps>('raise-steps.json');
  const st = steps.metrics.fte.at(-1)!;
  const total = st.hist.reduce((t, [, c]) => t + c, 0);
  const manifest = read<{ snapshots: { snapshot_id: string; note?: string }[] }>('manifest.json');
  const note = manifest.snapshots.find((s) => s.snapshot_id === st.to_id)?.note ?? '';
  const inNote = note.match(/of the ([\d,]+) people who kept the same title/)?.[1];
  if (inNote) expect(inNote, 'the snapshot note and the raise steps count different people').toBe(n(total));
  await open(page, '', '.whats-new-change');
  await expect(page.locator('[data-item="step"]')).toContainText(`of the ${n(total)} people`);
  // 3. Medians say what they count.
  await expect(page.locator('[data-figure="median"]')).toContainText('Median pay, per person');
  // 4. Two pay views, everywhere the page counts them.
  await expect(page.locator('main')).not.toContainText(/three (“|")?Pay(”|")? views/i);
  await page.goto('./data?tab=method');
  await expect(page.locator('#methodology')).toContainText('The two Pay views are derived from them');
  await page.goto('./data?tab=snapshots');
  await expect(page.locator('.data-snap-table thead')).toContainText(/Median \/ row/i);
  // 5. "TTC" on a person's page opens the Snapshots tab at the note about it.
  await page.goto('./data#ttc');
  await expect(page.getByRole('tab', { name: 'Snapshots' })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
  await expect(page.locator('#ttc')).toBeInViewport({ timeout: 30_000 });
  await expect(page.locator('#ttc')).toContainText(/TTC/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('no tab scrolls the page sideways, and the tab bar scrolls on its own', async ({ page }) => {
    for (const [tab, ready] of [['', '.whats-new-change'], ['accuracy', '#identity'], ['method', '.pipeline-step'], ['ranges', '.range-table tbody tr'],
      ['snapshots', '.snap-note-row'], ['renames', '.dup-row']] as const) {
      await open(page, tab, ready);
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${tab || 'overview'} scrolls the page sideways`).toBeLessThanOrEqual(0);
    }
    const list = page.getByRole('tablist');
    const fits = await list.evaluate((el) => {
      const scroller = el.closest('[class*="overflow"], .mantine-Tabs-list') ?? el;
      return scroller.scrollWidth <= scroller.clientWidth + 1;
    });
    expect(fits, 'six tabs fit 390px, so the scroll is untested').toBe(false);
  });
});
