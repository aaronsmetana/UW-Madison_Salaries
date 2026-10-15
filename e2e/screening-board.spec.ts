import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot } from './oracle';

/**
 * Screening's scope and its ranking (S1, S3–S6): a scope is needed, the last one used is chosen again, and the
 * button says how many it screens; ties on the capped score go to whoever is furthest below their title's median,
 * which has a column of its own; an inversion is a share of the peers it could be; names open their pages; and a
 * screen of one school lists departments, not the school on every row.
 */

test.use({ viewport: { width: 1440, height: 1000 } });
const PHARM = 'School of Pharmacy';

async function pick(page: Page, school: string) {
  await page.getByRole('textbox', { name: 'School / division' }).click();
  await page.getByRole('option', { name: school, exact: true }).click();
}

test('a scope is needed; the button says how many it screens; the last scope is chosen again', async ({ page }) => {
  await page.goto('./screening');
  const button = page.locator('.screen-run');
  await expect(button).toHaveText('Choose a school to screen', { timeout: 60_000 });
  await expect(button).toBeDisabled();
  await pick(page, PHARM);
  const [{ n }] = await oracle<{ n: number }>(
    `SELECT count(DISTINCT person_key) FILTER (WHERE salary > 0) n FROM $SAL WHERE snapshot_id = '${await latestSnapshot()}' AND school = '${PHARM}'`,
  );
  await expect(button).toHaveText(`Screen ${n.toLocaleString('en-US')} people`, { timeout: 60_000 });
  await button.click();
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  // Back to the page with nothing in the address: the scope screened last.
  await page.goto('./screening');
  await expect(page.getByRole('textbox', { name: 'School / division' })).toHaveValue(PHARM, { timeout: 60_000 });
  await expect(button).toBeEnabled();
});

test('ties on the score go to the furthest below the median, said in a column; an inversion is a share; names open their pages; one school lists departments', async ({ page }) => {
  await page.goto(`./screening?run=1&sch=${encodeURIComponent(PHARM)}`);
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 120_000 });
  const read = await rows.evaluateAll((trs) => trs.map((tr) => {
    const score = Number(tr.querySelector('td:nth-last-child(2)')?.textContent?.match(/\d+$/)?.[0] ?? NaN);
    const b = tr.querySelector('.screen-below')?.textContent ?? '';
    const m = b.match(/([\d.]+)% (below|above)/);
    return { score, below: b === 'at median' ? 0 : m ? Number(m[1]) * (m[2] === 'below' ? 1 : -1) : -Infinity };
  }));
  expect(read.length).toBeGreaterThan(10);
  for (let k = 1; k < read.length; k++) {
    const [a, b] = [read[k - 1], read[k]];
    expect(a.score >= b.score, `row ${k}: not by score`).toBe(true);
    if (a.score === b.score) expect(a.below >= b.below, `row ${k}: a tie not broken by how far below the median (${a.below} then ${b.below})`).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Sort by Below median' })).toBeVisible();
  // An inversion said as a share of the peers it could be.
  const inv = page.locator('.screen-inversion').first();
  if (await inv.count()) await expect(inv).toHaveText(/^Paid less than \d+% of less-tenured peers$/);
  await expect(page.getByText(/^Inversion ×/)).toHaveCount(0);
  // One school: its departments in the column.
  await expect(page.getByRole('button', { name: 'Sort by Department' })).toBeVisible();
  const third = await rows.locator('td:nth-child(3)').allInnerTexts();
  expect(third.filter((t) => t === PHARM), 'the school on every row').toEqual([]);
  // A name is its page.
  const name = rows.first().locator('a.screen-name');
  const href = await name.getAttribute('href');
  expect(href).toMatch(/\/person\//);
  await name.click();
  await expect(page).toHaveURL(/\/person\//);
});
