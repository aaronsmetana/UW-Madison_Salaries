import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, spots } from './homeDots';

/**
 * The landing search's suggestions — with the box empty, the most common titles and largest divisions —
 * and its title and division results. A press on a row opens its page (on a desktop the list closed from
 * under the press, and nothing happened). A row the reader goes to, by pointer or arrow, is shown on the
 * graph above: its dots lit and the rest faded, as a filter shows it full page. "Show on full page graph"
 * puts it there.
 */

const SNAP = HOME_STATS.snapshot_id;

/** Everyone paid in the graph's snapshot, at their total pay, with a paid appointment in the title or school. */
function covered(f: { code?: string; school?: string }) {
  const cond = f.code ? `job_code = '${f.code}'` : `school = '${f.school!.replace(/'/g, "''")}'`;
  return oracle<{ person_key: string; pay: number }>(
    `WITH p AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key)
     SELECT person_key, pay FROM p WHERE pay > 0 AND person_key IN
       (SELECT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND ${cond})`,
  );
}

/** The main field's lit dots as the page prints them: how many, and the sum and sum of squares of places. */
async function mainPrint(who: { person_key: string }[]) {
  const at = await spots();
  const f = [0, 0, 0];
  for (const p of who) {
    const s = at.get(p.person_key);
    if (!s || s.field !== 'main') continue;
    f[0]++; f[1] += s.index; f[2] += s.index * s.index;
  }
  return f.join(':');
}

const box = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });
const main = (page: Page) => page.locator('.hero-dist-main').first();
const dots = (page: Page) => page.locator('.hero-dist-main .hero-dots').first();
const row = (page: Page, key: string) => page.locator(`[data-suggestions] [role="option"][data-key="${key}"]`);

/** The page, the dots at rest, the box engaged and its suggestions open. */
async function suggestions(page: Page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); sessionStorage.setItem('nav-peek', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots').first()).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await box(page).click();
  await expect(page.locator('[data-suggestions] [role="option"]').first()).toBeVisible({ timeout: 60_000 });
  return (await page.locator('[data-suggestions] [role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')!)));
}

test('a press on a suggestion opens its page; a press on the list elsewhere leaves it open', async ({ page }) => {
  const keys = await suggestions(page);
  const title = keys.find((k) => k.startsWith('t:'))!;
  const division = keys.find((k) => k.startsWith('d:'))!;
  await page.getByText('Most common titles').click();
  await expect(row(page, title), 'a press on the list’s heading closed it').toBeVisible();
  await row(page, title).locator('.mantine-Text-root').first().click();
  await expect(page).toHaveURL(new RegExp(`/paycheck\\?code=${title.slice(2)}$`));
  await page.goBack();
  await box(page).click();
  await expect(row(page, division)).toBeVisible({ timeout: 60_000 });
  await row(page, division).locator('.mantine-Text-root').first().click();
  await expect(page).toHaveURL(new RegExp(`/school/${encodeURIComponent(division.slice(2)).replace(/[()]/g, '\\$&')}$`));
});

test('a suggestion the reader goes to is shown on the graph — its dots lit, exactly — and only then', async ({ page }) => {
  test.setTimeout(180_000);
  const keys = await suggestions(page);
  // Opened, nothing is shown: the list starts on its first row, which the reader has not gone to.
  await page.waitForTimeout(800);
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
  await expect(dots(page)).not.toHaveAttribute('data-lit', /./);
  // Nor by a row sliding under a pointer at rest: opening the list can scroll the page, and Chrome then
  // sends a mousemove that has not moved.
  await row(page, keys[2]).dispatchEvent('mousemove', { movementX: 0, movementY: 0, bubbles: true });
  await page.waitForTimeout(600);
  await expect(main(page), 'a still pointer chose a row').not.toHaveAttribute('data-filter', /./);

  // A pointer on the second title.
  const t = keys.filter((k) => k.startsWith('t:'))[1];
  const who = await covered({ code: t.slice(2) });
  await row(page, t).hover();
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(who), { timeout: 60_000 });
  await expect(main(page)).toHaveAttribute('data-group-count', String(who.length));

  // The arrow keys to the first division.
  const d = keys.find((k) => k.startsWith('d:'))!;
  const whoD = await covered({ school: d.slice(2) });
  for (let k = 0; k < keys.length && (await row(page, d).getAttribute('aria-selected')) !== 'true'; k++) await box(page).press('ArrowDown');
  await expect(row(page, d)).toHaveAttribute('aria-selected', 'true');
  await expect(main(page)).toHaveAttribute('data-filter', d.slice(2), { timeout: 60_000 });
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(whoD), { timeout: 60_000 });

  // Put away, it goes.
  await box(page).press('Escape');
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
  await expect(dots(page)).not.toHaveAttribute('data-lit', /./);

  // And by a press away from the list.
  await box(page).click();
  await row(page, t).hover();
  await expect(main(page)).toHaveAttribute('data-filter', /./, { timeout: 60_000 });
  await page.mouse.click(5, 450);
  await expect(main(page)).not.toHaveAttribute('data-filter', /./);
});

