import { test, expect, type Page } from '@playwright/test';

/**
 * The sidebar's first look (app/AppShell): on a visit's first load it is open, over the page's left edge —
 * the page beneath is laid out for the collapsed rail, so nothing on it moves — and a second on it narrows
 * into the rail. Not again that visit; not out from under a pointer resting on it; at once under Reduce
 * Motion; never on a phone, whose menu is a sheet over the page (the tests at the end).
 *
 * A second is shorter than a page takes to load on a busy machine, so these do not look at the sidebar
 * after `goto` and hope it is still open: every state it passes through is recorded as it happens.
 */

const nav = (page: Page) => page.locator('.mantine-AppShell-navbar');
const navWidth = async (page: Page) => Math.round((await nav(page).boundingBox())!.width);

interface PeekState { v: string; t: number; w: number; named: boolean; panelX: number | null; pad: string | null }
/** Every state the sidebar passes through, as it happens: when, how wide, whether its links are named, and
 *  where the page beside it is. */
async function recordPeek(page: Page) {
  await page.addInitScript(() => {
    const seen: PeekState[] = [];
    (window as unknown as { peekSeen: PeekState[] }).peekSeen = seen;
    new MutationObserver(() => {
      const el = document.querySelector('.mantine-AppShell-navbar');
      if (!el) return;
      const v = el.getAttribute('data-peek') ?? 'none';
      if (seen.length && seen[seen.length - 1].v === v) return;
      const panel = document.querySelector('.hero-dist');
      const main = document.querySelector('#main-content');
      seen.push({
        v, t: performance.now(), w: Math.round(el.getBoundingClientRect().width),
        named: [...el.querySelectorAll('.mantine-NavLink-label')].some((l) => l.textContent === 'Titles'),
        panelX: panel ? Math.round(panel.getBoundingClientRect().x) : null,
        pad: main ? getComputedStyle(main).paddingLeft : null,
      });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-peek'] });
  });
}
const peekSeen = (page: Page) => page.evaluate(() => (window as unknown as { peekSeen: PeekState[] }).peekSeen);
/** Until the sidebar has come to rest in the rail. */
const tucked = (page: Page) => expect.poll(async () => (await peekSeen(page)).at(-1)?.v, { timeout: 6000 }).toBe('none');

test("a visit's first load opens the sidebar over the page, then tucks it into the rail after a second — once", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await recordPeek(page);
  await page.goto('./');
  await tucked(page);
  const [open, closing, rail] = await peekSeen(page);
  expect([open?.v, closing?.v, rail?.v]).toEqual(['open', 'closing', 'none']);
  expect(open.w, 'the sidebar did not open').toBe(330);
  expect(open.named, 'the open sidebar does not name its links').toBe(true);
  // A second open: long enough to see what is there, not so long it stands over the graph. It was two.
  const held = closing.t - open.t;
  expect(held, `it tucked in after ${Math.round(held)}ms`).toBeGreaterThanOrEqual(950);
  expect(held, `it held open for ${Math.round(held)}ms`).toBeLessThan(1750);
  // Over the page, not beside it: the page is already where it will be with the rail.
  expect(await navWidth(page), 'the sidebar did not tuck into the rail').toBe(64);
  const main = page.locator('#main-content');
  const settled = { x: Math.round((await page.locator('.hero-dist').boundingBox())!.x), pad: await main.evaluate((el) => getComputedStyle(el).paddingLeft) };
  for (const s of [open, closing]) {
    if (s.panelX != null) expect(s.panelX, `the page moved under the sidebar (${s.v})`).toBe(settled.x);
    if (s.pad != null) expect(s.pad).toBe(settled.pad);
  }
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
  await recordPeek(page);
  // Resting there as the page comes up, rather than arriving some unknown part of the second in.
  await page.mouse.move(120, 200);
  await page.goto('./');
  await expect.poll(async () => (await peekSeen(page))[0]?.v).toBe('open');
  await page.waitForTimeout(2500);
  expect((await peekSeen(page)).map((s) => s.v), 'the sidebar closed from under the pointer').toEqual(['open']);
  await page.mouse.move(900, 500);
  await tucked(page);
  expect(await navWidth(page)).toBe(64);
});

test('its collapse button tucks it in at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await recordPeek(page);
  // The pointer on the sidebar holds it open for as long as it takes to reach the button.
  await page.mouse.move(120, 200);
  await page.goto('./');
  await expect.poll(async () => (await peekSeen(page))[0]?.v).toBe('open');
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
  await recordPeek(page);
  await page.goto('./');
  await tucked(page);
  expect(await navWidth(page)).toBe(64);
  // No narrowing stage: straight from open to the rail.
  expect((await peekSeen(page)).map((s) => s.v)).toEqual(['open', 'none']);
  await ctx.close();
});

test('on a phone there is no first look: the sidebar stays off-screen', async ({ browser }) => {
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

// The phone's menu. It used to be the sidebar itself, stretched to the screen's width: it followed the desktop
// rail's collapsed state, so it opened on a column of bare icons, and a tap on one navigated underneath it and
// left it open over the page it had gone to. Now it is a sheet over the dimmed page — a dialog of its own.
const phone = (browser: import('@playwright/test').Browser, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}) =>
  browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: opts.reducedMotion ?? 'no-preference' });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Menu' });
