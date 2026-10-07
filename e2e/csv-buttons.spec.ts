import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { oracle, latestSnapshot } from './oracle';

/**
 * A CSV sits beside the table or chart it is the data of (G4): no page-level download standing for one of
 * several tables — Reports' header had one, for whichever report was open — and every CSV button the same
 * size. Downloaded, each holds the rows its table shows.
 */

const KEY = 'aaronsmetana|2014-10-15';

/** Press a CSV button and read the file: its header and its rows. */
async function download(page: Page, name: string | RegExp) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
  const text = readFileSync((await file.path())!, 'utf8').trim();
  const [head, ...rows] = text.split(/\r?\n/);
  return { name: file.suggestedFilename(), head: head.split(','), rows };
}

test('Reports has no page-level CSV: the one-person report’s history has its own, of the rows it shows', async ({ page }) => {
  await page.goto(`./reports?person=${encodeURIComponent(KEY)}&pname=${encodeURIComponent('Aaron Smetana')}`);
  const card = page.locator('.mantine-Card-root', { has: page.getByText('Title & salary history', { exact: true }) });
  await expect(card.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  const shown = await card.locator('table tbody tr').count();
  const csv = await download(page, 'CSV of the title and salary history');
  expect(csv.name).toBe('Aaron Smetana-history.csv');
  expect(csv.head).toEqual(['snapshot', 'title', 'job_code', 'school', 'department', 'rate', 'actual_pay', 'change', 'change_note', 'fte', 'basis']);
  expect(csv.rows.length).toBe(shown);
});

test('a raise case’s peer comparison and market standing each have their CSV, and the header none', async ({ page }) => {
  test.setTimeout(120_000);
  const snap = await latestSnapshot();
  const peers = await oracle<{ k: string; nm: string }>(
    `SELECT person_key k, any_value(first_name || ' ' || last_name) nm FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${KEY}') AND person_key <> '${KEY}'
     GROUP BY 1 ORDER BY 1 LIMIT 2`,
  );
  const [{ n }] = await oracle<{ n: number }>(
    `SELECT count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${KEY}')`,
  );
  const people = [{ type: 'person', id: KEY, label: 'Aaron Smetana', colorIdx: 0 }, ...peers.map((p, i) => ({ type: 'person', id: p.k, label: p.nm, colorIdx: i + 1 }))];
  await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify(people));
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(KEY)}`);
  await expect(page.getByRole('button', { name: 'CSV of the peer comparison' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  // The market standing's pools count the others the subject is placed among, and say so (G6).
  await expect(page.getByRole('columnheader', { name: 'Others', exact: true })).toBeVisible();
  const cmp = await download(page, 'CSV of the peer comparison');
  expect(cmp.rows.length).toBe(people.length);
  expect(cmp.rows[0]).toContain('subject');
  const pool = await download(page, 'CSV of everyone with this title');
  expect(pool.rows.length).toBeGreaterThanOrEqual(n - 1);
});

test('every CSV button in the app is the same size', async ({ page }) => {
  test.setTimeout(180_000);
  const heights = new Map<string, number[]>();
  for (const path of ['./explore?tab=schools', './explore?tab=titles', './explore?tab=earners', './explore?tab=changes',
    `./school/${encodeURIComponent('School of Education')}?tab=departments`, './raises', `./screening?sch=${encodeURIComponent('School of Education')}&run=1`]) {
    await page.goto(path);
    const buttons = page.getByRole('button', { name: /^CSV/ });
    await expect(buttons.first()).toBeVisible({ timeout: 60_000 });
    const hs = await buttons.evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetParent).map((b) => Math.round(b.getBoundingClientRect().height)));
    heights.set(path, hs);
  }
  const all = [...heights.values()].flat();
  expect(all.length, 'no CSV buttons found').toBeGreaterThan(6);
  expect(new Set(all), JSON.stringify(Object.fromEntries(heights))).toEqual(new Set([28]));
});
