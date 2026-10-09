import { test, expect } from '@playwright/test';
import { readSurface, transparencyEmulator } from './glass';
import { parseColor, flatten, contrast } from './color';

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

    // Anchor both ends — the labels' container also starts with the first label's text, and a
    // start-anchored regex would match the wrapper and compare the wrong boxes. The quartiles are
    // named in full where there is room and in the shorthand on a phone, so both are allowed here.
    const labels = [
      page.getByText(/^(P25|25th percentile) \$[\d.,]+k$/).first(),
      page.getByText(/^Median \$[\d,]+( [+−]\$[\d,]+ since .+)?$/).first(),
      page.getByText(/^(P75|75th percentile) \$[\d.,]+k$/).first(),
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
 * The distribution is the landing page's centrepiece and the thing the hero's headline number labels.
 * Its curve and quartile lines used to grow up from the baseline (`scaleY(0.04) -> scaleY(1)`) while
 * the dots fell from the top — two motions in opposite directions — and a chart that never finished
 * that transition rendered as a 5px sliver. The lines are now simply there: full height on the first
 * frame, with no transform or transition, whatever the motion preference.
 */
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`home distribution actually draws its people (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./', { waitUntil: 'networkidle' });
    const plot = page.locator('.hero-dist-main');
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
    const box = (await plot.boundingBox())!;
    // 30% of its width, never under 400px or over 520; 300 on a phone. To the pixel, not the float.
    const want = width > 480 ? Math.round(Math.min(520, Math.max(400, box.width * 0.3))) : 300;
    expect(Math.abs(box.height - want), `the distribution is not at its full height (${box.height})`).toBeLessThan(0.5);
    expect(box.width, 'the distribution has no width').toBeGreaterThan(200);
    // Ink, and a skyline: the squares stand far higher at the crowded middle than at the thin top end.
    const ink = await page.locator('.strata-base').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const top = (x0: number, x1: number) => {
        for (let y = 0; y < c.height; y++) for (let x = Math.floor(x0 * c.width); x < Math.floor(x1 * c.width); x++) if (d[4 * (y * c.width + x) + 3] > 0) return c.height - y;
        return 0;
      };
      return { mid: top(0.2, 0.35), tail: top(0.75, 0.85), k: c.height / c.getBoundingClientRect().height };
    });
    expect(ink.mid / ink.k, 'nothing drawn in the middle of the distribution').toBeGreaterThan(60);
    expect(ink.mid, 'the middle is not busier than the tail — no shape in the data').toBeGreaterThan(ink.tail * 3);
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
    await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
    const box = (await page.locator('.hero-dist-main').boundingBox())!;
    const pill = page.locator('.strata-readout');

    const readAt = async (frac: number) => {
      await page.mouse.move(box.x + box.width * frac, box.y + box.height * 0.8);
      await expect(pill).toBeVisible();
      const text = (await pill.textContent()) ?? '';
      // "$75k–$80k · 3,621 people within ±$5k · 48% paid less" — a $5k column, a headcount, the width it was
      // counted over, and where that pay falls in the payroll.
      expect(text, 'the readout stopped naming a salary and a headcount').toMatch(
        /^\$[\d,]+k–\$[\d,]+k · [\d,]+ people within ±\$\d+k · \d+% paid less$/
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
    const caption = (await panel.locator('.strata-count').textContent()) ?? '';
    const population = Number(caption.replace(/^([\d,]+) people.*$/s, '$1').replace(/,/g, ''));
    expect(population, 'could not read the population off the toolbar').toBeGreaterThan(1000);
    expect(atPeak, 'the readout is reporting the density, not a count of people')
      .toBeGreaterThan(population * 0.05);

    // Leaving the plot clears it, rather than stranding a readout over a curve nobody is pointing at.
    await page.mouse.move(box.x + box.width / 2, box.y - 90);
    await expect(pill).toBeHidden();
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
      const plot = (await page.locator('.hero-dist-main').boundingBox())!;

      for (const frac of [0.01, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 0.95, 0.99]) {
        await page.mouse.move(plot.x + plot.width * frac, plot.y + plot.height * 0.5);
        const pill = page.locator('.strata-readout .chart-tip-pill');
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
  // `--content-prose` while the showcase tiles below it were wider, so the page's one chart was 320px
  // narrower than the row of cards under it for no reason a reader could see. Both now run the page's
  // width; swept, so the chart keeps pace with the tiles at every width, wide and narrow.
  for (const width of [2560, 1920, 1600, 1280, 992, 768, 375]) {
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

  // Capped at 1200px, a wide screen left a third of itself empty either side of the chart. The chart and
  // the search run the page's width, and the plot grows taller with it (up to 520px). What sits under the
  // search does not: the figures and the ways on used to grow with the band too — to 51px figures, a size
  // away from the title and four times the graph's own labels, and 23px card titles — which made them the
  // loudest things on the page after its name. They are the graph's supporting detail: set no larger than
  // the search's own text, the same size on any screen, and the page's title is the largest text on it.
  test('runs the page\'s width on a wide screen, and what is under the search stays the size of its detail', async ({ page }) => {
    const read = async (width: number) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('./', { waitUntil: 'networkidle' });
      await expect(page.locator('.hero-dist')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.home-stat-value').first()).not.toHaveText('—', { timeout: 60_000 });
      await page.waitForTimeout(500);
      return page.evaluate(() => {
        // The page's own box, inside its gutters (AppShell's `.app-page`).
        const main = document.querySelector('.app-page')!;
        const cs = getComputedStyle(main);
        const room = main.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().width;
        const sizes = (sel: string) => [...document.querySelectorAll(sel)].map((el) => parseFloat(getComputedStyle(el).fontSize));
        // Every piece of text on the page outside the graph's panel and the search's own box.
        const outside: { text: string; size: number; inTitle: boolean }[] = [];
        const walk = document.createTreeWalker(document.querySelector('#main-content')!, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const el = n.parentElement!;
          if (!(n.textContent ?? '').trim() || el.closest('.hero-dist, .mantine-TextInput-root, .visually-hidden')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          outside.push({ text: (n.textContent ?? '').trim().slice(0, 30), size: parseFloat(getComputedStyle(el).fontSize), inTitle: !!el.closest('h1') });
        }
        return {
          room, chart: w('.hero-dist'), search: w('.hero-search-input'), plotH: document.querySelector('.hero-dist-main')!.getBoundingClientRect().height, plotW: w('.hero-dist-main'),
          searchFont: parseFloat(getComputedStyle(document.querySelector('.hero-search-input')!).fontSize),
          title: parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
          under: [...sizes('.home-stat-value'), ...sizes('.home-stat-label'), ...sizes('.home-stats-browse'), ...sizes('.showcase-title'), ...sizes('.showcase-blurb')],
          outside,
        };
      });
    };
    const laptop = await read(1440);
    const wide = await read(2560);
    for (const [name, r] of [['1440px', laptop], ['2560px', wide]] as const) {
      expect(Math.abs(r.chart - r.room), `at ${name} the chart is ${r.chart}px of ${r.room}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.search - r.room), `at ${name} the search is ${r.search}px of ${r.room}px`).toBeLessThanOrEqual(1);
      expect(r.under.length, `at ${name} the figures and links under the search are not there to measure`).toBeGreaterThanOrEqual(14);
      for (const s of r.under) expect(s, `at ${name} something under the search is set larger than the search itself`).toBeLessThanOrEqual(r.searchFont);
      // The title's own words, whatever they say, and nothing else.
      const loudest = r.outside.filter((o) => o.size >= r.title);
      expect(loudest.length, `at ${name} the title is not the largest text`).toBeGreaterThan(0);
      expect(loudest.filter((o) => !o.inTitle).map((o) => o.text), `at ${name} text outside the graph is as large as the page's title`).toEqual([]);
    }
    // 30% of its width, from 400px up to 520: taller on a wider screen.
    expect(Math.round(laptop.plotH), 'the plot at 1440px').toBe(Math.round(Math.min(520, Math.max(400, laptop.plotW * 0.3))));
    expect(wide.plotH, 'the plot did not grow taller with a wide screen').toBe(520);
    expect(wide.under, 'what is under the search grew with the screen').toEqual(laptop.under);
  });

  // The graph and the search are the page, and they are in the first screen together. At 1440x900 the
  // search began at y=897, behind the 40px footer then fixed at the window's foot: a visitor arrived to a graph
  // and had to scroll to find the one thing the page is for. The title block above spent ~200px on the
  // site's name, already in the masthead. On a phone the search began at y=974 of 812, and is now above the
  // graph (search-reveal.spec). At 1280x800 the graph and the search do not both fit without squeezing the
  // plot, so it is not held to this here.
  for (const [width, height] of [[1440, 900], [1920, 1080], [2000, 1300]] as const) {
    test(`the graph and the search are both in the first screen (${width}x${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('./', { waitUntil: 'networkidle' });
      await expect(page.locator('.hero-dist')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      const seen = await page.evaluate(() => {
        const bottom = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().bottom;
        return {
          scrollY,
          end: innerHeight,
          panel: bottom('.hero-dist'),
          search: bottom('.hero-search-input'),
        };
      });
      expect(seen.scrollY).toBe(0);
      expect(seen.panel, 'the graph runs past the first screen').toBeLessThanOrEqual(seen.end);
      expect(seen.search, 'the search is below the first screen').toBeLessThanOrEqual(seen.end);
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

// The pins over the landing graph are the only place the chart explains its own guides: set to be read,
// in full where there is room, and each clearing 4.5:1 against the panel.
test('the percentile pins over the landing graph are set to be read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./', { waitUntil: 'networkidle' });
  const labels = page.locator('.strata-pin');
  await expect(labels).toHaveCount(3, { timeout: 60_000 });
  const seen = await labels.evaluateAll((els) => els.map((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent ?? '').trim(), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), color: cs.color };
  }));
  for (const l of seen) {
    expect(l.size, `"${l.text}" is set at ${l.size}px`).toBeGreaterThanOrEqual(12);
    expect(l.weight, `"${l.text}" is set at ${l.weight}`).toBeGreaterThanOrEqual(600);
  }
  expect(seen.map((l) => l.text.replace(/\s+\$.*/, ''))).toEqual(['Median', '25th percentile', '75th percentile']);
  const ground = await page.locator('.hero-dist').evaluate((el) => {
    const out: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) out.push(getComputedStyle(e).backgroundColor);
    return out.reverse();
  });
  let bg = [255, 255, 255];
  for (const c of ground) { const [r, g, b, a] = parseColor(c); if (a > 0) bg = flatten([r, g, b, a], bg); }
  for (const l of seen) {
    const [r, g, b, a] = parseColor(l.color);
    expect(contrast(flatten([r, g, b, a], bg), bg), `"${l.text}" against the panel`).toBeGreaterThanOrEqual(4.5);
  }
});
