import { test, expect } from '@playwright/test';
import { readSurface, transparencyEmulator } from './glass';

// DuckDB-WASM needs a moment to boot on a cold page load; give assertions room via expect's
// built-in polling rather than fixed sleeps.

test('home renders KPI figures', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
});

test('theme toggle switches color scheme without blanking the page', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
  const toggle = page.getByRole('button', { name: /Switch theme/ });
  await expect(toggle).toBeVisible();
  const before = await page.locator('html').getAttribute('data-mantine-color-scheme');
  await toggle.click();
  await expect(async () => {
    const after = await page.locator('html').getAttribute('data-mantine-color-scheme');
    expect(after).not.toBe(before);
  }).toPass({ timeout: 5_000 });
  // Content is still there after the scheme change — the toggle didn't break rendering.
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible();
});

test('explore renders a trend chart and the real-dollar toggle', async ({ page }) => {
  await page.goto('./explore');
  await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 });
  const realToggle = page.getByText(/^\d{4} \$$/).first();
  await expect(realToggle).toBeVisible();
  await realToggle.click();
  // Toggling shouldn't blow away the chart.
  await expect(page.locator('svg').first()).toBeVisible();
});

test('data health page renders the source/manifest table', async ({ page }) => {
  await page.goto('./data');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 60_000 });
});

// The landing distribution's quartile markers are the same collision risk as PeerRangeBar's (see
// person.spec.ts): p25 and the median sit close together on a right-skewed curve, so their labels
// run into each other and render as one unreadable string. Same guard, same shape — and it must
// hold at phone width, where the chart is narrowest and all three crowd.
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`home distribution quartile labels never overlap (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./', { waitUntil: 'networkidle' });

    // Anchor both ends — the labels' container also starts with "p25 $…", and a start-anchored
    // regex would match the wrapper and compare the wrong boxes.
    const labels = [
      page.getByText(/^p25 \$[\d.,]+k$/).first(),
      page.getByText(/^median \$[\d.,]+k$/).first(),
      page.getByText(/^p75 \$[\d.,]+k$/).first(),
    ];
    await expect(labels[0]).toBeVisible({ timeout: 60_000 });
    // The stagger re-measures on document.fonts.ready; let that settle before reading geometry.
    await page.waitForTimeout(800);

    const boxes = [];
    for (const label of labels) {
      const box = await label.boundingBox();
      expect(box, 'quartile label should have a layout box').not.toBeNull();
      boxes.push(box!);
    }

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
 * The distribution is the landing page's centrepiece and the thing the hero's headline number labels,
 * but it reveals itself with a `scaleY(0.04) -> scaleY(1)` transition. A chart that never finishes that
 * transition renders as a 5px sliver and looks like an empty card — and it is invisible to the label
 * test above, which only reads the HTML labels beneath the SVG.
 *
 * (This is also the one thing that cannot be checked from a hidden browser tab: rAF is throttled to
 * zero there, so the reveal never advances and every measurement reads as stuck.)
 */
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`home distribution actually renders its curve (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./', { waitUntil: 'networkidle' });

    const svg = page.locator('.hero-dist-plot');
    await expect(svg).toBeVisible({ timeout: 60_000 });
    // The reveal is a 700ms transform; give it room to finish rather than racing it.
    await page.waitForTimeout(1_200);

    const box = await svg.boundingBox();
    expect(box, 'the distribution should have a layout box').not.toBeNull();
    expect(box!.height, 'the distribution collapsed — its reveal transform never completed').toBeGreaterThan(60);
    expect(box!.width, 'the distribution has no width').toBeGreaterThan(200);

    // A curve, not a flat line: the area path has to describe real vertical variation.
    const spread = await svg.locator('path').first().evaluate((el) => {
      const ys = (el.getAttribute('d') ?? '').match(/,(\d+(?:\.\d+)?)/g)?.map((m) => parseFloat(m.slice(1))) ?? [];
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    });
    expect(spread, 'the distribution path is flat — no shape in the data').toBeGreaterThan(40);
  });
}

