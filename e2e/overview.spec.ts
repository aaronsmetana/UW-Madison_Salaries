import { test, expect, type Page } from '@playwright/test';
import { parseColor, contrast } from './color';

/**
 * A person's overview charts, as a reader meets them: the strip of everyone with the title, and the
 * pay-against-tenure scatter under it. What each draws, and where it writes what.
 */

const AARON = 'aaronsmetana|2014-10-15';
/** A Professor: a title big enough for the strip's density ribbon and the scatter's crowd. */
const KENNETH = 'kennethposs|2024-07-01';

async function open(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}`);
  await expect(page.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tenure-plot')).toBeVisible({ timeout: 60_000 });
  // Both charts drawn, not merely mounted: the strip lays out once it has measured its width, and the
  // scatter once its axes have. A slow runner can sit between the two for seconds.
  await expect(page.locator('.peer-strip-marker')).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('.tenure-plot .tenure-self circle').first()).toBeAttached({ timeout: 60_000 });
  // The strip fades its marks in, and its axis re-measures once the webfont lands.
  await page.waitForTimeout(1_000);
}

const stripCard = (page: Page) => page.locator('.peer-strip').locator('xpath=ancestor::div[contains(@class,"mantine-Card-root")][1]');

type Box = { left: number; right: number; top: number; bottom: number };
const boxOf = (r: DOMRect | { x: number; y: number; width: number; height: number }): Box =>
  ({ left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height });
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Piled up from the axis, a small title read as pebbles on a floor: nearly every dot on the axis
 * line and a few short towers. Centred on a middle row, a cluster bulges both ways into a shape. The
 * middle row is the one the packer fills first, so it holds the most dots; a strip stacked from the
 * floor has that row at the bottom and nothing under it.
 *
 * And the middle-50% box spans the population, not the lane above it where the subject's mark stands:
 * run up through that lane, it boxed the subject in with the people they are measured against.
 */
test('the strip spreads its people both ways from a middle row, under the subject', async ({ page }) => {
  await open(page, AARON);
  await expect(page.locator('.peer-strip circle.chart-dot').first()).toBeAttached();
  const m = await page.locator('.peer-strip').evaluate((el) => {
    const svg = el.querySelector<SVGSVGElement>('svg:has(circle.chart-dot)')!;
    const ys = [...svg.querySelectorAll('circle.chart-dot')].map((c) => Number(c.getAttribute('cy')));
    const count = new Map<number, number>();
    for (const y of ys) count.set(y, (count.get(y) ?? 0) + 1);
    const mid = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const band = el.querySelector('rect.band-iqr')!;
    const mark = el.querySelector('.peer-strip-marker')!;
    return {
      n: ys.length,
      above: ys.filter((y) => y < mid - 0.5).length,
      below: ys.filter((y) => y > mid + 0.5).length,
      bandTop: Number(band.getAttribute('y')),
      markBottom: Number(mark.getAttribute('cy')) + Number(mark.getAttribute('r')),
    };
  });
  expect(m.n, 'the strip drew no dots').toBeGreaterThan(20);
  expect(m.above, 'no dot sits above the middle row').toBeGreaterThan(0);
  expect(m.below, 'no dot sits below the middle row: the strip is stacked on its floor').toBeGreaterThan(0);
  expect(m.bandTop, "the middle-50% box runs up into the subject's lane").toBeGreaterThanOrEqual(m.markBottom);
});

/**
 * The key under the strip names every colour the chart paints, and not the subject, who is named
 * where they stand. The density ribbon's key used to say "Everyone with this title" in grey while
 * its dot field painted the same-school people green, leaving a colour on the chart with no name.
 */
for (const [who, key, ribbon] of [['a small title', AARON, false], ['a large title, drawn as a ribbon', KENNETH, true]] as const) {
  test(`the strip's key names each colour it paints, and not the subject: ${who}`, async ({ page }) => {
    await open(page, key);
    const card = stripCard(page);
    if (ribbon) {
      const field = card.locator('.strip-dots').first();
      await expect(field, 'this title is no longer drawn as a ribbon').toBeAttached();
      await expect.poll(() => field.getAttribute('data-inks'), { timeout: 15_000 }).toMatch(/\|/);
      expect((await field.getAttribute('data-inks'))!.split('|').length, 'the field paints one ink, so there is no green to name').toBeGreaterThanOrEqual(2);
    }
    const keyWords = await card.locator('.mantine-Text-root').evaluateAll((els) => els
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => ['This person', 'Same school', 'Others', 'Everyone with this title'].includes(t)));
    expect(keyWords).toEqual(['Same school', 'Others']);
  });
}

/**
 * The finding comes before the chart that shows it, and the card ends at the chart's footer. "Paid
 * more than 33%" sat under the source line, after the footnotes, above a "Go to title page" button;
 * the title in the card's opening line is that link now, and how to read the dots is behind the
 * footer's note.
 */
test('the strip card leads with its finding and keeps how-to-read behind its footer', async ({ page }) => {
  await open(page, AARON);
  const card = stripCard(page);
  const finding = card.getByText(/^Paid more than \d+%/);
  await expect(finding).toBeVisible();
  expect(await finding.evaluate((f) => {
    const strip = document.querySelector('.peer-strip')!;
    return !!(f.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), 'the finding comes after the chart').toBe(true);
  await expect(card.getByText(/1 dot = 1 person/)).toHaveCount(0);
  await expect(card.getByRole('link', { name: /Go to title page/ })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'System Engineer IV' })).toHaveAttribute('href', /paycheck\?code=IT040/);
  await card.locator('.chart-about').click();
  await expect(page.locator('.chart-about-note')).toContainText('1 dot = 1 person');
  await expect(page.locator('.chart-about-note')).toContainText('middle 50%');
});

