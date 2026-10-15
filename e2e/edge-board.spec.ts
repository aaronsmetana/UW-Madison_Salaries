import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot, PERSON_PAY, usd } from './oracle';

/**
 * People and data states at the edges (E3, E6, E9, E12, E14, E15, E17). An unpaid appointment in History is an
 * affiliate's, not a new title at $0. One who has left is "Former" by the name and has no raise case. A 9 Month figure
 * is the 12-month equivalent, said so, with the academic-year pay beside it. Inflation-adjusted dollars are in the
 * address, not remembered, and every such figure says "2026 $"; the growth tile gives both readings. A past snapshot
 * says so at the top with the way back. The snapshot menu counts people and names each snapshot one way.
 */

test.use({ viewport: { width: 1440, height: 900 } });
const AARON = 'aaronsmetana|2014-10-15';
const person = (key: string, q = '') => `./person/${encodeURIComponent(key)}${q}`;

test('an unpaid appointment in History is an affiliate’s, not a new title at $0', async ({ page }) => {
  const [{ pk }] = await oracle<{ pk: string }>(
    `SELECT person_key pk FROM $SAL GROUP BY 1
     HAVING count(*) FILTER (WHERE coalesce(salary, 0) = 0) >= 1 AND count(*) FILTER (WHERE salary > 0) >= 3 ORDER BY 1 LIMIT 1`,
  );
  await page.goto(person(pk, '?tab=history'));
  const unpaid = page.locator('tr[data-unpaid]');
  await expect(unpaid.first()).toBeVisible({ timeout: 60_000 });
  const rows = await unpaid.evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText));
  for (const r of rows) {
    expect(r, 'an unpaid row not said to be one').toContain('Unpaid affiliate');
    expect(r, 'an unpaid row called a new title').not.toMatch(/New title/);
    expect(r, 'an unpaid row at $0').not.toMatch(/\$0\b/);
  }
});

test('one who has left is Former by the name and has no raise case; one still here, neither', async ({ page }) => {
  const [{ pk }] = await oracle<{ pk: string }>(
    `SELECT person_key pk FROM $SAL GROUP BY 1
     HAVING max(snapshot_date) FILTER (WHERE salary > 0) < (SELECT max(snapshot_date) FROM $SAL) AND count(DISTINCT snapshot_id) >= 6 ORDER BY 1 LIMIT 1`,
  );
  await page.goto(person(pk));
  await expect(page.locator('.person-head')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.person-name-row .former-badge')).toHaveText('Former');
  await expect(page.getByRole('link', { name: 'Build raise case' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /compare/i }).first()).toBeVisible();
  await page.goto(person(AARON));
  await expect(page.locator('.person-head')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.former-badge')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Build raise case' })).toBeVisible();
});

test('a 9 Month figure is the 12-month equivalent, said so, with the academic-year pay beside it', async ({ page }) => {
  const snap = await latestSnapshot();
  const [{ pk, pay }] = await oracle<{ pk: string; pay: number }>(
    `SELECT person_key pk, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1
     HAVING count(*) = 1 AND any_value(comp_basis) = '9 Month' AND ${PERSON_PAY} > 0 ORDER BY 1 LIMIT 1`,
  );
  await page.goto(person(pk));
  await expect(page.locator('.person-head')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/· 12-month equivalent of a 9-month appointment$/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.academic-year-pay')).toHaveText(`academic-year pay ${usd((pay * 9) / 11)}`);
  await expect(page.getByText(/9-month \(academic year\) basis/)).toHaveCount(0);
});

test('real dollars are in the address, not remembered, and say "2026 $"', async ({ page }) => {
  await page.goto(person(AARON, '?tab=trends'));
  const toggle = page.getByRole('radio', { name: /\d{4} \$/ });
  await expect(toggle.first()).toBeAttached({ timeout: 60_000 });
  await page.getByText(/^\d{4} \$$/).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('dollars')).toBe('real');
  await expect(page.locator('.real-badge').first()).toBeVisible();
  // Another page, opened without it: nominal, whatever was chosen before.
  await page.goto('./divisions');
  await expect(page.locator('[data-figure="median-growth"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.real-badge')).toHaveCount(0);
  // A link carrying it: real, said.
  await page.goto('./divisions?dollars=real');
  await expect(page.locator('[data-figure="median-growth"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.real-badge').first()).toBeVisible();
});

