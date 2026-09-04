import { test, expect } from '@playwright/test';

test('search finds a person and navigates to their profile', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  await expect(page).toHaveURL(/\/person\//);
  // The lead "Actual pay" stat card.
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
});

/**
 * `%` and `_` are LIKE wildcards. The search box interpolates what a reader types into a LIKE
 * pattern, so before `sqlLikeContains` escaped them a single `%` matched all 22,000 employees and
 * `_` matched any character — the box quietly stopped being a search.
 */
test('typing a SQL wildcard searches for the character, not for everyone', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });

  // A real name first, to prove the query works at all and to wait out the DuckDB boot.
  await search.fill('Kenneth Poss');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 60_000 });

  // `__` is two "any single character" wildcards, so unescaped it matches every employee with a
  // name of two characters or more — i.e. everyone. Two characters, not one, because the box only
  // queries at `q.length >= 2`; a single `_` would never run the query and the test would pass
  // vacuously. Assert the *positive* empty state for the same reason: a count of zero is also true
  // in the window before results arrive.
  await search.fill('__');
  await expect(page.getByText(/No matches for/)).toBeVisible({ timeout: 15_000 });
});

/** Land on a person profile by name, the way a reader gets there. */
async function openPerson(page: import('@playwright/test').Page, name: string) {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill(name);
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.locator('.peer-strip')).toBeVisible({ timeout: 60_000 });
  // The axis stagger re-measures on document.fonts.ready; let it settle before reading geometry.
  await page.waitForTimeout(800);
}

/** Every pair of rendered text boxes inside the strip, tested in both axes. */
async function textCollisions(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.peer-strip');
    if (!strip) return ['no .peer-strip on the page'];
    const boxes = [...strip.querySelectorAll('*')]
      .filter((el) => !el.children.length && (el.textContent ?? '').trim())
      .map((el) => ({ text: (el.textContent ?? '').trim(), r: el.getBoundingClientRect() }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top) {
          hits.push(`"${boxes[i].text}" overlaps "${boxes[j].text}"`);
        }
      }
    }
    return hits;
  });
}

// The chart this replaced drew a salary axis out of every histogram bin edge, and at phone width all
// eleven adjacent pairs of those labels overlapped — "$95k$100k$105k…" as one unreadable run — while a
// quartile guide label printed straight through a bar's count. Neither is visible to axe or to a
// presence assertion, and the visual suite masks the plot, so this geometric check is the only guard.
// "Professor" is the known-bad cohort: a $749k maximum drags the median label toward the left edge.
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`peer strip labels never overlap (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPerson(page, 'Kenneth Poss');
    expect(await textCollisions(page), `at ${width}px`).toEqual([]);
  });

  test(`peer strip labels never overlap for a small cohort (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // A cohort small enough to draw dots rather than the density ribbon — the other render path.
    await openPerson(page, 'Aaron Smetana');
    expect(await textCollisions(page), `at ${width}px`).toEqual([]);
  });
}

// The subject used to be marked by recolouring one tile inside a stack of tiles, where the tile's
// height meant "count" for every other person and "rank within the bin" for them. Being one of the
// population's own marks is the thing that made it unreadable, so this asserts the separation the
// redesign is built on rather than any particular appearance.
test('peer strip marks the subject once, with a mark the peers do not use', async ({ page }) => {
  await openPerson(page, 'Aaron Smetana');
  await expect(page.locator('.peer-strip-marker')).toHaveCount(1);
  await expect(page.locator('.peer-strip .chart-dot')).not.toHaveCount(0);
  expect(await page.locator('.peer-strip-marker.chart-dot').count()).toBe(0);
});

// Both charts on this tab draw the same cohort, so a reader moving between them has to be able to
// carry the marking across. They agreed on nothing before: three different teals for "this person"
// across the app, and the population pale teal in one chart and grey in the other.
test('the strip and the scatter mark a person the same way', async ({ page }) => {
  await openPerson(page, 'Aaron Smetana');
  await expect(page.locator('.recharts-wrapper circle').first()).toBeVisible({ timeout: 60_000 });

  const marks = await page.evaluate(() => {
    const fill = (el: Element | null) => (el ? getComputedStyle(el).fill : null);
    const strip = document.querySelector('.peer-strip');
    const scatter = document.querySelector('.recharts-wrapper');
    return {
      stripSelf: fill(strip?.querySelector('.peer-strip-marker') ?? null),
      stripPeer: fill(strip?.querySelector('.chart-dot') ?? null),
      scatterPeer: fill(scatter?.querySelector('.chart-dot') ?? null),
      // The scatter's subject is the only circle it draws with a body-coloured stroke.
      scatterSelf: fill([...(scatter?.querySelectorAll('circle') ?? [])]
        .find((c) => getComputedStyle(c).strokeWidth === '1.5px') ?? null),
      legends: [...document.querySelectorAll('.mantine-Text-root')]
        .map((e) => (e.textContent ?? '').trim())
        .filter((t) => t === 'This person' || t === 'Same school' || t === 'Others'),
    };
  });

  expect(marks.stripSelf, 'subject fill').toBe(marks.scatterSelf);
  expect(marks.stripPeer, 'peer fill').toBe(marks.scatterPeer);
  // Each chart names the same three roles, so the labels appear twice apiece.
  expect(marks.legends.filter((t) => t === 'This person')).toHaveLength(2);
  expect(marks.legends.filter((t) => t === 'Others')).toHaveLength(2);
});

