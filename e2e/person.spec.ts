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
