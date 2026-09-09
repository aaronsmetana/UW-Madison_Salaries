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

/**
 * The density ribbon is drawn at pixel resolution, and is still a distribution when it gets there.
 *
 * A cohort too dense to draw as dots falls back to a ribbon, and that ribbon used to ask `binSalaries`
 * for 24 bins. `niceStep` rounds to round dollar widths, so across the 1,251 Professors' $739k range
 * it returned $50k bins — fifteen of them — and the whole mound was three points 68px apart. It read
 * as a sawtooth rather than a distribution, which is what a reader reported.
 *
 * Two assertions, because the two ways to get this wrong are opposite. Segment spacing catches
 * under-binning: the facets coming back. Roughness catches over-smoothing — a kernel wide enough to
 * iron the distribution into one featureless lognormal blob. Peak height would catch NEITHER, because
 * the curve is normalised to its own smoothed peak and so reaches the top of the lane whatever the
 * kernel does.
 *
 * The roughness scale is `lib/distribution.ts`'s own, from tuning the landing page's kernel: mean
 * |second difference| over mean height, where raw $1k buckets score 0.579 and "read as static", $5k
 * scores 0.003 and is "a featureless lognormal blob", and the shipped kernel lands at 0.059. This
 * chart measures 0.033 with 12 humps, so the band below is wide enough not to be brittle and narrow
 * enough that either failure mode falls outside it.
 */
test('the peer density ribbon is drawn at pixel resolution', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Professor — 1,251 people, the cohort dense enough to take the ribbon path at all.
  await openPerson(page, 'Kenneth Poss');

  const m = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.peer-strip svg');
    if (!svg) return { mode: 'no chart' as const };
    const line = [...svg.querySelectorAll('path')].find((p) => getComputedStyle(p).fill === 'none');
    if (!line) return { mode: 'dots' as const };

    const d = line.getAttribute('d') ?? '';
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const base = Math.max(...ys);
    const heights = ys.map((y) => base - y);
    const peak = Math.max(...heights);
    const meanH = heights.reduce((a, b) => a + b, 0) / heights.length;

    let secondDiff = 0;
    let humps = 0;
    for (let i = 1; i < heights.length - 1; i++) {
      secondDiff += Math.abs(heights[i - 1] - 2 * heights[i] + heights[i + 1]);
      if (heights[i] > heights[i - 1] && heights[i] >= heights[i + 1] && heights[i] > peak * 0.1) humps++;
    }

    return {
      mode: 'ribbon' as const,
      vertices: ys.length,
      pxPerSegment: svg.getBoundingClientRect().width / Math.max(1, ys.length - 1),
      roughness: meanH > 0 ? secondDiff / (heights.length - 2) / meanH : 0,
      humps,
    };
  });

  expect(m.mode, 'this cohort no longer draws the ribbon, so nothing here is tested').toBe('ribbon');
  const seen = JSON.stringify(m);
  expect(m.pxPerSegment!, `the ribbon is drawn in coarse facets again — ${seen}`).toBeLessThanOrEqual(5);
  expect(m.roughness!, `the ribbon has been smoothed into a featureless blob — ${seen}`).toBeGreaterThan(0.008);
  expect(m.roughness!, `the ribbon is jagged rather than smoothed — ${seen}`).toBeLessThan(0.25);
  expect(m.humps!, `the distribution has lost its structure — ${seen}`).toBeGreaterThanOrEqual(3);
});

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

/**
 * A person with two concurrent appointments under ONE title. The history table used to sum a
 * snapshot's rows per job code and then divide each row's own pay by that sum, so both of Gulnara
 * Glowacki's Lecturer lines reported a pay cut every cycle — −70.1% and −27.9% in Mar 2022, on a
 * page where each appointment had risen 2.0%. 1,345 cells across the dataset said that.
 *
 * The rule now pairs appointments by department and only combines what it cannot match, so this
 * asserts BOTH halves: no cell in a split snapshot carries the part-over-whole value, and a cell that
 * cannot be attributed says so rather than quietly presenting a per-line figure.
 */
