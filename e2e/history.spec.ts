import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { oracle } from './oracle';

/**
 * One history table (G8). The person page's History tab and the one-person report draw the same title & salary
 * history, so the printed report cannot tell a reader something the page does not: not its rows, not a change,
 * and not under another pay measure (the report's own once showed full-time rates under "Actual pay"). On paper
 * it fits a Letter page, where its scroll box cannot scroll: the report's own ran 680–832px wide against 661, and
 * for someone with several appointments the pay, the change and the FTE were off the edge of the sheet.
 */

const AARON = 'aaronsmetana|2014-10-15';
const HALZEN = 'francishalzen|1975-07-01';

/** Four histories that each strain the table a different way. */
async function people(): Promise<[string, string][]> {
  // The most appointments at once anyone holds, and someone who holds two for years.
  const [most] = await oracle<{ k: string }>(
    `SELECT person_key k FROM $SAL WHERE salary > 0 AND snapshot_id NOT LIKE '%-pre' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`,
  );
  const [two] = await oracle<{ k: string }>(
    `SELECT person_key k FROM (SELECT person_key, snapshot_id, count(*) n FROM $SAL WHERE salary > 0 GROUP BY 1, 2)
     GROUP BY 1 HAVING count(*) >= 8 AND min(n) >= 2 AND max(n) = 2 ORDER BY 1 LIMIT 1`,
  );
  return [['one appointment and a promotion', AARON], ['across the 9-month reporting change', HALZEN],
    ['two appointments for years', two.k], ['the most appointments at once', most.k]];
}

/** Every row of the history, as read; once the raises' comparisons, which load last, are in. */
async function rowsOf(page: Page, scope = page.locator('body')) {
  const table = scope.locator('table.appt-history');
  await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(table.locator('[data-raise-compare]').first()).toBeAttached({ timeout: 60_000 });
  const head = (await table.locator('thead th').allInnerTexts()).map((t) => t.trim());
  const rows = (await table.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  return { head, rows };
}

test('the person page’s History and its Report tab draw the same history, whatever measure the report is set to', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [why, key] of await people()) {
    await page.goto(`./person/${encodeURIComponent(key)}?tab=history`);
    const onPage = await rowsOf(page);
    for (const metric of ['', '&metric=full']) {
      await page.goto(`./person/${encodeURIComponent(key)}?tab=report${metric}`);
      if (metric) await expect(page.getByRole('radio', { name: 'Full-time rate' })).toBeChecked({ timeout: 60_000 });
      const inReport = await rowsOf(page, page.locator('.print-area'));
      expect(inReport.head, `${why}${metric}: the columns`).toEqual(onPage.head);
      expect(inReport.rows, `${why}${metric}: the rows`).toEqual(onPage.rows);
    }
  }
});

test('on a Letter page the history fits the sheet, its job code, department, rate and basis under the cells beside them', async ({ browser }) => {
  test.setTimeout(240_000);
  // 8.5in less print.css's 0.6in margins: 7.3in, 701px.
  const ctx = await browser.newContext({ viewport: { width: 701, height: 1000 } });
  const page = await ctx.newPage();
  for (const [why, key] of await people()) {
    for (const path of [`./person/${encodeURIComponent(key)}?tab=report`, `./person/${encodeURIComponent(key)}?tab=history`]) {
        const scope = page.locator(path.endsWith('report') ? '.print-area' : 'body');
      await page.goto(path);
      await rowsOf(page, scope);
      await page.emulateMedia({ media: 'print' });
      const fit = await scope.locator('table.appt-history').evaluate((t) => {
        const card = t.closest('.mantine-Card-root')!.getBoundingClientRect();
        const cells = [...t.querySelectorAll('th, td')].filter((c) => getComputedStyle(c).display !== 'none');
        return {
          over: Math.max(...cells.map((c) => c.getBoundingClientRect().right)) - card.right,
          page: Math.round(document.documentElement.getBoundingClientRect().width),
          folded: [...t.querySelectorAll('[data-print-fold]')].filter((c) => getComputedStyle(c).display !== 'none').length,
          under: [...t.querySelectorAll('tbody td .print-under')].filter((c) => getComputedStyle(c).display !== 'none').length,
        };
      });
      expect(fit.over, `${why} at ${path}: the history runs off the sheet`).toBeLessThanOrEqual(0.5);
      expect(fit.folded, `${why}: a folded column still prints`).toBe(0);
      expect(fit.under, `${why}: nothing folded under the cells`).toBeGreaterThan(0);
      await page.emulateMedia({ media: 'screen' });
    }
  }
  await ctx.close();
});

test('on a screen too narrow for its columns the history folds as on paper, never scrolling sideways', async ({ browser }) => {
  test.setTimeout(360_000);
  // A tablet and a narrow window fold; a wide window keeps every column. A phone folds its own way (responsive.spec).
  for (const [width, folds] of [[1024, true], [820, true], [1440, false]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    for (const [why, key] of await people()) {
      for (const path of [`./person/${encodeURIComponent(key)}?tab=report`, `./person/${encodeURIComponent(key)}?tab=history`]) {
        const scope = page.locator(path.endsWith('report') ? '.print-area' : 'body');
        await page.goto(path);
        await rowsOf(page, scope);
        const fit = await scope.locator('table.appt-history').evaluate((t) => {
          const vp = t.closest('.mantine-ScrollArea-viewport') as HTMLElement | null;
          const shown = (sel: string) => [...t.querySelectorAll(sel)].filter((c) => getComputedStyle(c).display !== 'none').length;
          return { sideways: vp ? vp.scrollWidth - vp.clientWidth : 0, folded: shown('[data-print-fold]'), under: shown('tbody td .print-under') };
        });
        const at = `${why} at ${width}px, ${path}`;
        expect(fit.sideways, `${at}: the history scrolls sideways`).toBeLessThanOrEqual(1);
        if (folds) {
          expect(fit.folded, `${at}: a folded column still shows`).toBe(0);
          expect(fit.under, `${at}: nothing folded under the cells`).toBeGreaterThan(0);
        } else {
          expect(fit.folded, `${at}: a wide window lost its columns`).toBeGreaterThan(0);
          expect(fit.under, `${at}: a wide window folded`).toBe(0);
        }
      }
    }
    await ctx.close();
  }
});

test('the history has its CSV on the person page too, stating each change as its cell does', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(HALZEN)}?tab=history`);
  const { rows } = await rowsOf(page);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV of the title and salary history' }).click()]);
  expect(file.suggestedFilename()).toBe('Francis Halzen-history.csv');
  const [head, ...lines] = readFileSync((await file.path())!, 'utf8').trim().split(/\r?\n/);
  expect(head.split(',')).toEqual(['snapshot', 'title', 'job_code', 'school', 'department', 'rate', 'actual_pay', 'change', 'change_note', 'fte', 'basis']);
  expect(lines.length).toBe(rows.length);
  // Across the reporting change, like for like and saying so, as the cell does.
  const sep = lines.find((l) => l.startsWith('Sep 2025,'))!;
  const cell = rows.find((r) => r.startsWith('Sep 2025'))!;
  expect(cell).toContain('+3.0%');
  expect(sep).toContain('+3.0%');
  expect(sep).toContain('9-month pay reported differently · ×11/9 taken out');
});
