import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot, PERSON_PAY } from './oracle';

/**
 * Compare (C1, C3–C9). Empty, it has no view controls and offers comparisons to start from. Titles and divisions
 * are drawn on the people's chart, each a dashed median over a band of its middle half, and every line is named
 * where it ends — one who left says when. The gap to the top earner is drawn only at snapshots where everyone was
 * paid, and the gap and standing charts name their own lines. A link holds ids alone, encoded once; the unit is
 * "division" everywhere; and the tray shows three chips and how many more, one row on a phone.
 */

test.use({ viewport: { width: 1280, height: 900 } });
const ENGINEERING = 'College of Engineering';

/** Two associate professors in Engineering paid in six snapshots or more: one who has left, one paid in every snapshot. */
async function pair() {
  const rows = await oracle<{ pk: string; last_label: string; stayed: boolean }>(
    `WITH a AS (SELECT person_key pk, max(snapshot_date) FILTER (WHERE salary > 0) last_date,
        arg_max(snapshot_label, snapshot_date) FILTER (WHERE salary > 0) last_label,
        count(DISTINCT snapshot_id) FILTER (WHERE salary > 0) n,
        bool_or(job_code = 'FA030' AND school = '${ENGINEERING}') fa030
      FROM $SAL GROUP BY person_key)
     SELECT pk, last_label, last_date = (SELECT max(snapshot_date) FROM $SAL) stayed FROM a
     WHERE fa030 AND n >= 6 ORDER BY pk`,
  );
  const left = rows.find((r) => !r.stayed);
  const stayed = rows.find((r) => r.stayed);
  expect(left && stayed, 'no associate professor in Engineering who left, and one who stayed').toBeTruthy();
  return { left: left!, stayed: stayed! };
}

const link = (sel: string[]) => `./compare?${sel.map((s) => `sel=${encodeURIComponent(s)}`).join('&')}`;
const cardOf = (page: Page, chart: string) => page.locator('.mantine-Card-root', { has: page.locator(chart) });

async function cells(card: ReturnType<typeof cardOf>) {
  const table = card.locator('table').first();
  const head = await table.locator('thead th').allTextContents();
  const rows = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')));
  return { head, rows };
}
const amount = (s: string) => (s === '' ? null : Number(s.replace('−', '-').replace(/[^\d.-]/g, '')));

