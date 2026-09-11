import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { continuingRaisesSql, standingSql, peopleSql, poolPercentile, sameQuantitySql, scopeWhere } from './queries';
import { raiseStepsSql } from './raises';

/**
 * The shared SQL rules, executed. A string test says a query CONTAINS a clause; only running it says
 * the clause does what the rule claims. Each fixture row below exists to exercise one exclusion.
 */

type Row = Record<string, string | number | null>;

const COLS = ['snapshot_id', 'snapshot_date', 'person_key', 'school', 'department', 'job_code', 'grade_number', 'grade_basis', 'salary', 'salary_fte_adjusted', 'fte', 'comp_basis'] as const;

const r = (snap: string, date: string, person: string, job: string | null, salary: number, extra: Partial<Row> = {}): Row => ({
  snapshot_id: snap, snapshot_date: date, person_key: person, school: 'A', department: 'D1', job_code: job,
  grade_number: 20, grade_basis: 'annual_12mo', salary, salary_fte_adjusted: null, fte: 1, comp_basis: 'Annual', ...extra,
});

// Three canonical steps: the TTC twins (pre and post share a date), then s1 → s2 → s3.
const ROWS: Row[] = [
  r('2021-11-pre', '2021-11-01', 'stay', 'OLD', 50000),
  r('2021-11-post', '2021-11-01', 'stay', 'J1', 50000),
  r('s1', '2022-03-01', 'stay', 'J1', 51000),
  r('s2', '2022-08-01', 'stay', 'J1', 53040), // +4% — the one continuing raise on this step
  // A promotion: same person, new job code. Not a raise.
  r('s1', '2022-03-01', 'promo', 'J1', 60000),
  r('s2', '2022-08-01', 'promo', 'J2', 70000),
  // An FTE change: actual pay halves. Not a cut.
  r('s1', '2022-03-01', 'fte', 'J1', 60000, { fte: 1 }),
  r('s2', '2022-08-01', 'fte', 'J1', 60000, { fte: 0.5 }),
  // Two appointments on one side: cannot be attributed. Excluded.
  r('s1', '2022-03-01', 'split', 'J1', 40000),
  r('s1', '2022-03-01', 'split', 'J3', 20000, { department: 'D2' }),
  r('s2', '2022-08-01', 'split', 'J1', 42000),
  // Academic → 9 Month: the Sep 2025 reporting change (×11/9 × 1.03). Not a raise.
  r('s2', '2022-08-01', 'nine', 'F1', 90000, { comp_basis: 'Academic' }),
  r('s3', '2023-10-01', 'nine', 'F1', 113300, { comp_basis: '9 Month' }),
  // Annual → 12 Month: a pure relabel. IS a raise.
  r('s2', '2022-08-01', 'twelve', 'J1', 80000, { comp_basis: 'Annual' }),
  r('s3', '2023-10-01', 'twelve', 'J1', 82400, { comp_basis: '12 Month' }),
  // No basis recorded on either side (every snapshot before Sep 2024). IS a raise.
  r('s1', '2022-03-01', 'nobasis', 'J1', 70000, { comp_basis: null }),
  r('s2', '2022-08-01', 'nobasis', 'J1', 72100, { comp_basis: null }),
  // Same department name in another school — must not join school A's "D1".
  r('s3', '2023-10-01', 'other', 'J1', 99000, { school: 'B' }),
  // Grade 20 on the hourly schedule — the same number, not the same grade.
  r('s3', '2023-10-01', 'hourly', 'H1', 40000, { grade_basis: 'hourly', department: 'D9' }),
];

let db: duckdb.Database;
const all = <T,>(sql: string) =>
  new Promise<T[]>((res, rej) => db.all(sql, (e: Error | null, rows: unknown[]) => (e ? rej(e) : res(rows as T[]))));

beforeAll(async () => {
  db = new duckdb.Database(':memory:');
  const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
  const values = ROWS.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n');
  await all(`CREATE TABLE salaries (snapshot_id VARCHAR, snapshot_date DATE, person_key VARCHAR, school VARCHAR,
    department VARCHAR, job_code VARCHAR, grade_number INTEGER, grade_basis VARCHAR, salary DOUBLE, salary_fte_adjusted DOUBLE,
    fte DOUBLE, comp_basis VARCHAR)`);
  await all(`INSERT INTO salaries VALUES ${values}`);
});
afterAll(() => db.close());

