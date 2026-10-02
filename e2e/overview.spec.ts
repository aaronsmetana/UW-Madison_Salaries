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
 * A beeswarm round a centreline (the person-page redesign): the people spread both ways from the line, as
 * near it as their neighbours allow, so a cluster bulges into a shape — piled up from the axis, a small title
 * read as pebbles on a floor. The subject is placed first, on the line, among the people they are measured
 * against, the same size as everyone (their pip and their name say who they are). The middle-50% band is
 * drawn behind the swarm and spans it.
 */
test('the strip spreads its people both ways from a centreline, the subject on it', async ({ page }) => {
  await open(page, AARON);
  await expect(page.locator('.peer-strip circle.chart-dot').first()).toBeAttached();
  const m = await page.locator('.peer-strip').evaluate((el) => {
    const svg = el.querySelector<SVGSVGElement>('svg:has(circle.chart-dot)')!;
    const dots = [...svg.querySelectorAll('circle.chart-dot')].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), r: Number(c.getAttribute('r')) }));
    const ys = dots.map((d) => d.y);
    const count = new Map<number, number>();
    for (const y of ys) count.set(y, (count.get(y) ?? 0) + 1);
    const mid = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const band = el.querySelector('rect.band-iqr')!;
    const mark = el.querySelector('.peer-strip-marker')!;
    const markX = Number(mark.getAttribute('cx')), markY = Number(mark.getAttribute('cy'));
    // Any two people closer than their two radii: overlapping dots.
    let overlaps = 0;
    const all = [...dots, { x: markX, y: markY, r: Number(mark.getAttribute('r')) }];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) < all[i].r + all[j].r - 0.01) overlaps++;
    return {
      n: ys.length, mid, overlaps,
      above: ys.filter((y) => y < mid - 0.5).length,
      below: ys.filter((y) => y > mid + 0.5).length,
      bandTop: Number(band.getAttribute('y')), bandBottom: Number(band.getAttribute('y')) + Number(band.getAttribute('height')),
      top: Math.min(...ys) - 5, bottom: Math.max(...ys) + 5, markY, markR: Number(mark.getAttribute('r')),
    };
  });
  expect(m.n, 'the strip drew no dots').toBeGreaterThan(20);
  expect(m.above, 'no dot sits above the line').toBeGreaterThan(0);
  expect(m.below, 'no dot sits below the line: the strip is stacked on its floor').toBeGreaterThan(0);
  expect(m.markY, 'the subject is not on the centreline').toBe(m.mid);
  expect(m.markR, 'the subject is drawn larger than everyone else').toBe(5);
  expect(m.overlaps, 'two people overlap').toBe(0);
  expect(m.bandTop, 'the middle-50% band does not span the swarm').toBeLessThanOrEqual(m.top);
  expect(m.bandBottom).toBeGreaterThanOrEqual(m.bottom);
});

/**
 * The key over the strip names the subject with their own dot, then every colour the chart paints. The
 * density ribbon's key used to say "Everyone with this title" in grey while its dot field painted the
 * same-school people green, leaving a colour on the chart with no name.
 */