// PayCheck tells the reader the salary they type "is never uploaded, saved, or put in the address
// bar". It used to live in a `?sal=` query parameter, which broke that in three places at once:
// browser history, any copied link, and — because GitHub Pages has no rewrite and deep links bounce
// through public/404.html — a request URL sent to GitHub's servers. This asserts the promise holds.
test('a pinned salary never reaches the URL', async ({ page }) => {
  await page.goto('./paycheck');

  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeVisible({ timeout: 60_000 });
  await title.click();
  await page.getByRole('option').first().click();

  const secret = '123456';
  await page.getByRole('textbox', { name: /Salary to pin/ }).fill(secret);
  // Let any state/URL write settle before reading the address bar.
  await page.waitForTimeout(1_000);

  expect(page.url()).not.toContain(secret);
  expect(page.url()).not.toContain('sal=');
  // The value is still doing its job on the page, just not in the URL.
  await expect(page.getByRole('textbox', { name: /Salary to pin/ })).toHaveValue(/123,?456/);
});

/**
 * index.html hard-codes one canonical URL and one social title, and index.html is what every route
 * loads — so all ~22,000 person pages declared themselves duplicates of the landing page. The head is
 * updated per route now; this checks the three rules that make that worth doing: a content page points
 * at itself, a view of the same content (`?tab=`) does not become a second URL, and a parameter that
 * genuinely selects the content (`?code=`) does.
 */
test('canonical URL and social title follow the route', async ({ page }) => {
  const head = () => page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
    title: document.title,
  }));

  await page.goto('./data', { waitUntil: 'networkidle' });
  const about = await head();
  expect(about.canonical, 'a content page is canonical to itself').toMatch(/\/data$/);
  expect(about.ogUrl).toBe(about.canonical);
  expect(about.ogTitle).toBe(about.title);
  expect(about.ogTitle).toMatch(/About the data/);

  await page.goto('./paycheck?code=IT040', { waitUntil: 'networkidle' });
  const titled = await head();
  expect(titled.canonical, 'a parameter that selects the content stays').toMatch(/\/paycheck\?code=IT040$/);

  await page.goto('./paycheck?code=IT040&tab=people', { waitUntil: 'networkidle' });
  expect((await head()).canonical, 'a view of the same content is not a second URL').toBe(titled.canonical);

  expect(titled.canonical).not.toBe(about.canonical);
});

/**
 * Booting DuckDB costs ~13.8 MB over the wire (7.5 MB wasm + 6.0 MB Parquet + ~250 KB worker/JS),
 * so the pages that serve from precomputed JSON must not pay for it. Home has `home-stats.json`
 * (1 KB) and gates all eight of its queries behind `needsSql`, and the 404 route renders no data at
 * all. That optimisation existed once before and was silently defeated by `DataErrorBanner` calling
 * the enabled form of `useDbReady` from the shell, on every route — exactly the kind of regression a
 * comment cannot prevent and this test can.
 *
 * `/data` is deliberately NOT in this list: `DuplicateIdentities` (DataHealth.tsx:587) runs two real
 * queries, so the data-health page genuinely needs the dataset and paying for it there is correct.
 */
for (const route of ['./', './this-route-does-not-exist']) {
  test(`no DuckDB boot on a route that never queries (${route})`, async ({ page }) => {
    const heavy: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\.wasm(\?|$)/.test(u) || /\.parquet(\?|$)/.test(u)) heavy.push(u.split('/').pop()!);
    });
    await page.goto(route);
    // Wait for the page to be genuinely settled, so "nothing was fetched" isn't just "not yet".
    await expect(page.locator('footer, [class*=Footer]').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    expect(heavy, `${route} downloaded DuckDB/Parquet it never queries`).toEqual([]);
  });
}

test('a route that does query still loads the dataset', async ({ page }) => {
  const heavy: string[] = [];
  page.on('request', (r) => {
    if (/\.parquet(\?|$)/.test(r.url())) heavy.push('parquet');
  });
  await page.goto('./explore');
  await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 });
  await expect(() => expect(heavy.length).toBeGreaterThan(0)).toPass({ timeout: 60_000 });
});

