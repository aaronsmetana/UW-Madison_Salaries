import { test, expect } from '@playwright/test';

/**
 * Guards for the defects the /data page shipped with, each of which was invisible to the existing suites
 * because those assert on page overflow and axe rules rather than on where things actually land.
 *
 * All of them failed on the pre-fix build, by the margins named in each test.
 */

const TABLE = '.data-snap-table';

test.describe('data · about', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./data');
    // The ingestion table is manifest-driven, so wait for real rows rather than a fixed pause.
    await expect(page.locator(`${TABLE} tbody tr`).first()).toBeVisible({ timeout: 60_000 });
  });

  /**
   * The page is a reading column with one data breakout, and both halves of that are asserted.
   *
   * The prose sections share an edge because the cap used to be applied per child as `maw={PROSE}` at
   * eight call sites, and being per-child is what made it forgettable: `#snapshots` and `#duplicates`
   * (the latter in DuplicateIdentities.tsx, a different file) both missed it, so six cards ended at
   * 880px and two ran to the full 1063 — a 183px step the reader hit mid-scroll with nothing to
   * explain it.
   *
   * `#snapshots` is now deliberately wider, because 880px is right for prose and wrong for a
   * 10-column table: capped, it scrolled 94px at every width. So the assertion is not "all the same"
   * but "one prose edge, and the table filling the region" — and every section still shares a LEFT
   * edge, which is what makes the breakout read as deliberate rather than as the ragged widths this
   * page started with.
   *
   * Desktop-only on purpose: the 880px cap only binds above a ~1257px viewport, so asserting it at
   * 375 would pass no matter what the cap said.
   */
  test('the prose sections share one edge and the table section fills the region', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const ids = ['source', 'disclaimer', 'privacy', 'how-it-works', 'pipeline', 'methodology', 'snapshots', 'duplicates'];

    const m = await page.evaluate((sectionIds) => {
      const column = document.querySelector('.data-about')!.getBoundingClientRect();
      return {
        columnRight: Math.round(column.right),
        edges: sectionIds.map((id) => {
          const el = document.getElementById(id);
          if (!el) return { id, left: null, right: null };
          const r = el.getBoundingClientRect();
          return { id, left: Math.round(r.left), right: Math.round(r.right) };
        }),
      };
    }, ids);

    const { edges } = m;
    const missing = edges.filter((e) => e.right === null).map((e) => e.id);
    expect(missing, 'a section id vanished — update this list or restore the section').toEqual([]);

    const seen = JSON.stringify(m);
    const prose = edges.filter((e) => e.id !== 'snapshots');
    const wide = edges.find((e) => e.id === 'snapshots')!;

    // Compare on the set, not pairwise, so the failure message names every edge that disagreed.
    expect(new Set(prose.map((e) => e.right)), `prose sections disagree on a right edge: ${seen}`).toHaveProperty('size', 1);
    expect(new Set(edges.map((e) => e.left)), `sections disagree on a left edge: ${seen}`).toHaveProperty('size', 1);

    // The breakout is the point, so assert it rather than letting a lost `.data-wide` pass quietly.
    expect(wide.right, `the ingestion table stopped filling the region: ${seen}`).toBe(m.columnRight);
    expect(wide.right, `the ingestion table is no wider than the prose column: ${seen}`).toBeGreaterThan(prose[0]!.right!);
  });

  /**
   * The page never scrolls sideways, and exactly one element absorbs the table's overflow.
   *
   * The second half is not pedantry. `ScrollArea.Autosize` renders its wrapper and an inner div as flex
   * containers, and a flex item's default `min-width: auto` refuses to shrink below its content's
   * min-content width — the table's `miw`. So the ScrollArea root blew out to 692px inside its own 301px
   * wrapper and the *wrapper* scrolled, which left Mantine's viewport inert, its styled scrollbar never
   * rendered, and `position: sticky` inside the table anchored to a container that never moved: a pinned
   * first column scrolled clean off the edge, 37 → −213.
   *
   * Both halves are asserted, because the broken arrangement looks identical until something tries to
   * stick to it.
   */
  test('the ingestion table stays inside its card at every width', async ({ page }) => {
    const measure = () => page.evaluate(() => {
      const wrapper = document.querySelector<HTMLElement>('.data-snap-scroll')!;
      const viewport = wrapper.querySelector<HTMLElement>('.mantine-ScrollArea-viewport')!;
      const card = document.getElementById('snapshots')!.getBoundingClientRect();
      const doc = document.documentElement;
      const overflowOf = (el: HTMLElement) => el.scrollWidth - el.clientWidth;
      return {
        pageOverflow: overflowOf(doc),
        viewportScrollsBy: overflowOf(viewport),
        wrapperScrollsBy: overflowOf(wrapper),
        scrollerWithinCard: Math.round(viewport.getBoundingClientRect().right) <= Math.round(card.right),
      };
    });

    // Wide: the breakout gives the table room, so it should not need to scroll at all.
    await page.setViewportSize({ width: 1440, height: 900 });
    const wide = await measure();
    const wideSeen = JSON.stringify(wide);
    expect(wide.pageOverflow, `the table widened the whole page at 1440 — ${wideSeen}`).toBe(0);
    expect(
      wide.wrapperScrollsBy,
      `the Autosize wrapper is scrolling instead of the viewport, so the styled scrollbar is gone and sticky cells cannot stick — ${wideSeen}`,
    ).toBe(0);
    expect(wide.scrollerWithinCard, `the table scroller escaped its card at 1440 — ${wideSeen}`).toBe(true);
    expect(
      wide.viewportScrollsBy,
      `the table should FIT at 1440 now that it fills the region — if this is non-zero the breakout is gone: ${wideSeen}`,
    ).toBe(0);

    // Narrow: it must still clip and scroll inside the card rather than taking the page with it.
    // Narrow enough, beside the sidebar's rail, that the table has to scroll.
    await page.setViewportSize({ width: 780, height: 900 });
    const narrow = await measure();
    const narrowSeen = JSON.stringify(narrow);
    expect(narrow.pageOverflow, `the table widened the whole page at 780 — ${narrowSeen}`).toBe(0);
    expect(narrow.wrapperScrollsBy, `the wrapper is scrolling at 780 — ${narrowSeen}`).toBe(0);
    expect(narrow.scrollerWithinCard, `the table scroller escaped its card at 780 — ${narrowSeen}`).toBe(true);
    expect(narrow.viewportScrollsBy, `the table stopped scrolling at 780 — ${narrowSeen}`).toBeGreaterThan(0);
  });

  /**
   * The fade promises there is more table off to the right, and every proxy for that has been wrong at
   * least once. It was mobile-only while the 880px column made the full table scroll at every width;
   * then it was keyed to `!compact`, which stopped meaning "too wide" the moment the breakout let that
   * same table fit with room to spare. Either way it drew a fade over a table with nothing to scroll,
   * which reads as a rendering fault rather than an affordance.
   *
   * It is measured now, so the promise is asserted against the fact at both widths. `toPass` because
   * the ResizeObserver settles a frame after the viewport changes.
   */
  test('the fade appears only when the table actually scrolls', async ({ page }) => {
    const read = () =>
      page.evaluate(() => {
        const wrapper = document.querySelector<HTMLElement>('.data-snap-scroll')!;
        const viewport = wrapper.querySelector<HTMLElement>('.mantine-ScrollArea-viewport')!;
        return {
          scrollsBy: viewport.scrollWidth - viewport.clientWidth,
          faded: wrapper.hasAttribute('data-overflowing'),
          masked: getComputedStyle(wrapper).maskImage !== 'none',
        };
      });

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      const m = await read();
      const seen = JSON.stringify(m);
      expect(m.scrollsBy, `expected the table to fit at 1440 — ${seen}`).toBe(0);
      expect(m.faded, `the fade is promising columns that are not off-screen — ${seen}`).toBe(false);
      expect(m.masked, `the mask is painted over a table that fits — ${seen}`).toBe(false);
    }).toPass({ timeout: 5_000 });

    await page.setViewportSize({ width: 780, height: 900 });
    await expect(async () => {
      const m = await read();
      const seen = JSON.stringify(m);
      expect(m.scrollsBy, `expected the table to overflow at 780 — ${seen}`).toBeGreaterThan(0);
      expect(m.faded, `the table scrolls with nothing to say so — ${seen}`).toBe(true);
      expect(m.masked, `data-overflowing is set but no mask is painted — ${seen}`).toBe(true);
    }).toPass({ timeout: 5_000 });
  });

  /**
   * The Snapshot column stays put while the rest of the table scrolls. Below ~1324px the table still
   * overflows, and scrolling right used to carry the row label away with it — leaving a screenful of
   * numbers with nothing to say which snapshot any of them belonged to.
   *
   * This could not work at all until the table had a single scroll container: `position: sticky`
   * resolves against the nearest one, and while the Autosize wrapper was doing the scrolling the cell
   * was pinned to a viewport that never moved, so it slid off at 37 -> -213.
   *
   * The background assertions are not decoration. A transparent pinned cell lets the scrolling columns
   * read straight through it, and a pinned cell that drops the inline shading of a "noted" row makes
   * those rows look unremarkable in the one column that never scrolls away.
   */
  test('the Snapshot column stays put while the rest of the table scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 900 });

    const m = await page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>('.data-snap-scroll .mantine-ScrollArea-viewport')!;
      const rows = [...vp.querySelectorAll<HTMLElement>('tbody tr')];
      const isShaded = (r: HTMLElement) => (r.getAttribute('style') ?? '').includes('background');
      const plain = rows.find((r) => !isShaded(r));
      const shaded = rows.find(isShaded);
      const cell = plain?.querySelector<HTMLElement>('td');
      const vpLeft = Math.round(vp.getBoundingClientRect().left);
      const before = cell ? Math.round(cell.getBoundingClientRect().left) : null;
      vp.scrollLeft = 250;
      const out = {
        scrolledBy: vp.scrollLeft,
        vpLeft,
        before,
        after: cell ? Math.round(cell.getBoundingClientRect().left) : null,
        plainBg: cell ? getComputedStyle(cell).backgroundColor : null,
        shadedBg: shaded?.querySelector('td') ? getComputedStyle(shaded.querySelector('td')!).backgroundColor : null,
      };
      vp.scrollLeft = 0;
      return out;
    });

    const seen = JSON.stringify(m);
    expect(m.scrolledBy, `the table did not scroll, so pinning is untested here — ${seen}`).toBeGreaterThan(0);
    expect(m.after, `the Snapshot column scrolled away with the rest of the table — ${seen}`).toBe(m.before);
    expect(Math.abs((m.after ?? 0) - m.vpLeft), `the pinned column is not at the scroller's edge — ${seen}`).toBeLessThanOrEqual(2);
    // A transparent pinned cell is the failure mode that still *looks* pinned until rows slide under it.
    expect(m.plainBg, `the pinned column is transparent — ${seen}`).not.toBe('rgba(0, 0, 0, 0)');
    expect(m.shadedBg, `a noted row lost its shading in the pinned column — ${seen}`).not.toBe(m.plainBg);
  });

  /**
   * "A shaded row carries a note worth reading" — the caption under this table says so, and it was not
   * true. The theme sets `striped: true` for every Table (theme.ts:90), and `--table-striped-color` is
   * #f8f9fa, the *same* colour as `--mantine-color-default-hover`, which is the shade a noted row
   * carries. Six of the ten rows therefore read as shaded while only three had notes, so the mark the
   * caption points at was not one a reader could act on. Striping is off for this table now.
   *
   * The assertion compares the two sets rather than counting, so the failure names the rows that
   * disagreed — and it would fail equally if a real note ever stopped being marked.
   */
  test('a shaded row is exactly a row carrying a note', async ({ page }) => {
    // Keep the pointer off the table: `highlightOnHover` is deliberately still on, and a hovered row
    // is legitimately shaded without carrying a note.
    await page.mouse.move(0, 0);

    const rows = await page.evaluate(() => {
      const base = getComputedStyle(document.documentElement).getPropertyValue('--mantine-color-body').trim();
      const probe = document.createElement('div');
      probe.style.backgroundColor = base;
      document.body.appendChild(probe);
      const unshaded = getComputedStyle(probe).backgroundColor;
      probe.remove();

      return [...document.querySelectorAll<HTMLElement>('.data-snap-table tbody tr')].map((r) => ({
        label: (r.querySelector('td')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20),
        shaded: getComputedStyle(r).backgroundColor !== unshaded,
        // The note is what drives the inline background in DataHealth.tsx, and it is also the only
        // thing rendered into the STATUS cell in italics, so either would do as the source of truth.
        carriesNote: (r.getAttribute('style') ?? '').includes('background'),
      }));
    });

    const seen = JSON.stringify(rows);
    expect(rows.length, `no ingestion rows rendered — ${seen}`).toBeGreaterThan(3);
    const shaded = rows.filter((r) => r.shaded).map((r) => r.label).sort();
    const noted = rows.filter((r) => r.carriesNote).map((r) => r.label).sort();
    expect(noted.length, `no row carries a note, so the caption marks nothing — ${seen}`).toBeGreaterThan(0);
    expect(shaded, `shaded rows and noted rows are not the same set — ${seen}`).toEqual(noted);
  });

  /**
   * A narrow table starts compact, and the switch still wins. The threshold is measured off the
   * scroller rather than a media query on purpose: the sidebar collapses from 330px to 64px, which
   * moves the viewport width the same card width corresponds to by 266px, so a `(min-width: …)` query
   * would hide columns from a table that had room for them.
   */
  test('a table with no room starts compact, and the reader can still override it', async ({ page }) => {
    const columns = () => page.locator('.data-snap-table thead th').count();
    const toggle = page.getByRole('switch', { name: /hide technical details/i });

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(async () => {
      expect(await columns(), 'a table with no room did not drop to the compact column set').toBe(9);
    }).toPass({ timeout: 5_000 });
    await expect(toggle, 'the switch does not reflect the compact table the reader is looking at').toBeChecked();

    // The measured default must never trap the reader in it. Mantine keeps the Switch's native input
    // visually hidden under a styled track, so Playwright's actionability check on the input never
    // passes — click the label text, exactly as a real reader would (same as reports.spec.ts).
    await page.getByText('Hide technical details').click();
    await expect(async () => {
      expect(await columns(), 'turning technical details back on did not restore the full table').toBe(10);
    }).toPass({ timeout: 5_000 });

    // And a table with room shows everything without being asked.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator('.data-snap-table tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      expect(await columns(), 'a table with room still hid a column').toBe(10);
    }).toPass({ timeout: 5_000 });
  });

  /**
   * The table can be scrolled from the keyboard. `role="region"` + `tabIndex={0}` sat on a Box that
   * *contained* the scroller rather than on the scroller itself, and arrow keys act on the nearest
   * scrollable ancestor of the focused element — never on one nested inside it. So the region was
   * announced, took a focus stop, and scrolled the page instead of the table.
   */
  test('the ingestion table can be scrolled from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 900 });
    const viewport = page.locator('.data-snap-scroll .mantine-ScrollArea-viewport');
    await expect(viewport, 'the scrollable region is not the element that scrolls').toHaveAttribute('role', 'region');

    await viewport.focus();
    await expect(viewport).toBeFocused();
    const before = await viewport.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');

    await expect(async () => {
      const after = await viewport.evaluate((el) => el.scrollLeft);
      expect(after, 'ArrowRight moved the page, not the table').toBeGreaterThan(before);
    }).toPass({ timeout: 3_000 });
  });

  /**
   * `stickyHeaderOffset` resolves against the nearest scrolling ancestor. Inside a `Table.ScrollContainer`
   * that ancestor is the ScrollArea viewport, not the document, so the offset pushed the header *down
   * into* the table and it rendered over the first rows — the header sat 49px BELOW row 1 on production.
   */
  test('the ingestion table header sits above its first row', async ({ page }) => {
    const gap = await page.evaluate((sel) => {
      const thead = document.querySelector(`${sel} thead`)!.getBoundingClientRect();
      const firstRow = document.querySelector(`${sel} tbody tr`)!.getBoundingClientRect();
      return Math.round(firstRow.top - thead.bottom);
    }, TABLE);
    expect(gap, 'the column header is rendering over the rows it labels').toBeGreaterThanOrEqual(0);
  });

  /**
   * The app-wide header look is `.mantine-Table-thead .mantine-Table-th` — uppercase, 11px, dimmed. A
   * sortable header that wraps its label in a button escapes all of it, so two of the ten columns
   * rendered at 16px sentence case beside eight at 11px uppercase.
   */
  test('every ingestion column header renders at the same size and case', async ({ page }) => {
    const styles = await page.evaluate((sel) =>
      [...document.querySelectorAll(`${sel} thead th`)].map((th) => {
        // Measure the element that actually paints the label — a sortable header nests a button.
        const label = th.querySelector('button') ?? th;
        const cs = getComputedStyle(label);
        return { text: (th.textContent ?? '').trim(), size: cs.fontSize, transform: cs.textTransform };
      }), TABLE);

    expect(styles.length).toBeGreaterThan(2);
    const detail = JSON.stringify(styles);
    expect(new Set(styles.map((s) => s.size)).size, `headers disagree on font-size: ${detail}`).toBe(1);
    expect(new Set(styles.map((s) => s.transform)).size, `headers disagree on case: ${detail}`).toBe(1);
  });

  /**
   * The page stacks a 64px app header over a sticky jump nav. Without `scroll-margin-top`, a fragment
   * jump scrolls the section to y=0 — behind that chrome. On production the Methodology heading landed
   * 449px above the fold, i.e. entirely out of sight.
   */
  test('every jump-nav link lands its section in view', async ({ page }) => {
    const chips = page.locator('.data-jump-chip');
    const count = await chips.count();
    expect(count).toBeGreaterThan(3);

    for (let i = 0; i < count; i++) {
      const id = (await chips.nth(i).getAttribute('href'))!.replace('#', '');
      await chips.nth(i).click();
      // Fragment navigation is synchronous, but the sticky nav re-lays out; give it a frame.
      await page.waitForTimeout(400);

      const hidden = await page.evaluate((sectionId) => {
        const sec = document.getElementById(sectionId)!.getBoundingClientRect();
        const nav = document.querySelector('.data-jumpnav')!.getBoundingClientRect();
        // How far the section's top sits above the bottom edge of the sticky chrome.
        return Math.round(nav.bottom - sec.top);
      }, id);

      expect(hidden, `#${id} lands behind the sticky nav`).toBeLessThanOrEqual(0);
    }
  });

  /**
   * The pipeline card states figures — workbooks ingested, rows stored — that the page also states
   * elsewhere, and that a future edit could easily freeze into the copy. Every one of them is meant to
   * be read from the manifest at render time, so this asserts them against the manifest itself rather
   * than against a number written into the test.
   *
   * This is the guard the chart labels needed and did not have: two counts shipped in this pass that
   * described a `LIMIT 3000` render budget as a headcount and a row count as a number of people. Both
   * were sentences a reader would believe and no test could see.
   */
  test('the pipeline quotes the manifest, not a number typed into the copy', async ({ page }) => {
    const manifest = await (await page.request.get('./data/manifest.json')).json();
    const ingested = manifest.snapshots.filter((s: { row_count: number }) => s.row_count);
    const n = (x: number) => x.toLocaleString('en-US');

    const pipeline = page.locator('#pipeline');
    await expect(pipeline).toContainText(`${n(manifest.total_rows)} rows`);
    await expect(pipeline).toContainText(
      `${n(ingested.length)} workbook${ingested.length === 1 ? '' : 's'}`
    );

    // The two per-report figures name the report they were measured on, so neither can be read as
    // spanning the whole dataset the way the row total does.
    const latest = [...ingested].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).at(-1);
    await expect(pipeline).toContainText(
      `${Object.keys(latest.detected_mapping).length} columns · ${latest.snapshot_label}`
    );
    await expect(pipeline).toContainText(`${n(latest.distinct_people)} people · ${latest.snapshot_label}`);
  });
});

