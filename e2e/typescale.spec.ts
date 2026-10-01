import { test, expect, type Page } from '@playwright/test';

/**
 * One type scale, seven sizes, app-wide (theme.ts): 40 page title and lead figure, 24 figures and section
 * headings, 18 card titles and page descriptions, 15 body, 13 secondary, 12 chart text, 11 small labels.
 * The person page rendered about ten sizes (10.5, 11, 12, 12.5, 13, 14, 15, 16, 17, 24, 40), so its card
 * titles did not stand out from the text around them. Checked as rendered: a size set inline, in a chart
 * constant or by a Mantine default all show up here, where a source search would miss the last.
 *
 * The landing page is its own approved design (a fluid title, a large search) and is not swept. Every other
 * page is: the person page's tabs, a title, Divisions, a division, Raises, both reports, Compare, Screening
 * and Data.
 */

const AARON = 'aaronsmetana|2014-10-15';
const SMPH = 'School of Medicine and Public Health';
/** Two people in Compare's tray: Aaron Smetana and Adam Koch. */
const TRAY = encodeURIComponent([
  ['p', encodeURIComponent(AARON), encodeURIComponent('Aaron Smetana')].join(','),
  ['p', encodeURIComponent('adamkoch|2009-05-26'), encodeURIComponent('Adam Koch')].join(','),
].join('|'));

const SCALE = [11, 12, 13, 15, 18, 24, 40];
/** Chart text: axis numbers, labels on a chart, names at a line's end (CHART_FONT in lib/chartStyle). */
const CHART = 12;
/** The monospace register draws at 0.94em (app.css `.mono`), since the mono face runs optically larger. */
const MONO = 0.94;

const onScale = (px: number) => SCALE.some((s) => Math.abs(px - s) < 0.05);

/** Every visible piece of text on the page: its size, whether it is monospace, whether it is in a chart. */
async function sizes(page: Page) {
  return page.evaluate(() => {
    const out: { px: number; mono: boolean; chart: boolean; text: string; at: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || !el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      out.push({
        px: parseFloat(cs.fontSize),
        mono: /monospace|SF Mono|Menlo|Consolas/.test(cs.fontFamily),
        chart: !!el.closest('svg'),
        text: text.slice(0, 32),
        at: `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`,
      });
    }
    return out;
  });
}

/** Wide enough that the page title is at its full 40px: it eases down with the window (3vw) below 1334px. */
test.use({ viewport: { width: 1440, height: 900 } });

// `svg`: the page draws Recharts charts, whose text is checked at the chart size. The Titles histogram,
// Divisions' box plots and the pay band are HTML, swept with the rest of the page.
for (const [name, route, ready, svg] of [
  ['person', `./person/${encodeURIComponent(AARON)}`, '.peer-strip', true],
  ['person, pay & standing', `./person/${encodeURIComponent(AARON)}?tab=pay`, '.person-payband', false],
  ['person, salary trend', `./person/${encodeURIComponent(AARON)}?tab=trends`, '.recharts-wrapper', true],
  // The loaded histogram, not a card title: the page loads with the distribution card's own title on a
  // placeholder (TitleStats), and a sweep that started there on CI measured 27 texts of the loading page.
  ['a title', './paycheck?code=IT040', '.hist-plot', false],
  ['Divisions', './explore?tab=schools', '.school-row', false],
  ['a division', `./school/${encodeURIComponent(SMPH)}?tab=dist`, '.card-title', true],
  ['Raises', `./raises?sch=${encodeURIComponent(SMPH)}&dept=Neurology`, '.raise-summary', true],
  ['Reports, one person', `./reports?type=person&person=${encodeURIComponent(AARON)}`, '.card-title', true],
  ['Reports, raise case', `./reports?type=comparison&subject=${encodeURIComponent(AARON)}`, '.report-brief', false],
  ['Compare', `./compare?sel=${TRAY}`, '.card-title', true],
  ['Screening', './screening?run=1&flag=below-min', '.mantine-Table-table', false],
  ['Data', './data', '.card-title', false],
] as const) {
  test(`every size on ${name} is on the type scale, and chart text is one size`, async ({ page }) => {
    // A raise case is built from the tray: Compare's link puts Aaron and Adam in it.
    if (name === 'Reports, raise case') {
      await page.goto(`./compare?sel=${TRAY}`);
      await expect(page.locator('.card-title').first()).toBeVisible({ timeout: 60_000 });
    }
    await page.goto(route);
    // Visible ones: a page's other tabs keep their panels mounted but hidden.
    await expect(page.locator(ready).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    // Charts draw after their queries; the sweep needs their labels in.
    if (svg) await expect(page.locator('svg text').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const all = await sizes(page);
    expect(all.length, `${name}: no text to measure`).toBeGreaterThan(50);
    if (svg) expect(all.filter((t) => t.chart).length, `${name}: no chart text to measure`).toBeGreaterThan(5);

    const off = all
      .filter((t) => !onScale(t.px) && !(t.mono && onScale(t.px / MONO)))
      .map((t) => `${t.px}px ${t.at} "${t.text}"`);
    expect([...new Set(off)], `${name}: text off the scale`).toEqual([]);

    const chartOff = all.filter((t) => t.chart && Math.abs(t.px - CHART) > 0.05).map((t) => `${t.px}px ${t.at} "${t.text}"`);
    expect([...new Set(chartOff)], `${name}: chart text not at the chart size`).toEqual([]);
  });
}

/**
 * A phone: no text field under 16px. Under 16px, iOS Safari zooms the page into a field when it takes focus
 * and leaves it zoomed. A minimum, so the landing page's larger search keeps its size.
 */
test('on a phone, no text field is under 16px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ['./', './explore', './screening', './raises']) {
    await page.goto(route);
    const fields = page.locator('input:not([type="hidden"], [type="radio"], [type="checkbox"]), textarea').locator('visible=true');
    await expect(fields.first()).toBeVisible({ timeout: 60_000 });
    const got = await fields.evaluateAll((els) => els.map((e) => ({
      name: (e as HTMLInputElement).placeholder || e.getAttribute('aria-label') || e.id,
      px: parseFloat(getComputedStyle(e).fontSize),
    })));
    expect(got.length, `${route}: no fields to measure`).toBeGreaterThan(0);
    expect(got.filter((f) => f.px < 16).map((f) => `${f.name}: ${f.px}px`), `${route}: a field iOS would zoom into`).toEqual([]);
  }
  // Only a phone: on a desktop the fields follow the scale, and Raises' compact filters are at 13px.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const desk = await page.locator('input:not([type="hidden"], [type="radio"], [type="checkbox"])').locator('visible=true')
    .evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(desk.filter((px) => !onScale(px)), 'a desktop field off the scale').toEqual([]);
  expect(Math.min(...desk), 'the 16px floor reaches past a phone').toBeLessThan(16);
});
