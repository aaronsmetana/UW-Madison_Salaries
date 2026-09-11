import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { titlesQuery, divisionsQuery, serializeSearchIndex, SEARCH_INDEX_BUDGET } from './lib/search-index.mjs';
import { peopleSql } from '../src/lib/queries.ts';

/**
 * The search index states a title's and a division's headcount and median before the database loads;
 * once it loads, the title page and the Divisions table state them again. They must be the same
 * numbers, so the index is checked against the app's own per-person SQL (`peopleSql`) on a fixture
 * carrying each case that separates people from rows.
 */

const COLS = ['snapshot_id', 'snapshot_date', 'person_key', 'job_code', 'title', 'school', 'salary', 'salary_fte_adjusted', 'base_pay', 'fte', 'comp_basis'];
const r = (snap, person, job, title, school, salary, extra = {}) => ({
  snapshot_id: snap, snapshot_date: snap === 's1' ? '2025-09-01' : '2026-03-01', person_key: person, job_code: job, title, school,
  salary, salary_fte_adjusted: null, base_pay: null, fte: 1, comp_basis: 'Annual', ...extra,
});
const ROWS = [
  // An earlier snapshot, which the index must not count.
  r('s1', 'old', 'J1', 'Engineer', 'A', 99000),
  r('s1', 'gone', 'J9', 'Retired Title', 'C', 50000),
  // Two appointments in one title: one person, at their combined pay.
  r('s2', 'split', 'J1', 'Engineer', 'A', 60000, { fte: 0.5, salary_fte_adjusted: 30000 }),
  r('s2', 'split', 'J1', 'Engineer', 'A', 60000, { fte: 0.5, salary_fte_adjusted: 30000 }),
  r('s2', 'a', 'J1', 'Engineer', 'A', 70000),
  r('s2', 'b', 'J1', 'ENGINEER', 'B', 80000),
  r('s2', 'c', 'J1', 'Engineer', 'B', 90000),
  // Unpaid: in neither the headcount nor the median.
  r('s2', 'unpaid', 'J1', 'Engineer', 'A', 0),
  // Hourly (FTE 0): counted at the full rate.
  r('s2', 'hourly', 'H1', 'Custodian', 'B', 41600, { fte: 0 }),
  // A title with only an unpaid holder is not offered.
  r('s2', 'zero', 'Z1', 'Emeritus', 'A', 0),
  r('s2', 'nocode', null, 'No Code', 'A', 50000),
  r('s2', 'noschool', 'J1', 'Engineer', null, 65000),
];

let db;
const all = (sql) =>
  new Promise((res, rej) => db.all(sql, (e, rows) => (e ? rej(e) : res(rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))))));

beforeAll(async () => {
  db = new duckdb.Database(':memory:');
  const lit = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`);
  await all(`CREATE TABLE salaries (snapshot_id VARCHAR, snapshot_date DATE, person_key VARCHAR, job_code VARCHAR, title VARCHAR,
    school VARCHAR, salary DOUBLE, salary_fte_adjusted DOUBLE, base_pay DOUBLE, fte DOUBLE, comp_basis VARCHAR)`);
  await all(`INSERT INTO salaries VALUES ${ROWS.map((row) => `(${COLS.map((c) => lit(row[c])).join(', ')})`).join(',\n')}`);
});
afterAll(() => db.close());

const appSide = (col) =>
  all(`WITH pe AS (${peopleSql({ metric: 'fte', where: `snapshot_id = 's2' AND ${col} IS NOT NULL`, by: [col] })})
       SELECT ${col} k, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med
       FROM pe GROUP BY ${col} HAVING count(*) FILTER (WHERE pay > 0) > 0 ORDER BY k`);

describe('search-index.json', () => {
  it("gives every title the title page's headcount and median", async () => {
    const index = (await all(titlesQuery('salaries', 's2'))).map((x) => [x.code, x.n, x.med]).sort();
    expect(index).toEqual((await appSide('job_code')).map((x) => [x.k, x.n, x.med]));
    // People, not rows: split counts once at 60,000; unpaid is out.
    expect(index).toContainEqual(['J1', 5, 70000]);
    expect(index.map((x) => x[0])).not.toContain('Z1');
    expect(index.map((x) => x[0])).not.toContain('J9');
  });

  it("gives every division the Divisions table's headcount and median", async () => {
    const index = (await all(divisionsQuery('salaries', 's2'))).map((x) => [x.school, x.n, x.med]).sort();
    expect(index).toEqual((await appSide('school')).map((x) => [x.k, x.n, x.med]));
  });

  it("names a title by its most common spelling", async () => {
    const [j1] = (await all(titlesQuery('salaries', 's2'))).filter((x) => x.code === 'J1');
    expect(j1.title).toBe('Engineer');
  });

  it('refuses an index over its gzipped budget', () => {
    const big = { titles: Array.from({ length: 4000 }, (_, i) => [`X${i}`, `Title ${((i * 2654435761) % 2 ** 32).toString(36)}`, i, i * 7]) };
    expect(() => serializeSearchIndex(big)).toThrow(/budget/);
    expect(serializeSearchIndex({ titles: [['J1', 'Engineer', 5, 70000]] }).gz).toBeLessThan(SEARCH_INDEX_BUDGET);
  });
});