test('the growth tile gives both readings, nominal and after inflation, across years', async ({ page }) => {
  // Within one year the CPI gives one reading, and the tile says one.
  await page.goto('./divisions');
  await expect(page.locator('[data-figure="median-growth"]')).toHaveText(/%$/, { timeout: 60_000 });
  await expect(page.locator('.growth-other')).toHaveCount(0);
  const summary = await (await page.request.get('./data/summary.json')).json() as { snapshots: { id: string }[] };
  const start = summary.snapshots.find((x) => !x.id.includes('pre'))!.id;
  await page.goto(`./divisions?from=${start}`);
  const fig = page.locator('[data-figure="median-growth"]');
  await expect(fig).toHaveText(/^[+−-][\d.]+%$/, { timeout: 60_000 });
  const other = page.locator('.growth-other');
  await expect(other).toHaveText(/^ · [+−-][\d.]+% after inflation$/);
  const n = (s: string) => Number(s.replace('−', '-').match(/[+-]?[\d.]+/)![0]);
  const [nominal, real] = [n(await fig.innerText()), n(await other.innerText())];
  expect(real, 'after inflation is not below the nominal growth').toBeLessThan(nominal);
  await page.goto(`./divisions?from=${start}&dollars=real`);
  await expect(page.locator('.growth-other')).toHaveText(/ before inflation$/, { timeout: 60_000 });
  expect(n(await page.locator('[data-figure="median-growth"]').innerText())).toBeCloseTo(real, 1);
});

test('a past snapshot says so at the top, with the way back', async ({ page }) => {
  const [{ id, label }] = await oracle<{ id: string; label: string }>(
    `SELECT snapshot_id id, any_value(snapshot_label) "label" FROM $SAL GROUP BY 1 ORDER BY any_value(snapshot_date) DESC LIMIT 1 OFFSET 3`,
  );
  await page.goto(`./divisions?snap=${id}`);
  const tag = page.locator('.viewing-past');
  await expect(tag).toContainText(`Viewing ${label}`, { timeout: 60_000 });
  await expect(page.locator('.release-tag')).toHaveCount(0);
  await tag.getByText('Back to latest').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('snap')).toBeNull();
  await expect(page.locator('.viewing-past')).toHaveCount(0);
});

test('the snapshot menu counts people and names each snapshot one way', async ({ page }) => {
  const summary = await (await page.request.get('./data/summary.json')).json() as { snapshots: { id: string; label: string; headcount?: number | null }[] };
  const latest = summary.snapshots.at(-1)!;
  await page.goto('./divisions');
  const picker = page.getByRole('textbox', { name: 'Snapshot', exact: true });
  await expect(picker).toBeVisible({ timeout: 60_000 });
  await picker.click();
  const opt = page.getByRole('option', { name: new RegExp(`^${latest.label.replace(/[()]/g, '\\$&')}`) }).first();
  await expect(opt).toContainText(`${Number(latest.headcount).toLocaleString('en-US')} people`);
  await expect(page.getByRole('option').filter({ hasText: / rows$/ })).toHaveCount(0);
  const names = await page.getByRole('option').allInnerTexts();
  expect(names.some((t) => t.includes('Nov 2021 (Post-TTC)')), `the long name: ${names}`).toBe(true);
  expect(names.some((t) => / · post/.test(t)), 'a second name for a snapshot').toBe(false);
  // The period's start names them the same way.
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'From snapshot' }).click();
  const from = await page.getByRole('option').allInnerTexts();
  expect(from.some((t) => t.includes('Nov 2021 (Post-TTC)')), `the long name: ${from}`).toBe(true);
  expect(from.some((t) => / · post/.test(t)), 'a second name for a snapshot').toBe(false);
});
