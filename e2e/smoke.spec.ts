import { test, expect } from '@playwright/test';

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

    const svg = page.locator('svg[viewBox="0 0 1000 120"]');
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
  const CURVE = 'svg[viewBox="0 0 1000 120"] path[stroke]';

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

  test('is smooth, not a picket fence', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator(CURVE).first()).toBeVisible({ timeout: 60_000 });
    // Mean |second difference| down the drawn y-values. Raw $1k counts score ~0.58 on this snapshot
    // and the smoothed curve ~0.003; the gap is three orders of magnitude, so any threshold in
    // between is safe. This is the guard for "someone raised the resolution and dropped the kernel",
    // which would pass the vertex-count test above while looking far worse than the original.
    const roughness = await page.locator(CURVE).first().evaluate((el) => {
      const ys = (el.getAttribute('d') ?? '').split(/[ML]/).slice(1).map((p) => Number(p.split(',')[1]));
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      let acc = 0;
      for (let i = 1; i < ys.length - 1; i++) acc += Math.abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]);
      return acc / (ys.length - 2) / mean;
    });
    expect(roughness, 'the curve is drawing raw counts, not a density').toBeLessThan(0.05);
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
      // "$75k · 2,848 people ±$5k" — a bucket, a headcount, and the bandwidth it was counted over.
      expect(text, 'the readout stopped naming a salary and a headcount').toMatch(
        /^\$[\d,]+k · [\d,]+ people ±\$\d+k$/
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

  test('is glass over a backdrop that actually reaches it', async ({ page }) => {
    await page.goto('./');
    const panel = page.locator('.hero-dist');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // 1. The panel is translucent and filtering — and goes solid when someone has asked for less
    //    transparency, which is the other half of the same rule.
    //
    //    The preference is *emulated* rather than inherited. Asserting glass against whatever the
    //    host machine reports is not a test of the stylesheet, it is a test of the machine: this
    //    assertion passed on a developer Mac and failed in CI, because the panel there was correctly
    //    taking the `prefers-reduced-transparency` branch and the test had no idea that branch
    //    existed. Emulating both is deterministic everywhere and covers the fallback for free.
    //    Playwright's `emulateMedia` has no key for this feature yet, hence CDP.
    const cdp = await page.context().newCDPSession(page);
    const transparency = (value: 'no-preference' | 'reduce') =>
      cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });

    const readPanel = () => panel.evaluate((el) => {
      const cs = getComputedStyle(el);
      // `color-mix()` computes to `color(srgb r g b / a)`, not to `rgba()`, so read the alpha out of
      // either form rather than pattern-matching one of them.
      const bg = cs.backgroundColor;
      const slash = /\/\s*([\d.]+%?)\s*\)/.exec(bg);
      const legacy = /rgba?\(([^)]+)\)/.exec(bg);
      const alpha = slash
        ? (slash[1].endsWith('%') ? parseFloat(slash[1]) / 100 : Number(slash[1]))
        : legacy
          ? ((p) => (p.length > 3 ? Number(p[3]) : 1))(legacy[1].split(/[,\s/]+/).filter(Boolean))
          : 1;
      return { filter: cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter'), bg, alpha };
    });

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
