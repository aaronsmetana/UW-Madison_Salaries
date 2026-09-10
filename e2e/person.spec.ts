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

/** One history row as the reader sees it, including the lane markers that carry its identity. */
type HistoryRow = {
  snapshot: string;
  /** True on the one row of a snapshot group that prints the snapshot's name. */
  labelled: boolean;
  /** The lane letter, or '' where the snapshot holds a single appointment. */
  lane: string;
  /** Filled node: the matcher found this line in the previous snapshot. Hollow: it starts here. */
  tracked: boolean;
  /**
   * Where the node actually sits, in px from the left of the gutter cell. The rendered proof of the
   * rule the letters only assert: a lane's slot is keyed to the lane, so an appointment ending never
   * slides the lines below it sideways.
   */
  nodeX: number;
  dept: string;
  raise: string;
  /** The "rate +2.0%" line under a percentage, where the pair's FTE or comp basis moved. */
  note: string;
  /** Segments on this row marked as an appointment ending. */
  caps: number;
  /** `data-group-last`, and the row border that follows from it. */
  groupLast: string;
  border: string;
  /** The department-change dot's accessible name, '' when there is no dot. */
  dotLabel: string;
};

async function readHistory(page: import('@playwright/test').Page): Promise<HistoryRow[]> {
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('table.appt-history tbody tr').first().waitFor();
  // The gutter column only exists for a person who holds concurrent appointments, so every other
  // column shifts by one for them. Detect it once rather than hard-coding two sets of indices.
  const off = await page.locator('table.appt-history thead th.appt-gutter-th').count();
  const rows = await page.locator('table.appt-history tbody tr').all();
  const out: HistoryRow[] = [];
  let snapshot = '';
  for (const row of rows) {
    const cells = row.locator('td');
    const badge = cells.nth(off).locator('.mantine-Badge-root');
    // The snapshot is named once per group, so carry its name down the rest of its own rows.
    const labelled = (await badge.count()) > 0;
    if (labelled) snapshot = (await badge.first().innerText()).replace(/\s+/g, ' ').trim();
    const chip = row.locator('.appt-lane-chip');
    const node = row.locator('.appt-gutter-node');
    let nodeX = -1;
    let tracked = true;
    if (await node.count()) {
      const [box, cellBox] = [await node.first().boundingBox(), await cells.nth(0).boundingBox()];
      nodeX = box && cellBox ? Math.round(box.x - cellBox.x) : -1;
      tracked = (await node.first().getAttribute('data-start')) === 'no';
    }
    const noteEl = row.locator('.appt-rate-note');
    const note = (await noteEl.count()) ? (await noteEl.first().innerText()).trim() : '';
    const dot = cells.nth(off + 3).locator('[role="img"]');
    // The percentage cell now also holds the note; strip it so the two are asserted separately and
    // a guard on one cannot pass on the other's text.
    const raiseCell = (await cells.nth(off + 6).innerText()).replace(/\s+/g, ' ').trim();
    out.push({
      snapshot,
      labelled,
      lane: (await chip.count()) ? (await chip.first().innerText()).trim() : '',
      tracked,
      nodeX,
      dept: (await cells.nth(off + 3).innerText()).split('\n').pop()!.trim(),
      raise: note ? raiseCell.replace(note, '').trim() : raiseCell,
      note,
      caps: await row.locator(".appt-gutter-track[data-ends='yes']").count(),
      groupLast: (await row.getAttribute('data-group-last')) ?? '',
      border: await row.evaluate((el) => getComputedStyle(el).borderBottomColor),
      dotLabel: (await dot.count()) ? ((await dot.first().getAttribute('aria-label')) ?? '') : '',
    });
  }
  return out;
}

const bySnapshot = (rows: HistoryRow[]) => {
  const m = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    if (!m.has(r.snapshot)) m.set(r.snapshot, []);
    m.get(r.snapshot)!.push(r);
  }
  return m;
};