test('concurrent appointments are tracked one by one, in a stable order', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  await page.getByRole('tab', { name: 'History' }).click();

  const rows = await page.locator('table').filter({ hasText: 'Job code' }).locator('tbody tr').all();
  expect(rows.length).toBeGreaterThan(10);

  const seen: { snapshot: string; appt: string; dept: string; raise: string }[] = [];
  for (const row of rows) {
    const cells = row.locator('td');
    const raw = (await cells.nth(0).innerText()).replace(/\s+/g, ' ').trim();
    const snapshot = raw;
    seen.push({
      // The badge now names the appointment ("1 of 2"), so strip it to get the snapshot itself —
      // otherwise every row lands in its own group and a within-snapshot comparison sees nothing.
      snapshot: snapshot.replace(/\d+ of \d+/, '').trim(),
      appt: snapshot.match(/\d+ of \d+/)?.[0] ?? '',
      dept: (await cells.nth(3).innerText()).split('\n').pop()!.trim(),
      raise: (await cells.nth(6).innerText()).replace(/\s+/g, ' ').trim(),
    });
  }

  const splits = seen.filter((r) => r.appt);
  expect(splits.length, 'this person must still have concurrent appointments to be a useful case').toBeGreaterThan(8);

  for (const { raise } of splits) {
    const pct = Number(raise.match(/-?\d+\.?\d*(?=%)/)?.[0] ?? 0);
    // The part-over-whole values this page used to print. A 0.333-FTE line divided by the pair total
    // lands near −70%; nothing real on this page falls below −35% (Sep 2024's genuine FTE reversal).
    expect(pct, `"${raise}" is a part divided by the pair total`).toBeGreaterThan(-35);
  }

  // The two appointments move by different amounts, and only a WITHIN-snapshot comparison can see
  // it: a rule that gave every split row one shared figure still varies from snapshot to snapshot,
  // so the set of all values down the page cannot tell the two apart.
  const bySnapshot = new Map<string, Set<string>>();
  for (const { snapshot, raise } of splits) {
    if (!bySnapshot.has(snapshot)) bySnapshot.set(snapshot, new Set());
    bySnapshot.get(snapshot)!.add(raise);
  }
  const differsWithin = [...bySnapshot.values()].filter((v) => v.size > 1).length;
  expect(differsWithin, 'no snapshot shows its two appointments moving by different amounts').toBeGreaterThan(2);

  /*
   * The property that makes an appointment followable, and the one no per-row assertion can see: the
   * larger appointment must occupy the same position in every snapshot. Sorting by date alone left
   * the order to the query, and this person's 0.667 line was second in Mar 2022 and first in
   * Sep 2024 — 1,207 transitions across 678 people flipped like that.
   *
   * Compared by ordinal rather than by department name on purpose: Sep 2025 renames both departments,
   * so a name-based check would report a flip where the rows in fact held their places.
   */
  const positions = new Map<string, string[]>();
  for (const { snapshot, appt, dept } of splits) {
    if (!positions.has(snapshot)) positions.set(snapshot, []);
    positions.get(snapshot)![Number(appt.split(' ')[0]) - 1] = dept;
  }
  const twoUp = [...positions.entries()].filter(([, d]) => d.length === 2 && d.every(Boolean));
  expect(twoUp.length, 'need several two-appointment snapshots to compare').toBeGreaterThan(4);
  const firstSlot = twoUp.map(([snap, d]) => `${snap.split(' 20')[0]}=${d[0]}`);
  // Every snapshot's first row is the 0.667 (or larger) German line; none is the 0.333 line.
  const slotOne = new Set(twoUp.map(([, d]) => (d[0].includes('German') ? 'larger' : 'smaller')));
  expect([...slotOne], `first row per snapshot: ${firstSlot.join(', ')}`).toEqual(['larger']);

  // FTE now resolves the renamed-department snapshot, so nothing on this page falls back to the
  // across-both label — the reader sees a per-appointment figure on every row.
  const fellBack = splits.filter((r) => /across/.test(r.raise));
  expect(fellBack.map((r) => r.snapshot), 'no row here should need the combined fallback').toEqual([]);
});
