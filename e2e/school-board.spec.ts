import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot, PERSON_PAY } from './oracle';

/**
 * A division's own page (SC1–SC7). Its bar names the division, whatever scope the address carries. Overview is four
 * figures, the pay of its people laid out and how its median and headcount moved; at actual pay it says how many
 * hold under a quarter-time appointment. Tenure against pay is coloured by category and narrows to one title. A
 * division of one department has no Departments tab; one of many opens a department in place. The histogram's axis
 * says money as every chart does, with no Log. People is the categories drawn and everyone, sortable and searchable.
 */

test.use({ viewport: { width: 1440, height: 900 } });
const PHARMACY = 'School of Pharmacy';
const ENGINEERING = 'College of Engineering';
const at = (school: string, q = '') => `./school/${encodeURIComponent(school)}${q}`;

async function open(page: Page, school: string, q = '') {
  await page.goto(at(school, q));
  await expect(page.getByRole('heading', { level: 1, name: school })).toBeVisible({ timeout: 60_000 });
}

/** The latest snapshot's people in a division: each at their pay, with their summed FTE. */
async function people(school: string) {
  const snap = await latestSnapshot();
  return oracle<{ pk: string; pay: number; fte: number | null }>(
    `SELECT person_key pk, ${PERSON_PAY} pay, sum(fte) FILTER (WHERE salary > 0 AND fte > 0) fte FROM $SAL
     WHERE snapshot_id = '${snap}' AND school = '${school}' GROUP BY person_key HAVING ${PERSON_PAY} > 0`,
  );
}