/**
 * Pointing at a dot grows that dot and names it. It used to dim every other dot on the strip to 45%
 * as well, so the whole chart flickered as a pointer crossed it, for a name the pill already gives.
 */
test('pointing at a strip dot leaves the other dots as they were', async ({ page }) => {
  await open(page, AARON);
  const dots = page.locator('.peer-strip circle.chart-dot');
  const before = await dots.evaluateAll((cs) => cs.map((c) => getComputedStyle(c).fillOpacity));
  // Into the middle of the window first: at 1280x720 the strip's dots sit just above the fixed footer
  // here, and under it on CI's wider text, where a pointer sent to the dot pointed at the footer.
  await dots.nth(5).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = (await dots.nth(5).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.peer-strip .chart-tip-pill')).toHaveText(/^[^~]+ · \$[\d,]+$/, { timeout: 5_000 });
  const after = await dots.evaluateAll((cs) => cs.map((c) => getComputedStyle(c).fillOpacity));
  expect(after).toEqual(before);
});

/**
 * The scatter names the subject beside their dot, in the words and the colour the strip above names
 * them, and the dot holds still: an endlessly pulsing ring was how a reader was meant to find them,
 * motion no one asked for that kept pulling the eye back. The name sits on the dot's own side of the
 * tenure line, so the line never runs between a name and whom it names, and it clears 4.5:1 against
 * the halo it is written on.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`the scatter names the subject beside a still mark (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, AARON);
    const plot = page.locator('.tenure-plot');
    const label = plot.locator('.tenure-self-label');
    await expect(label).toBeVisible();
    await expect(plot.locator('.tenure-fit line')).toBeAttached();
    expect((await label.textContent())?.trim()).toBe((await page.locator('.peer-strip-you').textContent())?.trim());
    await expect(plot.locator('.tenure-self animate')).toHaveCount(0);
    expect(await plot.locator('.tenure-self').evaluate((g) => g.getAnimations({ subtree: true }).length)).toBe(0);

    const g = await plot.evaluate((el) => {
      const dot = [...el.querySelectorAll<SVGCircleElement>('.tenure-self circle')].pop()!;
      const text = el.querySelector<SVGTextElement>('.tenure-self-label')!;
      const fit = el.querySelector<SVGLineElement>('.tenure-fit line')!;
      const b = text.getBBox();
      const cs = getComputedStyle(text);
      const n = (e: Element, a: string) => Number(e.getAttribute(a));
      return {
        dot: { x: n(dot, 'cx'), y: n(dot, 'cy') },
        box: { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height },
        line: { x1: n(fit, 'x1'), y1: n(fit, 'y1'), x2: n(fit, 'x2'), y2: n(fit, 'y2') },
        fill: cs.fill,
        halo: cs.stroke,
      };
    });
    const { dot, box, line } = g;
    // Near: the box's nearest point within 30px of the dot's centre (the ring is 9px, the gap ~5).
    const dx = Math.max(box.left - dot.x, 0, dot.x - box.right), dy = Math.max(box.top - dot.y, 0, dot.y - box.bottom);
    expect(Math.hypot(dx, dy), 'the name is not beside the dot').toBeLessThanOrEqual(30);
    // Same side of the tenure line as the dot.
    const side = (x: number, y: number) => Math.sign((line.x2 - line.x1) * (y - line.y1) - (line.y2 - line.y1) * (x - line.x1));
    expect(side((box.left + box.right) / 2, (box.top + box.bottom) / 2), 'the tenure line runs between the name and the dot').toBe(side(dot.x, dot.y));
    expect(contrast(parseColor(g.fill).slice(0, 3), parseColor(g.halo).slice(0, 3)), `${g.fill} on ${g.halo}`).toBeGreaterThanOrEqual(4.5);
  });
}

/**
 * On a phone the plot is a quarter as wide, and the subject's name and the tenure line's still have to
 * fit in it: clear of each other, of the ring round the subject's dot, and inside the plot.
 */
test("at phone width the scatter's names stay inside the plot and clear of each other", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, AARON);
  const plot = page.locator('.tenure-plot');
  await plot.scrollIntoViewIfNeeded();
  await expect(plot.locator('.tenure-self-label')).toBeVisible();
  await expect(plot.locator('.tenure-fit-label')).toBeVisible();
  const g = await plot.evaluate((el) => {
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return {
      self: r(el.querySelector('.tenure-self-label')!),
      fit: r(el.querySelector('.tenure-fit-label')!),
      ring: r(el.querySelector('.tenure-self circle')!),
      plot: r(el.querySelector('.recharts-cartesian-grid-bg')!),
    };
  });
  const [self, fit, ring, area] = [g.self, g.fit, g.ring, g.plot].map(boxOf);
  expect(overlaps(self, fit), 'the two names overlap').toBe(false);
  expect(overlaps(self, ring), "the subject's name covers their ring").toBe(false);
  for (const [name, b] of [['subject', self], ['tenure line', fit]] as const) {
    expect(b.left, `the ${name}'s name leaves the plot on the left`).toBeGreaterThanOrEqual(area.left - 1);
    expect(b.right, `the ${name}'s name leaves the plot on the right`).toBeLessThanOrEqual(area.right + 1);
    expect(b.top, `the ${name}'s name leaves the plot at the top`).toBeGreaterThanOrEqual(area.top - 1);
    expect(b.bottom, `the ${name}'s name leaves the plot at the bottom`).toBeLessThanOrEqual(area.bottom + 1);
  }
});
