import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import {
  usualModesSql, usualRaises, reviewSql, titleChangesSql, accountSql, distributionSql,
  type ModeRow, type ReviewRow, type Account, type TitleChangeRow, type Usuals,
} from './raiseReview';

/**
 * The Raises page's SQL, executed over a campus built to exercise each rule once. Between snapshots `a` and
 * `b` the pay plan gave Academic Staff 2%; University Staff got no one raise most of them share; and each
 * explanation has the people it is for.
 */

type Row = Record<string, string | number | null>;
const COLS = ['snapshot_id', 'snapshot_date', 'person_key', 'first_name', 'last_name', 'school', 'department', 'employee_category',
  'job_code', 'title', 'grade_number', 'grade_basis', 'salary', 'salary_fte_adjusted', 'fte', 'comp_basis', 'base_pay'] as const;
const DATES: Record<string, string> = { a: '2026-03-01', b: '2026-09-01', c: '2027-03-01' };

const ROWS: Row[] = [];
/** One paid appointment in snapshot `snap`. */
function appt(snap: string, person: string, o: { job: string; pay: number; cat?: string; school?: string; dept?: string; fte?: number; basis?: string; grade?: number | null }) {
  ROWS.push({
    snapshot_id: snap, snapshot_date: DATES[snap], person_key: person, first_name: person, last_name: 'X',
    school: o.school ?? 'S', department: o.dept ?? 'D1', employee_category: o.cat ?? 'Academic Staff',
    job_code: o.job, title: `Title ${o.job}`, grade_number: o.grade ?? null, grade_basis: o.grade != null ? 'annual_12mo' : null,
    salary: o.pay, salary_fte_adjusted: null, fte: o.fte ?? 1, comp_basis: o.basis ?? '12 Month', base_pay: null,
  });
}
/** A continuing raise from `a` to `b`: the same job, FTE and basis, by `r`. */
function raise(person: string, r: number, o: Parameters<typeof appt>[2]) {
  appt('a', person, o);
  appt('b', person, { ...o, pay: Math.round(o.pay * (1 + r) * 100) / 100 });
}

