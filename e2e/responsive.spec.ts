import { test, expect } from '@playwright/test';

/**
 * Phone-width layout guard. Every route must fit the viewport: a page wider than the window scrolls the
 * whole app sideways, which reads as breakage and hides controls off the right edge. Wide content is
 * allowed — it just has to scroll inside its own container (`Table.ScrollContainer`, `overflowX: auto`)
 * rather than stretching the document.
 *
 * This caught four routes at once: Reports pushed 274px past a 375px screen (its mode switcher measured
 * 633px), Person 53px on all four tabs, and Explore/Compare 24px from the control bar's snapshot Select.
 */
const PHONE = { width: 375, height: 812 };

const ROUTES = [
  ['home', './'],
  ['paycheck', './paycheck'],
  ['explore', './explore'],
  ['compare', './compare'],
  ['reports', './reports'],
  ['screening', './screening'],
  ['data', './data'],
  ['school', `./school/${encodeURIComponent('School of Medicine and Public Health')}`],
] as const;

/** Document scroll width minus viewport width — 0 when nothing overflows the page. */
const pageOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, path] of ROUTES) {
  test(`no horizontal page overflow at ${PHONE.width}px: ${name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path, { waitUntil: 'networkidle' });
    // Settle rather than wait on content: this is a layout assertion, and a currency-text probe matches
    // hidden chart labels on some routes. networkidle covers the parquet/wasm fetches; the pause covers
    // the render they trigger.
    await page.waitForTimeout(2_500);
    expect(await pageOverflow(page), `${name} is wider than the viewport`).toBe(0);
  });
}

test(`no horizontal page overflow at ${PHONE.width}px: person`, async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.getByRole('heading', { name: 'Kenneth Poss' })).toBeVisible({ timeout: 60_000 });

  // The header actions sit beside the title on desktop and wrap below it here; check every tab, since
  // each renders its own charts and tables.
  for (const tab of await page.getByRole('tab').allTextContents()) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(800);
    expect(await pageOverflow(page), `person/${tab} is wider than the viewport`).toBe(0);
  }
});

/**
 * The same guard, but driving every tab.
 *
 * The block above visits each route once and therefore only ever sees its DEFAULT tab — Explore has
 * six, School four. That blind spot is not hypothetical: School's Departments table shipped with a
 * 560px `miw` and no scroll wrapper, inside a Mantine Card that computes `overflow: hidden`, so its
 * "Total payroll" column was silently unreachable on a phone. The mobile-overflow pass that fixed
 * four other routes could not have caught it.
 */
const TABBED = [
  ['explore', './explore'],
  ['school', `./school/${encodeURIComponent('School of Medicine and Public Health')}`],
] as const;

for (const [name, path] of TABBED) {
  test(`no horizontal page overflow at ${PHONE.width}px across every tab: ${name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_500);

    const tabs = await page.getByRole('tab').allTextContents();
    expect(tabs.length, `${name} should render tabs`).toBeGreaterThan(1);

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      // Each panel mounts its own tables/charts; give the query + render a beat to settle.
      await page.waitForTimeout(1_200);
      expect(await pageOverflow(page), `${name} → "${tab}" is wider than the viewport`).toBe(0);
    }
  });
}

/**
 * Content that is wider than its container AND has no scrollable ancestor is simply unreachable:
 * no scrollbar, no page overflow, nothing to drag — the columns are just gone. Page-overflow checks
 * cannot see it, because the clipping is exactly what stops the page getting wide.
 *
 * This is the app's own established pattern, asserted: every other wide table pairs `miw` with a
 * `ScrollArea.Autosize` or `Table.ScrollContainer`. School's Departments table paired `miw={560}`
 * with neither, inside a Mantine Card that computes `overflow: hidden`, hiding 219px — three of its
 * four columns, i.e. every number in it — at phone width.
 */