test('a title typed for is shown on the graph as its row is gone to', async ({ page }) => {
  test.setTimeout(120_000);
  await suggestions(page);
  const [c] = await oracle<{ code: string }>(
    `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND title = 'Research Associate'
     GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`,
  );
  await box(page).fill('research assoc');
  const r = page.locator(`[role="option"][data-key="t:${c.code}"]`);
  await expect(r).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await expect(main(page), 'typing alone showed a row').not.toHaveAttribute('data-filter', /./);
  await r.hover();
  await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(await covered({ code: c.code })), { timeout: 60_000 });
});

test('the group’s label keeps off the panel’s controls, for every suggestion', async ({ page }) => {
  test.setTimeout(240_000);
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    const keys = await suggestions(page, size);
    for (const k of keys) {
      await row(page, k).hover();
      await expect(main(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
      await expect(page.locator('.hero-dist-group-flag')).not.toHaveAttribute('data-pending', /./);
      await page.waitForTimeout(100);
      const hit = await page.evaluate(() => {
        const f = document.querySelector('.hero-dist-group-flag')!.getBoundingClientRect();
        const c = document.querySelector('.hero-dist-controls')!.getBoundingClientRect();
        return f.left < c.right && f.right > c.left && f.top < c.bottom && f.bottom > c.top;
      });
      expect(hit, `${size.width}px: ${k}'s label lies on the controls`).toBe(false);
      // Moving off a row onto the next shows the next; here, to be sure it changed, wait for its name.
    }
  }
});

test('"Show on full page graph" puts the group on full page, and a preview never shows there', async ({ page }) => {
  const keys = await suggestions(page);
  const t = keys.find((k) => k.startsWith('t:'))!;
  await row(page, t).hover();
  await expect(main(page)).toHaveAttribute('data-filter', /./, { timeout: 60_000 });
  const name = await main(page).getAttribute('data-filter');
  await row(page, t).locator('.search-show-on-graph').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .search-token-label')).toHaveText([name!]);
  await expect(page.locator('.search-show-on-graph')).toHaveCount(0);
  // Full page, the bar's own suggestions are filters to put on, not previews: going to one leaves the
  // graph showing the filter that is on.
  const fullMain = page.locator('.hero-dist-full .hero-dist-main');
  await expect(fullMain).toHaveAttribute('data-filter', name!, { timeout: 60_000 });
  const chip = page.locator('.hero-dist-full [role="option"]').first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await chip.hover();
  await page.waitForTimeout(800);
  await expect(fullMain).toHaveAttribute('data-filter', name!);
});

test('"Show on full page graph" is in the accent on every row, and leaves every name its whole width', async ({ page }) => {
  const keys = await suggestions(page);
  const looks = await page.evaluate(() => [...document.querySelectorAll('[data-suggestions] [role="option"]')].map((r) => {
    const chip = r.querySelector('.search-show-on-graph')!;
    const name = r.querySelector('.mantine-Text-root')!;
    const cs = getComputedStyle(chip);
    // The name's text, not its element: a block that runs the row's width, and its line's leading.
    const range = document.createRange();
    range.selectNodeContents(name);
    const nb = range.getBoundingClientRect(), cb = chip.getBoundingClientRect();
    // Down to the glyphs: the line box's half-leading below them is space, not name.
    const ncs = getComputedStyle(name);
    const glyphBottom = nb.bottom - (parseFloat(ncs.lineHeight) - parseFloat(ncs.fontSize)) / 2;
    return {
      tinted: !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor),
      truncated: name.scrollWidth > name.clientWidth + 1,
      overName: nb.right > cb.left && nb.left < cb.right && glyphBottom > cb.top && nb.top < cb.bottom,
    };
  }));
  expect(looks).toHaveLength(keys.length);
  for (const [i, l] of looks.entries()) {
    expect(l.tinted, `${keys[i]}: the button is quiet`).toBe(true);
    expect(l.truncated, `${keys[i]}: the name is cut short`).toBe(false);
    expect(l.overName, `${keys[i]}: the button lies beside the name`).toBe(false);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the suggestions, with one shown on the graph, pass a strict accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const keys = await suggestions(page);
    await row(page, keys[1]).hover();
    await expect(main(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page }).include('.search-dropdown').include('[role="combobox"]').include('.hero-dist-group-flag').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await expect(row(page, keys[1]).locator('.search-show-on-graph')).toHaveText('Show on full page graph');
  });
}
