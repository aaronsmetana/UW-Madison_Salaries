import { test, expect, type Page } from '@playwright/test';
import { parseColor, contrast, lab, cvdDistance } from './color';

/**
 * One colour pair for a change's direction, and only for that (G11, G12). Up is blue and down orange,
 * with a lightness gap, so the pair holds for a reader who can't tell red from green — the red/green it
 * replaces sat 13 apart (ΔE) under protanopia. Green is left to success (copied, in the tray, a check
 * passed) and red to errors; a magnitude or a category (same school, retained, a target, a total) takes
 * the accent or a neutral.
 */

const AARON = 'aaronsmetana|2014-10-15';
/** Nine snapshots at six different FTEs, so her trend draws the FTE panel under the pay line. */
const ALICE = 'alicegaber|2021-05-18';

const ink = (page: Page, v: string) => page.evaluate((v) => {
  const s = document.createElement('span');
  document.body.appendChild(s);
  s.style.color = `var(${v})`;
  const c = getComputedStyle(s).color;
  s.remove();
  return c;
}, v).then(parseColor);

const hue = (c: number[]) => { const [, a, b] = lab(c); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };

async function setScheme(page: Page, scheme: 'light' | 'dark') {
  await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
  await page.waitForTimeout(300);
}

test('up and down are a blue and an orange that stay apart without their hues, in both schemes', async ({ page }) => {
  await page.goto('./divisions?tab=changes');
  for (const scheme of ['light', 'dark'] as const) {
    await setScheme(page, scheme);
    const [up, down, upWords, downWords, card] = await Promise.all(
      ['--mark-up', '--mark-down', '--text-up', '--text-down', '--surface'].map((v) => ink(page, v)));
    expect(hue(up), `${scheme}: up is not a blue`).toBeGreaterThan(260);
    expect(hue(up), `${scheme}: up is not a blue`).toBeLessThan(310);
    expect(hue(down), `${scheme}: down is not an orange`).toBeGreaterThan(45);
    expect(hue(down), `${scheme}: down is not an orange`).toBeLessThan(80);
    expect(hue(upWords), `${scheme}: up's words are not a blue`).toBeGreaterThan(260);
    expect(hue(upWords), `${scheme}: up's words are not a blue`).toBeLessThan(310);
    expect(hue(downWords), `${scheme}: down's words are not an orange`).toBeGreaterThan(40);
    expect(hue(downWords), `${scheme}: down's words are not an orange`).toBeLessThan(80);
    expect(Math.abs(lab(up)[0] - lab(down)[0]), `${scheme}: the pair's lightness gap`).toBeGreaterThanOrEqual(15);
    expect(cvdDistance(up, down), `${scheme}: up and down to a red-green colour-blind reader`).toBeGreaterThanOrEqual(60);
    for (const [what, c, min] of [['an up mark', up, 3], ['a down mark', down, 3], ['up words', upWords, 4.5], ['down words', downWords, 4.5]] as const) {
      expect(contrast(c, card), `${scheme}: ${what} against the card`).toBeGreaterThanOrEqual(min);
    }
  }
});

