import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { oracle, latestSnapshot, rangesSql, GRADED, PAY } from './oracle';

/**
 * A pay band is a range of full-time rates, and is read against the full-time rate of the appointment that
 * carries the grade. Screening and Reports read it against the pay the metric describes — actual pay,
 * scaled by the appointment percentage and summed across appointments — so a part-time appointment on a
 * mid-range rate read as below the market floor, and someone holding two was placed by their combined
 * earnings. Each test here picks, from the data, someone the two readings disagree on.
 */

interface Case {
  person_key: string; fn: string; ln: string; n: number; depts: number; school: string; department: string;
  pay: number; rate: number; grade: number; mn: number; mx: number; mid: number; pir: number; below: boolean; below_by_pay: boolean;
}

/** People whose market-floor verdict differs between their full-time rate and their pay. */
async function misread(where: string): Promise<Case[]> {
  const snap = await latestSnapshot();
  return oracle<Case>(
    `WITH b AS ${rangesSql()},
     p AS (
       SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
         count(*) FILTER (WHERE salary > 0) n,
         count(DISTINCT school) FILTER (WHERE salary > 0) schools, count(DISTINCT department) FILTER (WHERE salary > 0) depts,
         any_value(school) FILTER (WHERE salary > 0) school, any_value(department) FILTER (WHERE salary > 0) department,
         sum(${PAY}) FILTER (WHERE salary > 0) pay, ${GRADED} gr
       FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key
     ),
     -- A name no one else has ever carried, so a search or a table row can only be them.
     unique_names AS (SELECT first_name fn, last_name ln FROM $SAL GROUP BY 1, 2 HAVING count(DISTINCT person_key) = 1),
     x AS (
       SELECT p.*, gr.rate rate, gr.grade grade, mn, mx, (mn + mx) / 2 mid, (gr.rate - mn) / (mx - mn) pir,
         (gr.rate / ((mn + mx) / 2) < 0.85 OR (gr.rate - mn) / (mx - mn) < 0.25) below,
         (pay / ((mn + mx) / 2) < 0.85 OR (pay - mn) / (mx - mn) < 0.25) below_by_pay
       FROM p JOIN b ON b.grade = gr.grade AND b.basis = gr.basis JOIN unique_names USING (fn, ln)
     )
     SELECT * FROM x WHERE schools = 1 AND below <> below_by_pay AND ${where} ORDER BY person_key`
  );
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Their name as the whole of a cell, and within a longer text. */
const nameRe = (c: Case) => new RegExp(`^${esc(`${c.fn} ${c.ln}`)}$`, 'i');
const nameIn = (c: Case) => new RegExp(esc(`${c.fn} ${c.ln}`), 'i');

/** One CSV line into its fields, quotes and all. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Screens the smallest scope that holds all of `c`'s appointments, and returns their row. */
async function screen(page: Page, c: Case) {
  const q = new URLSearchParams({ run: '1', sch: c.school, ...(c.depts === 1 ? { dept: c.department } : {}) });
  await page.goto(`./screening?${q}`);
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 120_000 });
  const all = page.getByRole('button', { name: /^Show all/ });
  if (await all.count()) await all.click();
  const row = page.locator('table tbody tr').filter({ has: page.locator('td:first-child', { hasText: nameRe(c) }) });
  await expect(row).toHaveCount(1);
  return row;
}

async function checkScreen(page: Page, c: Case) {
  const row = await screen(page, c);
  const flags = row.locator('td').nth(5);
  if (c.below) await expect(flags).toContainText('Below market floor');
  else await expect(flags).not.toContainText('Below market floor');
  // The export says which rate was read, and the compa-ratio it gave.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  const lines = readFileSync((await download.path())!, 'utf8').split('\n');
  const head = csvFields(lines[0]);
  const mine = lines.slice(1).map(csvFields).filter((f) => nameRe(c).test(f[head.indexOf('name')]));
  expect(mine).toHaveLength(1);
  expect(Number(mine[0][head.indexOf('full_time_rate')])).toBe(Math.round(c.rate));
  expect(mine[0][head.indexOf('compa_ratio')]).toBe((c.rate / c.mid).toFixed(2));
  expect(mine[0][head.indexOf('below_market')]).toBe(c.below ? 'yes' : 'no');
}