describe('continuingRaisesSql', () => {
  it('keeps only same-title, same-FTE, single-appointment steps on the same pay quantity', async () => {
    const rows = await all<{ person_key: string; from_id: string; to_id: string; r: number }>(
      `SELECT person_key, from_id, to_id, r FROM (${continuingRaisesSql({ metric: 'fte' })}) ORDER BY person_key, from_id`
    );
    const people = rows.map((x) => `${x.person_key}:${x.from_id}>${x.to_id}`);
    // stay: post→s1 and s1→s2; nobasis: s1→s2 with no basis recorded; twelve: s2→s3 across the
    // pure relabel. Nothing else.
    expect(people).toEqual(['nobasis:s1>s2', 'stay:2021-11-post>s1', 'stay:s1>s2', 'twelve:s2>s3']);
    expect(rows.find((x) => x.person_key === 'stay' && x.from_id === 's1')!.r).toBeCloseTo(0.04, 6);
  });

  it("carries each step's snapshot dates as text", async () => {
    const rows = await all<{ from_date: string; to_date: string }>(
      `SELECT from_date, to_date FROM (${continuingRaisesSql({ metric: 'fte', pair: { from: 's1', to: 's2' } })}) LIMIT 1`
    );
    expect(rows[0]).toEqual({ from_date: '2022-03-01', to_date: '2022-08-01' });
  });

  it('never makes the TTC twins a step', async () => {
    const rows = await all<{ from_id: string }>(`SELECT from_id FROM (${continuingRaisesSql({ metric: 'fte' })})`);
    expect(rows.some((x) => x.from_id === '2021-11-pre')).toBe(false);
  });

  it('with a pair, measures exactly that step', async () => {
    const rows = await all<{ person_key: string }>(
      `SELECT person_key FROM (${continuingRaisesSql({ metric: 'fte', pair: { from: 's1', to: 's2' } })}) ORDER BY 1`
    );
    expect(rows.map((x) => x.person_key)).toEqual(['nobasis', 'stay']);
  });
});

describe('raiseStepsSql', () => {
  it('gives each step its continuing raises, campus-wide and for one title', async () => {
    const rows = await all<{ from_id: string; to_id: string; from_date: string; n: number; med: number; n_title: number; med_title: number }>(
      raiseStepsSql({ metric: 'fte', jobCode: 'J1' })
    );
    expect(rows.map((x) => [x.from_id, x.to_id, Number(x.n), Number(x.n_title)])).toEqual([
      ['2021-11-post', 's1', 1, 1],
      ['s1', 's2', 2, 2],
      ['s2', 's3', 1, 1],
    ]);
    // s1 → s2: stay +4% and nobasis +3%. The promotion, the FTE change, the split and the 9-month
    // relabel are not raises, so none of them moves the median.
    expect(rows[1].med).toBeCloseTo(0.035, 6);
    expect(rows[1].from_date).toBe('2022-03-01');
  });
});

describe('sameQuantitySql', () => {
  it('treats Annual → 12 Month as the same quantity and Academic → 9 Month as a reporting change', async () => {
    const [x] = await all<{ relabel: boolean; reporting: boolean; missing: boolean; different: boolean }>(
      `SELECT ${sameQuantitySql("'Annual'", "'12 Month'")} relabel, ${sameQuantitySql("'Academic'", "'9 Month'")} reporting,
              ${sameQuantitySql('NULL', "'9 Month'")} missing, ${sameQuantitySql("'Annual'", "'9 Month'")} different`
    );
    expect(x).toEqual({ relabel: true, reporting: false, missing: true, different: false });
  });
});

describe('peopleSql', () => {
  it('counts a person with two appointments once, at their combined pay', async () => {
    const rows = await all<{ person_key: string; pay: number }>(
      `SELECT person_key, pay FROM (${peopleSql({ metric: 'fte', where: "snapshot_id = 's1'" })}) ORDER BY person_key`
    );
    expect(rows.find((x) => x.person_key === 'split')!.pay).toBe(60000);
    expect(rows.filter((x) => x.person_key === 'split')).toHaveLength(1);
  });
});

describe('standingSql', () => {
  it('builds the department pool inside its school', async () => {
    const [x] = await all<{ n_dept: number; b_dept: number; n_div: number }>(
      standingSql({ snapshotId: 's3', pay: 90000, metric: 'fte', school: 'A', department: 'D1', grade: 20, jobCode: 'J1' })
    );
    // School B's "D1" (the 99,000 row) is a different unit with the same name.
    expect(Number(x.n_dept)).toBe(2);
    expect(Number(x.b_dept)).toBe(1);
    expect(Number(x.n_div)).toBe(3);
  });

  it('builds the grade pool from one pay schedule', async () => {
    const [x] = await all<{ n_grade: number }>(
      standingSql({ snapshotId: 's3', pay: 90000, metric: 'fte', grade: 20, gradeBasis: 'annual_12mo', jobCode: 'J1' })
    );
    // s3 holds nine, twelve and other on the 12-month schedule at grade 20; the hourly grade 20 is out.
    expect(Number(x.n_grade)).toBe(3);
  });
});

describe('poolPercentile', () => {
  it('is the share of the other members strictly below, and null for a pool of one', () => {
    expect(poolPercentile(1, 3)).toBe(50);
    expect(poolPercentile(0, 1)).toBeNull();
  });
});

describe('scopeWhere', () => {
  it('names a department inside its school', () => {
    expect(scopeWhere({ kind: 'department', value: 'Administration', school: 'SMPH' })).toBe(
      "school = 'SMPH' AND department = 'Administration'"
    );
  });
  it('keeps a legacy name-only department link working', () => {
    expect(scopeWhere({ kind: 'department', value: 'Administration', school: null })).toBe("department = 'Administration'");
  });
});
