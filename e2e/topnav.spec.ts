import { test, expect, type Page } from '@playwright/test';

/**
 * The top of every page (app/AppShell, app/PageTop) and its foot (app/Footer), as the person-page redesign
 * drew them.
 *
 * The bar holds the name, the eight destinations, each named, and the theme. It replaced a rail of bare icons
 * down every page's left edge, whose names were a hover or an "Expand" away. From 1200px a destination is its
 * icon and its name, from 992px its name alone, and below that the destinations are a sheet behind a burger.
 *
 * Under the bar, every page's own top row: an entity page's trail at left, the release at right. And at the
 * foot, the footer as the page's last thing, where it covers nothing; it was a fixed band over the bottom
 * 40px of every desktop window.
 */

const AARON = 'aaronsmetana|2014-10-15';
const SMPH = 'School of Medicine and Public Health';
const NAMES = ['Home', 'People', 'Titles', 'Divisions', 'Compare', 'Raises', 'Reports', 'Screening'];
/** CI's Linux runner draws text a few percent wider than a Mac (brand.spec's 4%): the bar must fit with that. */
const widerText = (page: Page) => page.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = 'body { letter-spacing: 0.035em }';
    document.head.append(s);
  });
});

async function measureBar(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('.mantine-AppShell-header > .app-bar')!.getBoundingClientRect();
    const links = [...document.querySelectorAll('.app-nav-link')].map((a) => {
      const r = a.getBoundingClientRect();
      const icon = a.querySelector('svg');
      return {
        name: a.textContent!.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        icon: !!icon && icon.getBoundingClientRect().width > 0, current: a.getAttribute('aria-current'),
      };
    });
    const toggle = document.querySelector('.mantine-AppShell-header [aria-label^="Switch theme"]')!.getBoundingClientRect();
    const name = document.querySelector('.app-name')!.getBoundingClientRect();
    return { top: header.top, bottom: header.bottom, links, toggle: { left: toggle.left, right: toggle.right }, name: { h: name.height, right: name.right } };
  });
}

test('the bar names all eight destinations on one row, icons from 1200px, and fits with CI-wide text', async ({ page }) => {
  await widerText(page);
  for (const [width, icons] of [[1440, true], [1280, true], [1200, true], [1199, false], [1024, false], [992, false]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    await expect(page.locator('.app-nav-link'), `${width}px`).toHaveCount(8, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Toggle navigation' }), `${width}px: a burger beside the named links`).toBeHidden();
    const g = await measureBar(page);
    expect(g.links.map((l) => l.name), `${width}px`).toEqual(NAMES);
    expect(g.links.filter((l) => l.icon).length, `${width}px: icons`).toBe(icons ? 8 : 0);
    expect(new Set(g.links.map((l) => Math.round(l.top))).size, `${width}px: the destinations wrap`).toBe(1);
    for (const l of g.links) {
      expect(l.top, `${width}px: ${l.name} spills above the bar`).toBeGreaterThanOrEqual(g.top);
      expect(l.bottom, `${width}px: ${l.name} spills below the bar`).toBeLessThanOrEqual(g.bottom);
    }
    expect(g.links[0].left, `${width}px: the destinations run into the name`).toBeGreaterThan(g.name.right);
    expect(g.toggle.left - g.links[7].right, `${width}px: the destinations run into the theme switch`).toBeGreaterThanOrEqual(16);
    expect(g.toggle.right, `${width}px: the theme switch is off the screen`).toBeLessThanOrEqual(width);
    expect(g.name.h, `${width}px: the name broke onto a second line`).toBeLessThan(30);
  }
});

test('the bar marks the place the page belongs to: a person is People, a division Divisions, a title Titles', async ({ page }) => {
  for (const [route, current] of [
    ['./', 'Home'],
    ['./people', 'People'],
    [`./person/${encodeURIComponent(AARON)}`, 'People'],
    ['./paycheck?code=IT040', 'Titles'],
    ['./explore', 'Divisions'],
    [`./school/${encodeURIComponent(SMPH)}`, 'Divisions'],
    ['./raises', 'Raises'],
    ['./data', null],
  ] as const) {
    await page.goto(route);
    await expect(page.locator('.app-nav-link'), route).toHaveCount(8, { timeout: 60_000 });
    const marked = await page.locator('.app-nav-link[aria-current="page"]').allTextContents();
    expect(marked.map((t) => t.trim()), route).toEqual(current ? [current] : []);
  }
});

test('the trail says where an entity page sits, and its steps lead there', async ({ page }) => {
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aaron Smetana', { timeout: 60_000 });
  await expect(trail.locator('li')).toHaveText(['People', 'System Engineer IV', 'Aaron Smetana']);
  await expect(trail.locator('[aria-current="page"]')).toHaveText('Aaron Smetana');
  await expect(trail.getByRole('link', { name: 'People' })).toHaveAttribute('href', /\/UW-Madison_Salaries\/people$/);
  await trail.getByRole('link', { name: 'System Engineer IV' }).click();
  await expect(page).toHaveURL(/\/paycheck\?code=IT040$/);
  await expect(trail.locator('li')).toHaveText(['Titles', 'System Engineer IV'], { timeout: 60_000 });
  await page.goto(`./school/${encodeURIComponent(SMPH)}`);
  await expect(trail.locator('li')).toHaveText(['Divisions', SMPH], { timeout: 60_000 });
  // A top-level page has no trail, and every page says which release it holds.
  for (const route of ['./explore', './raises', './']) {
    await page.goto(route);
    await expect(page.locator('.page-top .release-tag'), route).toBeVisible({ timeout: 60_000 });
    await expect(trail, route).toHaveCount(0);
  }
});

test('on a phone the trail and the release share the top row without running off the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li')).toHaveCount(3, { timeout: 60_000 });
  const g = await page.evaluate(() => [...document.querySelectorAll('.page-top *')].map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0).reduce((m, r) => Math.max(m, r.right), 0));
  expect(g, 'the top row runs off the screen').toBeLessThanOrEqual(375);
});

