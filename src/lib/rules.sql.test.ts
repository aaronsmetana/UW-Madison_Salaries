import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { continuingRaisesSql, standingSql, peopleSql, poolPercentile, sameQuantitySql, scopeWhere, GRADED_APPT, gradedCols, gradedAppt } from './queries';
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

describe('GRADED_APPT', () => {
  // Each person is one way of getting the band's pay wrong.
  const G: Row[] = [
    // Half-time: the band is compared with the full-time rate, not the pay it earns.
    r('g', '2026-01-01', 'half', 'J1', 60000, { grade_number: 15, fte: 0.5 }),
    // Two graded appointments: the one that pays most carries the grade, not their combined earnings.
    r('g', '2026-01-01', 'two', 'J1', 50000, { grade_number: 15, fte: 0.6 }),
    r('g', '2026-01-01', 'two', 'J2', 80000, { grade_number: 20, grade_basis: 'hourly', fte: 0.3 }),
    // The best-paid appointment has no grade: the graded one is read, however small.
    r('g', '2026-01-01', 'ungraded', 'J3', 100000, { grade_number: null, grade_basis: null }),
    r('g', '2026-01-01', 'ungraded', 'J1', 40000, { grade_number: 17, fte: 0.2 }),
    // The top appointment records no schedule: grade and schedule still come from the same row.
    r('g', '2026-01-01', 'nobasis', 'J1', 90000, { grade_number: 22, grade_basis: null }),
    r('g', '2026-01-01', 'nobasis', 'J2', 30000, { grade_number: 16, fte: 0.5 }),
    // Equal pay: the higher rate wins, whatever order the rows come in.
    r('g', '2026-01-01', 'tie', 'J1', 40000, { grade_number: 18, fte: 1 }),
    r('g', '2026-01-01', 'tie', 'J2', 80000, { grade_number: 25, fte: 0.5 }),
    // Unpaid, graded: nothing to place.
    r('g', '2026-01-01', 'unpaid', 'J1', 0, { grade_number: 15 }),
    r('g', '2026-01-01', 'unpaid', 'J3', 70000, { grade_number: null, grade_basis: null }),
  ];
  const WANT = {
    half: { grade: 15, basis: 'annual_12mo', rate: 60000 },
    two: { grade: 15, basis: 'annual_12mo', rate: 50000 },
    ungraded: { grade: 17, basis: 'annual_12mo', rate: 40000 },
    nobasis: { grade: 22, basis: null, rate: 90000 },
    tie: { grade: 25, basis: 'annual_12mo', rate: 80000 },
    unpaid: null,
  };

  it('reads each band against the full-time rate of the appointment that carries the grade', async () => {
    const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
    await all(`CREATE TABLE graded AS SELECT * FROM salaries WHERE FALSE`);
    await all(`INSERT INTO graded VALUES ${G.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
    const rows = await all<{ person_key: string; grade_number: number | null; grade_basis: string | null; band_rate: number | null }>(
      `SELECT person_key, ${gradedCols()} FROM (SELECT person_key, ${GRADED_APPT} graded FROM graded GROUP BY person_key) ORDER BY person_key`
    );
    const got = Object.fromEntries(rows.map((x) => [x.person_key, x.grade_number == null ? null : { grade: x.grade_number, basis: x.grade_basis, rate: x.band_rate }]));
    expect(got).toEqual(WANT);
  });

  it('picks the same appointment client-side, in either row order', () => {
    for (const order of [G, [...G].reverse()]) {
      const got = Object.fromEntries(
        Object.keys(WANT).map((k) => [
          k,
          gradedAppt(order.filter((x) => x.person_key === k).map((x) => ({
            salary: x.salary as number, salary_fte_adjusted: x.salary_fte_adjusted as number | null, fte: x.fte as number | null,
            grade_number: x.grade_number as number | null, grade_basis: x.grade_basis as string | null,
          }))),
        ])
      );
      expect(got).toEqual(WANT);
    }
  });
});
