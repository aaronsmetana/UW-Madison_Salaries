import { test, expect, type Page } from '@playwright/test';
import { oracle } from './oracle';

/**
 * The raise case (RC2–RC8). Its standing names the pool its median is of — the others, the subject left out. A
 * subject taken from the compare set says so. The grounds are two a row at most. The setup is four steps, each
 * marked done as it is, and a step folds away. The brief's pay chart names every year. With Setup chosen on a
 * narrow window, the brief is still what prints. And Export, while it waits, says what for.
 */

const AARON = 'aaronsmetana|2014-10-15';
const CASE = `./raise-case?type=comparison&subject=${encodeURIComponent(AARON)}`;
test.use({ viewport: { width: 1440, height: 900 } });

async function brief(page: Page) {
  await page.goto(CASE);
  await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 90_000 });
}

test('the standing names its pool: the others, the subject left out, and their median', async ({ page }) => {
  await brief(page);
  await expect(page.locator('.report-brief').getByText(/: the \d+ others, Aaron left out, their median \$[\d,]+\./).first()).toBeVisible();
  await expect(page.locator('.report-brief').getByText(/pay against .*\(n = \d+\)\.$/)).toHaveCount(0);
});

test('a subject taken from the compare set says so', async ({ page }) => {
  await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
    { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
    { type: 'title', id: 'FA020', label: 'Professor', colorIdx: 1 },
  ]));
  await page.goto('./raise-case?type=comparison');
  await expect(page.locator('.subject-note')).toHaveText(/^Aaron Smetana, the first person in your compare set\. Pick anyone else here\.$/, { timeout: 60_000 });
  // Opened on a subject of its own, nothing to say.
  await page.goto(CASE);
  await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.subject-note')).toHaveCount(0);
});

test('the grounds are two a row at most, no word broken across lines', async ({ page }) => {
  await brief(page);
  const cards = page.locator('.brief-grounds > *');
  expect(await cards.count()).toBeGreaterThan(2);
  const tops = await cards.evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
  const perRow = [...tops.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<number, number>()).values()];
  expect(Math.max(...perRow), `${perRow} a row`).toBeLessThanOrEqual(2);
  // A figure's words whole: none of them wider than its card.
  const broken = await cards.evaluateAll((cs) => cs.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent));
  expect(broken).toEqual([]);
});

test('the setup is four steps, each marked done as it is, and a step folds away', async ({ page }) => {
  await brief(page);
  const steps = page.locator('.setup-step');
  await expect(steps).toHaveCount(4);
  await expect(page.getByRole('button', { name: /^Step 1: Subject\s*,\s*done$/ })).toBeVisible();
  await expect(steps.first()).toHaveAttribute('data-done', 'true');
  await expect(steps.first().locator('.setup-step-mark svg')).toBeVisible();
  // The mark is a ring holding the number until the step is done.
  const undone = page.locator('.setup-step:not([data-done]) .setup-step-mark');
  if (await undone.count()) await expect(undone.first()).toHaveText(/^[2-4]$/);
  const fmt = page.getByRole('button', { name: /^Step 4: Format/ });
  await expect(fmt).toHaveAttribute('aria-expanded', 'true');
  await fmt.click();
  await expect(fmt).toHaveAttribute('aria-expanded', 'false');
});

test('the brief’s pay chart names every year it covers', async ({ page }) => {
  // The chart is the subject's years in the title they hold now.
  await brief(page);
  const chart = page.locator('.report-brief .recharts-wrapper', { has: page.locator('svg[aria-label^="Pay vs. title median over time"]') });
  await expect(chart).toBeVisible();
  const ticks = await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents();
  const [{ y0, y1 }] = await oracle<{ y0: number; y1: number }>(
    `SELECT min(year(snapshot_date)) y0, max(year(snapshot_date)) y1 FROM $SAL WHERE person_key = '${AARON}' AND salary > 0
       AND job_code = (SELECT arg_max(job_code, snapshot_date) FROM $SAL WHERE person_key = '${AARON}' AND salary > 0)`,
  );
  const years = Array.from({ length: Number(y1) - Number(y0) + 1 }, (_, i) => String(Number(y0) + i));
  expect(ticks.map((t) => t.trim())).toEqual(years);
});

test.describe('on a narrow window', () => {
  test.use({ viewport: { width: 768, height: 1000 } });
  test('with Setup chosen, the brief is what prints', async ({ page }) => {
    await page.goto(CASE);
    // Narrow, one pane at a time: the brief is drawn, only not shown.
    await expect(page.locator('.report-pane-brief #report-sec-notes')).toBeAttached({ timeout: 90_000 });
    await page.getByRole('radio', { name: 'Setup' }).check({ force: true });
    await expect(page.locator('.report-pane-brief')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    // The brief's print area, laid out on the page (print.css takes it out of its pane's flow).
    const area = page.locator('.report-pane-brief .report-brief');
    await expect(area).toBeVisible();
    await expect(page.locator('.report-pane-setup')).toBeHidden();
    const h = await area.evaluate((e) => e.getBoundingClientRect().height);
    expect(h, 'the brief prints empty').toBeGreaterThan(800);
    await expect(page.locator('.report-pane-brief #report-sec-notes')).toBeVisible();
    // The PDF itself: pages of the brief, not blank ones.
    await page.emulateMedia({ media: 'screen' });
    const pdf = await page.pdf({ width: '768px', printBackground: false });
    expect(pdf.length, 'a blank PDF').toBeGreaterThan(60_000);
  });
});

test('Export, while it waits, says what for', async ({ page }) => {
  await page.route('**/data/salaries.parquet', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
  await page.goto(CASE);
  const button = page.getByRole('button', { name: 'Export', exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await page.locator('.export-wrap').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Waiting for comparison data');
  await expect(button).toBeEnabled({ timeout: 90_000 });
  await expect(button).not.toHaveAttribute('aria-busy', /.*/);
});
