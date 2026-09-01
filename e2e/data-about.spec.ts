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
