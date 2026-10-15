import { test, expect, type Page } from '@playwright/test';

/**
 * Raises (R2, R3, R5–R7). Period and scope are one row, and the rest is under "More filters"; the usual raise is a
 * small table of its categories. An explanation chip brings the list it filters into view. A name keeps a line to
 * itself with its title under it, and an explanation is shown whole. A changed title's rate change sits over the
 * full-time rates it is of. An hourly title is tagged, and the patterns can be split by pay basis.
 */

test.use({ viewport: { width: 1440, height: 900 } });
const ROWS = '.raise-above-table tbody tr';

async function open(page: Page) {
  await page.goto('./raises');
  await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 90_000 });
}

test('period and scope are one row and the rest is under More filters; the usual raise is a table', async ({ page }) => {
  await open(page);
  const ROW = ['From', 'To', 'School / division', 'Department'];
  const tops = await page.locator('main .mantine-InputWrapper-label').evaluateAll((ls) =>
    ls.filter((l) => !l.closest('[inert]')).map((l) => ({ t: l.textContent ?? '', y: Math.round(l.getBoundingClientRect().top) })));
  expect(tops.map((x) => x.t)).toEqual(expect.arrayContaining(ROW));
  expect(new Set(tops.filter((x) => ROW.includes(x.t)).map((x) => x.y)).size, `period and scope on more than one row: ${JSON.stringify(tops)}`).toBe(1);
  const more = page.locator('.raise-more-filters');
  const [m, f] = [(await more.boundingBox())!, (await page.getByRole('textbox', { name: 'From', exact: true }).boundingBox())!];
  expect(Math.abs(m.y + m.height - (f.y + f.height)), 'More filters is not on the row').toBeLessThan(4);
  const LATER = ['Title', 'Title category', 'Count raises above'];
  for (const name of LATER) await expect(page.getByRole('textbox', { name, exact: true })).toBeHidden();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  for (const name of LATER) await expect(page.getByRole('textbox', { name, exact: true })).toBeVisible();
  const usual = page.locator('.raise-usual-table');
  await expect(usual).toBeVisible();
  expect(await usual.locator('.raise-usual-cat').count()).toBeGreaterThanOrEqual(3);
});

test('an explanation chip brings the list it filters into view', async ({ page }) => {
  await open(page);
  const chip = page.locator('.raise-why-filter').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const r = await page.locator('.raise-above').boundingBox();
    return r != null && r.y > -2 && r.y < 450;
  }, { message: 'the list stays out of view', timeout: 10_000 }).toBe(true);
});

test('a name keeps a line to itself with its title under it, and an explanation is shown whole', async ({ page }) => {
  await open(page);
  const read = await page.locator(ROWS).evaluateAll((trs) => trs.map((tr) => {
    const a = tr.querySelector('.raise-name-cell > a') as HTMLElement;
    const lines = Math.round(a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight));
    const cut = [...tr.querySelectorAll('td:last-child *')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
    return { name: a.textContent, lines, title: tr.querySelector('.raise-name-title')?.textContent ?? '', cut: cut.length };
  }));
  expect(read.length).toBeGreaterThan(10);
  expect(read.filter((r) => r.lines > 1).map((r) => r.name), 'a name runs to two lines').toEqual([]);
  expect(read.filter((r) => !r.title.trim()).map((r) => r.name), 'a name with no title under it').toEqual([]);
  expect(read.filter((r) => r.cut).map((r) => r.name), 'an explanation cut short').toEqual([]);
});

test('a changed title’s rate change sits over the full-time rates it is of', async ({ page }) => {
  await open(page);
  const table = page.locator('.raise-changes-table');
  await table.scrollIntoViewIfNeeded();
  await expect(table.locator('thead')).toContainText('Actual pay');
  await expect(table.locator('thead')).toContainText('Full-time rate');
  const cells = await table.locator('.raise-rate-cell').evaluateAll((cs) => cs.map((c) => (c as HTMLElement).innerText));
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) {
    const m = c.match(/^([+−-]?[\d.]+)%\s*\$([\d,]+) → \$([\d,]+)$/);
    expect(m, `not a change over its rates: ${JSON.stringify(c)}`).toBeTruthy();
    const [ch, from, to] = [Number(m![1].replace('−', '-')), Number(m![2].replace(/,/g, '')), Number(m![3].replace(/,/g, ''))];
    expect(Math.abs((to / from - 1) * 100 - ch), `${c}: the change is not the rates'`).toBeLessThan(0.15);
  }
});

test('an hourly title is tagged, and the patterns split by pay basis', async ({ page }) => {
  await open(page);
  const pats = page.locator('.raise-patterns');
  await expect(pats.locator('.raise-pattern .raise-hourly').first()).toBeVisible();
  const toggle = pats.locator('.raise-pattern-pay');
  await toggle.getByText('Salaried', { exact: true }).click();
  await expect(pats.locator('.raise-pattern .raise-hourly')).toHaveCount(0);
  expect(await pats.locator('.raise-pattern').count()).toBeGreaterThan(0);
  await toggle.getByText('Hourly', { exact: true }).click();
  await expect.poll(() => pats.locator('.raise-pattern').count()).toBeGreaterThan(0);
  expect(await pats.locator('.raise-pattern .raise-hourly').count()).toBe(await pats.locator('.raise-pattern').count());
});