async function unreachableTables(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('table')]
      .filter((t) => t.offsetParent !== null) // Mantine keeps inactive tab panels mounted but hidden
      .filter((t) => {
        // Skip screen-reader-only tables (ChartData renders each chart's data inside VisuallyHidden).
        // Those are clipped to a 1px box deliberately and are reachable by assistive tech — exactly
        // the case this check must not confuse with a table whose columns are genuinely lost. Detect
        // it by the 1px box rather than by class name, so it holds if the implementation changes.
        for (let el: HTMLElement | null = t.parentElement; el; el = el.parentElement) {
          if (el.clientWidth <= 1) return false;
        }
        return true;
      })
      .map((t) => {
        let clippedBy: string | null = null;
        for (let el: HTMLElement | null = t.parentElement; el; el = el.parentElement) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') return null; // a real scroller — content is reachable
          if (ox === 'hidden') { clippedBy = el.className || el.tagName; break; }
        }
        const host = t.parentElement!;
        const hidden = t.scrollWidth - host.clientWidth;
        // A few px is a table shrinking to min-content and overshooting by a border or a rounded
        // column — nothing is actually lost. A lost column costs far more than this; School's
        // Departments hid 219px. Threshold it so the gate stays actionable instead of noisy.
        const LOST_COLUMN_PX = 16;
        return hidden > LOST_COLUMN_PX
          ? { hidden, clippedBy, headers: [...t.querySelectorAll('th')].map((th) => th.textContent?.trim()) }
          : null;
      })
      .filter(Boolean)
  );
}

for (const [name, path] of TABBED) {
  test(`no table content is clipped out of reach at ${PHONE.width}px: ${name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2_500);

    for (const tab of await page.getByRole('tab').allTextContents()) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(1_200);
      const bad = await unreachableTables(page);
      expect(bad, `${name} → "${tab}" clips table content with no way to scroll to it`).toEqual([]);
    }
  });
}

/**
 * The AppShell header has a fixed height, but the control bar inside it wraps as the viewport
 * narrows — so the two can drift apart silently. They had: a hardcoded 104px was 7px short at
 * 1440px and 19px short on a phone, and the bar spilled out of the header onto the page content
 * beneath it. Only /school renders the control bar (CONTROL_PATHS in AppShell).
 */
for (const width of [1440, 768, 375]) {
  test(`the control bar fits inside the app header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`./school/${encodeURIComponent('School of Medicine and Public Health')}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(2_000);

    const spill = await page.evaluate(() => {
      const header = document.querySelector('.mantine-AppShell-header');
      const bar = header?.lastElementChild;
      if (!header || !bar) return null;
      return Math.round(bar.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom);
    });
    expect(spill, 'control bar should be measurable inside the header').not.toBeNull();
    expect(spill!, `control bar spills ${spill}px past the header at ${width}px`).toBeLessThanOrEqual(0);
  });
}

/**
 * The histogram draws a label at every bin edge, so ten bins mean eleven labels. On a phone all eleven
 * adjacent pairs overlapped and the axis rendered as one unreadable run of digits — "$95k$100k$105k…" —
 * while the median guide's label printed straight through the count above the tallest bar at every
 * width. Neither is visible to axe or to a presence assertion, and the visual suite masks `.hist-plot`,
 * so this geometry check is the only guard. IT040 is a 48-person cohort, which is the "one block = one
 * person" render path; FA020 (Professor, 1,251) is the bar path.
 */
for (const code of ['IT040', 'FA020']) {
  for (const width of [1440, 375]) {
    test(`histogram axis labels never overlap: ${code} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`./paycheck?code=${code}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.hist-plot', { timeout: 60_000 });
      // Labels are thinned against a measured container width; let the observer settle.
      await page.waitForTimeout(1_500);

      const collisions = await page.evaluate(() => {
        const plot = document.querySelector('.hist-plot');
        if (!plot) return ['no .hist-plot on the page'];
        const boxes = [...plot.querySelectorAll('*')]
          .filter((el) => !el.children.length && (el.textContent ?? '').trim())
          .map((el) => ({ text: (el.textContent ?? '').trim(), r: el.getBoundingClientRect() }));
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].r, b = boxes[j].r;
            // The y-axis "0" tick and the "$0k" x-axis tick meet at the origin corner in the Recharts
            // path. That predates this guard and belongs to the axis component, not the label thinning.
            const corner = /^\$?0k?$/.test(boxes[i].text) && /^\$?0k?$/.test(boxes[j].text);
            if (!corner && a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top) {
              hits.push(`"${boxes[i].text}" overlaps "${boxes[j].text}"`);
            }
          }
        }
        return hits;
      });
      expect(collisions, `${code} at ${width}px`).toEqual([]);
    });
  }
}
