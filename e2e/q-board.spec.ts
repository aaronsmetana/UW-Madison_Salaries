import { test, expect } from '@playwright/test';

/**
 * Tablet, speed and print (Q7, Q8, Q10, Q11). At 768px the raise case keeps its setup beside the brief, and Divisions puts two
 * tiles a row. The parquet is named for its content. On paper a long
 * card runs on over a page break while charts, figures and headings stay with what they belong to.
 */

const AARON = 'aaronsmetana|2014-10-15';

test.describe('at a tablet’s width', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the raise case keeps its setup beside the brief', async ({ page }) => {
    await page.goto(`./raise-case?type=comparison&subject=${encodeURIComponent(AARON)}`);
    await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('radio', { name: 'Setup' })).toHaveCount(0);
    const [setup, brief] = [(await page.locator('[data-own-scroll]').boundingBox())!, (await page.locator('.report-brief').boundingBox())!];
    expect(brief.x, 'the brief is not beside the setup').toBeGreaterThanOrEqual(setup.x + setup.width);
  });

  test('Divisions puts two tiles a row', async ({ page }) => {
    await page.goto('./divisions');
    await expect(page.locator('[data-figure="median-growth"]')).toBeVisible({ timeout: 60_000 });
    const tops = await page.locator('.kpi-scroll .stat-row > *').evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(tops.length).toBe(3);
    expect(tops[0], 'the first two are not a row').toBe(tops[1]);
    expect(tops[2], 'three in a row').toBeGreaterThan(tops[0]);
  });
});

test('the parquet is named for its content', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes('.parquet')) asked.push(new URL(r.url()).pathname); });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('.person-head')).toBeVisible({ timeout: 90_000 });
  expect(asked.length, 'no parquet was fetched').toBeGreaterThan(0);
  expect(asked.every((p) => /\/data\/salaries\.[0-9a-f]{12}\.parquet$/.test(p)), `${asked}`).toBe(true);
});

test('on paper a long card runs on, while charts, figures and headings stay whole', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=report`);
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 90_000 });
  await page.emulateMedia({ media: 'print' });
  const rules = await page.evaluate(() => {
    const css = (sel: string, prop: string) => { const e = document.querySelector(`.mantine-AppShell-main ${sel}`); return e ? getComputedStyle(e).getPropertyValue(prop) : null; };
    return {
      card: css('.mantine-Card-root', 'break-inside'),
      chart: css('.recharts-wrapper', 'break-inside'),
      figures: css('.stat-row', 'break-inside'),
      title: css('.card-title', 'break-after'),
    };
  });
  expect(rules).toEqual({ card: 'auto', chart: 'avoid', figures: 'avoid', title: 'avoid' });
});
