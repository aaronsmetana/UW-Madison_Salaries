import { test, expect, type Page } from '@playwright/test';
import { oracle, main } from './oracle';

/**
 * Divisions › Changes (D21–D29): the payroll as its waterfall alone; caveats as one line with their detail a click
 * away; the median's word clear of the bars' counts; the biggest raises by Faculty or staff and without Athletics,
 * cuts the record cannot explain set aside; title changes with whole titles, codes where they read the same, and
 * pay; internal moves without the reorganization's, gains apart from losses; net flow as bars from zero; and a map
 * of the tab held under the page header.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

async function changes(page: Page, query = '') {
  await page.goto(`./divisions?tab=changes${query}`);
  await expect(page.locator('.changes-lead')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.raise-dist-card')).toHaveAttribute('data-raise-counts', /,/, { timeout: 60_000 });
}

test('the payroll is its waterfall, each step labelled, with no tiles saying it again', async ({ page }) => {
  await changes(page);
  const card = page.locator('#changes-payroll');
  await expect(card.locator('.recharts-label-list text')).toHaveCount(4, { timeout: 60_000 });
  await expect(card.locator('.stat-row')).toHaveCount(0);
});

test('a reorganization is one line, its detail one click away', async ({ page }) => {
  await changes(page);
  const notice = page.locator('.changes-reorg').first();
  await expect(notice.locator('.compact-notice-title')).toContainText('A reorganization:');
  // One line before the figures (the detail clipped to nothing until opened), then the detail under it.
  const height = async () => (await notice.boundingBox())!.height;
  expect(await height()).toBeLessThan(48);
  await expect(notice).toContainText('from whole departments of');
  await notice.getByRole('button', { name: 'More' }).click();
  await expect.poll(height).toBeGreaterThan(60);
  await notice.getByRole('button', { name: 'Less' }).click();
  await expect.poll(height).toBeLessThan(48);
});

test('the median’s word is clear of every count on the bars', async ({ page }) => {
  // The latest pair, and Sep 2025 → Mar 2026, when the no-change bar is the one cut and counted.
  for (const q of ['', '&snap=2026-03&from=2025-09']) {
    await changes(page, q);
    await page.waitForTimeout(1500);
    const hits = await page.locator('.raise-dist-card').evaluate((card) => {
      const box = (e: Element) => e.getBoundingClientRect();
      const words = [...card.querySelectorAll('.recharts-reference-line text, .recharts-reference-line .recharts-label')].map(box);
      const counts = [...card.querySelectorAll('.raise-count-label')].map(box);
      return words.flatMap((w) => counts.filter((c) => w.left < c.right && c.left < w.right && w.top < c.bottom && c.top < w.bottom)).length;
    });
    expect(hits, `"median" on a count${q ? ` (${q})` : ''}`).toBe(0);
  }
});

test('net flow is drawn as bars from zero, gains right and losses left, on one scale', async ({ page }) => {
  await changes(page);
  const rows = page.locator('#changes-flow tr[data-net]');
  await expect(rows.first()).toBeVisible();
  const g = await rows.evaluateAll((trs) => trs.map((tr) => {
    const net = Number(tr.getAttribute('data-net'));
    const track = tr.querySelector('.net-bar')!.getBoundingClientRect();
    const bar = tr.querySelector('.net-bar-up, .net-bar-down')!;
    const b = bar.getBoundingClientRect();
    return { net, up: bar.classList.contains('net-bar-up'), mid: track.left + track.width / 2, left: b.left, right: b.right, w: b.width };
  }));
  expect(g.some((r) => r.net > 0) && g.some((r) => r.net < 0)).toBe(true);
  const max = Math.max(...g.map((r) => Math.abs(r.net)));
  const widest = Math.max(...g.map((r) => r.w));
  for (const r of g) {
    expect(r.up, `${r.net} drawn the wrong way`).toBe(r.net > 0);
    expect(Math.abs((r.up ? r.left : r.right) - r.mid), 'a bar does not start at zero').toBeLessThanOrEqual(1);
    expect(Math.abs(r.w - (widest * Math.abs(r.net)) / max), 'a bar off the list’s one scale').toBeLessThanOrEqual(1);
  }
});

test('a map of the tab, held under the header, takes the reader to each section', async ({ page }) => {
  await changes(page);
  const map = page.getByRole('navigation', { name: 'Sections of Changes' });
  await expect(map.getByRole('button')).toHaveText(['Summary', 'Payroll', 'Raises', 'Biggest raises', 'Net flow', 'Title changes', 'Transitions', 'Internal moves']);
  // Net flow, mid-tab, so the page can scroll it to the top.
  await map.getByRole('button', { name: 'Net flow' }).click();
  await expect.poll(async () => Math.round((await page.locator('#changes-flow').boundingBox())!.y), { timeout: 5_000 }).toBeLessThan(220);
  await page.waitForTimeout(600);
  // Still on screen down the tab, just under the page header, and the section clear of it.
  const m = (await map.boundingBox())!;
  expect(m.y).toBeGreaterThanOrEqual(-1);
  expect(m.y).toBeLessThan(120);
  const section = (await page.locator('#changes-flow').boundingBox())!;
  expect(section.y, 'the section starts under the map').toBeGreaterThanOrEqual(m.y + m.height - 2);
  // In one division nobody moves between divisions: the map leaves out what the tab does not draw.
  await changes(page, `&school=${encodeURIComponent('College of Engineering')}`);
  await expect(page.locator('#changes-moves')).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Internal moves' })).toHaveCount(0);
});

const keysIn = (page: Page, sel: string) => page.locator(sel).locator('a[href*="/person/"]').evaluateAll((as) =>
  as.map((a) => decodeURIComponent(a.getAttribute('href')!.split('/person/')[1])));
const latestId = async () => (await oracle<{ id: string }>(`SELECT snapshot_id id FROM $SAL GROUP BY 1 ORDER BY any_value(snapshot_date) DESC LIMIT 1`))[0].id;

test('the biggest raises by Faculty or staff, and without Athletics', async ({ page }) => {
  await changes(page);
  const raises = page.locator('#changes-movers .mantine-Card-root').first();
  await expect(raises.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(raises).toContainText('Intercollegiate Athletics');
  await page.locator('.movers-no-athletics').click();
  // Once the list is back (it empties while it reloads), no one in it is Athletics'.
  await expect.poll(async () => {
    const text = await raises.innerText();
    return (await raises.locator('tbody tr').count()) >= 5 && !text.includes('Intercollegiate Athletics');
  }, { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(800);
  await expect(raises).not.toContainText('Intercollegiate Athletics');
  await page.locator('.mover-controls').getByText('Faculty', { exact: true }).click();
  await expect.poll(async () => (await keysIn(page, '#changes-movers .mantine-Card-root >> nth=0')).length, { timeout: 60_000 }).toBeGreaterThan(3);
  await page.waitForTimeout(800);
  const keys = await keysIn(page, '#changes-movers .mantine-Card-root >> nth=0');
  const snap = await latestId();
  const cats = await oracle<{ c: string }>(
    `SELECT ${main('employee_category')} c FROM $SAL WHERE snapshot_id = '${snap}' AND person_key IN (${keys.map((k) => `'${k.replaceAll("'", "''")}'`).join(', ')}) GROUP BY person_key`
  );
  expect(new Set(cats.map((r) => r.c))).toEqual(new Set(['Faculty']));
});

test('a cut the record cannot explain is set aside, and shown flagged on request', async ({ page }) => {
  await changes(page);
  const cuts = page.locator('.cuts-table');
  await expect(cuts.locator('tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(cuts.locator('.flag-tag')).toHaveCount(0);
  await expect(page.locator('.cuts-flag-note')).toContainText('set aside');
  // Every row a cut.
  const deltas = await cuts.locator('tr td:nth-child(3)').allInnerTexts();
  for (const d of deltas) expect(d.trim()).toMatch(/^−\$/);
  await page.locator('.cuts-show-flagged').click();
  await expect(cuts.locator('.flag-tag').first()).toBeVisible({ timeout: 60_000 });
});

test('a title change gives whole titles, their codes where they read the same, and the pay each side', async ({ page }) => {
  await changes(page);
  const rows = page.locator('tr.title-change-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  for (const row of await rows.all()) {
    const titles = (await row.locator('.title-change-titles').innerText()).trim();
    // A job code is two letters, three digits and a suffix (RE042N), not "(B)" in a title.
    const code = /\s*\(([A-Z]{2}\d{3}[A-Z0-9]*)\)$/;
    const [from, to] = titles.split(' → ').map((t) => t.replace(code, '').trim());
    if (from.toLowerCase() === to.toLowerCase()) expect(titles, 'same names, no codes').toMatch(/\([A-Z]{2}\d{3}[A-Z0-9]*\) → .*\([A-Z]{2}\d{3}[A-Z0-9]*\)$/);
    await expect(row.locator('.title-change-pay')).toHaveText(/^\$[\d,]+ → \$[\d,]+$/);
    // Whole: each title as its code's latest snapshot gives it (older snapshots cut titles at 30 characters).
    const [aj, bj] = [await row.getAttribute('data-a-job'), await row.getAttribute('data-b-job')];
    const map = new Map((await oracle<{ j: string; t: string }>(
      `SELECT job_code j, arg_max(title, snapshot_date) t FROM $SAL WHERE job_code IN ('${aj}', '${bj}') GROUP BY 1`
    )).map((r) => [r.j, r.t]));
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [shown, j] of [[from, aj], [to, bj]] as const) {
      const want = map.get(j ?? '') ?? '';
      // An all-capitals title is rewritten for reading (legacyTitle): only a cased one compares letter for letter.
      if (want && want !== want.toUpperCase()) expect(norm(shown), `${j}: "${shown}" is not "${want}"`).toBe(norm(want));
    }
    await expect(row.locator('.title-change-delta')).toHaveText(/[+−]\$[\d,]+ [+−][\d.]+%$/);
  }
});

test('internal moves: the reorganization’s set aside by default, gains apart from losses', async ({ page }) => {
  await changes(page);
  const card = page.locator('#changes-moves');
  await expect(card.locator('tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.reorg-badge')).toHaveCount(0);
  for (const [cls, sign] of [['.moves-up', '+'], ['.moves-down', '−']] as const) {
    const vals = await card.locator(`${cls} tr td:last-child`).allInnerTexts();
    expect(vals.length).toBeGreaterThan(0);
    for (const v of vals) expect(v.trim().startsWith(sign), `${cls}: ${v}`).toBe(true);
    // The biggest first.
    const sizes = vals.map((v) => Number(v.replace(/[^\d]/g, '')));
    expect(sizes, `${cls} not biggest first`).toEqual([...sizes].sort((x, y) => y - x));
  }
  await expect(card.locator('.moves-note')).toContainText('usually not a pay cut');
  await card.locator('.moves-hide-reorg').click();
  await expect(card.locator('.reorg-badge').first()).toBeVisible();
});
