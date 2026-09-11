import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY } from './oracle';

const AARON = 'aaronsmetana|2014-10-15';

/** Two of Aaron's System Engineer IV colleagues who held one appointment in every snapshot. */
async function colleagues() {
  return oracle<{ pk: string; nm: string }>(
    `SELECT person_key pk, arg_max(first_name || ' ' || last_name, snapshot_date) nm FROM $SAL
     WHERE person_key IN (SELECT person_key FROM $SAL WHERE snapshot_id = '2026-03' AND job_code = 'IT040') AND person_key <> '${AARON}'
     GROUP BY 1 HAVING count(*) = count(DISTINCT snapshot_id) AND count(DISTINCT snapshot_id) = 10 ORDER BY 1 LIMIT 2`
  );
}

/** Compare, opened on a shared link holding these people. */
async function openWith(page: Page, people: { pk: string; nm: string }[]) {
  const sel = people.map((p) => ['p', encodeURIComponent(p.pk), encodeURIComponent(p.nm)].join(',')).join('|');
  await page.goto(`./compare?${new URLSearchParams({ sel })}`);
  await expect(page.locator('.cadence-row')).toHaveCount(people.length, { timeout: 60_000 });
  await expect(page.locator('.cmp-line path.recharts-line-curve').first()).toBeAttached({ timeout: 60_000 });
}

test('adding a person in Compare renders a chart', async ({ page }) => {
  await page.goto('./compare');
  const search = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.locator('[role="option"][data-kind="person"]').first();
  await expect(hit).toBeVisible({ timeout: 60_000 });
  await hit.click();

  await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 });
});

test('one add box puts a person, a title and a division in the tray as what they are', async ({ page }) => {
  await page.goto('./compare');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  // One box, where there were three (a person search and two dropdowns).
  await expect(page.locator('.mantine-Card-root').filter({ hasText: 'Add a person, title or division' }).locator('input')).toHaveCount(1);

  await box.fill('smetana');
  await page.locator('[role="option"][data-kind="person"]').filter({ hasText: 'Aaron Smetana' }).click({ timeout: 60_000 });
  await box.fill('system engineer');
  await page.locator('[data-group="titles"] [role="option"]').filter({ hasText: 'IT040' }).click({ timeout: 60_000 });
  await box.fill('medicine');
  await page.locator('[data-group="divisions"] [role="option"]').filter({ hasText: 'School of Medicine and Public Health' }).click({ timeout: 60_000 });

  await expect(page.locator('[data-row="People"]')).toContainText('Aaron Smetana');
  await expect(page.locator('[data-row="Titles"]')).toContainText('System Engineer IV');
  await expect(page.locator('[data-row="Schools"]')).toContainText('School of Medicine and Public Health');
  await expect(page.locator('[data-row="People"] .mantine-Pill-root')).toHaveCount(1);
});

test('pointing at a chip thickens its series on every chart, and dims nothing', async ({ page }) => {
  const others = await colleagues();
  await openWith(page, [{ pk: AARON, nm: 'Aaron Smetana' }, ...others]);
  const chip = page.locator('[data-row="People"] [data-series]').first();
  const idx = await chip.getAttribute('data-color-idx');
  const lines = () =>
    page.locator('.cmp-line path.recharts-line-curve').evaluateAll((ps) =>
      ps.map((p) => ({ mine: (p.closest('.cmp-line')?.getAttribute('class') ?? '').split(' '), w: p.getAttribute('stroke-width'), o: p.getAttribute('stroke-opacity') }))
    );

  await chip.hover();
  const hovered = await lines();
  const own = hovered.filter((l) => l.mine.includes(`cmp-p${idx}`));
  // Trajectory, gap and standing: three charts draw each person.
  expect(own.map((l) => l.w)).toEqual(['3', '3', '3']);
  for (const l of hovered.filter((x) => !x.mine.includes(`cmp-p${idx}`))) expect([l.w, l.o]).toEqual(['2', '1']);

  // The same from a row of the cadence table.
  await page.locator('.cadence-row').nth(1).hover();
  const rowIdx = await page.locator('[data-row="People"] [data-series]').nth(1).getAttribute('data-color-idx');
  expect((await lines()).filter((l) => l.mine.includes(`cmp-p${rowIdx}`)).map((l) => l.w)).toEqual(['3', '3', '3']);

  // A click still mutes.
  await page.locator('[data-row="People"] .series-toggle').nth(1).click();
  await page.locator('h1').hover();
  expect((await lines()).filter((l) => l.mine.includes(`cmp-p${rowIdx}`)).map((l) => l.o)).toEqual(['0.15', '0.15', '0.15']);
});

