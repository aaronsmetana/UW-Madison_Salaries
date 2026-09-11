import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { raiseStepsQuery, raiseHistQuery, HIST_STEP } from './lib/raise-steps.mjs';
import { raiseStepsSql } from '../src/lib/raises.ts';

/**
 * Parity: the build's raise-steps.json and the app's `continuingRaisesSql` must describe the same raises.
 * The fixture carries one row for each thing the rule excludes, so a divergence in any clause shows up
 * as a different count or median on some step.
 */

const COLS = ['snapshot_id', 'snapshot_date', 'person_key', 'job_code', 'salary', 'salary_fte_adjusted', 'base_pay', 'fte', 'comp_basis'];
const r = (snap, date, person, job, salary, extra = {}) => ({
  snapshot_id: snap, snapshot_date: date, person_key: person, job_code: job, salary, salary_fte_adjusted: null,
  base_pay: null, fte: 1, comp_basis: 'Annual', ...extra,
});
const ROWS = [
  r('2021-11-pre', '2021-11-01', 'stay', 'OLD', 50000),
  r('2021-11-post', '2021-11-01', 'stay', 'J1', 50000),
  r('s1', '2022-03-01', 'stay', 'J1', 51000),
  r('s2', '2022-08-01', 'stay', 'J1', 53040),
  r('s1', '2022-03-01', 'stay2', 'J1', 40000, { salary_fte_adjusted: 20000, fte: 0.5 }),
  r('s2', '2022-08-01', 'stay2', 'J1', 41200, { salary_fte_adjusted: 20600, fte: 0.5, base_pay: 41000 }),
  r('s1', '2022-03-01', 'promo', 'J1', 60000),
  r('s2', '2022-08-01', 'promo', 'J2', 70000),
  r('s1', '2022-03-01', 'fte', 'J1', 60000, { fte: 1 }),
  r('s2', '2022-08-01', 'fte', 'J1', 60000, { fte: 0.5 }),
  r('s1', '2022-03-01', 'split', 'J1', 40000),
  r('s1', '2022-03-01', 'split', 'J3', 20000),
  r('s2', '2022-08-01', 'split', 'J1', 42000),
  r('s2', '2022-08-01', 'nine', 'F1', 90000, { comp_basis: 'Academic' }),
  r('s3', '2023-10-01', 'nine', 'F1', 113300, { comp_basis: '9 Month' }),
  r('s2', '2022-08-01', 'twelve', 'J1', 80000, { comp_basis: 'Annual' }),
  r('s3', '2023-10-01', 'twelve', 'J1', 82400, { comp_basis: '12 Month' }),
  r('s1', '2022-03-01', 'nobasis', 'J1', 70000, { comp_basis: null }),
  r('s2', '2022-08-01', 'nobasis', 'J1', 72100, { comp_basis: null }),
  r('s2', '2022-08-01', 'hourly0', 'H1', 41600, { fte: 0 }),
  r('s3', '2023-10-01', 'hourly0', 'H1', 42848, { fte: 0 }),
  r('s2', '2022-08-01', 'unpaid', 'J1', 0),
  r('s3', '2023-10-01', 'unpaid', 'J1', 50000),
];

let db;
const all = (sql) =>
  new Promise((res, rej) => db.all(sql, (e, rows) => (e ? rej(e) : res(rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))))));

beforeAll(async () => {
  db = new duckdb.Database(':memory:');
  const lit = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
  await all(`CREATE TABLE salaries (snapshot_id VARCHAR, snapshot_date DATE, person_key VARCHAR, job_code VARCHAR,
    salary DOUBLE, salary_fte_adjusted DOUBLE, base_pay DOUBLE, fte DOUBLE, comp_basis VARCHAR)`);
  await all(`INSERT INTO salaries VALUES ${ROWS.map((row) => `(${COLS.map((c) => lit(row[c])).join(', ')})`).join(',\n')}`);
});
afterAll(() => db.close());

describe('raise-steps.json and continuingRaisesSql', () => {
  for (const metric of ['fte', 'full', 'base']) {
    it(`agree on every step's count and median (${metric})`, async () => {
      const shape = (rows) => rows.map((x) => [x.from_id, x.to_id, x.n, Math.round(x.med * 1e9) / 1e9]);
      const build = await all(raiseStepsQuery('salaries', metric));
      const app = await all(`SELECT * FROM (${raiseStepsSql({ metric })}) ORDER BY from_date`);
      expect(shape(build)).toEqual(shape(app));
      // Guard against both being empty: the fixture has a continuing raise on every step.
      expect(build.length).toBe(3);
    });
  }

  it('bins each raise at the precision the app prints it', async () => {
    const hist = await all(raiseHistQuery('salaries', 'fte'));
    const s1 = hist.filter((h) => h.from_id === 's1');
    // s1 → s2: stay +4%, stay2 +3% (on actual pay), nobasis +3%.
    expect(s1.map((h) => [h.k * HIST_STEP, h.c])).toEqual([[0.03, 2], [0.04, 1]]);
  });
});
