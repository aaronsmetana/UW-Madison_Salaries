import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { continuingRaisesSql, standingSql, peopleSql, poolPercentile, comparableSql, scopeWhere, GRADED_APPT, gradedCols, gradedAppt, mainOf, mainRow, TITLE_RATE, personPay, personEarnings, personActualPay, personRate, type MainFields } from './queries';
import { raiseStepsSql } from './raises';

/**
 * The shared SQL rules, executed. A string test says a query CONTAINS a clause; only running it says
 * the clause does what the rule claims. Each fixture row below exists to exercise one exclusion.
 */

type Row = Record<string, string | number | null>;

const COLS = ['snapshot_id', 'snapshot_date', 'person_key', 'school', 'department', 'job_code', 'grade_number', 'grade_basis', 'salary', 'salary_fte_adjusted', 'fte', 'comp_basis', 'title', 'employee_category'] as const;

const r = (snap: string, date: string, person: string, job: string | null, salary: number, extra: Partial<Row> = {}): Row => ({
  snapshot_id: snap, snapshot_date: date, person_key: person, school: 'A', department: 'D1', job_code: job,
  grade_number: 20, grade_basis: 'annual_12mo', salary, salary_fte_adjusted: null, fte: 1, comp_basis: 'Annual',
  title: job == null ? null : `Title ${job}`, employee_category: 'University Staff', ...extra,
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
  // Academic → 9 Month: the Sep 2025 reporting change (×11/9 × 1.03). A 3% raise, like for like.
  r('s2', '2022-08-01', 'nine', 'F1', 90000, { comp_basis: 'Academic' }),
  r('s3', '2023-10-01', 'nine', 'F1', 113300, { comp_basis: '9 Month' }),
  // Annual → 12 Month: a pure relabel. IS a raise.
  r('s2', '2022-08-01', 'twelve', 'J1', 80000, { comp_basis: 'Annual' }),
  r('s3', '2023-10-01', 'twelve', 'J1', 82400, { comp_basis: '12 Month' }),
  // Hourly → 12 Month: the Sep 2025 relabel of the same hourly appointments. IS a raise — one way only.
  r('s2', '2022-08-01', 'relabel', 'H2', 41600, { comp_basis: 'Hourly', school: 'C', department: 'D8', grade_number: null }),
  r('s3', '2023-10-01', 'relabel', 'H2', 42848, { comp_basis: '12 Month', school: 'C', department: 'D8', grade_number: null }),
  r('s2', '2022-08-01', 'backward', 'H3', 41600, { comp_basis: '12 Month', school: 'C', department: 'D8', grade_number: null }),
  r('s3', '2023-10-01', 'backward', 'H3', 42848, { comp_basis: 'Hourly', school: 'C', department: 'D8', grade_number: null }),
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
    fte DOUBLE, comp_basis VARCHAR, title VARCHAR, employee_category VARCHAR)`);
  await all(`INSERT INTO salaries VALUES ${values}`);
});
afterAll(() => db.close());

describe('continuingRaisesSql', () => {
  it('keeps only same-title, same-FTE, single-appointment steps on a comparable pay basis', async () => {
    const rows = await all<{ person_key: string; from_id: string; to_id: string; pay_from: number; pay_to: number; r: number }>(
      `SELECT person_key, from_id, to_id, pay_from, pay_to, r FROM (${continuingRaisesSql({ metric: 'fte' })}) ORDER BY person_key, from_id`
    );
    const people = rows.map((x) => `${x.person_key}:${x.from_id}>${x.to_id}`);
    // stay: post→s1 and s1→s2; nobasis: s1→s2 with no basis recorded; twelve and relabel: s2→s3 across
    // the two pure relabels; nine: s2→s3 across the reporting change. Not backward, 12 Month → Hourly, which
    // no release did. Nothing else.
    expect(people).toEqual(['nine:s2>s3', 'nobasis:s1>s2', 'relabel:s2>s3', 'stay:2021-11-post>s1', 'stay:s1>s2', 'twelve:s2>s3']);
    expect(rows.find((x) => x.person_key === 'stay' && x.from_id === 's1')!.r).toBeCloseTo(0.04, 6);
    // Like for like: the earlier pay as the later snapshot reports it (× 11/9), the later as published.
    const nine = rows.find((x) => x.person_key === 'nine')!;
    expect(nine.r).toBeCloseTo(0.03, 9);
    expect(nine.pay_from).toBeCloseTo(110000, 6);
    expect(nine.pay_to).toBe(113300);
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
      ['s2', 's3', 3, 1],
    ]);
    // s1 → s2: stay +4% and nobasis +3%. The promotion, the FTE change, the split and the 9-month
    // relabel are not raises, so none of them moves the median.
    expect(rows[1].med).toBeCloseTo(0.035, 6);
    expect(rows[1].from_date).toBe('2022-03-01');
  });
});

describe('comparableSql', () => {
  it('treats Annual → 12 Month and Hourly → 12 Month as relabels and Academic → 9 Month as comparable, like for like', async () => {
    const [x] = await all<{ relabel: boolean; hourly: boolean; reversed: boolean; reporting: boolean; missing: boolean; different: boolean }>(
      `SELECT ${comparableSql("'Annual'", "'12 Month'")} relabel, ${comparableSql("'Hourly'", "'12 Month'")} hourly,
              ${comparableSql("'12 Month'", "'Hourly'")} reversed, ${comparableSql("'Academic'", "'9 Month'")} reporting,
              ${comparableSql('NULL', "'9 Month'")} missing, ${comparableSql("'Annual'", "'9 Month'")} different`
    );
    expect(x).toEqual({ relabel: true, hourly: true, reversed: false, reporting: true, missing: true, different: false });
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

describe('MAIN_KEY', () => {
  // Each person is one way of naming someone by the wrong job.
  const M: Row[] = [
    // A director who also works hourly crowd control: the salaried job, though the hourly one's annualized
    // rate is what an hourly job would pay over a full-time year.
    r('m', '2026-09-01', 'director', 'CP052', 135024),
    r('m', '2026-09-01', 'director', 'TE007', 89440, { fte: 0, grade_number: null }),
    // Two half-time appointments: the one that pays more.
    r('m', '2026-09-01', 'halves', 'J1', 60000, { fte: 0.5 }),
    r('m', '2026-09-01', 'halves', 'J2', 80000, { fte: 0.5 }),
    // A bigger appointment on a smaller rate: the bigger appointment.
    r('m', '2026-09-01', 'bigger', 'J1', 50000, { fte: 0.6 }),
    r('m', '2026-09-01', 'bigger', 'J2', 100000, { fte: 0.4 }),
    // Equal in FTE and pay: the job code decides, never the row order.
    r('m', '2026-09-01', 'same', 'J1', 80000, { fte: 0.5, department: 'D2' }),
    r('m', '2026-09-01', 'same', 'J2', 80000, { fte: 0.5, department: 'D3' }),
    // Only hourly jobs: the higher rate.
    r('m', '2026-09-01', 'hourly', 'H1', 40000, { fte: 0 }),
    r('m', '2026-09-01', 'hourly', 'H2', 50000, { fte: 0 }),
    // The main appointment records no department: none, not the side job's.
    r('m', '2026-09-01', 'nodept', 'J1', 70000, { department: null }),
    r('m', '2026-09-01', 'nodept', 'J2', 30000, { fte: 0.5, department: 'D2' }),
    // An unpaid row with a full FTE: a paid one comes first.
    r('m', '2026-09-01', 'unpaid', 'J1', 0),
    r('m', '2026-09-01', 'unpaid', 'J2', 40000, { fte: 0.2 }),
    // Nothing paid: still named, by the same order.
    r('m', '2026-09-01', 'none', 'J1', 0, { fte: 0.5 }),
    r('m', '2026-09-01', 'none', 'J2', 0, { fte: 1 }),
  ];
  const WANT = {
    director: ['CP052', 'D1'], halves: ['J2', 'D1'], bigger: ['J1', 'D1'], same: ['J2', 'D3'], hourly: ['H2', 'D1'],
    nodept: ['J1', null], unpaid: ['J2', 'D1'], none: ['J2', 'D1'],
  };

  it('names each person by their highest-FTE paid appointment, every column from that one row', async () => {
    const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
    await all(`CREATE TABLE mains AS SELECT * FROM salaries WHERE FALSE`);
    for (const order of [M, [...M].reverse()]) {
      await all(`DELETE FROM mains`);
      await all(`INSERT INTO mains VALUES ${order.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
      const rows = await all<{ person_key: string; code: string; dept: string | null }>(
        `SELECT person_key, ${mainOf('job_code')} code, ${mainOf('department')} dept FROM mains GROUP BY person_key`
      );
      expect(Object.fromEntries(rows.map((x) => [x.person_key, [x.code, x.dept]]))).toEqual(WANT);
    }
  });

  it('picks the same row client-side, in either row order', () => {
    for (const order of [M, [...M].reverse()]) {
      const got = Object.fromEntries(Object.keys(WANT).map((k) => {
        const m = mainRow(order.filter((x) => x.person_key === k) as unknown as (MainFields & Row)[]);
        return [k, [m?.job_code, m?.department]];
      }));
      expect(got).toEqual(WANT);
    }
  });
});

