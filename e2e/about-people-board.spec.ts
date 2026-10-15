import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot, PERSON_PAY, usd } from './oracle';

/**
 * About the data (AD1, AD2, AD5) and People (PE3). On a wide screen the page's index is a column beside its
 * sections and stays in view; narrower, it is a bar as wide as what scrolls under it. The back-to-top button stands
 * above the compare tray. A person's card on People says their pay and adds them to compare.
 */

const AARON = 'aaronsmetana|2014-10-15';

test.describe('wide', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('the index is a column beside the sections, and stays in view', async ({ page }) => {
    await page.goto('./data');
    const nav = page.locator('.data-jumpnav');
    const main = page.locator('.data-main');
    await expect(page.locator('#snapshots table')).toBeVisible({ timeout: 60_000 });
    const [n, m] = [(await nav.boundingBox())!, (await main.boundingBox())!];
    expect(n.x, 'the index is not beside the sections').toBeGreaterThanOrEqual(m.x + m.width);
    await page.locator('#duplicates').scrollIntoViewIfNeeded();
    const after = (await nav.boundingBox())!;
    expect(after.y, 'the index scrolled away').toBeGreaterThanOrEqual(0);
    expect(after.y + after.height).toBeLessThanOrEqual(900);
    // A link in it lands its section under the app bar, not under the index.
    await nav.getByRole('link', { name: 'Ranges' }).click();
    await expect.poll(async () => Math.round((await page.locator('#salary-ranges').boundingBox())!.y), { timeout: 5_000 }).toBeGreaterThanOrEqual(60);
    expect((await page.locator('#salary-ranges').boundingBox())!.y).toBeLessThan(140);
  });
});

test.describe('narrower', () => {
  test.use({ viewport: { width: 1024, height: 800 } });
  test('the index is a bar as wide as what scrolls under it', async ({ page }) => {
    await page.goto('./data');
    await expect(page.locator('#snapshots table')).toBeVisible({ timeout: 60_000 });
    const [n, wide] = [(await page.locator('.data-jumpnav').boundingBox())!, (await page.locator('#snapshots').boundingBox())!];
    expect(Math.abs(n.width - wide.width), `the bar is ${n.width}px over a ${wide.width}px table`).toBeLessThan(2);
  });
});

test('the back-to-top button stands above the compare tray', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
    { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
  ]));
  await page.goto('./data');
  await expect(page.locator('#snapshots table')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.scrollTo(0, 3000));
  const up = page.locator('.back-to-top');
  await expect(up).toHaveAttribute('data-show', /.*/);
  const tray = page.getByRole('region', { name: 'Compare set' });
  await expect(tray).toBeVisible();
  await expect.poll(async () => {
    const [u, t] = [(await up.boundingBox())!, (await tray.boundingBox())!];
    return u.y + u.height <= t.y;
  }, { message: 'the button sits on the tray', timeout: 5_000 }).toBe(true);
});

test('a card on People says the person’s pay and adds them to compare', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.locator('.person-head')).toBeVisible({ timeout: 60_000 });
  await page.goto('./people');
  const card = page.locator('.people-recent .people-card-wrap').first();
  const snap = await latestSnapshot();
  const [{ pay }] = await oracle<{ pay: number }>(`SELECT ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}'`);
  await expect(card.locator('.people-card-pay')).toContainText(usd(pay), { timeout: 60_000 });
  await expect(card.locator('.people-card')).toHaveAttribute('href', new RegExp(encodeURIComponent(AARON).replace(/\|/g, '\\|') + '$'));
  await card.getByRole('button', { name: /Add Aaron Smetana to compare|Add to compare/ }).click();
  await expect(page.locator('.people-set .people-card-name')).toHaveText(['Aaron Smetana']);
});