// PeerRangeBar's own p25/median/p75 labels are centered on their ticks, so a long-tailed cohort
// squeezes all three together and they render as one run. The person page no longer draws it, but the
// title page still does once a salary is pinned — with the same Professor cohort that first broke it
// (p75 $258k against a $749k maximum). The report brief draws it too, but its preview pane is
// display:none below the tablet breakpoint, so it cannot carry the narrow-width half of this guard.
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`peer-range quartile labels never overlap (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./paycheck?code=FA020');
    const pin = page.getByLabel('Salary to pin (optional)');
    await expect(pin).toBeVisible({ timeout: 60_000 });
    await pin.fill('278211');

    // Anchor both ends: the labels' container starts with "p25 $…" too, so a start-anchored regex
    // would match the wrapper and compare the wrong boxes.
    const p25 = page.getByText(/^p25 \$[\d.,]+k$/).first();
    await expect(p25).toBeVisible({ timeout: 60_000 });
    // The stagger re-measures on document.fonts.ready; let that settle before reading geometry.
    await page.waitForTimeout(800);
    const labels = [p25, page.getByText(/^median \$[\d.,]+k$/).first(), page.getByText(/^p75 \$[\d.,]+k$/).first()];

    const boxes = [];
    for (const label of labels) {
      const box = await label.boundingBox();
      expect(box, 'quartile label should have a layout box').not.toBeNull();
      boxes.push(box!);
    }

    // Two labels may share a row only if their horizontal spans are disjoint; otherwise they must have
    // been staggered onto different rows.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const sameRow = Math.abs(a.y - b.y) < 8;
        const overlapsX = a.x + a.width > b.x && b.x + b.width > a.x;
        expect(
          sameRow && overlapsX,
          `labels ${i}/${j} overlap at ${width}px — a=${JSON.stringify(a)} b=${JSON.stringify(b)}`
        ).toBe(false);
      }
    }
  });
}

/**
 * The scatter directly below the strip names the person you point at. The strip answered the same
 * gesture with an estimated axis value, so one dot meant two different things on one page. It snaps
 * to the nearest dot now — necessary, not decorative: these dots are r=4.5 and packed a couple of
 * pixels apart, which plain :hover makes a hard target for a mouse and an impossible one for a
 * finger. The axis readout stays for the space between dots, where it is the only sensible answer.
 */
test('the peer strip names the person under the cursor, and reads the axis between them', async ({ page }) => {
  await openPerson(page, 'Aaron Smetana');
  const dots = page.locator('.peer-strip circle.chart-dot');
  await expect(dots.first()).toBeVisible({ timeout: 60_000 });

  const box = await dots.nth(5).boundingBox();
  if (!box) throw new Error('peer dot has no box');
  const pill = page.locator('.peer-strip .chart-value-pill');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // A name and a pay figure — not the "~$X · Nth percentile" estimate.
  await expect(pill).toHaveText(/^[^~]+ · \$[\d,]+$/, { timeout: 5_000 });

  await page.mouse.move(box.x + box.width / 2, box.y - 34);
  await expect(pill).toHaveText(/^~\$[\d,]+/, { timeout: 5_000 });
});

/**
 * A legend that doesn't match the line it labels teaches the reader a key that is wrong. This one
 * had drifted twice over: the swatch for "Title median" was dashed "5 3" while the chart drew "6 4",
 * and "New title era" was "2 3" against the chart's "2 4". Nothing caught it because the legend and
 * the chart are 1,100 lines apart and neither one is wrong on its own.
 */
test('every dash in the trend legend is a dash the chart actually draws', async ({ page }) => {
  await openPerson(page, 'Aaron Smetana');
  await page.getByRole('tab', { name: /Salary trend/ }).click();
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  const dashes = await page.evaluate(() => {
    const norm = (el: Element) => getComputedStyle(el).strokeDasharray.replace(/px|\s/g, '');
    const chartRoot = document.querySelector('.recharts-wrapper')!;
    // Legend swatches are small standalone <svg> elements, not part of the Recharts surface.
    const swatches = [...document.querySelectorAll('svg:not(.recharts-surface) line')]
      .filter((l) => !chartRoot.contains(l))
      .map(norm)
      .filter((d) => d && d !== 'none');
    const drawn = [...chartRoot.querySelectorAll('path, line')].map(norm).filter((d) => d && d !== 'none');
    return { swatches: [...new Set(swatches)], drawn: [...new Set(drawn)] };
  });

  expect(dashes.swatches.length).toBeGreaterThan(0);
  for (const d of dashes.swatches) {
    expect(dashes.drawn, `legend draws ${d}, which the chart never does`).toContain(d);
  }
});
