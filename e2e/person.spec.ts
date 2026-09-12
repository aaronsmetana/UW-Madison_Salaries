import { test, expect } from '@playwright/test';
import { parseColor, flatten, contrast } from './color';

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
    // Legend swatches are small standalone <svg> elements, not part of the Recharts surface — and only
    // this chart's own, in its card. Collected page-wide, the tenure scatter's legend on the (still
    // mounted) Overview tab was compared with this chart, and passed only while the two charts happened
    // to share a dash.
    const card = chartRoot.closest('.mantine-Card-root')!;
    const swatches = [...card.querySelectorAll('svg:not(.recharts-surface) line')]
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
  /** The lane letter on the row's station, or '' where the person has no gutter at all. */
  lane: string;
  /** Filled station: the matcher found this line in the previous snapshot. Dashed: it starts here. */
  tracked: boolean;
  /**
   * Where the station actually sits, in px from the left of the gutter cell. The rendered proof of the
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
  // Columns by their headers, not their positions: the gutter exists only for a person who holds
  // concurrent appointments, and Rate and Actual pay are one "Pay" column when they never differ.
  const headers = (await page.locator('table.appt-history thead th').allInnerTexts()).map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
  const col = (name: string) => {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`no "${name}" column in: ${headers.join(' | ')}`);
    return i;
  };
  const [snapCol, orgCol, changeCol] = [col('snapshot'), col('school / dept'), col('change')];
  const rows = await page.locator('table.appt-history tbody tr').all();
  const out: HistoryRow[] = [];
  let snapshot = '';
  for (const row of rows) {
    const cells = row.locator('td');
    const badge = cells.nth(snapCol).locator('.mantine-Badge-root');
    // The snapshot is named once per group, so carry its name down the rest of its own rows.
    const labelled = (await badge.count()) > 0;
    if (labelled) snapshot = (await badge.first().innerText()).replace(/\s+/g, ' ').trim();
    // The station is the row's letter and its mark on the line in one element.
    const station = row.locator('.appt-station');
    let nodeX = -1;
    let tracked = true;
    if (await station.count()) {
      const [box, cellBox] = [await station.first().boundingBox(), await cells.nth(0).boundingBox()];
      nodeX = box && cellBox ? Math.round(box.x - cellBox.x) : -1;
      tracked = (await station.first().getAttribute('data-start')) === 'no';
    }
    const noteEl = row.locator('.appt-rate-note');
    const note = (await noteEl.count()) ? (await noteEl.first().innerText()).trim() : '';
    const dot = cells.nth(orgCol).locator('[role="img"]');
    // The percentage cell now also holds the note; strip it so the two are asserted separately and
    // a guard on one cannot pass on the other's text.
    const raiseCell = (await cells.nth(changeCol).innerText()).replace(/\s+/g, ' ').trim();
    out.push({
      snapshot,
      labelled,
      lane: (await station.count()) ? (await station.first().innerText()).trim() : '',
      tracked,
      nodeX,
      dept: (await cells.nth(orgCol).innerText()).split('\n').pop()!.trim(),
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

  // Rows of snapshots that hold more than one appointment. Not "rows with a letter": every row of a
  // split history is lettered, including Mar 2026, where she holds one.
  const perSnapshot = bySnapshot(rows);
  const splits = rows.filter((r) => perSnapshot.get(r.snapshot)!.length > 1);
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
  // their stations are dashed — the lane is position there, not evidence, and must not pretend otherwise.
  const combined = rows.filter((r) => /across/.test(r.raise));
  expect(combined.length, 'this person must still have unmatchable lines').toBeGreaterThan(2);
  expect(combined.filter((r) => r.tracked), 'an unmatched line is drawing a filled station').toEqual([]);

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
  // survivors left here. Asserted on the painted station, not on the data — the CSS has to agree too.
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
  // ...and far enough apart that neighbouring letters do not overlap. The station IS the line's mark,
  // so two drawn over each other leave neither letter readable — a slot narrower than the station
  // still keeps every x distinct, which is why distinctness alone does not cover this.
  const width = await page.locator('table.appt-history .appt-station').first().evaluate((e) => e.getBoundingClientRect().width);
  const sorted = [...allX].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((x, i) => x - sorted[i]);
  expect(Math.min(...gaps), `neighbouring stations overlap: ${JSON.stringify(sorted)} at ${width}px`).toBeGreaterThanOrEqual(width);
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
  expect(sep24.raise).toContain('−32.0%');
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
 * dashed station already says that, and a terminus would upgrade it to a claim).
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
 * The claim the gutter is built on: a row's letter is not a label beside the lines, it is ON its own
 * line. It used to sit in a column of its own, at the same x on all twenty of Gulnara's rows, with a
 * 7px dot on the line doing the work — so the lines carried nothing a reader could see and read as a
 * double rule. Measured against the painted track of the station's OWN lane on the same row, which
 * every row draws (laneGutter), matched by slot rather than by position in the cell.
 */
