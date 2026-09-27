import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * Offline, and not. The banner said "Offline — showing cached data" for good on a browser whose
 * `navigator.onLine` read false while every page loaded; and the service worker served a returning visitor
 * the previous deploy's data (stale-while-revalidate), so a new release read as the old one until a
 * second visit. The banner now needs the site to be unreachable, and data comes from the network first.
 */

const summary = JSON.parse(readFileSync(new URL('../public/data/summary.json', import.meta.url), 'utf8'));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const latestMonth = (() => { const d: string = summary.snapshots.at(-1).date; return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; })();
const banner = (page: Page) => page.getByText('Offline — showing cached data');

test('a browser that says offline while the site answers shows no offline banner', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true });
  });
  await page.goto('./');
  await expect(page.locator('.home-news')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => navigator.onLine), 'the premise: the browser says offline').toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(1000);
  await expect(banner(page)).toHaveCount(0);
});

test('when the site is really unreachable the banner says so, and goes when it is back', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.locator('.home-news')).toBeVisible({ timeout: 60_000 });
  await expect(banner(page)).toHaveCount(0);
  await context.setOffline(true);
  await expect(banner(page)).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
  await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a returning visit shows this deploy’s data, not what the worker cached from the last', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Controlled, and the data cached, as for any visitor who has been here before.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('.home-news')).toBeVisible({ timeout: 60_000 });
    const cached = () => page.evaluate(async () => !!(await (await caches.open('data-cache')).match(new URL('data/summary.json', location.href).href)));
    await expect.poll(cached, { timeout: 30_000 }).toBe(true);
    // What the cache holds stands in for the previous deploy's summary.
    await page.evaluate(async (s) => {
      const old = { ...s, snapshots: s.snapshots.slice(0, -1), latest: { ...s.latest, id: '1999-03', label: 'Mar 1999', median: 1 } };
      old.snapshots.push({ ...s.snapshots.at(-1), id: '1999-03', label: 'Mar 1999', date: '1999-03-01', median: 1 });
      await (await caches.open('data-cache')).put(new URL('data/summary.json', location.href).href, new Response(JSON.stringify(old), { headers: { 'content-type': 'application/json' } }));
    }, summary);
    await page.reload();
    await expect(page.locator('.home-news')).toContainText(`${latestMonth} data`, { timeout: 60_000 });
    await expect(page.locator('.home-news')).not.toContainText('1999');
  });
});