test('an empty Compare has no view controls and offers comparisons to start from, each a press', async ({ page }) => {
  await page.goto('./compare');
  await expect(page.getByRole('heading', { name: 'Build a side-by-side comparison' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('main').getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  await expect(page.locator('main .view-summary')).toHaveCount(0);
  await expect(page.locator('.compare-starters button')).toHaveCount(3);
  await page.getByRole('button', { name: 'Professor vs Associate Professor' }).click();
  await expect(page.locator('[data-row="Titles"] .mantine-Pill-root')).toHaveCount(2);
  await expect(page.getByRole('main').getByRole('button', { name: 'Copy link' })).toBeVisible();
});

test('titles and divisions are drawn on the people’s chart, a median over its middle half, and every line is named where it ends', async ({ page }) => {
  const { left, stayed } = await pair();
  await page.goto(link([`p:${left.pk}`, `p:${stayed.pk}`, 't:FA030', `s:${ENGINEERING}`]));
  const card = page.locator('.cmp-pay-card');
  await expect(card.locator('.end-label')).toHaveCount(4, { timeout: 60_000 });
  await expect(card.locator('.cmp-ref-title path.recharts-line-curve')).toBeAttached();
  await expect(card.locator('.cmp-ref-school path.recharts-line-curve')).toBeAttached();
  await expect(card.locator('.cmp-ref-band path.recharts-area-area')).toHaveCount(2);
  await expect(page.getByText('Title medians over time')).toHaveCount(0);
  const names = await card.locator('.end-label').allTextContents();
  expect(names).toContain('Associate Professor median');
  expect(names).toContain(`${ENGINEERING} median`);
  expect(names.filter((t) => t.endsWith(` · left after ${left.last_label}`)), `no one is said to have left after ${left.last_label}: ${names}`).toHaveLength(1);
  expect(names.filter((t) => t.includes('left after')), 'one who stayed is said to have left').toHaveLength(1);
  // The title's median at the latest snapshot: the oracle's, over each person's pay in the title.
  const snap = await latestSnapshot();
  const [{ med, q1, q3 }] = await oracle<{ med: number; q1: number; q3: number }>(
    `SELECT median(pay) med, quantile_cont(pay, 0.25) q1, quantile_cont(pay, 0.75) q3
     FROM (SELECT person_key, ${PERSON_PAY} pay FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = 'FA030' GROUP BY person_key) WHERE pay > 0`,
  );
  const { head, rows } = await cells(card);
  const col = head.indexOf('Associate Professor median');
  expect(col, `no median column in ${head}`).toBeGreaterThan(0);
  expect(amount(rows.at(-1)![col])).toBeCloseTo(Math.round(med), 0);
  // Its band, the middle half: the 25th to the 75th.
  const [lo, hi] = [amount(rows.at(-1)![col + 1])!, amount(rows.at(-1)![col + 2])!];
  expect(lo).toBeCloseTo(Math.round(q1), 0);
  expect(hi).toBeCloseTo(Math.round(q3), 0);
});

test('the gap to the top earner is drawn only where everyone was paid, in straight lines, each named', async ({ page }) => {
  const { left, stayed } = await pair();
  await page.goto(link([`p:${left.pk}`, `p:${stayed.pk}`]));
  const card = cardOf(page, '.gap-chart');
  await expect(card.locator('.end-label')).toHaveCount(2, { timeout: 60_000 });
  const { rows } = await cells(card);
  const shared = rows.filter((r) => r.slice(1).some((c) => c !== ''));
  expect(shared.length).toBeGreaterThan(1);
  for (const r of rows) {
    const v = r.slice(1).map(amount);
    if (v.every((x) => x == null)) continue;
    expect(v.every((x) => x != null), `${r[0]}: a gap drawn with someone not paid`).toBe(true);
    expect(Math.max(...(v as number[])), `${r[0]}: no one is the top earner`).toBe(0);
  }
  // After the one who left was last paid, nothing.
  const at = rows.findIndex((r) => r[0] === left.last_label);
  expect(at).toBeGreaterThan(-1);
  expect(rows.slice(at + 1).every((r) => r.slice(1).every((c) => c === '')), 'a gap drawn after one of them left').toBe(true);
  const curved = await card.locator('.cmp-line path.recharts-line-curve').evaluateAll((ps) => ps.some((p) => /[CQS]/.test(p.getAttribute('d') ?? '')));
  expect(curved, 'a gap line is curved').toBe(false);
  // The standing chart names its own lines too (C6).
  await expect(page.locator('.mantine-Card-root', { hasText: 'Standing within the school' }).locator('.end-label')).toHaveCount(2, { timeout: 60_000 });
});

test('a link holds ids alone, encoded once, and names them as it opens; the unit is a division everywhere', async ({ page }) => {
  await page.goto(link(['t:FA020', `s:${ENGINEERING}`]));
  await expect(page.locator('[data-row="Titles"]')).toContainText('Professor', { timeout: 60_000 });
  await expect(page.locator('[data-row="Divisions"]')).toContainText(ENGINEERING);
  await expect(page.locator('[data-row="Schools"]')).toHaveCount(0);
  await expect(page.getByText('Divisions side by side')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('columnheader', { name: 'Division', exact: true })).toBeVisible();
  const url = page.url();
  expect(url, 'encoded twice').not.toContain('%25');
  expect(new URL(url).searchParams.getAll('sel')).toEqual(['t:FA020', `s:${ENGINEERING}`]);
  expect(url, 'a name in the link').not.toContain('Professor');
});

const FIVE = JSON.stringify([
  { type: 'person', id: 'aaronsmetana|2014-10-15', label: 'Aaron Smetana', colorIdx: 0 },
  { type: 'title', id: 'FA020', label: 'Professor', colorIdx: 1 },
  { type: 'title', id: 'FA030', label: 'Associate Professor', colorIdx: 2 },
  { type: 'school', id: ENGINEERING, label: ENGINEERING, colorIdx: 3 },
  { type: 'school', id: 'School of Pharmacy', label: 'School of Pharmacy', colorIdx: 4 },
]);

test('the tray shows three chips and how many more, every one a press away', async ({ page }) => {
  await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), FIVE);
  await page.goto('./titles');
  const bar = page.getByRole('region', { name: 'Compare set' });
  await expect(bar).toBeVisible({ timeout: 60_000 });
  await expect(bar.locator('.tray-chip')).toHaveCount(3);
  await bar.getByRole('button', { name: '+2 more' }).click();
  await expect(bar.locator('.tray-chip')).toHaveCount(5);
  await bar.getByRole('button', { name: 'Fewer' }).click();
  await expect(bar.locator('.tray-chip')).toHaveCount(3);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the tray is one pill, and the page is padded to clear it', async ({ page }) => {
    await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), FIVE);
    await page.goto('./titles');
    const bar = page.getByRole('region', { name: 'Compare set' });
    await expect(bar).toBeVisible({ timeout: 60_000 });
    const box = (await bar.boundingBox())!;
    expect(box.height, 'the tray runs to more than one row').toBeLessThan(64);
    await expect(bar.locator('.tray-chip')).toHaveCount(0);
    await bar.getByRole('button', { name: 'More for the compare set' }).click();
    await expect(page.getByRole('menuitem', { name: /Clear/ })).toBeVisible();
    await page.keyboard.press('Escape');
    // Scrolled to the foot: the last of the page clears the tray.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footBottom = await page.locator('.app-footer').evaluate((f) => {
      const last = [...f.querySelectorAll('*')].filter((e) => e.textContent?.trim() && !e.children.length).at(-1)!;
      return last.getBoundingClientRect().bottom;
    });
    const top = (await bar.boundingBox())!.y;
    expect(footBottom, 'the tray covers the foot of the page').toBeLessThanOrEqual(top + 1);
  });
});
