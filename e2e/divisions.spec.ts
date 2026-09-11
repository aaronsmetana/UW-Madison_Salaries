import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, usd, latestSnapshot } from './oracle';
import { parseColor, flatten, contrast } from './color';

/**
 * Divisions (src/routes/Explore.tsx and its panels): the box plots' one scale, the pay-band note beside
 * pay-band figures, clickable school rows, the Top earners exclusions, the raise bins, the known breaks,
 * and the row add buttons at rest. Expected values from SQL written here.
 */

const DATA = new URL('../public/data/', import.meta.url);

async function tab(page: Page, name: string, query = '') {
  await page.goto(`./explore?tab=${name}${query}`);
}

test('box plots on Titles and Schools give every row the same pixels per $10k', async ({ page }) => {
  for (const name of ['titles', 'schools']) {
    await tab(page, name);
    const plots = page.locator('svg.mini-range');
    await expect(plots.first()).toBeAttached({ timeout: 60_000 });
    const rows = await plots.evaluateAll((svgs) =>
      svgs.map((s) => {
        const r = s.querySelector('rect.band-iqr')!;
        return { w: Number(r.getAttribute('width')), p25: Number(s.getAttribute('data-p25')), p75: Number(s.getAttribute('data-p75')), hi: Number(s.getAttribute('data-scale-hi')) };
      })
    );
    // Boxes cut at the edge, or drawn at their 1px minimum, measure the edge, not the scale.
    const perDollar = rows.filter((r) => r.p75 < r.hi && r.w > 1.5).map((r) => r.w / (r.p75 - r.p25));
    expect(perDollar.length, `${name}: rows to compare`).toBeGreaterThan(10);
    const lo = Math.min(...perDollar);
    const hi = Math.max(...perDollar);
    expect(hi / lo - 1, `${name}: pixels per dollar vary by row`).toBeLessThan(1e-6);
    await expect(page.locator('.range-th')).toContainText(/Pay spread · \$0–\$\d+k/);
  }
});

