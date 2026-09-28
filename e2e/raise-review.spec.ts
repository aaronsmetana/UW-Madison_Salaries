import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle } from './oracle';
import { raisesCte } from './raiseOracle';

/**
 * The Raises page (src/routes/Raises.tsx): who got more than the usual raise between two snapshots, and what
 * may explain it. Every expected figure is the page's rule restated here in SQL over the parquet the preview
 * serves — never imported from src, and never a number written down, which the next data build would falsify.
 */

const read = <T,>(f: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${f}`, import.meta.url)), 'utf8'));
const REF = read<{ released_with: string | null; status: string }>('reference-status.json');
const GRADES = read<{ grade: number; basis: string; min: number }[]>('grades.json');

/** One employee category, however a release spelled it. */
const CAT = `CASE lower(trim(employee_category)) WHEN 'employee-in-training' THEN 'Employees in Training'
  WHEN 'employees in training' THEN 'Employees in Training' WHEN 'limited appointee' THEN 'Limited'
  ELSE coalesce(nullif(trim(employee_category), ''), 'Uncategorized') END`;

interface Pair { from: string; to: string }
/** A filter, on where each person is at the later snapshot: SQL over the columns it is given. */
type Where = (c: { sch: string; dept: string; code: string }) => string;
const EVERYONE: Where = () => 'TRUE';
const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
const inSchool = (school: string): Where => (c) => `${c.sch} = ${lit(school)}`;
const inDept = (school: string, dept: string): Where => (c) => `${c.sch} = ${lit(school)} AND ${c.dept} = ${lit(dept)}`;
const inTitle = (code: string): Where => (c) => `${c.code} = ${lit(code)}`;
const inFamily = (fam: string): Where => (c) => `regexp_extract(${c.code}, '^([A-Z]{2})[0-9]', 1) = ${lit(fam)}`;
/** The filter over `y`'s columns, and over a snapshot's own rows. */
const ON_Y = { sch: 'y.sch', dept: 'y.dept', code: 'y.code' };
const ON_ROWS = { sch: 'school', dept: 'department', code: 'job_code' };

/**
 * The pair's continuing raises (raiseOracle), each with where the person is at the later snapshot and their
 * usual raise: their category's most common raise at 0.1% where at least 40% of it got exactly that, else its
 * median; campus's for a category under 20 raises — or `set`, for everyone. Every category's usual raise is
 * read over all of campus. `y` carries `u` and `above`.
 */
function usualCte(p: Pair, set?: number): string {
  return `${raisesCte(p)},
    t AS (SELECT person_key, any_value(school) sch, any_value(department) dept, any_value(job_code) code, any_value(title) title,
                 any_value(${CAT}) cat, any_value(salary) rate, any_value(grade_number) g, any_value(grade_basis) gb, lower(any_value(comp_basis)) comp
          FROM $SAL WHERE snapshot_id = '${p.to}' AND salary > 0 GROUP BY 1 HAVING count(*) = 1),
    x AS (SELECT cr.*, t.* EXCLUDE (person_key) FROM cr JOIN t USING (person_key)),
    km AS (SELECT cat, round(r, 3) k, count(*) c FROM x GROUP BY 1, 2),
    modes AS (SELECT cat, first(k ORDER BY c DESC, k) k, max(c) c, sum(c) n FROM km GROUP BY cat),
    meds AS (SELECT cat, median(r) med FROM x GROUP BY cat),
    whole AS (SELECT first(k ORDER BY c DESC, k) k, max(c) c, sum(c) n FROM (SELECT round(r, 3) k, count(*) c FROM x GROUP BY 1)),
    cu AS (SELECT CASE WHEN c >= 0.4 * n THEN k ELSE round((SELECT median(r) FROM x), 3) END u FROM whole),
    usual AS (SELECT m.cat, CASE WHEN m.n < 20 THEN (SELECT u FROM cu) WHEN m.c >= 0.4 * m.n THEN m.k ELSE round(d.med, 3) END u
              FROM modes m JOIN meds d USING (cat)),
    y AS (SELECT x.*, ${set ?? 'usual.u'} u, round(r, 3) > ${set ?? 'usual.u'} above FROM x JOIN usual USING (cat))`;
}

/**
 * Who in the filter got more than their usual raise, and why — the first that fits: brought up to their
 * grade's minimum (only for a pair ending where the ranges came out); at least half of their title's
 * raises across campus above the usual, five or more, and theirs within a point of its median; the same of
 * their department's raises, leaving out those the first two explain; else individual.
 */
async function expected(p: Pair, where: Where = EVERYONE, set?: number) {
  const ranges = REF.status !== 'missing' && REF.released_with === p.to;
  const g = `(VALUES ${GRADES.map((x) => `(${x.grade}, '${x.basis}', ${x.min})`).join(', ')}) gr(grade, basis, mn)`;
  const floor = (min: string) => `(CASE WHEN y.gb = 'hourly' THEN round(${min} / 2080, 2) * 2080 ELSE ${min} - 0.5 END - 0.005)`;
  const scale = (comp: string) => `(CASE WHEN ${comp} = 'academic' THEN 9.0 / 11 ELSE 1 END)`;
  return oracle<{ person_key: string; why: string; r: number; u: number }>(
    `${usualCte(p, set)},
     f AS (SELECT person_key, any_value(salary) rate_from, lower(any_value(comp_basis)) comp_from FROM $SAL
           WHERE snapshot_id = '${p.from}' AND salary > 0 GROUP BY 1 HAVING count(*) = 1),
     ti AS (SELECT job, count(*) n, count(*) FILTER (WHERE above) b, median(r) med FROM y GROUP BY job),
     e AS (SELECT y.*,
             coalesce(${ranges} AND gr.mn IS NOT NULL AND f.rate_from < ${floor(`gr.mn * ${scale('f.comp_from')}`)}
               AND y.rate >= ${floor(`gr.mn * ${scale('y.comp')}`)} AND y.rate <= gr.mn * ${scale('y.comp')} * 1.005, FALSE) is_range,
             ti.n >= 5 AND ti.b * 2 >= ti.n AND abs(y.r - ti.med) <= 0.01 is_title
           FROM y JOIN f USING (person_key) JOIN ti USING (job) LEFT JOIN ${g} ON gr.grade = y.g AND gr.basis = y.gb),
     un AS (SELECT sch, dept, count(*) n, count(*) FILTER (WHERE above) b FROM e
            WHERE NOT (above AND (is_range OR is_title)) GROUP BY sch, dept)
     SELECT y.person_key, y.r, y.u, CASE
       WHEN y.is_range THEN 'range'
       WHEN y.is_title THEN 'title'
       WHEN un.n >= 5 AND un.b * 2 >= un.n THEN 'unit'
       ELSE 'individual' END why
     FROM e y LEFT JOIN un ON un.sch IS NOT DISTINCT FROM y.sch AND un.dept IS NOT DISTINCT FROM y.dept
     WHERE y.above AND ${where(ON_Y)}`,
  );
}

/** Everyone in the filter paid on both sides, by what can be said of them. */
async function account(p: Pair, where: Where = EVERYONE) {
  const [a] = await oracle<{ paid_both: number; same_job: number; changed_title: number; several: number; fte: number; basis: number }>(
    `${raisesCte(p)},
     s AS (SELECT snapshot_id, person_key, count(*) k, any_value(job_code) j, any_value(coalesce(nullif(fte, 0), 1)) f,
                  bool_or(${where(ON_ROWS)}) inside
           FROM $SAL WHERE salary > 0 AND snapshot_id IN ('${p.from}', '${p.to}') GROUP BY 1, 2),
     pb AS (SELECT a.k ka, b.k kb, a.j ja, b.j jb, a.f fa, b.f fb, a.person_key IN (SELECT person_key FROM cr) is_raise
              FROM s a JOIN s b ON b.person_key = a.person_key AND a.snapshot_id = '${p.from}' AND b.snapshot_id = '${p.to}' WHERE b.inside)
     SELECT count(*) paid_both, count(*) FILTER (WHERE is_raise) same_job,
       count(*) FILTER (WHERE ka = 1 AND kb = 1 AND ja IS DISTINCT FROM jb) changed_title,
       count(*) FILTER (WHERE NOT is_raise AND (ka > 1 OR kb > 1)) several,
       count(*) FILTER (WHERE NOT is_raise AND ka = 1 AND kb = 1 AND ja = jb AND fa <> fb) fte,
       count(*) FILTER (WHERE NOT is_raise AND ka = 1 AND kb = 1 AND ja = jb AND fa = fb) basis
     FROM pb`,
  );
  return a;
}

/** The canonical snapshots, oldest first (the Pre-TTC twin is not one). */
async function snapshots(): Promise<string[]> {
  return (await oracle<{ id: string }>(`SELECT snapshot_id id FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1 ORDER BY min(snapshot_date), 1`)).map((r) => r.id);
}

const summary = (page: Page) => page.locator('.raise-summary');
/** Once the page has read the pair and the filter's lists. */
async function loaded(page: Page) {
  await expect(summary(page)).toHaveAttribute('data-above', /^\d+$/, { timeout: 90_000 });
  await expect(page.locator('.raise-account')).toHaveAttribute('data-several', /^\d+$/, { timeout: 60_000 });
  await expect(page.locator('.raise-title-changes')).toHaveAttribute('data-count', /^\d+$/, { timeout: 60_000 });
}
const n = async (page: Page, attr: string) => Number(await summary(page).getAttribute(attr));

test('the two newest snapshots, each category’s usual raise as its rule finds it, and who got more', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  await page.goto('./raises');
  await loaded(page);
  const usual = await oracle<{ cat: string; u: number }>(`${usualCte(p)} SELECT cat, u FROM usual`);
  const shown = await page.locator('.raise-usual-cat').evaluateAll((els) => els.map((e) => ({ cat: e.getAttribute('data-cat')!, u: Number(e.getAttribute('data-usual')) })));
  expect(shown.map((s) => s.cat).sort()).toEqual(usual.map((s) => s.cat).sort());
  for (const s of shown) expect(s.u, s.cat).toBeCloseTo(usual.find((x) => x.cat === s.cat)!.u, 9);
  const want = await expected(p);
  const a = await account(p);
  expect(await n(page, 'data-above')).toBe(want.length);
  expect(await n(page, 'data-same-job')).toBe(a.same_job);
  expect(await n(page, 'data-paid-both')).toBe(a.paid_both);
  // Each explanation's count, as the badges give them.
  for (const w of ['range', 'title', 'unit', 'individual']) {
    const badge = page.locator(`.raise-why-counts [data-why="${w}"]`);
    const k = want.filter((r) => r.why === w).length;
    if (!k) await expect(badge).toHaveCount(0);
    else await expect(badge).toContainText(k.toLocaleString('en-US'));
  }
  // The first rows are the furthest above their usual raise.
  const firstRows = await page.locator('.raise-above-table tbody tr').evaluateAll((trs) => trs.slice(0, 5).map((tr) => tr.getAttribute('data-person')!));
  const top = [...want].sort((x, y) => y.r - y.u - (x.r - x.u)).slice(0, 5);
  const beyond = (k: string) => { const w = want.find((x) => x.person_key === k)!; return w.r - w.u; };
  firstRows.forEach((k, i) => expect(beyond(k), `row ${i + 1}`).toBeCloseTo(top[i].r - top[i].u, 9));
  // And each says it, in points at the printed tenth, beside its own usual raise. (The usual raise once
  // reached the page as an unscaled decimal: every row read "+0.0 pts, usual +200.0%" while every count
  // above was right.)
  const change = (d: number) => (Math.abs(d) < 0.0005 ? '0%' : `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`);
  const cells = await page.locator('.raise-above-table tbody tr .raise-above-cell').evaluateAll((tds) => tds.slice(0, 5).map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  firstRows.forEach((k, i) => {
    const w = want.find((x) => x.person_key === k)!;
    const pts = (Math.round(w.r * 1000) - Math.round(w.u * 1000)) / 10;
    expect(cells[i], `row ${i + 1}`).toBe(`+${pts.toFixed(1)} pts usual ${change(w.u)}`);
  });
});

test('everyone paid on both sides is accounted for, and the parts add up', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  await page.goto('./raises');
  await loaded(page);
  const a = await account(p);
  const box = page.locator('.raise-account');
  expect(Number(await box.getAttribute('data-changed-title'))).toBe(a.changed_title);
  expect(Number(await box.getAttribute('data-several'))).toBe(a.several);
  expect(Number(await box.getAttribute('data-fte'))).toBe(a.fte);
  expect(Number(await box.getAttribute('data-basis')) + Number(await box.getAttribute('data-other'))).toBe(a.basis);
  expect(a.same_job + a.changed_title + a.several + a.fte + a.basis, 'the oracle’s own parts').toBe(a.paid_both);
  expect(Number(await page.locator('.raise-title-changes').getAttribute('data-count'))).toBe(a.changed_title);
});

test('each filter narrows to exactly the people it names, where they are at the later snapshot', async ({ page }) => {
  test.setTimeout(300_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  const SCHOOL = 'School of Medicine and Public Health';
  const [dept] = await oracle<{ d: string }>(`SELECT department d FROM $SAL WHERE snapshot_id = '${p.to}' AND school = ${lit(SCHOOL)} AND salary > 0
    GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`);
  const [title] = await oracle<{ code: string }>(`SELECT job_code code FROM $SAL WHERE snapshot_id = '${p.to}' AND title = 'Research Specialist' AND salary > 0
    GROUP BY 1 ORDER BY count(DISTINCT person_key) DESC, 1 LIMIT 1`);
  const cases: [string, string, Where][] = [
    ['school', `sch=${encodeURIComponent(SCHOOL)}`, inSchool(SCHOOL)],
    ['department', `sch=${encodeURIComponent(SCHOOL)}&dept=${encodeURIComponent(dept.d)}`, inDept(SCHOOL, dept.d)],
    ['title', `title=${title.code}`, inTitle(title.code)],
    ['title category', 'family=IT', inFamily('IT')],
  ];
  for (const [what, query, where] of cases) {
    await page.goto(`./raises?${query}`);
    await loaded(page);
    const want = await expected(p, where);
    const a = await account(p, where);
    expect(await n(page, 'data-above'), what).toBe(want.length);
    expect(await n(page, 'data-same-job'), what).toBe(a.same_job);
    expect(await n(page, 'data-paid-both'), what).toBe(a.paid_both);
    expect(want.length, `${what}: nobody above the usual raise, so nothing here is tested`).toBeGreaterThan(0);
  }
  // From the picker too, and a school that someone moved into with their raise counts them.
  await page.goto('./raises');
  await loaded(page);
  await page.getByRole('textbox', { name: 'School / division' }).click();
  await page.getByRole('textbox', { name: 'School / division' }).fill('Medicine and Public');
  await page.getByRole('option', { name: SCHOOL, exact: true }).click();
  await expect(page).toHaveURL(/sch=School\+of\+Medicine|sch=School%20of%20Medicine/);
  await expect(summary(page)).toHaveAttribute('data-above', String((await expected(p, inSchool(SCHOOL))).length), { timeout: 60_000 });
});

test('a usual raise of your own counts the raises above it, and the link carries it', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  await page.goto('./raises');
  await loaded(page);
  const box = page.getByRole('textbox', { name: 'Count raises above' });
  await box.fill('5');
  await expect(page).toHaveURL(/base=5/);
  const want = await expected(p, EVERYONE, 0.05);
  await expect(summary(page)).toHaveAttribute('data-above', String(want.length), { timeout: 60_000 });
  await expect(page.locator('.raise-usual')).toHaveAttribute('data-usual-how', 'set');
  await page.reload();
  await loaded(page);
  expect(await n(page, 'data-above')).toBe(want.length);
  await expect(box).toHaveValue('5%');
  await page.getByRole('button', { name: 'Use the usual raise found in the data' }).click();
  await expect(page).not.toHaveURL(/base=/);
  await expect(summary(page)).toHaveAttribute('data-above', String((await expected(p)).length), { timeout: 60_000 });
});

test('a change of title is its own list, and no one in it is counted as a raise', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  // A department small enough that both lists are shown whole.
  const [d] = await oracle<{ sch: string; dept: string }>(
    `WITH s AS (SELECT snapshot_id, person_key, count(*) k, any_value(job_code) j, any_value(school) sch, any_value(department) dept
                FROM $SAL WHERE salary > 0 AND snapshot_id IN ('${p.from}', '${p.to}') GROUP BY 1, 2)
     SELECT b.sch, b.dept FROM s a JOIN s b ON b.person_key = a.person_key AND a.snapshot_id = '${p.from}' AND b.snapshot_id = '${p.to}'
     WHERE a.k = 1 AND b.k = 1 AND a.j IS DISTINCT FROM b.j AND b.sch IS NOT NULL AND b.dept IS NOT NULL
     GROUP BY 1, 2 HAVING count(*) BETWEEN 4 AND 60 ORDER BY count(*) DESC, 1, 2 LIMIT 1`,
  );
  const where = inDept(d.sch, d.dept);
  const changed = await oracle<{ pk: string }>(
    `WITH s AS (SELECT snapshot_id, person_key, count(*) k, any_value(job_code) j, any_value(school) sch, any_value(department) dept
                FROM $SAL WHERE salary > 0 AND snapshot_id IN ('${p.from}', '${p.to}') GROUP BY 1, 2)
     SELECT a.person_key pk FROM s a JOIN s b ON b.person_key = a.person_key AND a.snapshot_id = '${p.from}' AND b.snapshot_id = '${p.to}'
     WHERE a.k = 1 AND b.k = 1 AND a.j IS DISTINCT FROM b.j AND ${where({ sch: 'b.sch', dept: 'b.dept', code: 'b.j' })}`,
  );
  const above = await expected(p, where);
  expect(above.length, 'the premise: someone in the department got more than usual').toBeGreaterThan(0);
  expect(above.length, 'the premise: the list is shown whole').toBeLessThanOrEqual(100);
  await page.goto(`./raises?sch=${encodeURIComponent(d.sch)}&dept=${encodeURIComponent(d.dept)}`);
  await loaded(page);
  const keys = (sel: string) => page.locator(`${sel} tbody tr`).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-person')!).sort());
  expect(await keys('.raise-changes-table')).toEqual(changed.map((c) => c.pk).sort());
  const listed = await keys('.raise-above-table');
  expect(listed).toEqual(above.map((a) => a.person_key).sort());
  expect(listed.filter((k) => changed.some((c) => c.pk === k)), 'someone who changed title is listed as a raise').toEqual([]);
});

test('each raise is explained by the first reason that fits, and a pattern line opens its title', async ({ page }) => {
  test.setTimeout(240_000);
  const ids = await snapshots();
  const p = { from: ids.at(-2)!, to: ids.at(-1)! };
  const all = await expected(p);
  // The title with the most people explained title-wide, and every one of theirs as the rule gives it.
  const tally = new Map<string, number>();
  const codes = await oracle<{ pk: string; code: string }>(`${usualCte(p)} SELECT person_key pk, code FROM y WHERE above`);
  const codeOf = new Map(codes.map((c) => [c.pk, c.code]));
  for (const r of all) if (r.why === 'title') tally.set(codeOf.get(r.person_key)!, (tally.get(codeOf.get(r.person_key)!) ?? 0) + 1);
  const [code] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  expect(code, 'no title-wide adjustment in the newest pair to check').toBeTruthy();
  // Its line in the Patterns card counts the people it explains, and opens the title.
  await page.goto('./raises');
  await loaded(page);
  const line = page.locator(`.raise-patterns-title .raise-pattern[data-key="${code}"]`);
  await expect(line).toHaveAttribute('data-n', String(tally.get(code)));
  await expect(page.locator('.raise-patterns-title .raise-pattern').first(), 'the largest pattern is not first').toHaveAttribute('data-key', code);
  await line.click();
  await expect(page).toHaveURL(new RegExp(`title=${code}`));
  await loaded(page);
  const rows = await page.locator('.raise-above-table tbody tr').evaluateAll((trs) => Object.fromEntries(trs.map((tr) => [tr.getAttribute('data-person'), tr.getAttribute('data-why')])));
  const mine = all.filter((r) => codeOf.get(r.person_key) === code);
  expect(Object.keys(rows).length).toBe(Math.min(100, mine.length));
  for (const r of mine) if (rows[r.person_key]) expect(rows[r.person_key], r.person_key).toBe(r.why);
  expect(Object.values(rows)).toContain('title');
  // A range minimum, where the ranges came out with the later snapshot; its department's list shows it.
  const range = all.find((r) => r.why === 'range');
  if (REF.released_with === p.to) {
    expect(range, 'no one brought up to a range minimum in the pair the ranges came out with').toBeTruthy();
    const [at] = await oracle<{ sch: string; dept: string }>(`SELECT any_value(school) sch, any_value(department) dept FROM $SAL
      WHERE snapshot_id = '${p.to}' AND person_key = ${lit(range!.person_key)} AND salary > 0`);
    await page.goto(`./raises?sch=${encodeURIComponent(at.sch)}&dept=${encodeURIComponent(at.dept)}`);
    await loaded(page);
    await expect(page.locator(`.raise-above-table tr[data-person="${range!.person_key}"]`)).toHaveAttribute('data-why', 'range');
  }
});

test('the explanation badges narrow the list to one explanation, and the link carries it', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  const want = await expected({ from: ids.at(-2)!, to: ids.at(-1)! });
  await page.goto('./raises');
  await loaded(page);
  const badge = page.locator('.raise-why-counts [data-why="title"]');
  await badge.click();
  await expect(page).toHaveURL(/why=title/);
  await expect(badge).toHaveAttribute('aria-pressed', 'true');
  const whys = await page.locator('.raise-above-table tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-why')));
  expect(whys.length).toBe(Math.min(100, want.filter((w) => w.why === 'title').length));
  expect(new Set(whys)).toEqual(new Set(['title']));
  // The count above is still of everyone, and a reload keeps the narrowing.
  expect(await n(page, 'data-above')).toBe(want.length);
  await page.reload();
  await loaded(page);
  await expect(page.locator('.raise-above-table tbody tr[data-why="individual"]')).toHaveCount(0);
  await page.locator('.raise-why-counts [data-why="title"]').click();
  await expect(page).not.toHaveURL(/why=/);
  await expect(page.locator('.raise-above-table tbody tr[data-why="individual"]').first()).toBeVisible();
});

test('a raise on a person’s page opens who else in the title got more that step', async ({ page }) => {
  test.setTimeout(180_000);
  const AARON = 'aaronsmetana|2014-10-15';
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  const link = page.locator('table.appt-history .raise-compare-link').last();
  await expect(link).toBeVisible({ timeout: 60_000 });
  const href = new URL((await link.getAttribute('href'))!, 'http://x');
  const [from, to, code] = ['from', 'to', 'title'].map((k) => href.searchParams.get(k)!);
  // The step it links is the one the row compares: that person's continuing raise, in that title.
  const [mine] = await oracle<{ n: number }>(`${raisesCte({ from, to })} SELECT count(*) n FROM cr WHERE person_key = ${lit(AARON)} AND job = ${lit(code)}`);
  expect(mine.n, `${from} → ${to} in ${code} is not a continuing raise of theirs`).toBe(1);
  await link.click();
  await expect(page).toHaveURL(/\/raises\?/);
  await loaded(page);
  expect(await n(page, 'data-above')).toBe((await expected({ from, to }, inTitle(code))).length);
});

test('between two snapshots with no across-the-board raise, every raise is above the usual; and a longer span compounds', async ({ page }) => {
  test.setTimeout(240_000);
  const ids = await snapshots();
  // The newest pair whose campus-wide usual raise is 0%.
  let flat: Pair | null = null;
  for (let i = ids.length - 1; i > 0 && !flat; i--) {
    const p = { from: ids[i - 1], to: ids[i] };
    const [c] = await oracle<{ u: number }>(`${usualCte(p)} SELECT u FROM cu`);
    if (c.u === 0) flat = p;
  }
  expect(flat, 'no pair without an across-the-board raise to check').toBeTruthy();
  await page.goto(`./raises?from=${flat!.from}&to=${flat!.to}`);
  await loaded(page);
  await expect(page.locator('.raise-no-plan')).toBeVisible();
  expect(await n(page, 'data-above')).toBe((await expected(flat!)).length);
  // Two steps at once: the usual raise read over the span itself.
  const span = { from: ids.at(-3)!, to: ids.at(-1)! };
  await page.goto(`./raises?from=${span.from}&to=${span.to}`);
  await loaded(page);
  const [c] = await oracle<{ u: number }>(`${usualCte(span)} SELECT u FROM cu`);
  expect(Number(await page.locator('.raise-usual').getAttribute('data-usual-campus'))).toBeCloseTo(c.u, 9);
  expect(await n(page, 'data-above')).toBe((await expected(span)).length);
});

test('the pickers’ run is a link: reloaded, it is the same run', async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await snapshots();
  await page.goto('./raises');
  await loaded(page);
  const label = async (id: string) => (await oracle<{ l: string }>(`SELECT any_value(snapshot_label) l FROM $SAL WHERE snapshot_id = '${id}'`))[0].l;
  const from = ids.at(-4)!;
  await page.getByRole('textbox', { name: 'From', exact: true }).click();
  await page.getByRole('option', { name: await label(from), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
  await page.getByRole('textbox', { name: 'Title category' }).click();
  await page.getByRole('option', { name: 'Research (RE)', exact: true }).click();
  await expect(page).toHaveURL(/family=RE/);
  const want = await expected({ from, to: ids.at(-1)! }, inFamily('RE'));
  await expect(summary(page)).toHaveAttribute('data-above', String(want.length), { timeout: 90_000 });
  const url = page.url();
  await page.goto(url);
  await loaded(page);
  expect(await n(page, 'data-above')).toBe(want.length);
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveValue(await label(from));
  await expect(page.getByRole('textbox', { name: 'Title category' })).toHaveValue('Research (RE)');
});

test('Raises is a place in the menu and the palette, and Divisions → Changes links to its pair', async ({ page }) => {
  await page.goto('./explore?tab=changes');
  const link = page.locator('.changes-raises-link');
  await expect(link).toBeVisible({ timeout: 90_000 });
  const ids = await snapshots();
  expect(await link.getAttribute('href')).toContain(`from=${ids.at(-2)}&to=${ids.at(-1)}`);
  await link.click();
  await expect(page).toHaveURL(/\/raises\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Raises' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Raises', exact: true })).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog').getByRole('button', { name: 'Raises', exact: true }).click();
  await expect(page).toHaveURL(/\/raises$/);
});

test('on a phone the lists fit the screen', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('./raises');
  await loaded(page);
  await expect(page.locator('.raise-above-table tbody tr').first()).toBeVisible();
  const wide = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth,
    tables: [...document.querySelectorAll('.raise-above-table, .raise-changes-table')].map((t) => t.getBoundingClientRect().right) }));
  expect(wide.page, 'the page scrolls sideways').toBeLessThanOrEqual(wide.screen);
  for (const right of wide.tables) expect(right, 'a list runs past the screen').toBeLessThanOrEqual(wide.screen);
  await ctx.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the page passes axe once its lists are in (${theme})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ colorScheme: theme });
    const page = await ctx.newPage();
    await page.addInitScript((t) => { try { localStorage.setItem('mantine-color-scheme-value', t); } catch { /* private mode */ } }, theme);
    await page.goto('./raises');
    await loaded(page);
    await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await ctx.close();
  });
}