/**
 * A person with two concurrent appointments under ONE title. The history table used to sum a
 * snapshot's rows per job code and then divide each row's own pay by that sum, so both of Gulnara
 * Glowacki's Lecturer lines reported a pay cut every cycle — −70.1% and −27.9% in Mar 2022, on a
 * page where each appointment had risen 2.0%. 1,345 cells across the dataset said that.
 *
 * The rule now pairs appointments by department, then by appointment percentage, and only combines
 * what it cannot match — so this asserts BOTH halves: no cell in a split snapshot carries the
 * part-over-whole value, and a cell that cannot be attributed says so rather than quietly presenting
 * a per-line figure. On top of that, each line carries a lane that lets it be followed down the page.
 */
test('concurrent appointments are tracked one by one, each in its own lane', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);
  expect(rows.length).toBeGreaterThan(10);

  const splits = rows.filter((r) => r.lane);
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
  const groups = bySnapshot(splits);
  const differsWithin = [...groups.values()].filter((g) => new Set(g.map((r) => r.raise)).size > 1).length;
  expect(differsWithin, 'no snapshot shows its two appointments moving by different amounts').toBeGreaterThan(2);

  // The property that makes an appointment followable: one lane letter, one appointment, all the way
  // down — including through Sep 2025, where the source renames BOTH of this person's departments at
  // once and only the appointment percentage still connects the lines.
  const laneToDept = new Map<string, Set<string>>();
  for (const { lane, dept } of splits) {
    if (!laneToDept.has(lane)) laneToDept.set(lane, new Set());
    laneToDept.get(lane)!.add(dept.includes('German') ? 'german' : 'other');
  }
  expect([...laneToDept.get('A')!], 'lane A must hold the same appointment in every snapshot').toEqual(['german']);
  expect([...laneToDept.get('B')!], 'lane B must hold the same appointment in every snapshot').toEqual(['other']);

  // No two concurrent lines may share a lane, or the letter identifies nothing.
  for (const [snapshot, g] of groups) {
    expect(new Set(g.map((r) => r.lane)).size, `${snapshot} reuses a lane letter`).toBe(g.length);
    // And the snapshot names itself exactly once, on the first row of its group.
    expect(g.filter((r) => r.labelled).length, `${snapshot} is named more than once`).toBe(1);
  }

  // Both Lecturer lines are matched to the previous snapshot from Mar 2022 on, so their rails are
  // solid; a dotted rail there would claim less than the matcher actually established. The two
  // Nov 2021 snapshots are the only place a lane may restart — the first snapshot has nothing behind
  // it, and its Post-TTC twin renumbers every job code.
  //
  // Stated as an exact set, not as "every dotted row is Nov 2021": that form is vacuously true the
  // moment nothing is dotted, and a sabotage that drew every rail solid sailed straight through it.
  const lecturerLanes = splits.filter((r) => r.lane === 'A' || r.lane === 'B');
  const restarts = [...new Set(lecturerLanes.filter((r) => !r.tracked).map((r) => r.snapshot))].sort();
  expect(restarts, 'a Lecturer lane restarted somewhere other than the TTC boundary').toEqual([
    'Nov 2021 (Post-TTC)', 'Nov 2021 (Pre-TTC)',
  ]);

  // FTE resolves the renamed-department snapshot, so nothing on this page falls back to the
  // across-both label — the reader sees a per-appointment figure on every row.
  expect(splits.filter((r) => /across/.test(r.raise)).map((r) => r.snapshot)).toEqual([]);
});

/**
 * The hard case, and the one that separates a lane derived from the MATCHING from a lane that is
 * merely the row's position. Jeanne Harris holds up to six concurrent appointments, every one of them
 * on the `0.00025`/`0` appointment-percentage sentinels, and two of her Standardized Patient lines
 * share a job code AND a department — nothing in the source tells those two apart. Her line count
 * runs 6→6→6→5→5→3→4→4→2, so positions shift underneath her while the appointments do not.
 */