// Academic Staff at the plan's 2%: forty of them, eight in each of five departments — and on to `c` at 3%.
for (let i = 0; i < 40; i++) {
  raise(`base${i}`, 0.02, { job: 'J1', pay: 50000 + i, dept: `D${1 + (i % 5)}` });
  appt('c', `base${i}`, { job: 'J1', pay: Math.round((50000 + i) * 1.02 * 1.03 * 100) / 100, dept: `D${1 + (i % 5)}` });
}
// A title-wide adjustment: five of T1's six at +6%, in five different departments.
for (let i = 0; i < 6; i++) raise(`t1_${i}`, i < 5 ? 0.06 : 0.02, { job: 'T1', pay: 60000, dept: `D${1 + (i % 5)}` });
// A department-wide pattern: three of DU's five above the plan, each in a title of their own.
for (let i = 0; i < 5; i++) raise(`du${i}`, i < 3 ? 0.05 : 0.02, { job: `JU${i}`, pay: 55000, dept: 'DU' });
// Above the plan alone: a J1 in D1 at +10%.
raise('solo', 0.1, { job: 'J1', pay: 50000, dept: 'D1' });
// Brought up to grade 20's minimum (50,000): 45,000 → 50,000, alone in its title and department.
raise('floor', 50000 / 45000 - 1, { job: 'JR', pay: 45000, dept: 'DR', grade: 20 });
// Where two explanations fit, the first in order: DX's five are all T2 at +6%, so title-wide and department-wide
// at once — title-wide first — and one of them was brought up to grade 20's minimum by it, which comes first of all.
for (let i = 0; i < 4; i++) raise(`dx${i}`, 0.06, { job: 'T2', pay: 70000, dept: 'DX' });
raise('dxfloor', 50000 / 47170 - 1, { job: 'T2', pay: 47170, dept: 'DX', grade: 20 });
// A department whose raises above the plan are one title's adjustment: DT's five T3 at +6%, and beside them
// three at the plan's 2% and one at +5% in a title of its own. That one is not a department-wide pattern.
for (let i = 0; i < 5; i++) raise(`dt${i}`, 0.06, { job: 'T3', pay: 65000, dept: 'DT' });
for (let i = 0; i < 3; i++) raise(`dtbase${i}`, 0.02, { job: 'J1', pay: 50000, dept: 'DT' });
raise('dtsolo', 0.05, { job: 'J9', pay: 50000, dept: 'DT' });
// Both title-wide and department-wide: DU's pattern above, and T4's adjustment — five at +6% in D1–D5, and 'dut' in
// DU at the same. Title-wide comes first.
for (let i = 0; i < 5; i++) raise(`t4_${i}`, 0.06, { job: 'T4', pay: 58000, dept: `D${1 + i}` });
raise('dut', 0.06, { job: 'T4', pay: 58000, dept: 'DU' });
// Moved school with the raise: in S2 at `b`, and above the plan.
appt('a', 'mover', { job: 'J1', pay: 50000, school: 'S', dept: 'D1' });
appt('b', 'mover', { job: 'J1', pay: 53500, school: 'S2', dept: 'D1' });
// Three "Limited Appointee" (Apr 2024's spelling of Limited): too few for a usual raise of their own.
for (let i = 0; i < 3; i++) raise(`lim${i}`, i === 0 ? 0.05 : 0.02, { job: 'JL', pay: 30000, cat: i === 0 ? 'Limited Appointee' : 'Limited', dept: 'DL' });
// University Staff: 9 at +1%, 8 at +3%, 8 at +4% — no raise most share (9 of 25 is 36%), so the median, 3%.
for (let i = 0; i < 25; i++) raise(`us${i}`, i < 9 ? 0.01 : i < 17 ? 0.03 : 0.04, { job: 'JC', pay: 40000, cat: 'University Staff', dept: `E${1 + (i % 5)}` });
// Not compared: a title change, an FTE change, two appointments on one side, the 9-month reporting change.
appt('a', 'promo', { job: 'J1', pay: 50000 }); appt('b', 'promo', { job: 'J7', pay: 60000 });
appt('a', 'fte', { job: 'J1', pay: 50000, fte: 1 }); appt('b', 'fte', { job: 'J1', pay: 51000, fte: 0.5 });
appt('a', 'split', { job: 'J1', pay: 50000 }); appt('b', 'split', { job: 'J1', pay: 30000 }); appt('b', 'split', { job: 'J8', pay: 30000, dept: 'D2' });
// Two appointments later, neither in the earlier title: whichever one a query picked, it would read as a change of title.
appt('a', 'split2', { job: 'J5', pay: 50000 }); appt('b', 'split2', { job: 'J6', pay: 30000 }); appt('b', 'split2', { job: 'J7', pay: 30000 });
appt('a', 'nine', { job: 'F1', pay: 90000, basis: 'Academic' }); appt('b', 'nine', { job: 'F1', pay: 113300, basis: '9 Month' });
// Only in `b`: a new hire, never anyone's raise.
appt('b', 'hire', { job: 'J1', pay: 50000 });

let db: duckdb.Database;
const all = <T,>(sql: string) =>
  new Promise<T[]>((res, rej) => db.all(sql, (e: Error | null, rows: unknown[]) => (e ? rej(e) : res((rows as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))) as T[]))));