test('Changes: raises and new hires are up, departures down, the net a neutral total, and signed figures in their direction', async ({ page }) => {
  await page.goto('./divisions?tab=changes');
  const chart = page.locator('[aria-label^="Payroll change decomposition"]');
  await expect(chart.locator('.recharts-label-list text').first()).toBeVisible({ timeout: 60_000 });
  const labels = await chart.locator('.recharts-label-list text').allTextContents();
  const fills = (await chart.locator('.recharts-bar-rectangle path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill'))))
    .filter((f) => f !== 'transparent');
  expect(labels).toHaveLength(4);
  const want = labels.map((l, i) => (i === 3 ? 'var(--guide-strong)' : l.startsWith('−') ? 'var(--mark-down)' : 'var(--mark-up)'));
  expect(fills, `labels ${labels.join(' ')}`).toEqual(want);
  expect(fills[2], 'departures took from payroll').toBe('var(--mark-down)');

  const [upWords, downWords] = await Promise.all([ink(page, '--text-up'), ink(page, '--text-down')]);
  // A signed amount or count on its own: a change in dollars or in people. A share ("−10%") and the dimmed
  // "+120 / −80" beside a net are not coloured.
  const signed = page.locator('.mantine-Tabs-panel:not([hidden]) td').filter({ hasText: /^[+−](\$[\d,.]+[KMB]?|[\d,]+)$/ });
  await expect(signed.first()).toBeVisible({ timeout: 60_000 });
  const cells = await signed.evaluateAll((tds) => tds.map((td) => ({ t: td.textContent!.trim(), c: getComputedStyle(td).color })));
  expect(cells.some((x) => x.t.startsWith('+')) && cells.some((x) => x.t.startsWith('−')), 'no gains and losses to check').toBe(true);
  for (const { t, c } of cells) {
    expect(parseColor(c), `"${t}"`).toEqual(t.startsWith('+') ? upWords : downWords);
  }
});

test('Retention: who joined is up and who left down; the share retained is a magnitude in the accent', async ({ page }) => {
  await page.goto('./divisions?tab=retention');
  const turnover = page.locator('[aria-label^="Workforce turnover"]');
  await expect(turnover.locator('.recharts-bar-rectangle').first()).toBeVisible({ timeout: 60_000 });
  const fills = new Set(await turnover.locator('.recharts-bar-rectangle path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill'))));
  expect([...fills].sort()).toEqual(['var(--mark-down)', 'var(--mark-up)']);
  const retained = page.locator('[aria-label^="Retention by hire year"] .recharts-bar-rectangle path');
  const kept = new Set(await retained.evaluateAll((ps) => ps.map((p) => p.getAttribute('fill'))));
  expect(kept.has('var(--mantine-color-accent-6)'), [...kept].join(', ')).toBe(true);
  expect([...kept].filter((f) => /pos|red|mark-up|mark-down/.test(f ?? '')), 'retained wears a direction or a status').toEqual([]);
});

test('Standing: one neutral fill, a marker in its side of the median, and the median named once over its tick', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
  const bars = page.locator('.chart-plot', { hasText: 'more than' });
  await expect(bars.first()).toContainText('more than', { timeout: 60_000 });
  await page.waitForTimeout(800); // past the sweep
  const [up, down, guide] = await Promise.all(['--mark-up', '--mark-down', '--guide-strong'].map((v) => ink(page, v)));
  const rows = await bars.evaluateAll((els) => els.map((el) => {
    const m = el.querySelector('.standing-marker') as HTMLElement;
    const fill = m.previousElementSibling?.previousElementSibling as HTMLElement;
    return {
      pct: Number(el.textContent!.match(/more than\s*(\d+)%/)?.[1]),
      side: m.dataset.side,
      marker: getComputedStyle(m).backgroundColor,
      fill: getComputedStyle(fill).backgroundColor,
      word: getComputedStyle(el.lastElementChild!).color,
    };
  }));
  expect(rows.length).toBeGreaterThanOrEqual(3);
  expect(new Set(rows.map((r) => r.fill)).size, 'the fills differ by pool').toBe(1);
  expect(new Set(rows.map((r) => r.word)).size, 'the percentages are coloured by side').toBe(1);
  for (const r of rows) {
    const side = r.pct > 50 ? 'above' : r.pct < 50 ? 'below' : 'at';
    expect(r.side, `${r.pct}%`).toBe(side);
    expect(parseColor(r.marker), `${r.pct}%: the marker's colour`).toEqual(side === 'above' ? up : side === 'below' ? down : guide);
  }
  const label = page.getByText('Pool median', { exact: true });
  await expect(label).toHaveCount(1);
  const [l, tick] = await Promise.all([label.boundingBox(), page.locator('.standing-median').first().boundingBox()]);
  expect(Math.abs(l!.x + l!.width / 2 - (tick!.x + tick!.width / 2)), 'the median is named off its tick').toBeLessThanOrEqual(1);
});