test('a lane follows its appointment even as the rows around it disappear', async ({ page }) => {
  await openPerson(page, 'Jeanne Harris');
  const rows = await readHistory(page);
  const groups = bySnapshot(rows.filter((r) => r.lane));
  expect(Math.max(...[...groups.values()].map((g) => g.length)), 'need her six-line snapshot').toBeGreaterThanOrEqual(6);

  for (const [snapshot, g] of groups) {
    expect(new Set(g.map((r) => r.lane)).size, `${snapshot} reuses a lane letter`).toBe(g.length);
    expect(g.filter((r) => r.labelled).length, `${snapshot} is named more than once`).toBe(1);
  }

  // One appointment whose ROW MOVES UP as the lines above it end. Its letter must not move with it —
  // that is the whole difference between a lane and an index.
  //
  // Nov 2021 is excluded by name rather than by reading the rail: the TTC boundary renumbers every
  // job code, so nothing pairs across it and the lanes legitimately restart there. Filtering on
  // `tracked` instead would tie this assertion to the rail's, and a sabotage of one would trip the
  // other — which is exactly what happened when this was written that way.
  const cancer = [...groups.entries()]
    .map(([snapshot, g]) => ({ snapshot, at: g.findIndex((r) => r.dept.includes('Cancer')), g }))
    .filter((x) => x.at >= 0 && !x.snapshot.startsWith('Nov 2021'))
    .map((x) => ({ snapshot: x.snapshot, at: x.at, lane: x.g[x.at].lane }));
  expect(cancer.length, 'need several snapshots holding the Cancer Center appointment').toBeGreaterThan(2);
  expect(new Set(cancer.map((c) => c.lane)).size, `lane moved: ${JSON.stringify(cancer)}`).toBe(1);
  expect(new Set(cancer.map((c) => c.at)).size, `position never moved, so this proves nothing: ${JSON.stringify(cancer)}`).toBeGreaterThan(1);

  // The two Academic Affairs lines the source cannot separate report one figure across both, and
  // their nodes are hollow — the lane is position there, not evidence, and must not pretend otherwise.
  const combined = rows.filter((r) => /across/.test(r.raise));
  expect(combined.length, 'this person must still have unmatchable lines').toBeGreaterThan(2);
  expect(combined.filter((r) => r.tracked), 'an unmatched line is drawing a filled node').toEqual([]);

  // And no rate note: there is no single prior row to compare a rate against, so attributing one
  // would be the guess this module refuses to make.
  //
  // This is a structural invariant rather than a behavioural guard, and it is worth saying so.
  // `priorOf` is only ever set on a MATCHED row (payHistory.ts), and a combined row is by definition
  // the unmatched remainder — so the note cannot reach a combined row however the trigger is written.
  // A sabotage that removed the `kind === 'paired'` check failed nothing for exactly that reason.
  // What can regress is the note being computed from the ADJACENT row instead of the matched one —
  // the shape of the old department-dot bug, which put a false mark on 4,787 rows — and that is
  // caught by the exact-set assertion in the Gulnara note test, not here.
  expect(combined.map((r) => r.note), 'a combined row cannot claim what one rate did').toEqual(combined.map(() => ''));

  // The rendered half of rule 1, and the reason the gutter exists: a letter can only be followed if
  // the track it names holds one x-position for the whole table. Her line count collapses from six to
  // two, so any scheme that slotted tracks by the row's position within its snapshot would slide the
  // survivors left here. Asserted on the painted node, not on the data — the CSS has to agree too.
  const xByLane = new Map<string, Set<number>>();
  for (const { lane, nodeX } of rows.filter((r) => r.lane && r.nodeX >= 0)) {
    if (!xByLane.has(lane)) xByLane.set(lane, new Set());
    xByLane.get(lane)!.add(nodeX);
  }
  expect(xByLane.size, 'need several distinct lanes on this page').toBeGreaterThan(4);
  for (const [lane, xs] of xByLane) {
    expect([...xs], `lane ${lane}'s track moved sideways`).toHaveLength(1);
  }
  // ...and distinct lanes must not share a slot, or the tracks are drawn on top of one another.
  const allX = [...xByLane.values()].map((xs) => [...xs][0]);
  expect(new Set(allX).size, 'two lanes are drawn in the same slot').toBe(allX.length);
});