/**
 * `SortableTh` put its click handler on a bare `<th>`: styled as clickable, but not focusable and not
 * announced as a control, so sorting was mouse-only across every table that uses it. School's department
 * table is the check — it is a plain consumer of the shared component.
 */
test('a shared sortable header can be operated from the keyboard', async ({ page }) => {
  await page.goto(`./school/${encodeURIComponent('School of Medicine and Public Health')}?tab=departments`);
  // Scope to the departments table by a header only it has — the page also carries VisuallyHidden
  // `ChartData` tables whose cells would otherwise match first.
  const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Total payroll' }) });
  const firstCell = table.locator('tbody tr td').first();
  await expect(firstCell).toBeVisible({ timeout: 60_000 });

  const sortButton = table.locator('thead th button').first();
  await expect(sortButton, 'sortable headers expose no keyboard control').toBeVisible();

  const before = await firstCell.innerText();
  await sortButton.focus();
  await expect(sortButton).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(async () => {
    expect(await firstCell.innerText()).not.toBe(before);
  }).toPass({ timeout: 5_000 });
});

/**
 * The back-to-top button must be on the screen it is pinned to.
 *
 * It shipped `position: fixed` inside `.route-rise`, whose `animation-fill-mode: both` retains the
 * final keyframe's transform forever — and any transform other than `none`, an identity one very
 * much included, makes an element a containing block for fixed descendants. So the button anchored
 * to the route content box instead of the viewport and rendered ~1200px below the fold: it set its
 * `data-show` attribute, reported itself visible to any DOM query, and could never be seen or
 * clicked. Reduced-motion users were the only ones it worked for, because `animation: none` left no
 * transform behind.
 *
 * The assertion is deliberately geometric rather than `toBeVisible()`, which was true throughout.
 */
test('the back-to-top button is inside the viewport, and returns the reader to the top', async ({ page }) => {
  await page.goto('./data', { waitUntil: 'networkidle' });
  await page.mouse.wheel(0, 3_000);

  const fab = page.locator('.back-to-top');
  await expect(fab).toHaveAttribute('data-show', /.*/, { timeout: 15_000 });

  const view = page.viewportSize()!;
  const box = (await fab.boundingBox())!;
  expect(box, 'the back-to-top button has no box at all').not.toBeNull();
  expect(box.y, 'the back-to-top button renders below the fold — it is anchored to the route content box, not the viewport')
    .toBeLessThan(view.height);
  expect(box.y + box.height, 'the back-to-top button renders above the viewport').toBeGreaterThan(0);

  await fab.click();
  await expect
    .poll(async () => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 })
    .toBe(0);
});
