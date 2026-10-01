import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * The rebrand, as a visitor meets it: a mark that is the landing graph in miniature (fifteen dots in the pay
 * curve's shape, one lit) on every page, a header that holds only the mark, the name, the destinations and
 * the theme, the credit at the foot of every page, and a landing heading that says what the page shows rather
 * than repeating the name a few pixels above it. The mark's copies outside the app (favicon, app icon,
 * home-screen icon, share card) come from one file (scripts/brand-images.mjs), and each must resolve.
 */

const mark = JSON.parse(readFileSync(new URL('../src/components/brandMark.json', import.meta.url), 'utf8')) as {
  dots: [number, number][];
  litInk: string;
};
const summary = JSON.parse(readFileSync(new URL('../public/data/summary.json', import.meta.url), 'utf8')) as {
  latest: { headcount: number };
};
const AARON = 'aaronsmetana|2014-10-15';

/** The dots a mark draws, and how many of them are in the lit ink. */
async function dotsOf(scope: import('@playwright/test').Locator) {
  return scope.locator('svg').first().evaluate((svg, lit) => {
    const circles = [...svg.querySelectorAll('circle')];
    const hex = (c: string) => {
      const m = c.match(/\d+/g)!.map(Number);
      return `#${m.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    };
    return { n: circles.length, lit: circles.filter((c) => hex(getComputedStyle(c).fill) === lit.toUpperCase()).length };
  }, mark.litInk);
}

test('every page carries the dot mark beside a one-line name, and the header holds nothing else', async ({ page }) => {
  for (const route of ['./', `./person/${encodeURIComponent(AARON)}`, './explore', './reports']) {
    await page.goto(route);
    const word = page.locator('.app-wordmark');
    await expect(word, route).toBeVisible({ timeout: 60_000 });
    expect(await dotsOf(word), `${route}: the mark is not the dot hill`).toEqual({ n: mark.dots.length + 1, lit: 1 });
    await expect(page.locator('.app-name'), route).toHaveText('UW–Madison Salaries');
    // One line: the "Open record salary data" line that sat over the name is gone.
    await expect(page.locator('.mantine-AppShell-header'), route).not.toContainText('Open record salary data');
    const header = page.locator('.mantine-AppShell-header');
    // The credit went to the footer: the header is the mark, the name, the destinations and the theme.
    await expect(header, `${route}: the credit is back in the header`).not.toContainText('UFAS');
    await expect(header, route).not.toContainText('Built by');
    await expect(header.getByRole('button').locator('visible=true'), `${route}: the header holds another control`).toHaveCount(1);
  }
});

test('the phone menu carries the same mark', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./explore');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  expect(await dotsOf(sheet), 'the menu\'s mark is not the dot hill').toEqual({ n: mark.dots.length + 1, lit: 1 });
});

/** Who obtained the records and who built the site, at the foot of every page (every word at every width:
 *  topnav.spec). */
test('the footer credits UFAS Local 223 and the builder, and links the source', async ({ page }) => {
  await page.goto('./data');
  const foot = page.locator('.app-footer');
  await expect(foot).toContainText('Records obtained via open-records requests by UFAS Local 223', { timeout: 60_000 });
  await expect(foot.getByRole('link', { name: 'UFAS Local 223' })).toHaveAttribute('href', 'https://ufas223.org/');
  await expect(foot).toContainText('Built by Aaron Smetana');
  await expect(foot.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', /github\.com/);
});

/** The heading says what the page shows, counted from the data; the name stays in the header above it. */
test('the landing heading is how many people the graph shows, and keeps "UW–Madison" whole', async ({ page }) => {
  const want = `What ${summary.latest.headcount.toLocaleString('en-US')} people at UW–Madison are paid`;
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1, `${width}px`).toHaveText(want, { timeout: 60_000 });
    // The words themselves, wherever they sit in the heading's markup: a range over "UW–Madison" in its text.
    const split = await h1.evaluate((h) => {
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent!.indexOf('UW–Madison');
        if (at < 0) continue;
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + 'UW–Madison'.length);
        return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size;
      }
      return -1;
    });
    expect(split, `${width}px: "UW–Madison" breaks across lines`).toBe(1);
  }
});

/** The mark's copies outside the app, each one where the page says it is. */
test('the favicon, app icon, home-screen icon and share card resolve, and the icon is the dot hill', async ({ page, request }) => {
  await page.goto('./');
  const href = async (sel: string, attr = 'href') => new URL((await page.locator(sel).first().getAttribute(attr))!, page.url()).href;
  const icon = await href('link[rel="icon"]');
  expect(icon, 'the favicon is drawn inline, not the generated icon.svg').toMatch(/\/icon\.svg$/);
  const res = await request.get(icon);
  expect(res.status(), icon).toBe(200);
  const svg = await res.text();
  expect(svg.match(/<circle/g)?.length, 'the favicon is not the dot hill').toBe(mark.dots.length + 1);
  expect(svg).toContain(mark.litInk);
  for (const url of [await href('link[rel="apple-touch-icon"]'), await href('meta[property="og:image"]', 'content')]) {
    const r = await request.get(url.replace('https://aaronsmetana.github.io/UW-Madison_Salaries/', new URL('./', page.url()).href));
    expect(r.status(), url).toBe(200);
    expect(r.headers()['content-type'], url).toContain('image/png');
  }
});