test('each row sits on its own appointment line as a letter', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('table.appt-history tbody tr').first().waitFor();
  const seen = await page.locator('table.appt-history tbody tr').evaluateAll((trs) => trs.flatMap((tr) => {
    const td = tr.querySelector('td')!;
    const station = td.querySelector<HTMLElement>('.appt-station');
    if (!station) return [];
    const slot = station.style.getPropertyValue('--slot');
    const own = [...td.querySelectorAll<HTMLElement>('.appt-gutter-track')]
      .find((t) => t.style.getPropertyValue('--slot') === slot);
    const centre = (e: Element) => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; };
    return [{ letter: station.textContent ?? '', station: centre(station), line: own ? centre(own) : null }];
  }));
  expect(seen.length, 'this person must still have a gutter to measure').toBeGreaterThan(10);
  const off = seen
    .filter((r) => r.line === null || Math.abs(r.station - r.line) > 0.5)
    .map((r) => `${r.letter}: station at ${r.station.toFixed(1)}, its line at ${r.line?.toFixed(1) ?? 'none'}`);
  expect(off, 'a letter sits beside its line rather than on it').toEqual([]);
});

/**
 * A snapshot that holds one appointment, inside a history that elsewhere holds two, still letters its
 * row. The letter used to be hidden there ("A of 1" says nothing), but it is the line's name now: a
 * bare mark at the foot of the table would leave the reader tracing the line up to learn which one it
 * is. Gulnara's Mar 2026 is the only such snapshot on her page, and it continues her German line.
 */
test('the only appointment in a snapshot still names its line', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  const rows = await readHistory(page);
  const lone = [...bySnapshot(rows).entries()]
    .filter(([, g]) => g.length === 1)
    .map(([snapshot, g]) => `${snapshot}: ${g[0].lane || '(no letter)'} ${g[0].tracked ? 'filled' : 'dashed'}`);
  expect(lone).toEqual(['Mar 2026: A filled']);
});

/**
 * Dashed and filled are a state, not a style: dashed is exactly "the source cannot connect this line
 * to the snapshot above", which `data-start` records. Asserted as a mapping on the COMPUTED style, so
 * it fails in both directions — the attribute alone was already guarded, and CSS that painted the two
 * states the wrong way round would have passed every test that reads it.
 */
test('a dashed letter is exactly the line the source could not follow', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('table.appt-history tbody tr').first().waitFor();
  const seen = await page.locator('table.appt-history .appt-station').evaluateAll((els) => els.map((e) => {
    const cs = getComputedStyle(e);
    return { start: (e as HTMLElement).dataset.start ?? '', border: cs.borderTopStyle, fill: cs.backgroundColor, ring: cs.borderTopColor };
  }));
  expect(new Set(seen.map((s) => `${s.start}:${s.border}`))).toEqual(new Set(['yes:dashed', 'no:solid']));
  // Filled means filled with its own line's colour, and dashed means not. Compared with the station's
  // own ring rather than with the card, so whether the dashed fill is opaque stays the contrast test's
  // property and cannot fail this one.
  expect(seen.filter((s) => s.start === 'no' && s.fill !== s.ring).length, 'a followed station is not filled with its line').toBe(0);
  expect(seen.filter((s) => s.start === 'yes' && s.fill === s.ring).length, 'a starting station is filled as if followed').toBe(0);
});

