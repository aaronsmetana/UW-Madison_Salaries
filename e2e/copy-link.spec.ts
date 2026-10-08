import { test, expect, type Browser, type Page } from '@playwright/test';
import { oracle, latestSnapshot } from './oracle';

/**
 * A view a reader builds reopens from its link (G1): Titles, Raises, Screening and the raise case each have
 * "Copy link", and what it copies, opened in another browser with nothing in it, is the same view — a title and
 * its school; a pair of snapshots and a filter; a screen, run; a case with its people and its settings. Not
 * what a reader wrote in their own words: a raise case's notes and headline stay where they were written.
 */

/** A fresh browser: nothing saved, the clipboard allowed. */
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1440, height: 1000 } });
  return { ctx, page: await ctx.newPage() };
}
/** Press the page's Copy link and read what it put on the clipboard. */
async function copyLink(page: Page) {
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  await expect(page.getByRole('button', { name: 'Copied' }).first()).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test('Titles: a title and its school reopen from the link, and a pinned salary never goes in it', async ({ browser }) => {
  const a = await fresh(browser);
  await a.page.goto('./paycheck?code=FA020');
  await a.page.getByRole('textbox', { name: 'School (optional filter)' }).click();
  await a.page.getByRole('option', { name: /^College of Letters & Science/ }).click();
  await a.page.getByRole('textbox', { name: 'Salary to pin (optional)' }).fill('123456');
  const link = await copyLink(a.page);
  expect(link).toContain('code=FA020');
  expect(link).not.toContain('123456');
  await a.ctx.close();
  const b = await fresh(browser);
  await b.page.goto(link);
  await expect(b.page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(/FA020/);
  await expect(b.page.getByRole('textbox', { name: 'School (optional filter)' })).toHaveValue(/^College of Letters & Science/);
  await b.ctx.close();
});

test('Raises: the snapshots and a filter reopen from the link', async ({ browser }) => {
  const a = await fresh(browser);
  await a.page.goto('./raises');
  await a.page.getByRole('textbox', { name: 'School / division' }).click();
  await a.page.getByRole('option', { name: /^School of Education/ }).click();
  await expect(a.page).toHaveURL(/sch=/);
  const link = await copyLink(a.page);
  await a.ctx.close();
  const b = await fresh(browser);
  await b.page.goto(link);
  await expect(b.page.getByRole('textbox', { name: 'School / division' })).toHaveValue('School of Education');
  await b.ctx.close();
});

test('Screening: a screen, run, reopens from the link run', async ({ browser }) => {
  const a = await fresh(browser);
  await a.page.goto(`./screening?sch=${encodeURIComponent('School of Education')}&run=1`);
  await expect(a.page.getByRole('table').first()).toBeVisible({ timeout: 60_000 });
  const link = await copyLink(a.page);
  await a.ctx.close();
  const b = await fresh(browser);
  await b.page.goto(link);
  await expect(b.page.getByRole('textbox', { name: 'School / division' })).toHaveValue('School of Education');
  await expect(b.page.getByRole('table').first()).toBeVisible({ timeout: 60_000 });
  await b.ctx.close();
});

test('a raise case reopens from its link — its people and its settings — without the words written into it', async ({ browser }) => {
  test.setTimeout(180_000);
  const snap = await latestSnapshot();
  const KEY = 'aaronsmetana|2014-10-15';
  const peers = await oracle<{ k: string; nm: string }>(
    `SELECT person_key k, any_value(first_name || ' ' || last_name) nm FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${KEY}') AND person_key <> '${KEY}'
     GROUP BY 1 ORDER BY 1 LIMIT 2`,
  );
  const people = [{ type: 'person' as const, id: KEY, label: 'Aaron Smetana' }, ...peers.map((p) => ({ type: 'person' as const, id: p.k, label: p.nm }))];
  const a = await fresh(browser);
  // The case as one reader built it: by school, a factor and its amount, a note and a headline of their own.
  // Its people in the compare set the case is built from.
  await a.page.addInitScript(([key, set]) => {
    localStorage.setItem(`uwsal.pref.report.cfg.${key}`, JSON.stringify({
      configVersion: 2, cohort: 'school', factors: { supervision: { on: true, amount: 2500, note: 'Leads the on-call rota since March' } },
      headline: 'A headline of my own',
    }));
    localStorage.setItem('uwsal.tray.v1', set);
  }, [KEY, JSON.stringify(people.map((p, i) => ({ ...p, colorIdx: i })))] as const);
  await a.page.goto(`./reports?type=comparison&subject=${encodeURIComponent(KEY)}`);
  await expect(a.page.getByRole('radio', { name: /^The (tenure-adjusted )?median of same-title peers in / })).toBeChecked({ timeout: 60_000 });
  await expect(a.page).toHaveURL(/case=/);
  const link = await copyLink(a.page);
  expect(link).toContain('sel=');
  await a.ctx.close();

  const b = await fresh(browser);
  await b.page.goto(link);
  await expect(b.page.getByRole('textbox', { name: 'Pick the person the case is for' })).toHaveValue('Aaron Smetana', { timeout: 60_000 });
  await expect(b.page.getByRole('radio', { name: /^The (tenure-adjusted )?median of same-title peers in / })).toBeChecked();
  await expect(b.page.getByRole('switch', { name: 'Supervisory scope' })).toBeChecked();
  await expect(b.page.getByRole('textbox', { name: '+$ (optional)' }).first()).toHaveValue('$2,500');
  // Its people are the case's, all three; the reader's own compare set is left as it was.
  await expect.poll(() => b.page.locator('.setup-panel').getByRole('button', { name: /^Remove / }).count()).toBe(people.length - 1);
  for (const p of peers) await expect(b.page.locator('.setup-panel').getByRole('button', { name: new RegExp(`^Remove ${p.nm}$`, 'i') })).toBeVisible();
  expect(await b.page.evaluate(() => localStorage.getItem('uwsal.tray.v1') ?? '[]')).toBe('[]');
  // The words stayed behind.
  await expect(b.page.getByText('Leads the on-call rota since March')).toHaveCount(0);
  await expect(b.page.getByRole('textbox', { name: 'Headline (optional)' })).toHaveValue('');
  await b.ctx.close();
});