/**
 * The history table's percentage is the change in ACTUAL pay — rate x FTE — so an appointment
 * percentage move lands in it looking like a pay change. Gulnara Glowacki is the case: her rate rose
 * 4.0% in Apr 2024 and 2.0% in Sep 2024, and the column showed +55.9% and -32.0% because her FTE went
 * 0.667 -> 1.0 and back. Across the data 2,519 figures carry a sign that contradicts what the rate
 * did. The note is what stops the number lying on its own.
 */
test('a percentage moved by FTE says what the rate actually did', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);

  // An exact set, not `some`/`every`: this fails both when a note goes missing and when one appears
  // on a row whose pair never moved.
  const noted = rows.filter((r) => r.note).map((r) => `${r.snapshot} ${r.note}`).sort();
  expect(noted).toEqual(['Apr 2024 rate +4.0%', 'Sep 2024 rate +2.0%']);

  // The figure and its explanation must be in the same cell — a note one row away explains nothing.
  const sep24 = rows.find((r) => r.snapshot === 'Sep 2024' && r.note)!;
  expect(sep24.raise).toContain('-32.0%');
  expect(sep24.note).toBe('rate +2.0%');
});

/**
 * The department-change dot used to be a 6px orange square of colour with a hover tooltip and nothing
 * else — invisible to a screen reader, unreachable by keyboard, and it left the reader to scroll up
 * and diff two rows to find out what changed.
 */
test('the department-change dot names what it was', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);
  const dotted = rows.filter((r) => r.dotLabel);
  // Only Sep 2025, where the source really did rename both of her units.
  expect(dotted.map((r) => r.snapshot)).toEqual(['Sep 2025', 'Sep 2025']);
  for (const r of dotted) {
    expect(r.dotLabel, 'the dot must carry an accessible name').not.toBe('');
    expect(r.dotLabel, 'and it must name the previous value, not just say something changed')
      .toMatch(/was: .+/);
  }
  // The column itself is labelled, rather than being an unexplained strip down the left.
  const gutterTh = page.locator('table.appt-history thead th.appt-gutter-th');
  expect(await gutterTh.getAttribute('aria-label')).toBe('Appointment');
});

/**
 * A line that stops is only an appointment ENDING when the next snapshot does not hold that lane at
 * all. Two other shapes must not be capped: the final snapshot (those are the appointments the person
 * holds now, the data simply stops) and a lane that RESTARTS below (at the Nov 2021 TTC boundary every
 * job code was renumbered, so the matcher loses the thread while the appointments carry on — the
 * hollow node already says that, and a terminus would upgrade it to a claim).
 */
test('only an appointment the next snapshot does not hold is marked as ended', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);

  const capped = rows.filter((r) => r.caps > 0).map((r) => `${r.snapshot} x${r.caps}`);
  expect(capped).toEqual(['Aug 2022 x1', 'Sep 2025 x1']);

  // Stated separately, and selected by position rather than by `caps`, so this cannot pass merely
  // because the assertion above did.
  expect(rows[rows.length - 1].caps, 'the final snapshot holds current appointments, not ended ones').toBe(0);
  const ttc = rows.filter((r) => r.snapshot.startsWith('Nov 2021'));
  expect(ttc.map((r) => r.caps), 'a TTC reclassification is not an ending').toEqual(ttc.map(() => 0));
});

/** A snapshot's rows are one block: no rule inside it, the strongest rule in the table around it. */
test('a snapshot with two appointments reads as one block', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);
  const seen = rows.map((r) => `${r.groupLast}:${/rgba\(0, 0, 0, 0\)/.test(r.border) ? 'none' : 'rule'}`);
  // Every inner row draws nothing and every closing row draws a rule — as a mapping, so it fails in
  // both directions rather than counting.
  expect(new Set(seen)).toEqual(new Set(['no:none', 'yes:rule']));
  expect(seen.filter((x) => x === 'no:none').length, 'this person must still have grouped rows').toBeGreaterThan(5);
});

/**
 * Parse any colour Chrome returns from getComputedStyle into 0-255 RGB plus alpha. It must handle
 * `color(srgb r g b / a)`, whose channels are 0-1 FLOATS — which is what Chrome returns for several of
 * this table's backgrounds in dark mode. Reading those as 0-255 is the mistake that once reported
 * four different lane colours as the same grey and every dark background as black.
 */