test('a same-school peer wears the accent, quieter than the person, and no direction or success hue', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  for (const scheme of ['light', 'dark'] as const) {
    await setScheme(page, scheme);
    const [same, self, up, down, ok, card] = await Promise.all(
      ['--mark-peer-same-school', '--mark-self', '--mark-up', '--mark-down', '--text-pos', '--surface'].map((v) => ink(page, v)));
    expect(Math.abs(hue(same) - hue(self)), `${scheme}: same school is not the accent's hue`).toBeLessThanOrEqual(12);
    expect(contrast(same, card), `${scheme}: same school outshines the person`).toBeLessThan(contrast(self, card));
    for (const [what, c] of [['up', up], ['down', down], ['success', ok]] as const) {
      expect(cvdDistance(same, c), `${scheme}: same school and ${what}`).toBeGreaterThanOrEqual(20);
    }
  }
});

test("the landing's raises and cuts are the app's pair, and who joined is far from both", async ({ page }) => {
  await page.goto('./');
  for (const scheme of ['light', 'dark'] as const) {
    await setScheme(page, scheme);
    const [up, down, joined, neutral, markUp, markDown] = await Promise.all(
      ['--strata-up', '--strata-down', '--strata-new', '--strata-neutral', '--mark-up', '--mark-down'].map((v) => ink(page, v)));
    expect(up, scheme).toEqual(markUp);
    expect(down, scheme).toEqual(markDown);
    expect(cvdDistance(joined, down), `${scheme}: joined and down`).toBeGreaterThanOrEqual(40);
    expect(cvdDistance(joined, up), `${scheme}: joined and up`).toBeGreaterThanOrEqual(40);
    expect(cvdDistance(joined, neutral), `${scheme}: joined and everyone else`).toBeGreaterThanOrEqual(30);
  }
});

/** Every chart mark and signed figure on the pages that show change: none in the success green or error red.
 *  Each page is read once what it shows has drawn: its last part to arrive. */
for (const [name, path, ready] of [
  ['Divisions › Changes', './divisions?tab=changes', '.mantine-Tabs-panel:not([hidden]) td:text-matches("^[+−][$]")'],
  ['Divisions › Retention', './divisions?tab=retention', '.turnover .recharts-bar-rectangle'],
  ['Divisions › Trends', './divisions?tab=trends', '.recharts-line-curve'],
  ['Raises', './raises', '.recharts-bar-rectangle'],
  ['a person', `./person/${encodeURIComponent(AARON)}`, '.peer-strip circle.chart-dot'],
  ['a person, pay tab', `./person/${encodeURIComponent(AARON)}?tab=pay`, '.standing-marker'],
  ['a person, trend tab', `./person/${encodeURIComponent(ALICE)}?tab=trends`, 'text=Appointment (FTE) — lower chart'],
] as const) {
  test(`no change or magnitude in green or red: ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first(), 'what this page shows never drew').toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const [pos, neg] = await Promise.all([ink(page, '--text-pos'), ink(page, '--text-neg')]);
    const found = await page.evaluate(([pos, neg]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('svg *')) {
        for (const a of ['fill', 'stroke']) {
          const v = el.getAttribute(a) ?? '';
          if (/--mantine-color-(pos|red|green)-/.test(v)) out.push(`${el.tagName} ${a}=${v}`);
        }
      }
      const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map(Math.round).join(', ')})`;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const t = el.textContent?.trim() ?? '';
        if (!/^\(?[+−▲▼]/.test(t)) continue;
        const c = getComputedStyle(el).color;
        if (c === rgb(pos) || c === rgb(neg)) out.push(`"${t}" in ${c}`);
      }
      return out;
    }, [pos, neg]);
    expect(found).toEqual([]);
  });
}