test('the data error banner still fires when the dataset really fails', async ({ page }) => {
  // The banner now observes rather than initiates, so the thing worth proving is that observing is
  // enough: a route that queries must still surface the failure.
  await page.route('**/salaries.parquet', (r) => r.abort());
  await page.goto('./explore');
  await expect(page.getByText(/Couldn't load the salary data/i)).toBeVisible({ timeout: 60_000 });
});

/**
 * The landing curve is a density estimate over $1k buckets, and three separate things have to hold
 * for it to look like one. Each is invisible in review and each has a plausible way of quietly
 * reverting, so each gets an assertion.
 */
test.describe('the landing distribution', () => {
  // Selected by class, not by viewBox: the plot's height is a design decision and changing it
  // should not silently unhook the tests that guard its contents.
  const CURVE = '.hero-dist-plot path[stroke]';

  test('is drawn at the resolution the data now carries', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator(CURVE).first()).toBeVisible({ timeout: 60_000 });
    const vertices = await page.locator(CURVE).first().evaluate(
      (el) => (el.getAttribute('d') ?? '').split('L').length - 1
    );
    // 250 buckets, so 249 line segments. Anything near 25 means the $10k buckets came back and the
    // curve is a faceted polyline again — which is what this whole change was about.
    expect(vertices, 'the curve lost its resolution').toBeGreaterThan(200);
  });

  test('is detailed without being static', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator(CURVE).first()).toBeVisible({ timeout: 60_000 });
    // Mean |second difference| down the drawn y-values, normalised by their mean. Note that this is
    // measured in SCREEN coordinates, not bin counts — the two differ by roughly 6x because screen y
    // is offset by the plot height, so these numbers are not the ones quoted in distribution.ts.
    //
    // The assertion is TWO-SIDED because the design decision has two sides. Measured on this snapshot
    // at the shipped geometry: an unsmoothed $1k curve scores 0.099 and reads as static, the $5k
    // kernel this used to ship scores 0.0012 and is a featureless blob, and the $1.2k kernel lands at
    // 0.016 — the round-number spikes at $35k/$40k/$50k intact, the line between them still a line.
    // The upper bound alone used to be the whole test, which would have waved through smoothing the
    // spikes away again.
    const roughness = await page.locator(CURVE).first().evaluate((el) => {
      const ys = (el.getAttribute('d') ?? '').split(/[ML]/).slice(1).map((p) => Number(p.split(',')[1]));
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      let acc = 0;
      for (let i = 1; i < ys.length - 1; i++) acc += Math.abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]);
      return acc / (ys.length - 2) / mean;
    });
    expect(roughness, 'the curve is drawing raw counts — it will read as static').toBeLessThan(0.06);
    expect(roughness, 'the curve has been over-smoothed back into a featureless blob')
      .toBeGreaterThan(0.006);
  });

  test('keeps its salary axis legible at every width', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.hero-dist-axis')).toBeVisible({ timeout: 60_000 });

    // How many salary labels fit is a question about pixels, and answering it from the dollar range
    // alone put "$200k" flush against "$250k+" at 375px — touching exactly, so they read as one
    // string. Measure the real gap; polled, because a resize reflows after `setViewportSize` returns.
    for (const width of [1440, 1024, 768, 480, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const row = document.querySelector('.hero-dist-axis');
              if (!row) return -1;
              const boxes = [...row.children]
                .map((c) => c.getBoundingClientRect())
                .sort((a, b) => a.left - b.left);
              // Fewer than two labels is not "no collisions", it is a missing axis — which is the
              // failure mode of gating the ticks on a measurement that never lands.
              if (boxes.length < 2) return -1;
              return Math.min(...boxes.slice(1).map((b, i) => b.left - boxes[i].right));
            }),
          { message: `axis labels crowd each other, or the axis is missing, at ${width}px`, timeout: 10_000 }
        )
        .toBeGreaterThanOrEqual(8);
    }
  });

  test('names the mound under the pointer', async ({ page }) => {
    await page.goto('./');
    const panel = page.locator('.hero-dist');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const box = (await panel.boundingBox())!;
    const pill = page.locator('.chart-value-pill').first();

    const readAt = async (frac: number) => {
      await page.mouse.move(box.x + box.width * frac, box.y + 60);
      await expect(pill).toBeVisible();
      const text = (await pill.textContent()) ?? '';
      // "$75k · 2,848 people ±$5k · 50th percentile" — a bucket, a headcount, the bandwidth it was
      // counted over, and where that bucket falls in the payroll.
      expect(text, 'the readout stopped naming a salary and a headcount').toMatch(
        /^\$[\d,]+k · [\d,]+ people ±\$\d+k · \d+(st|nd|rd|th) percentile$/
      );
      return Number(text.replace(/^.*· ([\d,]+) people.*$/, '$1').replace(/,/g, ''));
    };

    // The readout has to follow the data: the peak of a right-skewed pay distribution holds many
    // times more people than its tail.
    const atPeak = await readAt(0.31);
    const atTail = await readAt(0.93);
    expect(atPeak, 'the peak reported no one').toBeGreaterThan(0);
    expect(atPeak, 'the peak of the distribution is not busier than its tail').toBeGreaterThan(atTail * 5);

    // And it has to be a HEADCOUNT, not the curve's y-value. The curve is a smoothed density —
    // people per $1k bucket — and reporting it as "N people" would be a plain lie about the data.
    // Scale is what separates them: summing ±$5k around the mode gathers ~13% of everyone, where a
    // single bucket's density is ~1%. The ratio test above does NOT catch this (verified: it passes
    // with the density substituted), which is why the population is read out of the caption and
    // compared against.
    const caption = (await panel.getByText(/across [\d,]+ employees/).textContent()) ?? '';
    const population = Number(caption.replace(/^.*across ([\d,]+) employees.*$/s, '$1').replace(/,/g, ''));
    expect(population, 'could not read the population off the caption').toBeGreaterThan(1000);
    expect(atPeak, 'the readout is reporting the density, not a count of people')
      .toBeGreaterThan(population * 0.05);

    // Leaving the plot clears it, rather than stranding a readout over a curve nobody is pointing at.
    await page.mouse.move(box.x + box.width / 2, box.y - 90);
    await expect(pill).toBeHidden();
  });

  test('marks the width it is counting, not a hairline through the middle of it', async ({ page }) => {
    await page.goto('./');
    const panel = page.locator('.hero-dist');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const box = (await panel.boundingBox())!;
    const plot = (await page.locator('.hero-dist-plot').boundingBox())!;

    await page.mouse.move(box.x + box.width * 0.31, box.y + 60);
    const band = page.locator('.hero-dist-band');
    await expect(band, 'the hover readout draws no band').toBeVisible();

    // The band has to BE the ±$5k the pill claims, or the drawing and the number describe different
    // things — which is exactly what a 1px crosshair under a "±$5k" label was doing. The axis runs
    // $0 to the $250k cap, so $10k of span is 4% of the plot; allow a point either side for the
    // rounding in the percentage the band is positioned with.
    const w = (await band.boundingBox())!.width;
    const share = (w / plot.width) * 100;
    expect(share, `the band spans ${share.toFixed(1)}% of the plot, which is not the ±$5k it reports`)
      .toBeGreaterThan(3);
    expect(share, `the band spans ${share.toFixed(1)}% of the plot, which is wider than the ±$5k it reports`)
      .toBeLessThan(5);

    // It must frost what is under it rather than hide it: a solid band over the curve would cover
    // the spikes the reader is pointing at.
    const bg = await band.evaluate((el) => getComputedStyle(el).backgroundColor);
    const alpha = Number(bg.match(/[\d.]+\s*\)$/)?.[0].replace(')', '') ?? '1');
    expect(alpha, 'the band is opaque — it hides the curve it is meant to be highlighting')
      .toBeLessThan(0.5);
  });

  /**
   * The band marks its two edges and leaves its middle completely alone.
   *
   * Tested in pixels rather than in CSS, because the property that matters is not "there is a mask"
   * but "the reader can see the curve they are pointing at, unaltered". A gradient BACKGROUND would
   * satisfy any style-based assertion here while the backdrop blur went on softening the middle at
   * full strength — which is the thing that actually obscured the spikes.
   *
   * The comparison is a byte-compare of two tiny screenshots of the same strip, hovered and not.
   * Identical at the centre; different at the edge. Both halves are asserted, because a band that
   * changes nothing anywhere would pass the first check on its own.
   */
  test('marks its edges and leaves its middle untouched', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./', { waitUntil: 'networkidle' });
    await expect(page.locator('.hero-dist')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(600);

    const plot = (await page.locator('.hero-dist-plot').boundingBox())!;
    const hoverAt = { x: plot.x + plot.width * 0.3, y: plot.y + plot.height * 0.6 };
    const away = { x: plot.x + plot.width / 2, y: plot.y - 80 };

    await page.mouse.move(hoverAt.x, hoverAt.y);
    const band = page.locator('.hero-dist-band');
    await expect(band).toBeVisible();
    const b = (await band.boundingBox())!;

    // Low in the plot, clear of the readout dot (which rides the curve) and the pill above it.
    const y = plot.y + plot.height - 24;
    const strip = (x: number) => ({ clip: { x, y, width: 3, height: 8 } });
    const centre = b.x + b.width / 2 - 1.5;
    const edge = b.x;

    await page.mouse.move(away.x, away.y);
    await expect(band).toBeHidden();
    const centreBefore = await page.screenshot(strip(centre));
    const edgeBefore = await page.screenshot(strip(edge));

    await page.mouse.move(hoverAt.x, hoverAt.y);
    await expect(band).toBeVisible();
    const centreAfter = await page.screenshot(strip(centre));
    const edgeAfter = await page.screenshot(strip(edge));

    expect(
      Buffer.compare(centreBefore, centreAfter),
      'the middle of the band alters the curve underneath it — that is the part the reader is pointing at',
    ).toBe(0);
    expect(
      Buffer.compare(edgeBefore, edgeAfter),
      'the edge of the band draws nothing, so it marks no ±$5k boundary at all',
    ).not.toBe(0);
  });

  // The pill carries four variable-length fields and is ~65% of the panel's width on a phone, so
  // where it may sit is a pixel question. It was answered with two thresholds (anchor left below
  // 15%, right above 85%) that assumed a narrower pill, and adding the percentile broke it in the
  // middle of the range, where neither threshold applies — 2px off the panel at 375px, hovering at
  // 30%. Sweeping is the point: a spot check at either end passes the bug.
  for (const { name, width, height } of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 375, height: 812 },
  ]) {
    test(`keeps the readout inside the panel at every hover position (${name})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('./', { waitUntil: 'networkidle' });
      const panel = page.locator('.hero-dist');
      await expect(panel).toBeVisible({ timeout: 60_000 });
      const box = (await panel.boundingBox())!;
      // Swept across the PLOT, not the panel: the panel carries padding, so the first and last few
      // percent of its width sit beside the chart rather than over it and register no hover at all.
      const plot = (await page.locator('.hero-dist-plot').boundingBox())!;

      for (const frac of [0.01, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 0.95, 0.99]) {
        await page.mouse.move(plot.x + plot.width * frac, plot.y + plot.height * 0.5);
        const pill = page.locator('.chart-value-pill').first();
        await expect(pill).toBeVisible();
        const r = (await pill.boundingBox())!;
        expect(r.x, `the readout hangs off the left of the panel at ${frac * 100}%`)
          .toBeGreaterThanOrEqual(box.x - 1);
        expect(r.x + r.width, `the readout hangs off the right of the panel at ${frac * 100}%`)
          .toBeLessThanOrEqual(box.x + box.width + 1);
      }
    });
  }

  // The hero column is a reading measure and the figure is not prose. It was drawn at
  // `--content-prose` while the showcase tiles below it used `--content-max`, so the page's one
  // chart was 320px narrower than the row of cards under it for no reason a reader could see.
  // Swept rather than checked at one width, because there are two things to prove and only the
  // widest viewport shows both: above ~1560px the 1200px cap binds and the chart has to stop
  // growing WITH the tiles, and below it the chart has to keep pace as the column narrows.
  for (const width of [1920, 1600, 1280, 992, 768, 375]) {
    test(`is as wide as the tiles below it (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('./', { waitUntil: 'networkidle' });
      const panel = page.locator('.hero-dist');
      await expect(panel).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);

      const chart = (await panel.boundingBox())!.width;
      const tiles = (await page.locator('.mantine-SimpleGrid-root').last().boundingBox())!.width;
      expect(Math.abs(chart - tiles), `at ${width}px the chart is ${chart}px and the tiles below it are ${tiles}px`)
        .toBeLessThanOrEqual(1);
      // And it never outgrows the page it sits on.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `at ${width}px the chart pushes the page sideways`).toBe(0);
    });
  }

  test('is glass over a backdrop that actually reaches it', async ({ page }) => {
    await page.goto('./');
    const panel = page.locator('.hero-dist');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // 1. The panel is translucent and filtering — and goes solid when someone has asked for less
    //    transparency, which is the other half of the same rule. Both helpers live in `./glass`
    //    because every glass surface in the app needs this exact treatment; the comment there
    //    records why the preference is emulated rather than inherited.
    const transparency = await transparencyEmulator(page);
    const readPanel = () => readSurface(panel);

    await transparency('no-preference');
    const glass = await readPanel();
    expect(glass.filter, 'the panel stopped filtering its backdrop').toMatch(/blur\(/);
    expect(glass.alpha, `the panel went opaque (${glass.bg}), so there is nothing to see through`)
      .toBeLessThan(0.9);

    await transparency('reduce');
    const solid = await readPanel();
    expect(solid.filter, 'the panel still filters for a visitor who asked for less transparency').toBe('none');
    expect(solid.alpha, `the reduced-transparency fallback is still translucent (${solid.bg}), which is the washed-out card the fallback exists to avoid`)
      .toBe(1);
    await transparency('no-preference');

    // 2. There is something behind it to filter. The dot grid is masked to an ellipse that faded out
    //    two-thirds of the way down the panel — which is exactly the state this shipped in — and it
    //    did so only above 1024px, because the radius was a percentage of a page whose height nearly
    //    doubles at 375px. So this is checked at both ends of the range, and derived from the live
    //    geometry rather than from the numbers in the stylesheet.
    const measure = () => page.evaluate(() => {
      const grid = document.querySelector('.hero-dotgrid');
      const panelEl = document.querySelector('.hero-dist');
      if (!grid || !panelEl) return { mask: '', d: null as number | null, end: 0 };
      const cs = getComputedStyle(grid);
      const mask = cs.maskImage || cs.getPropertyValue('-webkit-mask-image');
      // The computed value drops the `ellipse` keyword (two radii already imply one) and resolves
      // `transparent` to `rgba(0, 0, 0, 0)`, so match what the browser reports, not what we wrote.
      // Either unit is accepted for the vertical terms: what is being checked is the coverage, not
      // the decision about how to express it.
      const N = '([\\d.]+)(%|px)';
      const m = new RegExp(
        `(?:ellipse\\s+)?[\\d.]+%\\s+${N}\\s+at\\s+[\\d.]+%\\s+${N}` +
        `.*?(?:transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\))\\s+([\\d.]+)%`
      ).exec(mask);
      if (!m) return { mask, d: null as number | null, end: 0 };
      const g = grid.getBoundingClientRect(), p = panelEl.getBoundingClientRect();
      const px = (v: string, unit: string) => (unit === 'px' ? Number(v) : (Number(v) / 100) * g.height);
      const ry = px(m[1], m[2]), cy = px(m[3], m[4]);
      // The panel is horizontally centred on the ellipse, so the vertical term is the whole distance.
      return { mask, d: (p.bottom - g.top - cy) / ry, end: Number(m[5]) / 100 };
    });

    const { mask, end } = await measure();
    expect(end, `the dot-grid mask is no longer the ellipse this test knows how to check: ${mask}`)
      .toBeGreaterThan(0);

    for (const viewport of [{ width: 1280, height: 720 }, { width: 375, height: 760 }]) {
      await page.setViewportSize(viewport);
      // Polled, not read once. `setViewportSize` resolves before the browser has finished
      // re-laying-out, and this is pure geometry taken the moment it returns: measured locally, the
      // panel reads 1188px below the grid immediately after the resize and settles to 508px a frame
      // later. A single read raced that — it passed here, where the preceding round-trip happened to
      // absorb the delay, and failed in CI, where it did not. The stylesheet was never wrong.
      await expect
        .poll(async () => (await measure()).d, {
          message: `at ${viewport.width}px the dot grid fades out before the bottom of the panel, so the glass frosts nothing`,
          timeout: 10_000,
        })
        .toBeLessThan(end);
    }
  });
});
