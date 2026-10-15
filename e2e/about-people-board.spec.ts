import { test, expect } from '@playwright/test';
import { oracle, latestSnapshot, PERSON_PAY, usd } from './oracle';

/**
 * About the data (AD5) and People (PE3). The back-to-top button stands above the compare tray. A person's card on
 * People says their pay and adds them to compare. (AD1 and AD2's index is gone: the page's tabs replaced it —
 * about-tabs.spec.)
 */

const AARON = 'aaronsmetana|2014-10-15';

test('the back-to-top button stands above the compare tray', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
    { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
  ]));
  await page.goto('./data?tab=snapshots');
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