test('the pay-band note sits beside pay-band figures, not in a banner over Divisions', async ({ page }) => {
  const ref = JSON.parse(readFileSync(new URL('reference-status.json', DATA), 'utf8'));
  const grades: { grade: number; basis: string }[] = JSON.parse(readFileSync(new URL('grades.json', DATA), 'utf8'));
  expect(ref.status, 'the reference is partial, so there is a note to give').not.toBe('ok');
  const snap = await latestSnapshot();
  const [p] = await oracle<{ pk: string }>(
    `SELECT person_key pk FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       AND (${grades.map((g) => `(grade_number = ${g.grade} AND grade_basis = '${g.basis}')`).join(' OR ')})
     GROUP BY person_key HAVING count(*) = 1 ORDER BY 1 LIMIT 1`
  );

  await tab(page, 'schools');
  await expect(page.locator('svg.mini-range').first()).toBeAttached({ timeout: 60_000 });
  await expect(page.getByText('Pay-band reference')).toHaveCount(0);
  await expect(page.locator('.payband-note')).toHaveCount(0);

  await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=pay`);
  const card = page.locator('.mantine-Card-root').filter({ hasText: 'official HR range' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('.payband-note')).toContainText(`${ref.matched_rows.toLocaleString('en-US')} of ${ref.graded_rows.toLocaleString('en-US')} graded appointments`);
});

test('a school row opens the school; its chevron and add button do not; its departments link inside it', async ({ page }) => {
  await tab(page, 'schools');
  const row = page.locator('.school-row').filter({ hasText: 'School of Education' });
  await expect(row).toBeVisible({ timeout: 60_000 });

  await row.locator('.school-expand').click();
  await expect(page).toHaveURL(/\/explore\?/);
  const dept = page.locator('.dept-link').first();
  await expect(dept).toBeVisible({ timeout: 30_000 });
  const href = new URL((await dept.getAttribute('href'))!, 'http://x');
  expect(href.searchParams.get('school')).toBe('School of Education');
  expect(href.searchParams.get('dept')).toBe((await dept.textContent())!.trim());

  await row.locator('.peer-add').click();
  await expect(page).toHaveURL(/\/explore\?/);
  await expect(row.locator('.peer-add')).toContainText('In tray');

  await row.locator('td').nth(2).click();
  await expect(page).toHaveURL(new RegExp(`/school/${encodeURIComponent('School of Education')}`));
});

test('Top earners: setting Athletics aside refills the list, and part-time pay shows its full-time rate', async ({ page }) => {
  const snap = await latestSnapshot();
  const ranked = await oracle<{ pk: string; rate: number; n: number; fte: number; pay: number }>(
    `SELECT person_key pk, sum(salary) FILTER (WHERE salary > 0) rate, count(*) FILTER (WHERE salary > 0) n,
        sum(fte) FILTER (WHERE salary > 0) fte, sum(${PAY}) FILTER (WHERE salary > 0) pay
     FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1 HAVING pay > 0 ORDER BY pay DESC LIMIT 100`
  );
  const partTime = ranked.find((r) => r.n === 1 && r.fte < 0.995 && r.rate > r.pay);
  expect(partTime, 'someone in the top 100 is part-time').toBeTruthy();

  await tab(page, 'earners');
  const rows = page.locator('.earner-row');
  await expect(rows).toHaveCount(100, { timeout: 60_000 });
  const athletics = rows.filter({ has: page.locator('td', { hasText: 'Intercollegiate Athletics' }) });
  expect(await athletics.count(), 'Athletics is in the list to begin with').toBeGreaterThan(0);
  await expect(page.locator(`.earner-row:has(a[href$="${encodeURIComponent(partTime!.pk)}"]) .earner-rate`)).toHaveText(`full-time ${usd(partTime!.rate)}`);

  await page.locator('.exclude-athletics').click();
  await expect(page.locator('.earner-row[data-school="Intercollegiate Athletics"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(rows).toHaveCount(100);
});

test('Changes bins raises by 1%, with no change neutral and counted, and cuts in the down colour', async ({ page }) => {
  await tab(page, 'changes');
  const card = page.locator('.raise-dist-card');
  await expect(card).toHaveAttribute('data-raise-bins', /,/, { timeout: 60_000 });
  const bins = (await card.getAttribute('data-raise-bins'))!.split(',').map(Number);
  expect(bins).toEqual(Array.from({ length: bins.length }, (_, i) => bins[0] + i));
  expect(bins).toContain(0);
  expect(bins[bins.length - 1] - bins[0]).toBeGreaterThan(20);
  // Counted in 1% bins, not drawn on a 1% axis: raises land between the 5% marks too.
  const counts = (await card.getAttribute('data-raise-counts'))!.split(',').map((x) => x.split(':').map(Number));
  expect(counts.filter(([k, n]) => k > 0 && k % 5 !== 0 && n > 0).length).toBeGreaterThan(2);

  const zero = card.locator('.raise-bin-zero').first();
  await expect(zero).toHaveAttribute('fill', /gray4/);
  await expect(card.locator('.raise-zero-label')).toHaveText(/^[\d,]+$/);
  for (const down of await card.locator('.raise-bin-down').all()) await expect(down).toHaveAttribute('fill', /red/);
  for (const up of await card.locator('.raise-bin-up').all()) await expect(up).toHaveAttribute('fill', /pos/);
});

test('Retention marks the Oct 2023 coverage change, even where another step had more churn', async ({ page }) => {
  for (const q of ['', `&school=${encodeURIComponent('Intercollegiate Athletics')}`]) {
    await tab(page, 'cohorts', q);
    const turnover = page.locator('.turnover');
    await expect(turnover).toHaveAttribute('data-coverage-at', /\S/, { timeout: 60_000 });
    await expect(turnover).toHaveAttribute('data-coverage-at', 'Oct 2023');
    await expect(turnover.locator('.coverage-marker')).toHaveCount(1);
  }
});

test('Trends marks the scope change and the 9-month reporting change', async ({ page }) => {
  await tab(page, 'trends');
  const labels = page.locator('.break-label');
  await expect(labels).toHaveCount(2, { timeout: 60_000 });
  const text = (await labels.allTextContents()).join(' | ');
  expect(text).toMatch(/scope change/);
  expect(text).toMatch(/9-month/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`an add button at rest clears 3:1 against its row (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await tab(page, 'schools');
    const btn = page.locator('.school-row .peer-add').first();
    await expect(btn).toBeVisible({ timeout: 60_000 });
    await page.mouse.move(0, 0);
    const { color, bg, opacity } = await btn.evaluate((b) => {
      let el: Element | null = b;
      let op = 1;
      while (el) { op *= Number(getComputedStyle(el).opacity); el = el.parentElement; }
      let host: Element | null = b.closest('tr');
      let bgc = 'rgba(0, 0, 0, 0)';
      while (host && /rgba\(0, 0, 0, 0\)|transparent/.test(bgc)) { bgc = getComputedStyle(host).backgroundColor; host = host.parentElement; }
      return { color: getComputedStyle(b).color, bg: bgc, opacity: op };
    });
    const base = parseColor(bg).slice(0, 3) as [number, number, number];
    const [r, g, b, a] = parseColor(color);
    expect(contrast(flatten([r, g, b, a * opacity], base), base)).toBeGreaterThanOrEqual(3);
  });
}