beforeAll(async () => {
  db = new duckdb.Database(':memory:');
  const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
  await all(`CREATE TABLE salaries (snapshot_id VARCHAR, snapshot_date DATE, person_key VARCHAR, first_name VARCHAR, last_name VARCHAR,
    school VARCHAR, department VARCHAR, employee_category VARCHAR, job_code VARCHAR, title VARCHAR, grade_number INTEGER, grade_basis VARCHAR,
    salary DOUBLE, salary_fte_adjusted DOUBLE, fte DOUBLE, comp_basis VARCHAR, base_pay DOUBLE)`);
  await all(`INSERT INTO salaries VALUES ${ROWS.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
  await all(`CREATE TABLE grades("grade" INTEGER, "basis" VARCHAR, "min" DOUBLE, "max" DOUBLE, effective_year INTEGER)`);
  await all(`INSERT INTO grades VALUES (20, 'annual_12mo', 50000, 90000, 2026)`);
});
afterAll(() => db.close());

const PAIR = { metric: 'fte' as const, from: 'a', to: 'b' };
const NONE = {};
async function usuals(o = PAIR, set?: number): Promise<Usuals> {
  return usualRaises(await all<ModeRow>(usualModesSql(o)), set)!;
}
const byKey = (rows: ReviewRow[]) => Object.fromEntries(rows.map((r) => [r.person_key, r.why]));

describe('the usual raise', () => {
  it('is each category’s most common raise at 0.1%, read over the pair campus-wide', async () => {
    const u = await usuals();
    const acad = u.cats.find((c) => c.cat === 'Academic Staff')!;
    expect(acad).toMatchObject({ how: 'mode', usual: 0.02 });
    expect(u.campus).toMatchObject({ how: 'mode', usual: 0.02 });
  });

  it('is the median where no one raise is shared by 40%', async () => {
    const us = (await usuals()).cats.find((c) => c.cat === 'University Staff')!;
    expect(us.k).toBe(0.01);
    expect(us.share).toBeCloseTo(9 / 25, 6);
    expect(us).toMatchObject({ how: 'median', usual: 0.03 });
  });

  it('is campus’s for a category too small to have its own, spelled one way', async () => {
    const u = await usuals();
    expect(u.cats.map((c) => c.cat)).not.toContain('Limited Appointee');
    expect(u.cats.find((c) => c.cat === 'Limited')).toMatchObject({ n: 3, how: 'campus', usual: 0.02 });
  });

  it('compounds across a span of snapshots: 2% then 3% is +5.1%', async () => {
    const u = await usuals({ ...PAIR, to: 'c' });
    expect(u.campus).toMatchObject({ how: 'mode', usual: 0.051, n: 40 });
  });

  it('is the reader’s own when set, for everyone', async () => {
    const u = await usuals(PAIR, 0.05);
    expect([u.campus, ...u.cats].every((c) => c.how === 'set' && c.usual === 0.05)).toBe(true);
    const rows = await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: NONE, ranges: true }));
    expect(rows.map((r) => r.person_key).sort()).toEqual(['floor', 'mover', 't1_0', 't1_1', 't1_2', 't1_3', 't1_4', 'solo', 'dx0', 'dx1', 'dx2', 'dx3', 'dxfloor', 'dt0', 'dt1', 'dt2', 'dt3', 'dt4', 't4_0', 't4_1', 't4_2', 't4_3', 't4_4', 'dut'].sort());
  });
});

describe('who got more than the usual raise, and why', () => {
  it('lists only raises above their own category’s usual raise, each with the first explanation that fits', async () => {
    const rows = await all<ReviewRow>(reviewSql({ ...PAIR, usual: await usuals(), filters: NONE, ranges: true }));
    const why = byKey(rows);
    expect(why.floor).toBe('range');
    for (let i = 0; i < 5; i++) expect(why[`t1_${i}`]).toBe('title');
    for (let i = 0; i < 3; i++) expect(why[`du${i}`]).toBe('unit');
    expect(why.dut, 'both title-wide and department-wide: title-wide first').toBe('title');
    expect(rows.find((r) => r.person_key === 'dut')).toMatchObject({ un: 5, ub: 3 });
    expect(why.solo).toBe('individual');
    for (let i = 0; i < 4; i++) expect(why[`dx${i}`]).toBe('title');
    expect(why.dxfloor).toBe('range');
    for (let i = 0; i < 5; i++) expect(why[`dt${i}`]).toBe('title');
    expect(why.dtsolo, 'one title’s adjustment made a department-wide pattern').toBe('individual');
    expect(rows.find((r) => r.person_key === 'dtsolo')).toMatchObject({ un: 4, ub: 1 });
    expect(why.lim0).toBe('individual');
    // University Staff above their median, 3%: the eight at 4%.
    expect(rows.filter((r) => r.cat === 'University Staff')).toHaveLength(8);
    // At the usual raise, or not a continuing raise at all: not listed.
    for (const k of ['t1_5', 'du3', 'base0', 'us0', 'lim1', 'promo', 'fte', 'split', 'nine', 'hire']) expect(why[k], k).toBeUndefined();
    const t1 = rows.find((r) => r.person_key === 't1_0')!;
    expect(t1).toMatchObject({ tn: 6, tb: 5, usual: 0.02 });
    expect(t1.tmed).toBeCloseTo(0.06, 6);
  });

  it('says nothing of a range minimum where the ranges are not for the later snapshot', async () => {
    const rows = await all<ReviewRow>(reviewSql({ ...PAIR, usual: await usuals(), filters: NONE, ranges: false }));
    expect(byKey(rows).floor).toBe('individual');
    expect(byKey(rows).dxfloor).toBe('title');
  });

  it('filters by where each person is at the later snapshot', async () => {
    const u = await usuals();
    const in2 = await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: { school: 'S2' }, ranges: true }));
    expect(in2.map((r) => r.person_key)).toEqual(['mover']);
    const inS = await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: { school: 'S' }, ranges: true }));
    expect(inS.map((r) => r.person_key)).not.toContain('mover');
    // A department only inside its school; the title's pattern still read campus-wide.
    const du = await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: { school: 'S', department: 'DU' }, ranges: true }));
    expect(du.map((r) => r.person_key).sort()).toEqual(['du0', 'du1', 'du2', 'dut']);
    const t1 = await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: { jobCode: 'T1' }, ranges: true }));
    expect(t1.every((r) => r.why === 'title')).toBe(true);
    expect(await all<ReviewRow>(reviewSql({ ...PAIR, usual: u, filters: { family: 'XX' }, ranges: true }))).toEqual([]);
  });
});

describe('everyone paid on both sides, accounted for', () => {
  it('as a continuing raise, a change of title, or not compared with its reason; the parts add up', async () => {
    const [a] = await all<Account>(accountSql({ ...PAIR, filters: NONE }));
    expect(a).toMatchObject({ changed_title: 1, several: 2, fte_changed: 1, basis_changed: 1 });
    // 40 + 6 + 5 + solo + floor + 5 in DX + 9 in DT + 6 in T4 + mover + 3 + 25.
    expect(a.same_job).toBe(102);
    expect(a.paid_both).toBe(a.same_job + a.changed_title + a.several + a.fte_changed + a.basis_changed);
  });

  it('lists a change of title only with one appointment on each side', async () => {
    const rows = await all<TitleChangeRow>(titleChangesSql({ ...PAIR, filters: NONE }));
    expect(rows.map((r) => r.person_key)).toEqual(['promo']);
    expect(rows[0]).toMatchObject({ code_from: 'J1', code_to: 'J7', pay_from: 50000, pay_to: 60000 });
  });

  it('bins the same continuing raises the lists read', async () => {
    const bins = await all<{ bucket: number; n: number }>(distributionSql({ ...PAIR, filters: NONE }));
    expect(bins.reduce((t, b) => t + b.n, 0)).toBe(102);
    expect(bins.find((b) => b.bucket === 2)?.n).toBe(40 + 1 + 2 + 2 + 3);
  });
});