for (const [who, key, name, ribbon] of [['a small title', AARON, 'Aaron Smetana', false], ['a large title, drawn as a ribbon', KENNETH, 'Kenneth Poss', true]] as const) {
  test(`the strip's key names the subject and each colour it paints: ${who}`, async ({ page }) => {
    await open(page, key);
    const card = stripCard(page);
    if (ribbon) {
      const field = card.locator('.strip-dots').first();
      await expect(field, 'this title is no longer drawn as a ribbon').toBeAttached();
      await expect.poll(() => field.getAttribute('data-inks'), { timeout: 15_000 }).toMatch(/\|/);
      expect((await field.getAttribute('data-inks'))!.split('|').length, 'the field paints one ink, so there is no green to name').toBeGreaterThanOrEqual(2);
    }
    const legend = card.locator('.marker-legend');
    await expect(legend.locator('.mantine-Text-root')).toHaveText([name, 'Same school', 'Others']);
    await expect(legend.locator('.dot-chip circle[data-mark]')).toHaveCount(3);
    // Over the plot it explains, read before it.
    expect(await legend.evaluate((l) => !!(l.compareDocumentPosition(document.querySelector('.peer-strip')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
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
  const finding = card.locator('.peer-finding');
  await expect(finding).toHaveText(/^Aaron is paid more than \d+% of the \d+ others titled System Engineer IV \(IT040\), and \$[\d,]+ (below|above) the median\.$/);
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
  await expect(page.locator('.peer-strip .chart-tip-pill')).toHaveText(/^[^~]+ · \$[\d,]+( · [\d.]+ yrs)?$/, { timeout: 5_000 });
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

/**
 * "Same school" thins the strip instead of redrawing it: everyone stays where they were, those outside the
 * school at 18%, the school's people and the subject as they were.
 */
test('choosing the same school dims the others where they stand', async ({ page }) => {
  await open(page, AARON);
  const read = () => page.locator('.peer-strip').evaluate((el) => {
    const svg = el.querySelector<SVGSVGElement>('svg:has(circle.chart-dot)')!;
    return [...svg.querySelectorAll('circle.chart-dot')].map((c) => ({
      at: `${c.getAttribute('cx')},${c.getAttribute('cy')}`,
      mark: c.getAttribute('data-mark'),
      opacity: Number(getComputedStyle(c.parentElement!).opacity),
    }));
  });
  const before = await read();
  await page.getByText(/^Same school \d+$/).click();
  await page.waitForTimeout(600);
  const after = await read();
  expect(after.map((d) => d.at).sort(), 'someone moved').toEqual(before.map((d) => d.at).sort());
  const op = (list: typeof after, mark: string) => [...new Set(list.filter((d) => d.mark === mark).map((d) => Math.round(d.opacity * 100) / 100))];
  expect(op(after, 'peer'), 'the others are not dimmed').toEqual([0.18]);
  expect(op(after, 'same-school'), 'the school is dimmed').toEqual([1]);
  expect(op(before, 'peer'), 'the others were dimmed before').toEqual([1]);
  await expect(page.locator('.peer-strip-marker')).toBeVisible();
});

/**
 * The subject's name sits beside their dot, inside the plot, off every person and off the median's and the
 * band's names; a leader runs to it only when it has had to sit away. The median and the middle 50% are
 * named where they are: the median's name at the top of its line, the band's inside its foot.
 */
for (const width of [1440, 375]) {
  test(`the subject's name and the plot's own names are placed clear of each other and of the people (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, AARON);
    await page.mouse.move(1, 1);
    const g = await page.locator('.peer-strip').evaluate((el) => {
      const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
      const box = (b: DOMRect) => ({ x0: b.left, y0: b.top, x1: b.right, y1: b.bottom });
      const you = box(r(el.querySelector('.peer-strip-you'))!);
      const mark = r(el.querySelector('.peer-strip-marker'))!;
      const med = r(el.querySelector('.strip-median-label'));
      const band = r(el.querySelector('.strip-band-label'));
      const plot = r(el.querySelector('svg'))!;
      const medLine = r(el.querySelector('.strip-median'))!;
      const bandRect = r(el.querySelector('rect.band-iqr'))!;
      const dots = [...el.querySelectorAll('svg circle.chart-dot')].map((c) => r(c)!);
      const hit = (a: { x0: number; y0: number; x1: number; y1: number }, b: DOMRect) => a.x0 < b.right && b.left < a.x1 && a.y0 < b.bottom && b.top < a.y1;
      const cx = mark.left + mark.width / 2, cy = mark.top + mark.height / 2;
      const nx = Math.max(you.x0, Math.min(you.x1, cx)), ny = Math.max(you.y0, Math.min(you.y1, cy));
      return {
        inside: you.x0 >= plot.left - 1 && you.x1 <= plot.right + 1 && you.y0 >= plot.top - 1 && you.y1 <= plot.bottom + 1,
        dist: Math.hypot(nx - cx, ny - cy),
        leader: !!el.querySelector('.peer-strip-leader'),
        coversDots: dots.filter((d) => hit(you, d)).length,
        onMed: med ? hit(you, med) : false,
        onBand: band ? hit(you, band) : false,
        medNearTop: med ? Math.abs(med.top - medLine.top) <= 6 && Math.abs((med.left + med.right) / 2 - medLine.left) < med.width : true,
        bandInside: band ? band.left >= bandRect.left - 0.5 && band.right <= bandRect.right + 0.5 && band.bottom <= bandRect.bottom + 0.5 : true,
        medText: el.querySelector('.strip-median-label')?.textContent,
      };
    });
    expect(g.inside, "the subject's name leaves the plot").toBe(true);
    expect(g.dist, "the subject's name sits on their dot").toBeGreaterThanOrEqual(8 - 0.5);
    expect(g.coversDots, "the subject's name covers someone").toBe(0);
    expect(g.onMed, "the subject's name lies on the median's").toBe(false);
    expect(g.onBand, "the subject's name lies on the band's").toBe(false);
    expect(g.leader, `a leader where the name is ${Math.round(g.dist)}px off`).toBe(g.dist >= 11);
    expect(g.medText).toMatch(/^Median \$\d+k$/);
    expect(g.medNearTop, "the median's name is not at the top of its line").toBe(true);
    expect(g.bandInside, "the band's name is not inside its foot").toBe(true);
  });
}