/**
 * WCAG 1.4.11: a graphical object needed to understand the content must reach 3:1 against what it sits
 * on. These tracks ARE the mechanism for telling one appointment from another, and at the 45% alpha
 * they shipped with, seven of eight lane/scheme pairs failed. Asserted as a full matrix — every
 * lane-coloured object against every background a row can have — because checking one background is
 * exactly how a lane that passed at rest (3.15) and failed on hover (2.99) got through the first time.
 * Hover is read by actually hovering, never from a token.
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
    // The hovered row is the darkest background a track meets. It must come out as a third colour: a
    // hover that silently stopped applying would re-measure the card or the band and pass on those.
    await rows.nth(n - 1).hover();
    backgrounds.hover = await bgOf(n - 1);
    expect(backgrounds.hover, 'hover must repaint the row, not leave the card').not.toEqual(backgrounds.card);
    expect(backgrounds.hover, 'hover must repaint the row, not leave the band').not.toEqual(backgrounds.band);

    // Every lane-coloured object on the page: track, station ring, end cap. The ring is read on EVERY
    // station rather than choosing fill-or-ring by `data-start`: selecting by state would make this
    // test fail whenever the two states were painted the wrong way round, which is the next test's
    // property, not this one's. A filled station's fill is its ring colour, so nothing is missed.
    const inks = await page.locator('table.appt-history').evaluate((t) => {
      const out: string[] = [];
      t.querySelectorAll('.appt-gutter-track').forEach((e) => out.push(getComputedStyle(e).backgroundColor));
      t.querySelectorAll('.appt-station').forEach((e) => out.push(getComputedStyle(e).borderTopColor));
      t.querySelectorAll(".appt-gutter-track[data-ends='yes']").forEach((e) => out.push(getComputedStyle(e, '::after').backgroundColor));
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

    // The letter is TEXT, on the station's own fill, so its bar is 4.5:1 — and the fill must be opaque,
    // because the first snapshot draws its lines the full height of the row and a see-through station
    // would put the line through the letter.
    const letters = await page.locator('table.appt-history .appt-station').evaluateAll((els) =>
      [...new Set(els.map((e) => { const cs = getComputedStyle(e); return `${cs.color}|${cs.backgroundColor}`; }))]);
    expect(letters.length, 'need both station states on this page').toBeGreaterThan(1);
    const textFailures: string[] = [];
    for (const pair of letters) {
      const [ink, fill] = pair.split('|');
      const f = parseColor(fill);
      expect(f[3], `${fill}: a station must be opaque, or its line shows through the letter`).toBe(1);
      const r = contrast(parseColor(ink), f);
      if (r < 4.5) textFailures.push(`${ink} on ${fill}: ${r.toFixed(2)}`);
    }
    expect(textFailures, 'a station letter is below 4.5:1 on its own fill').toEqual([]);
  });
}

/**
 * Hover marks the row under the cursor and nothing else. A version that also lit the rest of the
 * appointment's rows down the page was tried and taken out as too much: the lane track already draws
 * that connection, at rest, for every reader.
 */
test('hovering a row highlights that row alone', async ({ page }) => {
  await openPerson(page, 'Gulnara Glowacki');
  await page.getByRole('tab', { name: 'History' }).click();
  const rows = page.locator('table.appt-history tbody tr');
  await rows.first().waitFor();
  const backgrounds = () => rows.evaluateAll((rs) => rs.map((r) => getComputedStyle(r.querySelector('td')!).backgroundColor));
  const resting = await backgrounds();
  // A row deep inside one appointment's run, so a multi-row highlight would have partners to light.
  const target = await rows.evaluateAll((rs) => {
    let snap = '';
    return rs.findIndex((r) => {
      const b = r.querySelectorAll('td')[1]?.querySelector('.mantine-Badge-root');
      if (b) snap = b.textContent!.trim();
      return snap === 'Mar 2022' && r.querySelector('.appt-station')?.textContent === 'A';
    });
  });
  expect(target).toBeGreaterThan(0);
  await rows.nth(target).hover();
  const hovered = await backgrounds();
  const changed = hovered.flatMap((bg, i) => (bg !== resting[i] ? [i] : []));
  expect(changed).toEqual([target]);
});

test('a person with one appointment per snapshot gets no lane markers at all', async ({ page }) => {
  await openPerson(page, 'Kenneth Poss');
  const rows = await readHistory(page);
  expect(rows.length).toBeGreaterThan(2);
  expect(rows.map((r) => r.lane), 'a single appointment needs no lane').toEqual(rows.map(() => ''));
  expect(rows.every((r) => r.labelled), 'every row is its own group, so every row names itself').toBe(true);
  // The column is absent, not merely empty — otherwise every person page would carry a blank gutter.
  expect(await page.locator('table.appt-history thead th.appt-gutter-th').count()).toBe(0);
  expect(await page.locator('table.appt-history .appt-station').count()).toBe(0);
  // And the snapshot-grouping rules never reach a table that has no groups to mark: every row here is
  // the last of its own snapshot, so an ungated rule would restyle all of them.
  expect(rows.map((r) => r.groupLast)).toEqual(rows.map(() => ''));
});
