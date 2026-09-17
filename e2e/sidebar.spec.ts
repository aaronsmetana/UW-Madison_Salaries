import { test, expect, type Page } from '@playwright/test';

/**
 * The sidebar's first look (app/AppShell): on a visit's first load it is open, over the page's left edge —
 * the page beneath is laid out for the collapsed rail, so nothing on it moves — and two seconds on it
 * narrows into the rail. Not again that visit; not out from under a pointer resting on it; at once under
 * Reduce Motion; never on a phone, whose sidebar is a drawer.
 */

const nav = (page: Page) => page.locator('.mantine-AppShell-navbar');
const navWidth = async (page: Page) => Math.round((await nav(page).boundingBox())!.width);

test("a visit's first load opens the sidebar over the page, then tucks it into the rail — once", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(nav(page)).toHaveAttribute('data-peek', 'open');
  expect(await navWidth(page), 'the sidebar did not open').toBe(330);
  await expect(nav(page).getByRole('link', { name: 'Titles', exact: true })).toContainText('Titles');
  // Over the page, not beside it: the page is already where it will be with the rail.
  const panelAt = Math.round((await page.locator('.hero-dist').boundingBox())!.x);
  const main = page.locator('#main-content');
  const mainPad = await main.evaluate((el) => getComputedStyle(el).paddingLeft);

  // Narrowing, then the rail.
  await expect(nav(page)).toHaveAttribute('data-peek', 'closing', { timeout: 3000 });
  await expect(nav(page)).not.toHaveAttribute('data-peek', /./, { timeout: 2000 });
  expect(await navWidth(page), 'the sidebar did not tuck into the rail').toBe(64);
  expect(Math.round((await page.locator('.hero-dist').boundingBox())!.x), 'the page moved under the sidebar').toBe(panelAt);
  expect(await main.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(mainPad);
  // The rail's links still say where they go.
  for (const name of ['People', 'Titles', 'Divisions', 'Compare', 'Reports', 'Screening']) {
    await expect(nav(page).getByRole('link', { name, exact: true })).toHaveCount(1);
  }

  // Not again this visit.
  await page.reload();
  await expect(nav(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await nav(page).getAttribute('data-peek')).toBeNull();
  expect(await navWidth(page)).toBe(64);
});

test('a pointer resting on the sidebar keeps it open until it leaves', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(nav(page)).toHaveAttribute('data-peek', 'open');
  await page.mouse.move(120, 200);
  await page.waitForTimeout(3000);
  await expect(nav(page), 'the sidebar closed from under the pointer').toHaveAttribute('data-peek', 'open');
  await page.mouse.move(900, 500);
  await expect(nav(page)).not.toHaveAttribute('data-peek', /./, { timeout: 2000 });
  expect(await navWidth(page)).toBe(64);
});

test('its collapse button tucks it in at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(nav(page)).toHaveAttribute('data-peek', 'open');
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(nav(page)).not.toHaveAttribute('data-peek', 'open', { timeout: 300 });
  await expect(nav(page)).not.toHaveAttribute('data-peek', /./, { timeout: 1500 });
  expect(await navWidth(page)).toBe(64);
  // And it expands, beside the page, on request as before.
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect.poll(() => navWidth(page)).toBe(330);
});

test('under Reduce Motion it goes straight to the rail', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Every state the sidebar passes through, recorded as it happens.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { peekSeen: string[] }).peekSeen = seen;
    new MutationObserver(() => {
      const el = document.querySelector('.mantine-AppShell-navbar');
      const v = el?.getAttribute('data-peek') ?? 'none';
      if (el && seen[seen.length - 1] !== v) seen.push(v);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-peek'] });
  });
  await page.goto('./');
  await expect(nav(page)).toHaveAttribute('data-peek', 'open');
  await expect(nav(page)).not.toHaveAttribute('data-peek', /./, { timeout: 3000 });
  expect(await navWidth(page)).toBe(64);
  // No narrowing stage: straight from open to the rail.
  expect(await page.evaluate(() => (window as unknown as { peekSeen: string[] }).peekSeen)).toEqual(['open', 'none']);
  await ctx.close();
});

test('on a phone there is no first look: the sidebar stays a closed drawer', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await nav(page).getAttribute('data-peek')).toBeNull();
  const box = await nav(page).boundingBox();
  expect(!box || box.x + box.width <= 1, 'the drawer is open').toBe(true);
  await ctx.close();
});