test('the gap chart says "behind" and "top earner", and shades only a person shown alone', async ({ page }) => {
  const others = await colleagues();
  await openWith(page, [{ pk: AARON, nm: 'Aaron Smetana' }, ...others]);
  const ticks = await page.locator('.gap-chart .recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
  expect(ticks).toContain('top earner');
  expect(ticks.filter((t) => t !== 'top earner').every((t) => /^\$[\d.]+k behind$/.test(t))).toBe(true);
  expect(ticks.length).toBeGreaterThan(2);

  const shade = page.locator('.gap-chart .gap-shade path.recharts-area-area');
  await expect(shade).toHaveCount(0);
  const dot = page.locator('[data-row="People"] .series-toggle').first();
  await dot.click({ modifiers: ['Shift'] });
  await expect(shade).toHaveCount(1);
  await dot.click({ modifiers: ['Shift'] });
  await expect(shade).toHaveCount(0);
});

test("the cadence table counts raises by the site's rules and measures stagnation in months", async ({ page }) => {
  // Aaron's pay by snapshot, from the parquet: the steps, and the longest run of months over which it did not rise.
  const snaps = await oracle<{ id: string; d: string; pay: number }>(
    `SELECT snapshot_id id, CAST(min(snapshot_date) AS VARCHAR) d, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL
     WHERE person_key = '${AARON}' AND snapshot_id NOT LIKE '%-pre' GROUP BY 1 ORDER BY d`
  );
  const months = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000 / 30.4375);
  let run = 0;
  let longest = 0;
  for (let i = 1; i < snaps.length; i++) {
    run = snaps[i].pay > snaps[i - 1].pay ? 0 : run + months(snaps[i - 1].d, snaps[i].d);
    longest = Math.max(longest, run);
  }

  await openWith(page, [{ pk: AARON, nm: 'Aaron Smetana' }]);
  const row = page.locator(`.cadence-row[data-person="${AARON}"]`);
  const steps = (await row.getAttribute('data-steps'))!.split(',');
  // The relabel is not a step: every step ends at a canonical snapshot after the first.
  expect(steps.map((s) => s.split(':')[0])).toEqual(snaps.slice(1).map((s) => s.id));
  expect(steps).toContain('2022-08:promotion');
  expect(Number(await row.getAttribute('data-raises'))).toBe(steps.filter((s) => s.endsWith(':raise')).length);
  expect(Number(await row.getAttribute('data-longest'))).toBe(longest);
  await expect(row).toContainText(`${longest} months`);
  await expect(row.locator('.series-dot')).toHaveCount(1);
  await expect(row.locator('svg.sparkline')).toHaveAttribute('data-points', String(snaps.length + 1));
});

test("a 9-month member's Sep 2025 is a reporting change, not a raise", async ({ page }) => {
  const [p] = await oracle<{ pk: string; nm: string }>(
    `WITH a AS (SELECT person_key, job_code, ${PAY} pay FROM $SAL WHERE snapshot_id = '2025-04' AND comp_basis = 'Academic' AND salary > 0),
          b AS (SELECT person_key, job_code, ${PAY} pay FROM $SAL WHERE snapshot_id = '2025-09' AND comp_basis = '9 Month' AND salary > 0),
          one AS (SELECT person_key FROM $SAL GROUP BY person_key HAVING count(*) = count(DISTINCT snapshot_id))
     SELECT a.person_key pk, (SELECT arg_max(first_name || ' ' || last_name, snapshot_date) FROM $SAL s WHERE s.person_key = a.person_key) nm
     FROM a JOIN b USING (person_key, job_code) JOIN one USING (person_key)
     WHERE abs(b.pay / (a.pay * 11.0 / 9) - 1) < 0.0005 ORDER BY 1 LIMIT 1`
  );
  await openWith(page, [p]);
  const row = page.locator('.cadence-row').first();
  const steps = (await row.getAttribute('data-steps'))!.split(',');
  expect(steps).toContain('2025-09:reporting');
  expect(Number(await row.getAttribute('data-raises'))).toBe(steps.filter((s) => s.endsWith(':raise')).length);
});