describe('personPay', () => {
  // Each person is one way of counting someone's pay wrong.
  const P: Row[] = [
    // A full-time director who also works crowd control by the hour: the directorship, not both.
    r('p', '2026-09-01', 'brett', 'CP052', 135024),
    r('p', '2026-09-01', 'brett', 'TE007', 89440, { fte: 0 }),
    // Two half-time appointments: both, as earned.
    r('p', '2026-09-01', 'halves', 'J1', 60000, { fte: 0.5 }),
    r('p', '2026-09-01', 'halves', 'J2', 80000, { fte: 0.5 }),
    // Two half-time appointments and an hourly job: the two, not the third.
    r('p', '2026-09-01', 'halvesHourly', 'J1', 60000, { fte: 0.5 }),
    r('p', '2026-09-01', 'halvesHourly', 'J2', 80000, { fte: 0.5 }),
    r('p', '2026-09-01', 'halvesHourly', 'H1', 40000, { fte: 0 }),
    // One half-time appointment: as earned, and its rate under the full-time measure.
    r('p', '2026-09-01', 'half', 'J1', 80000, { fte: 0.5 }),
    // Only hourly jobs: the best-paid one's rate, not two full-time years.
    r('p', '2026-09-01', 'hourly', 'H1', 40000, { fte: 0 }),
    r('p', '2026-09-01', 'hourly', 'H2', 50000, { fte: 0 }),
    // An unpaid appointment with an FTE beside an hourly job: the hourly job.
    r('p', '2026-09-01', 'unpaid', 'J1', 0),
    r('p', '2026-09-01', 'unpaid', 'H1', 41600, { fte: 0 }),
    // The source's own FTE-adjusted figure stands, as everywhere.
    r('p', '2026-09-01', 'adjusted', 'J1', 100000, { fte: 0.5, salary_fte_adjusted: 50001 }),
  ];
  const WANT = {
    brett: { fte: 135024, full: 135024, earn: 135024, rate: 135024 },
    halves: { fte: 70000, full: 70000, earn: 70000, rate: 70000 },
    halvesHourly: { fte: 70000, full: 70000, earn: 70000, rate: 70000 },
    half: { fte: 40000, full: 80000, earn: 40000, rate: 80000 },
    hourly: { fte: 50000, full: 50000, earn: 50000, rate: 50000 },
    unpaid: { fte: 41600, full: 41600, earn: 41600, rate: 41600 },
    adjusted: { fte: 50001, full: 100000, earn: 50000, rate: 100000 },
  };
  const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);

  it('counts a salaried person by their salaried jobs, and someone hourly by one rate', async () => {
    await all(`CREATE TABLE paid AS SELECT * FROM salaries WHERE FALSE`);
    await all(`INSERT INTO paid VALUES ${P.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
    const rows = await all<{ person_key: string; fte: number; ft: number; earn: number }>(
      `SELECT person_key, ${personPay('fte')} fte, ${personPay('full')} ft, ${personEarnings('full')} earn FROM paid GROUP BY person_key`
    );
    const want = Object.fromEntries(Object.entries(WANT).map(([k, w]) => [k, { fte: w.fte, full: w.full, earn: w.earn }]));
    expect(Object.fromEntries(rows.map((x) => [x.person_key, { fte: x.fte, full: x.ft, earn: x.earn }]))).toEqual(want);
  });

  it('counts the same client-side, in either row order, with the full-time rate of what it counts', () => {
    for (const order of [P, [...P].reverse()]) {
      const got = Object.fromEntries(Object.keys(WANT).map((k) => {
        const rows = order.filter((x) => x.person_key === k) as unknown as (MainFields & Row)[];
        return [k, { fte: personActualPay(rows), rate: personRate(rows) }];
      }));
      expect(got).toEqual(Object.fromEntries(Object.entries(WANT).map(([k, w]) => [k, { fte: w.fte, rate: w.rate }])));
    }
  });
});

describe('TITLE_RATE', () => {
  // Each person holds job code T; each is one way of reading someone in a title at the wrong figure.
  const T: Row[] = [
    // Half time: the rate, not the half of it they are paid.
    r('t', '2026-09-01', 'half', 'T', 80000, { fte: 0.5 }),
    // Two appointments in the title at different rates: the rate between, weighted by FTE, never the sum.
    r('t', '2026-09-01', 'two', 'T', 60000, { fte: 0.75 }),
    r('t', '2026-09-01', 'two', 'T', 100000, { fte: 0.25 }),
    // Over full time in one title: still the rate.
    r('t', '2026-09-01', 'over', 'T', 70000, { fte: 0.6 }),
    r('t', '2026-09-01', 'over', 'T', 70000, { fte: 0.6 }),
    // Hourly only: the higher rate, not the sum of two full-time years.
    r('t', '2026-09-01', 'hourly', 'T', 40000, { fte: 0 }),
    r('t', '2026-09-01', 'hourly', 'T', 50000, { fte: 0 }),
    // A salaried and an hourly appointment in the title: the salaried rate.
    r('t', '2026-09-01', 'mixed', 'T', 60000, { fte: 0.5 }),
    r('t', '2026-09-01', 'mixed', 'T', 90000, { fte: 0 }),
    // Unpaid beside paid: the unpaid row adds no FTE.
    r('t', '2026-09-01', 'unpaid', 'T', 0, { fte: 1 }),
    r('t', '2026-09-01', 'unpaid', 'T', 50000, { fte: 0.5 }),
    // Unpaid only: no rate.
    r('t', '2026-09-01', 'none', 'T', 0, { fte: 1 }),
  ];
  it('reads each person in a title at their full-time rate in it', async () => {
    const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
    await all(`CREATE TABLE titled AS SELECT * FROM salaries WHERE FALSE`);
    await all(`INSERT INTO titled VALUES ${T.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
    const rows = await all<{ person_key: string; rate: number | null }>(`SELECT person_key, ${TITLE_RATE} rate FROM titled GROUP BY person_key`);
    expect(Object.fromEntries(rows.map((x) => [x.person_key, x.rate]))).toEqual({
      half: 80000, two: 70000, over: 70000, hourly: 50000, mixed: 60000, unpaid: 50000, none: null,
    });
  });
});

describe('GRADED_APPT', () => {
  // Each person is one way of getting the band's pay wrong.
  const G: Row[] = [
    // Half-time: the band is compared with the full-time rate, not the pay it earns.
    r('g', '2026-01-01', 'half', 'J1', 60000, { grade_number: 15, fte: 0.5 }),
    // Two graded appointments: the main one (the higher FTE) carries the band, though the other pays more.
    r('g', '2026-01-01', 'two', 'J1', 50000, { grade_number: 15, fte: 0.6 }),
    r('g', '2026-01-01', 'two', 'J2', 100000, { grade_number: 25, fte: 0.4 }),
    // A salaried job and an hourly one on a higher annualized rate: the salaried job.
    r('g', '2026-01-01', 'hourly', 'J1', 50000, { grade_number: 15 }),
    r('g', '2026-01-01', 'hourly', 'H1', 90000, { grade_number: 20, grade_basis: 'hourly', fte: 0 }),
    // The main appointment has no grade: no band, not one borrowed from a side job.
    r('g', '2026-01-01', 'ungraded', 'J3', 100000, { grade_number: null, grade_basis: null }),
    r('g', '2026-01-01', 'ungraded', 'J1', 40000, { grade_number: 17, fte: 0.2 }),
    // The main appointment records no schedule: grade and schedule still come from the same row.
    r('g', '2026-01-01', 'nobasis', 'J1', 90000, { grade_number: 22, grade_basis: null }),
    r('g', '2026-01-01', 'nobasis', 'J2', 30000, { grade_number: 16, fte: 0.5 }),
    // Equal pay: the higher FTE wins, whatever order the rows come in.
    r('g', '2026-01-01', 'tie', 'J1', 40000, { grade_number: 18, fte: 1 }),
    r('g', '2026-01-01', 'tie', 'J2', 80000, { grade_number: 25, fte: 0.5 }),
    // Unpaid, graded: nothing to place.
    r('g', '2026-01-01', 'unpaid', 'J1', 0, { grade_number: 15 }),
    r('g', '2026-01-01', 'unpaid', 'J3', 70000, { grade_number: null, grade_basis: null }),
  ];
  // The appointment's comp_basis comes along: it says the units its rate was reported in (lib/bands).
  const WANT = {
    half: { grade: 15, basis: 'annual_12mo', rate: 60000, comp: 'Annual' },
    two: { grade: 15, basis: 'annual_12mo', rate: 50000, comp: 'Annual' },
    hourly: { grade: 15, basis: 'annual_12mo', rate: 50000, comp: 'Annual' },
    ungraded: null,
    nobasis: { grade: 22, basis: null, rate: 90000, comp: 'Annual' },
    tie: { grade: 18, basis: 'annual_12mo', rate: 40000, comp: 'Annual' },
    unpaid: null,
  };

  it('reads each band against the full-time rate of the main appointment, or not at all', async () => {
    const lit = (v: string | number | null) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
    await all(`CREATE TABLE graded AS SELECT * FROM salaries WHERE FALSE`);
    await all(`INSERT INTO graded VALUES ${G.map((row) => `(${COLS.map((c) => lit(row[c] ?? null)).join(', ')})`).join(',\n')}`);
    const rows = await all<{ person_key: string; grade_number: number | null; grade_basis: string | null; band_rate: number | null; band_comp: string | null }>(
      `SELECT person_key, ${gradedCols()} FROM (SELECT person_key, ${GRADED_APPT} graded FROM graded GROUP BY person_key) ORDER BY person_key`
    );
    const got = Object.fromEntries(rows.map((x) => [x.person_key, x.grade_number == null ? null : { grade: x.grade_number, basis: x.grade_basis, rate: x.band_rate, comp: x.band_comp }]));
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
            comp_basis: x.comp_basis as string | null, job_code: x.job_code as string | null,
          }))),
        ])
      );
      expect(got).toEqual(WANT);
    }
  });
});
