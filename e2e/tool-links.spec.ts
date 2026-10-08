import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot } from './oracle';

/**
 * A page about one thing links to the tools that take it (G10): a person to their report and a raise
 * case, a title to its raises, a division to its raises and its screening — one line of links under the
 * page's name, the same everywhere. Each lands on the tool with the subject already in it.
 */

const KEY = 'aaronsmetana|2014-10-15';
const links = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Take this further' });

test('a person links to their report and to a raise case with them as its subject', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(KEY)}`);
  const name = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
  await expect(links(page).getByRole('link')).toHaveText(['Report →', 'Raise case →']);
  await links(page).getByRole('link', { name: 'Report →' }).click();
  await expect(page).toHaveURL(new RegExp(`/reports\\?person=${encodeURIComponent(KEY).replace(/[|]/g, '\\$&')}`));
  await expect(page).toHaveTitle(new RegExp(`Report — ${name}`));
  await page.goBack();
  await links(page).getByRole('link', { name: 'Raise case →' }).click();
  await expect(page).toHaveURL(/\/reports\?.*type=comparison/);
  // The case is for them, as its subject; the compare set is left as it was.
  expect(await page.evaluate(() => localStorage.getItem('uwsal.tray.v1') ?? '[]')).toBe('[]');
  await expect(page.getByRole('textbox', { name: 'Pick the person the case is for' })).toHaveValue(name);
  await expect(page.getByText(new RegExp(`^Prepared for ${name}`))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`subject=${encodeURIComponent(KEY).replace(/[|]/g, '\\$&')}`));
});

test('a title links to its raises', async ({ page }) => {
  const snap = await latestSnapshot();
  const [t] = await oracle<{ code: string; title: string }>(
    `SELECT job_code code, any_value(title) title FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 AND title = 'Professor' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
  );
  await page.goto(`./paycheck?code=${t.code}`);
  await links(page).getByRole('link', { name: 'Raises in this title →' }).click();
  await expect(page).toHaveURL(new RegExp(`/raises\\?title=${t.code}`));
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(new RegExp(t.title));
});

test('a division links to its raises and to its screening, which runs', async ({ page }) => {
  const school = 'School of Education';
  await page.goto(`./school/${encodeURIComponent(school)}`);
  await expect(links(page).getByRole('link')).toHaveText(['Raises in this division →', 'Screen this division →']);
  await links(page).getByRole('link', { name: 'Raises in this division →' }).click();
  await expect(page).toHaveURL(/\/raises\?sch=School\+of\+Education|\/raises\?sch=School%20of%20Education/);
  await expect(page.getByRole('textbox', { name: 'School / division' })).toHaveValue(school);
  await page.goBack();
  await links(page).getByRole('link', { name: 'Screen this division →' }).click();
  await expect(page).toHaveURL(/\/screening\?sch=School/);
  await expect(page.getByRole('textbox', { name: 'School / division' })).toHaveValue(school);
  // Run, not a start screen: the screen's table of people is up.
  await expect(page.getByRole('table').first()).toBeVisible({ timeout: 60_000 });
});