async function checkReport(page: Page, c: Case) {
  await page.goto('./reports?type=comparison');
  const start = page.getByPlaceholder('Search yourself by name to begin…');
  await expect(start).toBeVisible({ timeout: 60_000 });
  await start.fill(`${c.fn} ${c.ln}`);
  await page.getByRole('option').filter({ hasText: nameIn(c) }).first().click();
  await expect(page.locator('#report-sec-highlights')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Market-competitive range — /)).toHaveText(
    `Market-competitive range — ${c.below ? `compa-ratio ${(c.rate / c.mid).toFixed(2)}` : 'within the 85–115% range'}`
  );
  // Position in range reads the rate too: under half the range is evidence, over it is "above the midpoint".
  const band = page.getByText(/^Grade-band position/);
  if (c.pir < 0.5) await expect(band).toHaveText('Grade-band position');
  else await expect(band).toHaveText('Grade-band position — above the band midpoint');
}

test.describe('a pay band reads the full-time rate of the graded appointment', () => {
  test.setTimeout(180_000);

  test('Screening: a part-time appointment is not read as below the market floor for earning part of its rate', async ({ page }) => {
    const [c] = await misread('n = 1');
    expect(c, 'no part-time appointment in the data reads differently by rate and by pay, so this tests nothing').toBeTruthy();
    expect(c.pay).toBeLessThan(c.rate);
    await checkScreen(page, c);
  });

  test('Screening: someone with two appointments is placed by the graded one, not their combined pay', async ({ page }) => {
    const [c] = await misread('n > 1');
    expect(c, 'no one with several appointments reads differently by rate and by pay, so this tests nothing').toBeTruthy();
    await checkScreen(page, c);
  });

  test('Reports: the market-competitive test and position in range read the rate, for a part-time appointment', async ({ page }) => {
    const [c] = await misread('n = 1');
    await checkReport(page, c);
  });

  test('Reports: the same for someone with two appointments', async ({ page }) => {
    const [c] = await misread('n > 1');
    await checkReport(page, c);
  });

  test('the person page places the band on the graded appointment’s rate, and draws its lines only over a line in that unit', async ({ page }) => {
    const [two] = await misread('n > 1');
    await page.goto(`./person/${encodeURIComponent(two.person_key)}?tab=pay`);
    const card = page.locator('.person-payband');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`Pay band — grade ${two.grade}`);
    await expect(card.locator('.payband-rate')).toHaveText(
      `Placed on the full-time rate of the appointment in grade ${two.grade}, $${Math.round(two.rate).toLocaleString('en-US')}.`
    );
    const through = Math.round(((two.rate - two.mn) / (two.mx - two.mn)) * 100);
    await expect(card).toContainText(two.rate < two.mn ? 'below min' : two.rate > two.mx ? 'over max' : `${through}% through band`);

    // A part-time appointment's actual pay is not in the band's unit; its rate is.
    const [part] = await misread('n = 1');
    await page.goto(`./person/${encodeURIComponent(part.person_key)}?tab=pay`);
    await expect(page.locator('.person-payband')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.person-payband .payband-rate')).toHaveCount(0);
    const legend = page.getByText(new RegExp(`^Grade ${part.grade} band \\$`));
    await page.goto(`./person/${encodeURIComponent(part.person_key)}?tab=trends`);
    await expect(page.getByRole('heading', { name: 'Salary over time' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.recharts-surface').first()).toBeVisible();
    await expect(legend).toHaveCount(0);
    // Mantine's segmented control keeps its radios visually hidden; a reader clicks the label.
    await page.locator('label').filter({ hasText: /^Rate$/ }).click();
    await expect(legend).toHaveCount(1);
  });
});
