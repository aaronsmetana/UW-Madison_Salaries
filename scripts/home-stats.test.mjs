import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import duckdb from 'duckdb';
import { computeHomeStats } from './lib/home-stats.mjs';

// Six synthetic appointments across two schools/titles/categories, all in one snapshot — enough to
// exercise every aggregate computeHomeStats derives without depending on the real (large) dataset.
// `salary_fte_adjusted` matches the real parquet's schema (the importer emits the column; no source has
// populated it yet), so the COALESCE in the pay expression is exercised. p1 carries a numeric value —
// equal to its own computed pay, so no assertion depends on it — purely so read_json_auto types the
// column as DOUBLE; an all-null column infers as JSON and the arithmetic fails to bind.
// p6 is the load-bearing one: an hourly appointment with `fte: 0`, which is how this source records
// "no fixed appointment percentage", NOT "earns nothing". It must contribute its full annualized rate.
const ROWS = [
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p1', salary_fte_adjusted: 100000, salary: 100000, fte: 1, date_of_hire: '2020-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p2', salary: 120000, salary_fte_adjusted: null, fte: 1, date_of_hire: '2015-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p5', salary: 110000, salary_fte_adjusted: null, fte: 1, date_of_hire: '2018-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'B', job_code: 'J2', title: 'Staff', employee_category: 'Staff', person_key: 'p3', salary: 50000, salary_fte_adjusted: null, fte: 0.5, date_of_hire: '2022-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'B', job_code: 'J2', title: 'Staff', employee_category: 'Staff', person_key: 'p4', salary: 60000, salary_fte_adjusted: null, fte: 1, date_of_hire: '2010-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J3', title: 'Temp', employee_category: 'University Staff', person_key: 'p6', salary: 40000, salary_fte_adjusted: null, fte: 0, date_of_hire: '2024-01-01', snapshot_date: '2026-01-01' },
];

let tmpDir;
let parquetPath;
let stats;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-stats-test-'));
  const ndjson = path.join(tmpDir, 'rows.ndjson');
  parquetPath = path.join(tmpDir, 'salaries.parquet');
  fs.writeFileSync(ndjson, ROWS.map((r) => JSON.stringify(r)).join('\n'));

  await new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const con = db.connect();
    const esc = (p) => p.replace(/'/g, "''");
    con.run(`CREATE TABLE t AS SELECT * FROM read_json_auto('${esc(ndjson)}', format='newline_delimited');`, (err) => {
      if (err) return reject(err);
      con.run(`COPY t TO '${esc(parquetPath)}' (FORMAT PARQUET);`, (err2) => (err2 ? reject(err2) : db.close(resolve)));
    });
  });

  stats = await computeHomeStats(parquetPath, 'snap-1');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('computeHomeStats shape + derivation', () => {
  it('carries the snapshot id through unchanged', () => {
    expect(stats.snapshot_id).toBe('snap-1');
  });
  it('sums FTE-scaled payroll for paid appointments only', () => {
    // 100000 + 120000 + 110000 + 50000*0.5 + 60000 + 40000 (p6: fte 0 counts at its full rate)
    expect(stats.payroll_total).toBeCloseTo(455000, 5);
  });
  it('counts distinct schools and job codes', () => {
    expect(stats.schools).toBe(2);
    expect(stats.titles).toBe(3);
  });
  it('finds the min/max nominal salary', () => {
    expect(stats.salary_lo).toBe(40000);
    expect(stats.salary_hi).toBe(120000);
  });
  it('bins actual (FTE-scaled) pay into $10k buckets, ascending, each carrying a count', () => {
    // The bins describe the same quantity as the headline median — actual pay — so p3 lands at
    // 50000*0.5 = 25000, not at its 50000 rate. p6 (fte 0, hourly) lands at its full 40000.
    expect(stats.bins).toEqual([
      { bucket: 20000, n: 1 },
      { bucket: 40000, n: 1 },
      { bucket: 60000, n: 1 },
      { bucket: 100000, n: 1 },
      { bucket: 110000, n: 1 },
      { bucket: 120000, n: 1 },
    ]);
  });
  it('picks the title/division with the most appointments', () => {
    expect(stats.top_title).toEqual({ title: 'Prof', n: 3 });
    expect(stats.top_division).toEqual({ school: 'A', n: 4 });
  });
  it('computes the 90th-percentile pay across people', () => {
    // sorted per-person pay: 40000, 50000, 60000, 100000, 110000, 120000 -> interpolated p90 = 115000
    expect(stats.p90).toBeCloseTo(115000, 5);
  });
  it('reports a positive median tenure', () => {
    expect(typeof stats.median_tenure_years).toBe('number');
    expect(stats.median_tenure_years).toBeGreaterThan(0);
  });
  it('ranks categories by headcount, each with its own median', () => {
    expect(stats.category_medians).toEqual([
      { category: 'Faculty', median: 110000 },
      { category: 'Staff', median: 55000 },
      { category: 'University Staff', median: 40000 },
    ]);
  });

  it('reports the histogram cap and what sits above it, instead of dropping the tail', () => {
    expect(stats.bin_cap).toBe(250000);
    expect(stats.bins_overflow).toBe(0); // nothing in this fixture is above the cap
  });

  it('derives quartiles from the same actual-pay measure the bins use', () => {
    // sorted actual pay: 25000, 40000, 60000, 100000, 110000, 120000
    expect(stats.p25).toBeCloseTo(45000, 5);
    expect(stats.p50).toBeCloseTo(80000, 5);
    expect(stats.p75).toBeCloseTo(107500, 5);
  });

  it('counts an hourly fte=0 appointment at its full rate, not as $0', () => {
    // The regression this guards: `salary * COALESCE(fte, 1)` leaves a literal 0 intact and zeroes
    // out every hourly worker. p6 must appear in the 40000 bin and in the payroll total.
    expect(stats.bins).toContainEqual({ bucket: 40000, n: 1 });
    expect(stats.bins.find((b) => b.bucket === 0)).toBeUndefined();
  });
});