function parseColor(css: string): [number, number, number, number] {
  const c = css.trim();
  let m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
  throw new Error(`unparsed colour: ${css}`);
}
const flatten = ([r, g, b, a]: number[], [br, bg, bb]: number[]) =>
  [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
function contrast(x: number[], y: number[]): number {
  const L = ([r, g, b]: number[]) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [L(x) + 0.05, L(y) + 0.05];
  return Math.max(a, b) / Math.min(a, b);
}

/**
 * WCAG 1.4.11: a graphical object needed to understand the content must reach 3:1 against what it sits
 * on. These tracks ARE the mechanism for telling one appointment from another, and at the 45% alpha
 * they shipped with, seven of eight lane/scheme pairs failed. Asserted as a full matrix — every
 * lane-coloured object against every background a row can have — because checking one background is
 * exactly how a lane that passed at rest (3.15) and failed on hover (2.99) got through the first time.
 * Hover and the appointment tint are read by actually hovering, never from a token.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`every appointment track meets 3:1 against every background (${scheme})`, async ({ page }) => {
    // The parser is the thing that was wrong last time, so it is checked before it is trusted.
    expect(contrast(parseColor('rgb(255, 255, 255)'), parseColor('color(srgb 0 0 0)'))).toBeCloseTo(21, 1);
    expect(parseColor('color(srgb 1 0.5 0 / 0.25)').map(Math.round)).toEqual([255, 128, 0, 0]);

    await page.emulateMedia({ colorScheme: scheme });
    await openPerson(page, 'Jeanne Harris');   // six lanes: every slot colour in play
    await page.getByRole('tab', { name: 'History' }).click();
    const rows = page.locator('table.appt-history tbody tr');
    await rows.first().waitFor();

    const card = parseColor(await page.locator('table.appt-history').evaluate(
      (t) => getComputedStyle(t.closest('.mantine-Card-root')!).backgroundColor));
    const bgOf = async (i: number) => {
      const c = parseColor(await rows.nth(i).evaluate((tr) => getComputedStyle(tr.querySelector('td')!).backgroundColor));
      return flatten(c, card);
    };
    const n = await rows.count();
    const banded = await rows.evaluateAll((rs) => rs.findIndex((r) => (r as HTMLElement).dataset.band === '1'));
    const plain = await rows.evaluateAll((rs) => rs.findIndex((r) => (r as HTMLElement).dataset.band === '0'));
    const backgrounds: Record<string, number[]> = {
      card: flatten(card, card), band: await bgOf(banded), plain: await bgOf(plain),
    };
    // Hover a row that has partners in its run, then read both the hovered row and a lit sibling.
    await rows.nth(n - 1).hover();
    const lit = await rows.evaluateAll((rs) => rs.findIndex((r, i) => i !== rs.length - 1 && (r as HTMLElement).dataset.apptActive === 'yes'));
    backgrounds.hover = await bgOf(n - 1);
    expect(lit, 'hovering must light at least one other row, or the tint is untested').toBeGreaterThanOrEqual(0);
    backgrounds.tint = await bgOf(lit);

    // Every lane-coloured object on the page: track, filled node, hollow ring, end cap, chip border.
    const inks = await page.locator('table.appt-history').evaluate((t) => {
      const out: string[] = [];
      t.querySelectorAll('.appt-gutter-track').forEach((e) => out.push(getComputedStyle(e).backgroundColor));
      t.querySelectorAll(".appt-gutter-node[data-start='no']").forEach((e) => out.push(getComputedStyle(e).backgroundColor));
      t.querySelectorAll(".appt-gutter-node[data-start='yes']").forEach((e) => {
        const m = getComputedStyle(e).boxShadow.match(/(rgba?\([^)]*\)|color\([^)]*\))/);
        if (m) out.push(m[1]);
      });
      t.querySelectorAll(".appt-gutter-track[data-ends='yes']").forEach((e) => out.push(getComputedStyle(e, '::after').backgroundColor));
      t.querySelectorAll('.appt-lane-chip').forEach((e) => out.push(getComputedStyle(e).borderTopColor));
      return [...new Set(out)];
    });
    expect(inks.length, 'need several distinct lane colours on this page').toBeGreaterThan(3);

    const failures: string[] = [];
    for (const ink of inks) {
      const c = parseColor(ink);
      expect(c[3], `${ink} is translucent — a lane colour must be solid to be measured, and to be seen`).toBe(1);
      for (const [name, bg] of Object.entries(backgrounds)) {
        const r = contrast(c, bg);
        if (r < 3) failures.push(`${ink} on ${name}: ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
}

/**
 * Hovering a row lights the rest of that appointment — its RUN, not its lane. Gulnara Glowacki has 3
 * lanes but 5 runs: lanes A and B both restart at the Nov 2021 TTC boundary, where every job code was
 * renumbered and nothing pairs. Highlighting by lane would join her pre-TTC "Senior Lecturer" row to
 * the Lecturer line after it, asserting a continuity the matcher explicitly refuses.
 */
test('hovering a row lights its appointment, and only as far as it can be followed', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  await page.getByRole('tab', { name: 'History' }).click();
  const rows = page.locator('table.appt-history tbody tr');
  await rows.first().waitFor();
  const label = () => rows.evaluateAll((rs) => {
    let snap = '';
    return rs.map((r) => {
      const b = r.querySelectorAll('td')[1]?.querySelector('.mantine-Badge-root');
      if (b) snap = b.textContent!.trim();
      return { snap, lane: r.querySelector('.appt-lane-chip')?.textContent ?? '', lit: (r as HTMLElement).dataset.apptActive === 'yes',
               opacity: getComputedStyle(r).opacity };
    });
  });
  const before = await label();
  const target = before.findIndex((r) => r.snap === 'Mar 2022' && r.lane === 'A');
  await rows.nth(target).hover();
  const after = await label();

  // The German line from the point the matcher picked it up, down to her one remaining appointment.
  expect(after.filter((r) => r.lit).map((r) => `${r.snap} ${r.lane || '·'}`)).toEqual([
    'Nov 2021 (Post-TTC) A', 'Mar 2022 A', 'Aug 2022 A', 'Oct 2023 A', 'Apr 2024 A',
    'Sep 2024 A', 'Apr 2025 A', 'Sep 2025 A', 'Mar 2026 ·',
  ]);
  // Stated on its own, and selected by label rather than by the highlight, so it cannot pass because
  // the assertion above did: the same letter before the boundary is a different appointment.
  const preTtcA = after.find((r) => r.snap === 'Nov 2021 (Pre-TTC)' && r.lane === 'A')!;
  expect(preTtcA.lit, 'lane A before the TTC boundary is a different run').toBe(false);
  // And nothing is dimmed to make the rest stand out.
  expect(after.map((r) => r.opacity)).toEqual(after.map(() => '1'));
});

test('a person with one appointment per snapshot gets no lane markers at all', async ({ page }) => {
  await openPerson(page, 'Kenneth Poss');
  const rows = await readHistory(page);
  expect(rows.length).toBeGreaterThan(2);
  expect(rows.map((r) => r.lane), 'a single appointment needs no lane').toEqual(rows.map(() => ''));
  expect(rows.every((r) => r.labelled), 'every row is its own group, so every row names itself').toBe(true);
  // The column is absent, not merely empty — otherwise every person page would carry a blank gutter.
  expect(await page.locator('table.appt-history thead th.appt-gutter-th').count()).toBe(0);
  expect(await page.locator('table.appt-history .appt-gutter-node').count()).toBe(0);
  // And the snapshot-grouping rules never reach a table that has no groups to mark: every row here is
  // the last of its own snapshot, so an ungated rule would restyle all of them.
  expect(rows.map((r) => r.groupLast)).toEqual(rows.map(() => ''));
  // And no appointment highlight: with one line per snapshot there is nothing to follow.
  await page.locator('table.appt-history tbody tr').first().hover();
  expect(await page.locator("table.appt-history tbody tr[data-appt-active='yes']").count()).toBe(0);
});
