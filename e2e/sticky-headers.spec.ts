import { test, expect, type Page } from '@playwright/test';

/**
 * A long table keeps its column headers in view (G26). On Divisions' Schools after "Show all", Divisions'
 * Titles and a title's people, the headers scrolled off with the first rows, leaving a thousand rows of
 * unnamed figures. Read at desktop width, scrolled far into each table: its header row sits just under the
 * app's header, in front of the rows.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const TABLES: [string, string, string][] = [
  ["Divisions' Schools", './divisions?tab=schools', 'Sort by Median'],
  ["Divisions' Titles", './divisions?tab=titles', 'Sort by Median'],
  ["a title's people", './titles?code=FA020', 'Sort by Full-time rate'],
];

async function headerUnderChrome(page: Page, sortName: string) {
  const table = page.locator('table', { has: page.getByRole('button', { name: sortName }) }).first();
  await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const all = page.getByRole('button', { name: /^Show all/ }).first();
  if (await all.isVisible()) await all.click();
  const rows = table.locator('tbody tr');
  await expect.poll(() => rows.count()).toBeGreaterThan(25);
  // Far into the table: its 25th row at the top of the window.
  await rows.nth(24).evaluate((r) => window.scrollTo(0, window.scrollY + r.getBoundingClientRect().top - 200));
  await page.waitForTimeout(300);
  return page.evaluate((name) => {
    const t = [...document.querySelectorAll('table')].find((x) => x.querySelector(`[aria-label="${name}"]`))!;
    const head = t.querySelector('thead')!.getBoundingClientRect();
    const chrome = document.querySelector('.mantine-AppShell-header')!.getBoundingClientRect();
    const first = t.querySelector('tbody tr')!.getBoundingClientRect();
    // What is painted at the middle of the header row: a header cell, not a row under it.
    const hit = document.elementFromPoint(head.left + head.width / 2, head.top + head.height / 2);
    return { top: head.top, chrome: chrome.bottom, firstRow: first.top, onTop: !!hit?.closest('thead') };
  }, sortName);
}

for (const [where, path, sortName] of TABLES) {
  test(`the column headers stay in view far into the table: ${where}`, async ({ page }) => {
    await page.goto(path);
    const m = await headerUnderChrome(page, sortName);
    expect(m.firstRow, 'the table was not scrolled past its first row').toBeLessThan(0);
    expect(Math.abs(m.top - m.chrome), `the header row sits at ${Math.round(m.top)}px, the app header ends at ${Math.round(m.chrome)}px`).toBeLessThanOrEqual(1);
    expect(m.onTop, 'the rows paint over the header').toBe(true);
  });
}

test("on a phone, where the table scrolls sideways in its card, its head stays above its first row", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./divisions?tab=schools');
  const row = page.locator('.school-row').first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const [head, first] = await Promise.all([page.locator('table:has(.school-row) thead').boundingBox(), row.boundingBox()]);
  expect(head!.y + head!.height, 'the head sits over the first row').toBeLessThanOrEqual(first!.y + 0.5);
  // And the first row's button takes a tap.
  await row.locator('.peer-add').click();
  await expect(row.locator('.peer-add')).toHaveAttribute('aria-pressed', 'true');
});
