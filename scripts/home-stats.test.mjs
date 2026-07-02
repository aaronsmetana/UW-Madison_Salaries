import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import duckdb from 'duckdb';
import { computeHomeStats } from './lib/home-stats.mjs';

// Five synthetic appointments across two schools/titles/categories, all in one snapshot — enough to
// exercise every aggregate computeHomeStats derives without depending on the real (large) dataset.
const ROWS = [
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p1', salary: 100000, fte: 1, date_of_hire: '2020-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p2', salary: 120000, fte: 1, date_of_hire: '2015-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'A', job_code: 'J1', title: 'Prof', employee_category: 'Faculty', person_key: 'p5', salary: 110000, fte: 1, date_of_hire: '2018-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'B', job_code: 'J2', title: 'Staff', employee_category: 'Staff', person_key: 'p3', salary: 50000, fte: 0.5, date_of_hire: '2022-01-01', snapshot_date: '2026-01-01' },
  { snapshot_id: 'snap-1', school: 'B', job_code: 'J2', title: 'Staff', employee_category: 'Staff', person_key: 'p4', salary: 60000, fte: 1, date_of_hire: '2010-01-01', snapshot_date: '2026-01-01' },
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
    // 100000 + 120000 + 110000 + 50000*0.5 + 60000
    expect(stats.payroll_total).toBeCloseTo(415000, 5);
  });
  it('counts distinct schools and job codes', () => {
    expect(stats.schools).toBe(2);
    expect(stats.titles).toBe(2);
  });
  it('finds the min/max nominal salary', () => {
    expect(stats.salary_lo).toBe(50000);
    expect(stats.salary_hi).toBe(120000);
  });
  it('bins salaries into $10k buckets, ascending, each carrying a count', () => {
    expect(stats.bins).toEqual([
      { bucket: 50000, n: 1 },
      { bucket: 60000, n: 1 },
      { bucket: 100000, n: 1 },
      { bucket: 110000, n: 1 },
      { bucket: 120000, n: 1 },
    ]);
  });
  it('picks the title/division with the most appointments', () => {
    expect(stats.top_title).toEqual({ title: 'Prof', n: 3 });
    expect(stats.top_division).toEqual({ school: 'A', n: 3 });
  });
  it('computes the 90th-percentile pay across people', () => {
    // sorted per-person pay: 50000, 60000, 100000, 110000, 120000 -> interpolated p90 = 116000
    expect(stats.p90).toBeCloseTo(116000, 5);
  });
  it('reports a positive median tenure', () => {
    expect(typeof stats.median_tenure_years).toBe('number');
    expect(stats.median_tenure_years).toBeGreaterThan(0);
  });
  it('ranks categories by headcount, each with its own median', () => {
    expect(stats.category_medians).toEqual([
      { category: 'Faculty', median: 110000 },
      { category: 'Staff', median: 55000 },
    ]);
  });
});