test('the bar names the division, whatever scope the address carries', async ({ page }) => {
  await open(page, PHARMACY, `?school=${encodeURIComponent(ENGINEERING)}`);
  const bar = page.locator('.scope-locked').locator('visible=true');
  await expect(bar.first()).toHaveText(PHARMACY);
  // Named, not picked: no scope picker on a division's own page.
  await expect(page.getByLabel('Scope', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText('All UW', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText(ENGINEERING)).toHaveCount(0);
});

test('Overview is four figures, the pay laid out, and the median and headcount over time', async ({ page }) => {
  await open(page, PHARMACY);
  const labels = await page.getByRole('tabpanel').locator('.stat-row').first().evaluate((g) => [...g.children].map((c) => c.textContent ?? ''));
  expect(labels.length, `${labels}`).toBe(4);
  expect(labels.join(' | ')).toMatch(/Headcount.*Median.*Middle half.*Total payroll/);
  await expect(page.locator('.school-dist .recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.locator('.school-trend .recharts-line-curve')).toHaveCount(2);
  // People, not appointments: the bars add up to the headcount.
  const all = await people(PHARMACY);
  await expect(page.locator('.school-dist')).toContainText(`${all.length.toLocaleString('en-US')} people`);
  // The axis says money as every chart does, and there is no Log.
  const ticks = await page.locator('.school-dist .recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents();
  expect(ticks.every((t) => /^\$\d+k$|^\$0$/.test(t.trim())), `${ticks}`).toBe(true);
  await expect(page.getByText('Log', { exact: true })).toHaveCount(0);
});

test('at actual pay, it says how many hold under a quarter-time appointment', async ({ page }) => {
  const all = await people(ENGINEERING);
  const small = all.filter((p) => p.fte != null && p.fte < 0.25).length;
  expect(small, 'no one in Engineering under a quarter-time, so nothing to check').toBeGreaterThan(0);
  await open(page, ENGINEERING, '?metric=fte');
  // Its bars count people, not appointments: Engineering has a few people with two.
  await expect(page.locator('.school-dist')).toContainText(`${all.length.toLocaleString('en-US')} people`, { timeout: 60_000 });
  await expect(page.locator('.school-small-fte')).toHaveText(new RegExp(`^${small.toLocaleString('en-US')} (person holds|people hold) under a quarter-time appointment`));
  await page.goto(at(ENGINEERING, '?metric=full'));
  await expect(page.locator('.school-dist .recharts-bar-rectangle').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.school-small-fte')).toHaveCount(0);
});

test('tenure against pay is coloured by category and narrows to one title', async ({ page }) => {
  await open(page, ENGINEERING, '?tab=tenure');
  const series = page.locator('.school-tenure .school-tenure-dots');
  await expect(page.locator('.school-tenure .recharts-scatter-symbol').first()).toBeVisible({ timeout: 60_000 });
  const fills = await series.evaluateAll((gs) => gs.map((g) => g.querySelector('.recharts-symbols')?.getAttribute('fill') ?? null).filter(Boolean));
  expect(new Set(fills).size, `one colour for every category: ${fills}`).toBeGreaterThan(1);
  await expect(page.locator('.school-tenure-key .cat-key').first()).toBeVisible();
  // One title: its people, all of them.
  const snap = await latestSnapshot();
  const [{ n }] = await oracle<{ n: number }>(
    `SELECT count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND school = '${ENGINEERING}' AND job_code = 'FA020' AND salary > 0 AND date_of_hire IS NOT NULL`,
  );
  await page.getByRole('textbox', { name: 'Title' }).click();
  await page.getByRole('option', { name: /^Professor · / }).click();
  await expect.poll(() => page.locator('.school-tenure .recharts-scatter-symbol').count(), { timeout: 30_000 }).toBe(Number(n));
  await expect(page.locator('.school-tenure')).toContainText(`${Number(n).toLocaleString('en-US')} people in Professor`);
});

test('a division of one department has no Departments tab; of many, a department opens in place', async ({ page }) => {
  await open(page, PHARMACY);
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Departments' })).toHaveCount(0);
  await open(page, ENGINEERING, '?tab=departments');
  const row = page.locator('.school-dept-row').first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const url = page.url();
  await row.locator('.school-dept-toggle').click();
  await expect(row.locator('.school-dept-toggle')).toHaveAttribute('aria-expanded', 'true');
  const titles = page.locator('.school-dept-titles tbody tr');
  await expect(titles.first()).toBeVisible({ timeout: 30_000 });
  expect(await titles.count()).toBeLessThanOrEqual(8);
  expect(page.url(), 'the department sent the reader away').toBe(url);
  await expect(page.locator('.school-dept-open')).toHaveAttribute('href', /\/divisions\?school=.*&dept=/);
  await row.locator('.school-dept-toggle').click();
  await expect(page.locator('.school-dept-titles')).toHaveCount(0);
});

test('People draws its categories and lists everyone, sortable and searchable', async ({ page }) => {
  await open(page, ENGINEERING, '?tab=people');
  const all = await people(ENGINEERING);
  const rows = page.locator('.school-comp-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const counted = await rows.evaluateAll((rs) => rs.reduce((t, r) => t + Number(r.getAttribute('data-n')), 0));
  expect(counted, 'the categories count each person once').toBe(all.length);
  // Each a bar, its share of the division wide.
  const widths = await rows.evaluateAll((rs) => rs.map((r) => parseFloat((r.querySelector('div[aria-hidden] > div[style*="width"]') as HTMLElement | null)?.style.width ?? 'NaN')));
  expect(widths.every((w) => Number.isFinite(w)), `a category with no bar: ${widths}`).toBe(true);
  expect(Math.round(widths.reduce((a, b) => a + b, 0)), 'the bars are not shares of the division').toBeGreaterThanOrEqual(99);
  const table = page.locator('.school-people');
  await expect(table.getByRole('columnheader', { name: /Department/ })).toBeVisible();
  await expect(table.getByText(`Showing 25 of ${all.length.toLocaleString('en-US')}`)).toBeVisible({ timeout: 60_000 });
  // The highest paid first: the oracle's.
  const top = all.reduce((a, b) => (b.pay > a.pay ? b : a));
  await expect(table.locator('tbody tr').first().locator('a').first()).toHaveAttribute('href', new RegExp(encodeURIComponent(top.pk).replace(/\|/g, '\\|')));
  // Searchable: a name narrows it.
  const name = (await table.locator('tbody tr').first().locator('a').first().innerText()).trim();
  await table.getByPlaceholder('Search name or title…').fill(name);
  await expect(table.locator('tbody tr.earner-row')).toHaveCount(1);
});