const burger = (page: Page) => page.getByRole('button', { name: 'Toggle navigation' });
const NAMES = ['People', 'Titles', 'Divisions', 'Compare', 'Reports', 'Screening', 'About the data'];

test('on a phone the menu is a sheet over the dimmed page, and names every link', async ({ browser }) => {
  const ctx = await phone(browser);
  const page = await ctx.newPage();
  await page.goto('./data');
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');
  // A sheet, not the screen: the page is still there beside it, under a dimming layer.
  await expect.poll(async () => Math.round((await sheet(page).boundingBox())!.x)).toBe(0);
  const box = (await sheet(page).boundingBox())!;
  expect(Math.round(box.width), 'the sheet is not a sheet').toBe(280);
  const dim = await page.locator('.mantine-Drawer-overlay').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    return { w: r.width, h: r.height, alpha: Number(/rgba?\([^)]*?,\s*([\d.]+)\)$/.exec(bg)?.[1] ?? (bg.startsWith('rgb(') ? 1 : 0)) };
  });
  expect(dim.w, 'nothing dims the page beside the sheet').toBeGreaterThanOrEqual(375);
  expect(dim.alpha, 'the layer over the page does not dim it').toBeGreaterThan(0);
  // Every link says where it goes in words a reader can see — not only to a screen reader.
  for (const name of NAMES) {
    const link = sheet(page).getByRole('link', { name, exact: true });
    await expect(link, `"${name}" is not named on screen`).toHaveText(name);
    expect(await link.getAttribute('aria-label'), `"${name}" is named for a screen reader only`).toBeNull();
    const label = (await link.locator('.mantine-NavLink-label').boundingBox())!;
    expect(label.width, `"${name}"'s label is not drawn`).toBeGreaterThan(20);
  }
  // The keyboard is inside it, and walking it raises none of the rail's tooltips.
  expect(await sheet(page).evaluate((d) => d.contains(document.activeElement)), 'focus did not move into the sheet').toBe(true);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  expect(await sheet(page).evaluate((d) => d.contains(document.activeElement)), 'focus left the open sheet').toBe(true);
  await expect(page.locator('.mantine-Tooltip-tooltip')).toHaveCount(0);
  // Nothing of the sidebar is left to reach behind it: the phone's navbar holds no links.
  await expect(nav(page).locator('a')).toHaveCount(0);
  await ctx.close();
});

test('on a phone the sheet closes on a tap beside it, on Escape, and on any link — the page it is on included', async ({ browser }) => {
  const ctx = await phone(browser);
  const page = await ctx.newPage();
  await page.goto('./data');
  // Beside it, on the dimmed page.
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.touchscreen.tap(340, 400);
  await expect(sheet(page)).toHaveCount(0);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
  // Escape, and the keyboard goes back to where it came from.
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(burger(page)).toBeFocused();
  // A link: the page it names, with the sheet out of the way.
  await burger(page).tap();
  await sheet(page).getByRole('link', { name: 'Titles', exact: true }).tap();
  await expect(page).toHaveURL(/\/paycheck$/);
  await expect(sheet(page)).toHaveCount(0);
  // The page it is already on, where the address does not change and nothing else would close it.
  await burger(page).tap();
  await sheet(page).getByRole('link', { name: 'Titles', exact: true }).tap();
  await expect(sheet(page)).toHaveCount(0);
  await ctx.close();
});

test('the sheet goes when the window widens to a sidebar', async ({ browser }) => {
  const ctx = await phone(browser);
  const page = await ctx.newPage();
  await page.goto('./data');
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(sheet(page)).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Titles', exact: true })).toHaveCount(1);
  // Closed, not just out of sight: back at a phone's width it does not open again by itself.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  await expect(sheet(page)).toHaveCount(0);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
  await ctx.close();
});

test('under Reduce Motion the sheet is simply there, never part-way in', async ({ browser }) => {
  for (const motion of ['no-preference', 'reduce'] as const) {
    const ctx = await phone(browser, { reducedMotion: motion });
    const page = await ctx.newPage();
    // Where the sheet's left edge is, every frame from the moment it exists.
    await page.addInitScript(() => {
      const seen: number[] = [];
      (window as unknown as { sheetSeen: number[] }).sheetSeen = seen;
      const tick = () => {
        const d = document.querySelector('[role="dialog"][aria-label="Menu"]');
        if (d) seen.push(Math.round(d.getBoundingClientRect().x));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto('./data');
    await burger(page).tap();
    await expect(sheet(page)).toBeVisible();
    await page.waitForTimeout(400);
    const seen = await page.evaluate(() => (window as unknown as { sheetSeen: number[] }).sheetSeen);
    const partWay = seen.filter((x) => x < 0);
    if (motion === 'reduce') expect(partWay, 'under Reduce Motion the sheet slid in').toEqual([]);
    // And with motion it does slide, or the check above proves nothing.
    else expect(partWay.length, 'the sheet does not slide in even with motion, so Reduce Motion is not what stops it').toBeGreaterThan(0);
    await ctx.close();
  }
});