test('the footer is the page\'s last thing: it covers nothing, and sits at the bottom of a short page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.getByRole('heading', { name: 'Others with this title' })).toBeVisible({ timeout: 60_000 });
  const foot = page.locator('.app-footer');
  // At the top of a long page the window's bottom row is the page, not the footer.
  const atBottom = await page.evaluate(() => {
    const e = document.elementFromPoint(640, innerHeight - 4);
    return !!e?.closest('.app-footer');
  });
  expect(atBottom, 'the footer covers the bottom of the window').toBe(false);
  await expect(foot).not.toBeInViewport();
  // At the end of the page, the footer ends it.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(foot).toBeInViewport();
  const end = await page.evaluate(() => ({
    foot: document.querySelector('.app-footer')!.getBoundingClientRect().bottom + scrollY,
    doc: document.documentElement.scrollHeight,
  }));
  expect(Math.abs(end.doc - end.foot), 'something follows the footer').toBeLessThanOrEqual(1);
  // A short page: the footer at the window's bottom, not halfway up it.
  await page.goto('./nowhere');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  const bottom = await foot.evaluate((f) => f.getBoundingClientRect().bottom);
  expect(Math.round(bottom), 'the footer floats above the bottom of a short page').toBe(720);
  // Both lines, every word, at every width: nothing is dropped to fit a bar.
  for (const width of [375, 768, 992, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./data');
    await expect(foot, `${width}px`).toContainText('UFAS Local 223', { timeout: 60_000 });
    await expect(foot, `${width}px`).toContainText('Built by Aaron Smetana');
    await expect(foot.getByRole('link', { name: 'Source on GitHub' }), `${width}px`).toBeVisible();
    await expect(foot.getByRole('link', { name: 'About the data' }), `${width}px`).toBeVisible();
  }
});

// Below 992px the destinations are a sheet over the dimmed page — a dialog of its own, every link named.
const phone = (browser: import('@playwright/test').Browser, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}) =>
  browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: opts.reducedMotion ?? 'no-preference' });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Menu' });
const burger = (page: Page) => page.getByRole('button', { name: 'Toggle navigation' });
const SHEET_NAMES = [...NAMES, 'About the data'];

test('below 992px the bar holds the burger, not the links', async ({ page }) => {
  for (const width of [991, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./data');
    await expect(burger(page), `${width}px`).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.app-nav-link'), `${width}px`).toHaveCount(0);
  }
});

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
    return { w: r.width, alpha: Number(/rgba?\([^)]*?,\s*([\d.]+)\)$/.exec(bg)?.[1] ?? (bg.startsWith('rgb(') ? 1 : 0)) };
  });
  expect(dim.w, 'nothing dims the page beside the sheet').toBeGreaterThanOrEqual(375);
  expect(dim.alpha, 'the layer over the page does not dim it').toBeGreaterThan(0);
  // Every link says where it goes in words a reader can see — not only to a screen reader.
  for (const name of SHEET_NAMES) {
    const link = sheet(page).getByRole('link', { name, exact: true });
    await expect(link, `"${name}" is not named on screen`).toHaveText(name);
    expect(await link.getAttribute('aria-label'), `"${name}" is named for a screen reader only`).toBeNull();
  }
  // The keyboard is inside it.
  expect(await sheet(page).evaluate((d) => d.contains(document.activeElement)), 'focus did not move into the sheet').toBe(true);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  expect(await sheet(page).evaluate((d) => d.contains(document.activeElement)), 'focus left the open sheet').toBe(true);
  await ctx.close();
});

test('on a phone the sheet closes on a tap beside it, on Escape, and on any link — the page it is on included', async ({ browser }) => {
  const ctx = await phone(browser);
  const page = await ctx.newPage();
  await page.goto('./data');
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.touchscreen.tap(340, 400);
  await expect(sheet(page)).toHaveCount(0);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(burger(page)).toBeFocused();
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

test('the sheet goes when the window widens to the bar', async ({ browser }) => {
  const ctx = await phone(browser);
  const page = await ctx.newPage();
  await page.goto('./data');
  await burger(page).tap();
  await expect(sheet(page)).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.app-nav-link', { hasText: 'Titles' })).toHaveCount(1);
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
    else expect(partWay.length, 'the sheet does not slide in even with motion, so Reduce Motion is not what stops it').toBeGreaterThan(0);
    await ctx.close();
  }
});
