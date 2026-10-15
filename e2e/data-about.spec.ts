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
    // The ingestion table is the Snapshots tab's.
    await page.goto('./data?tab=snapshots');
    // The ingestion table is manifest-driven, so wait for real rows rather than a fixed pause.
    await expect(page.locator(`${TABLE} tbody tr`).first()).toBeVisible({ timeout: 60_000 });
  });

  /**
   * Each tab is a column of cards on the page's own edges, as the person page's are: no reading column narrower
   * than the tables under it (the old page's 880px prose cap, which the 10-column table broke out of), and no
   * card running ragged against the next. Snapshots' three cards, and Overview's full-width ones, share both edges.
   */
  test("a tab's cards share the page's edges", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const edges = (ids: string[]) => page.evaluate((list) => list.map((id) => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return r ? { id, left: Math.round(r.left), right: Math.round(r.right) } : { id, left: null, right: null };
    }), ids);
    for (const [tab, ids] of [['snapshots', ['snapshot-glance', 'snapshots', 'mapping']], ['overview', ['whats-new', 'rely', 'pay-views', 'pipeline-summary']]] as const) {
      if (tab === 'overview') {
        await page.goto('./data');
        await expect(page.locator('.whats-new-change').first()).toBeVisible({ timeout: 60_000 });
      }
      const m = await edges([...ids]);
      const seen = JSON.stringify(m);
      expect(m.filter((e) => e.left === null).map((e) => e.id), `a section id vanished on ${tab} — ${seen}`).toEqual([]);
      expect(new Set(m.map((e) => e.left)).size, `${tab}: cards disagree on a left edge — ${seen}`).toBe(1);
      expect(new Set(m.map((e) => e.right)).size, `${tab}: cards disagree on a right edge — ${seen}`).toBe(1);
      const tabs = (await page.getByRole('tablist').boundingBox())!;
      expect(Math.abs(m[0].right! - Math.round(tabs.x + tabs.width)), `${tab}: the cards stop short of the tab bar's edge — ${seen}`).toBeLessThanOrEqual(1);
    }
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

    // Wide: the card is the page's width, so the table should not need to scroll at all.
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
      `the table should FIT at 1440 in a card the page's width: ${wideSeen}`,
    ).toBe(0);

    // Narrow: it must still clip and scroll inside the card rather than taking the page with it.
    // Narrow enough that the table has to scroll: 684px of page, as 780px gave when a 64px rail stood beside it.
    await page.setViewportSize({ width: 716, height: 900 });
    const narrow = await measure();
    const narrowSeen = JSON.stringify(narrow);
    expect(narrow.pageOverflow, `the table widened the whole page at 716 — ${narrowSeen}`).toBe(0);
    expect(narrow.wrapperScrollsBy, `the wrapper is scrolling at 716 — ${narrowSeen}`).toBe(0);
    expect(narrow.scrollerWithinCard, `the table scroller escaped its card at 716 — ${narrowSeen}`).toBe(true);
    expect(narrow.viewportScrollsBy, `the table stopped scrolling at 716 — ${narrowSeen}`).toBeGreaterThan(0);
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

    await page.setViewportSize({ width: 716, height: 900 });
    await expect(async () => {
      const m = await read();
      const seen = JSON.stringify(m);
      expect(m.scrollsBy, `expected the table to overflow at 716 — ${seen}`).toBeGreaterThan(0);
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
    await page.setViewportSize({ width: 716, height: 900 });

    const m = await page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>('.data-snap-scroll .mantine-ScrollArea-viewport')!;
      const rows = [...vp.querySelectorAll<HTMLElement>('tbody tr')];
      const isShaded = (r: HTMLElement) => r.classList.contains('snap-note-row');
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
    expect(m.shadedBg, `a note row lost its shading — ${seen}`).not.toBe(m.plainBg);
  });

  /**
   * A note is a row of its own, under the snapshot it is about, shaded and numbered as that snapshot is — in the
   * table and under the charts' labels. It was a narrow column that made a noted row about 150px tall, and before
   * that a shade on the row itself that the theme's striping made indistinguishable from no note. No other row is
   * shaded, so a shade still means a note.
   */
  test('each note sits under its snapshot, numbered as the charts number it', async ({ page }) => {
    await page.mouse.move(0, 0);
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.data-snap-table tbody tr')].map((r) => ({
      note: r.classList.contains('snap-note-row'),
      for: r.getAttribute('data-note-for'),
      snapshot: r.getAttribute('data-snapshot'),
      flag: r.querySelector('.note-flag')?.textContent ?? null,
      bg: getComputedStyle(r.querySelector('td')!).backgroundColor,
    })));
    const seen = JSON.stringify(rows);
    const notes = rows.filter((r) => r.note);
    expect(notes.length, `no note rows — ${seen}`).toBeGreaterThan(0);
    rows.forEach((r, i) => {
      if (!r.note) return;
      expect(rows[i - 1]?.snapshot, `note ${r.flag} is not under its snapshot — ${seen}`).toBe(r.for);
      expect(rows[i - 1]?.flag, `note ${r.flag}'s snapshot carries another number — ${seen}`).toBe(r.flag);
    });
    // Shaded: the notes, and only they.
    const plain = new Set(rows.filter((r) => !r.note).map((r) => r.bg));
    expect(plain.size, `snapshot rows disagree on their ground — ${seen}`).toBe(1);
    expect(notes.every((r) => !plain.has(r.bg)), `a note row is not shaded — ${seen}`).toBe(true);
    // The charts' badges: the same numbers, in the same order.
    const badges = await page.locator('#snapshot-glance figure').first().locator('.recharts-xAxis text').evaluateAll((ts) =>
      ts.map((t) => t.textContent ?? '').filter((t) => /^\d+$/.test(t)));
    expect(badges).toEqual(notes.map((n) => n.flag));
  });

  /**
   * The Source (file · sheet) and Status columns are gone: every row was OK, so the card says that once, and the
   * file names are a button away (Source files). A row that is not OK says so where its name is.
   */
  test('the table has no Source or Status column, and says once that every report came in whole', async ({ page }) => {
    const heads = await page.locator('.data-snap-table thead th').allInnerTexts();
    expect(heads.map((h) => h.trim().toUpperCase())).toEqual(['SNAPSHOT', 'ROWS', 'PEOPLE', 'PAID', 'Δ PAID', 'UNPAID $0', 'MEDIAN / ROW', 'Δ MEDIAN']);
    const manifest = await (await page.request.get('./data/manifest.json')).json();
    const ingested = manifest.snapshots.filter((s: { row_count: number }) => s.row_count);
    const ok = ingested.filter((s: { status: string }) => s.status === 'ok').length;
    await expect(page.locator('.ingest-status')).toContainText(ok === ingested.length ? `All ${ingested.length} ingested without errors` : `${ok} of ${ingested.length} ingested without errors`);
    await page.getByRole('button', { name: 'Source files' }).click();
    await expect(page.locator('.source-files')).toContainText(ingested[0].source_file);
  });

  /**
   * The table can be scrolled from the keyboard. `role="region"` + `tabIndex={0}` sat on a Box that
   * *contained* the scroller rather than on the scroller itself, and arrow keys act on the nearest
   * scrollable ancestor of the focused element — never on one nested inside it. So the region was
   * announced, took a focus stop, and scrolled the page instead of the table.
   */
  test('the ingestion table can be scrolled from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 716, height: 900 });
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
   * Every anchor the old page had — its eleven "Jump to" targets — and the two other pages link to (a person's "TTC",
   * the matching rule) opens the tab that holds it and lands the section in view, under the app bar.
   */
  test('every old anchor lands on its tab and section', async ({ page }) => {
    const anchors: [string, string][] = [
      ['whats-new', 'Overview'], ['source', 'Overview'], ['disclaimer', 'Accuracy & privacy'], ['privacy', 'Accuracy & privacy'],
      ['how-it-works', 'How it’s built'], ['salary-ranges', 'Salary ranges'], ['pipeline', 'How it’s built'], ['methodology', 'How it’s built'],
      ['snapshots', 'Snapshots'], ['departments', 'Renames & duplicates'], ['duplicates', 'Renames & duplicates'],
      ['ttc', 'Snapshots'], ['identity', 'Accuracy & privacy'],
    ];
    for (const [id, tab] of anchors) {
      await page.goto(`./data#${id}`);
      await expect(page.getByRole('tab', { name: tab }), `#${id}`).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
      const section = page.locator(`[id="${id}"]`);
      await expect(section, `#${id}`).toBeInViewport({ timeout: 30_000 });
      const under = await page.evaluate((sid) =>
        document.getElementById(sid)!.getBoundingClientRect().top - document.querySelector('header')!.getBoundingClientRect().bottom, id);
      expect(under, `#${id} lands behind the app bar`).toBeGreaterThanOrEqual(0);
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

    await page.goto('./data?tab=method');
    const pipeline = page.locator('#pipeline');
    await expect(pipeline).toContainText(`${n(manifest.total_rows)} rows`, { timeout: 60_000 });
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
