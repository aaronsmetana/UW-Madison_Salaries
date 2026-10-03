import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { oracle, PAY } from './oracle';
import { HOME_STATS, places, spots } from './homeDots';

/**
 * The landing search's suggestions — with the box empty, the most common titles and largest divisions —
 * and its title and division results. A press on a row opens its page (on a desktop the list closed from
 * under the press, and nothing happened). A row the reader goes to, by pointer or arrow, is shown on the
 * graph above: its squares lit and the rest faded, where they stand. "Show on full page graph"
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
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
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

/**
 * A group shown on the graph from the list is lit where it stands: its squares in the search's ink, everyone
 * else's in the faded one, and nothing moves — a pointer passing over the list only repaints. Read off the
 * canvas at squares of each, before and after.
 */
test.describe('at 2x', () => {
  test.use({ deviceScaleFactor: 2, colorScheme: 'light' });

  test('a group shown on the graph is lit in the search’s ink, everyone else faded, and no square moves', async ({ page }) => {
    test.setTimeout(120_000);
    await suggestions(page);
    const [c] = await oracle<{ code: string }>(
      `SELECT job_code code FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND title = 'Professor'
       GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`,
    );
    const who = await covered({ code: c.code });
    const at = await spots();
    const lit = new Set(who.map((p) => at.get(p.person_key)).filter((s) => s?.field === 'main').map((s) => s!.index));
    const field = '.hero-dist-main .hero-dots';
    const before = await places(page, field);
    const n = before.length / 2;
    const mine = [...lit].slice(0, 30);
    const rest: number[] = [];
    for (let i = 0; i < n && rest.length < 30; i += 97) if (!lit.has(i)) rest.push(i);
    const colour = (v: string) => page.evaluate((v) => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = `var(${v})`; const c = getComputedStyle(s).color; s.remove(); return c.match(/[\d.]+/g)!.slice(0, 3).map(Number); }, v);
    const paint = (idx: number[]) => page.evaluate(([pts]) => {
      const cv = document.querySelector('.hero-dist-main .strata-base') as HTMLCanvasElement;
      const k = cv.width / cv.getBoundingClientRect().width;
      const ctx = cv.getContext('2d')!;
      return pts.map(([x, y]) => [...ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data].slice(0, 3));
    }, [idx.map((i) => [before[2 * i], before[2 * i + 1]] as [number, number])] as const);
    const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 6;

    await box(page).fill('professor');
    const row = page.locator(`[role="option"][data-key="t:${c.code}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.hover();
    await expect(dots(page)).toHaveAttribute('data-lit', await mainPrint(who), { timeout: 60_000 });
    await expect(main(page)).toHaveAttribute('data-sink', 'off');
    await page.waitForTimeout(300);
    const match = await colour('--strata-match'), dim = await colour('--strata-dim');
    const mineNow = await paint(mine), restNow = await paint(rest);
    expect(mineNow.filter((p) => !near(p, match)), 'a square of the group is not in the search’s ink').toEqual([]);
    expect(restNow.filter((p) => !near(p, dim)), 'a square of everyone else is not faded').toEqual([]);
    expect(await places(page, field), 'a preview moved the squares').toEqual(before);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the suggestions, with one shown on the graph, pass a strict accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const keys = await suggestions(page);
    await row(page, keys[1]).hover();
    await expect(main(page)).toHaveAttribute('data-group-count', /\d/, { timeout: 60_000 });
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page }).include('.search-dropdown').include('[role="combobox"]').include('.strata-chip').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await expect(row(page, keys[1]).locator('.search-show-on-graph')).toHaveText('Show on full page graph');
  });
}
