import { test, expect, type Page } from '@playwright/test';

/**
 * The rules every chart keeps since the person-page redesign:
 * - a person is one size of dot, 10px, with an edge inside it and a ring of the card's colour round it; the
 *   person the page is about wears their teal with a pip, and legend chips are the same dots;
 * - what a pointer calls up is a readout in the page's inverse, not in the teal that names the person;
 * - a chart card's tools say what they are (About, CSV, Table), their names kept on a phone for a screen reader;
 * - a segmented control's chosen option is a raised segment in the ink, never a teal fill.
 */

const AARON = 'aaronsmetana|2014-10-15';

async function scheme(page: Page, s: 'light' | 'dark') {
  await page.evaluate((v) => document.documentElement.setAttribute('data-mantine-color-scheme', v), s);
  await page.waitForTimeout(500);
}
const token = (page: Page, v: string, prop: 'color' | 'backgroundColor' = 'color') => page.evaluate(([name, p]) => {
  const probe = document.createElement('span');
  probe.style[p as 'color'] = `var(${name})`;
  document.body.append(probe);
  const c = getComputedStyle(probe)[p as 'color'];
  probe.remove();
  return c;
}, [v, prop]);

test('every person is a 10px dot with an edge and a ring, the page\'s person with a pip, and the legend draws the same', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const strip = page.locator('.peer-strip').first();
  await expect(strip.locator('circle.chart-dot').first()).toBeVisible({ timeout: 60_000 });
  const dots = await page.locator('.peer-strip circle.chart-dot, .tenure-self-dot, .peer-strip-marker').evaluateAll((cs) => cs.map((c) => ({
    r: Number(c.getAttribute('r')), mark: c.getAttribute('data-mark'),
    ring: getComputedStyle(c).stroke, ringW: Number(c.getAttribute('stroke-width')),
    edge: !!c.parentElement?.querySelector(':scope > circle[stroke-width="1"]'),
    pip: !!c.parentElement?.querySelector(':scope > .chart-dot-pip'),
  })));
  expect(dots.length, 'too few dots to be checking anything').toBeGreaterThan(20);
  expect([...new Set(dots.map((d) => d.r))], 'dots of more than one size').toEqual([5]);
  for (const d of dots.filter((x) => x.mark !== 'self')) {
    expect(d.edge, 'a peer dot without its edge').toBe(true);
    expect(d.pip, 'a peer dot with the person\'s pip').toBe(false);
  }
  const selves = dots.filter((d) => d.mark === 'self');
  expect(selves.length, "the page's person is not marked in both charts").toBe(2);
  for (const d of selves) expect(d.pip, "the page's person has no pip").toBe(true);
  const card = await token(page, '--mantine-color-body');
  for (const d of dots) {
    expect(d.ring, 'a dot\'s ring is not the card\'s colour').toBe(card);
    expect(d.ringW, 'a dot\'s ring is not 1.5px outside it').toBe(3);
  }
  // The legend's chips are the chart's dots.
  const chips = await page.locator('.dot-chip circle[data-mark]').evaluateAll((cs) =>
    cs.map((c) => ({ r: Number(c.getAttribute('r')), mark: c.getAttribute('data-mark') })));
  expect(chips.filter((c) => c.mark === 'same-school' || c.mark === 'peer').length, 'the legend does not draw the dots').toBeGreaterThanOrEqual(2);
  for (const c of chips) expect(c.r).toBe(5);
});

test('a readout over a chart is the page\'s inverse, in both schemes, and the dot pointed at takes the ink ring', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const dot = page.locator('.peer-strip circle.chart-dot').nth(10);
  await expect(dot).toBeVisible({ timeout: 60_000 });
  await dot.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  for (const s of ['light', 'dark'] as const) {
    await scheme(page, s);
    const b = (await dot.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const tip = page.locator('.peer-strip .chart-tip-pill');
    await expect(tip, s).toBeVisible();
    await expect(tip, s).toContainText(/ · \$[\d,]+/);
    const [bg, ink] = await Promise.all([token(page, '--inverse-bg', 'backgroundColor'), token(page, '--inverse-ink')]);
    await expect(tip, `${s}: the readout is not the inverse`).toHaveCSS('background-color', bg);
    await expect(tip).toHaveCSS('color', ink);
    expect(await page.locator('.peer-strip .chart-dot-hover').count(), `${s}: the dot pointed at has no ring`).toBe(1);
    await page.mouse.move(5, 5);
  }
});

test('a chart card\'s tools say what they are; on a phone their icons stay and their names are read out', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    const tools = page.locator('.chart-tool').first().locator('xpath=..');
    await expect(page.locator('.chart-tool').first()).toBeVisible({ timeout: 60_000 });
    for (const [name, words] of [['About this chart', 'About'], ["CSV of this chart's data", 'CSV'], ["Table of this chart's data", 'Table']] as const) {
      const b = tools.getByRole('button', { name });
      await expect(b, `${width}px: no "${name}"`).toBeVisible();
      if (width === 1440) await expect(b, `${width}px`).toHaveText(words);
      else await expect(b.locator('.chart-tool-label'), `${width}px: the name is drawn on a phone`).toBeHidden();
    }
  }
});

test('a segmented control\'s choice is a raised segment in the ink, never a teal fill, in both schemes', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const seg = page.locator('.mantine-SegmentedControl-root').first();
  await expect(seg).toBeVisible({ timeout: 60_000 });
  for (const s of ['light', 'dark'] as const) {
    await scheme(page, s);
    const [track, thumb, ink] = await Promise.all([
      token(page, '--seg-track', 'backgroundColor'), token(page, '--seg-thumb', 'backgroundColor'), token(page, '--mantine-color-text'),
    ]);
    await expect(seg, s).toHaveCSS('background-color', track);
    await expect(seg.locator('.mantine-SegmentedControl-indicator'), s).toHaveCSS('background-color', thumb);
    await expect(seg.locator('.mantine-SegmentedControl-label[data-active]'), s).toHaveCSS('color', ink);
    expect(track, `${s}: the track and the chosen segment are one colour`).not.toBe(thumb);
  }
});
