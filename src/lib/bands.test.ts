import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import duckdb from 'duckdb';
import { bandFor, belowMinimum, belowMinimumSql, bandScaleSql, isRange, minimumAt, type GradeBand } from './bands';

const GRADES: GradeBand[] = [
  { grade: 17, basis: 'annual_12mo', min: 42481, max: 79015 },
  { grade: 17, basis: 'hourly', min: 42481, max: 79015 },
  { grade: 80, basis: 'annual_9mo', min: 91548, max: null },
];

describe('bandFor', () => {
  it('finds the grade on its schedule, and nothing on another', () => {
    expect(bandFor(GRADES, 17, 'hourly')).toEqual(GRADES[1]);
    expect(bandFor(GRADES, 17, 'annual_9mo')).toBeNull();
    expect(bandFor(GRADES, null, 'hourly')).toBeNull();
    expect(bandFor(undefined, 17, 'hourly')).toBeNull();
  });

  it('reads a band in the units the row was reported in: 9-month pay before Sep 2025 was the 9-month amount', () => {
    // HR's own 9-month minimum for grade 80 is $74,903 — the 12-month $91,548 × 9/11.
    expect(bandFor(GRADES, 80, 'annual_9mo', 'Academic')!.min).toBeCloseTo(74903, 0);
    expect(bandFor(GRADES, 80, 'annual_9mo', '9 Month')!.min).toBe(91548);
    expect(bandFor(GRADES, 80, 'annual_9mo', 'Academic')!.max).toBeNull();
  });

  it('tells a range from a minimum only', () => {
    expect(isRange(GRADES[0])).toBe(true);
    expect(isRange(GRADES[2])).toBe(false);
    expect(isRange(null)).toBe(false);
  });
});

describe('belowMinimum', () => {
  it('reads an hourly rate against the hourly minimum as published, to the cent', () => {
    // $42,481 ÷ 2,080 is published as $20.42: paid exactly that, annualized, is $42,473.60 — at the minimum.
    expect(minimumAt(42481, 'hourly')).toBeCloseTo(42473.6, 6);
    expect(belowMinimum(20.42 * 2080, GRADES[1], 'hourly')).toBe(false);
    expect(belowMinimum(20.41 * 2080, GRADES[1], 'hourly')).toBe(true);
    // Last year's grade 15 minimum, $17.00 an hour, under this year's.
    expect(belowMinimum(35360, { grade: 15, basis: 'hourly', min: 36421, max: 67743 }, 'hourly')).toBe(true);
  });

  it('reads an annual rate against the minimum to the dollar HR rounds it to', () => {
    expect(belowMinimum(42480.6, GRADES[0], 'annual_12mo')).toBe(false);
    expect(belowMinimum(42480.4, GRADES[0], 'annual_12mo')).toBe(true);
  });

  it('applies to a minimum-only grade, and needs a paid rate', () => {
    expect(belowMinimum(90000, GRADES[2], 'annual_9mo')).toBe(true);
    expect(belowMinimum(0, GRADES[2], 'annual_9mo')).toBe(false);
    expect(belowMinimum(null, GRADES[2], 'annual_9mo')).toBe(false);
    expect(belowMinimum(90000, null, 'annual_9mo')).toBe(false);
  });
});

describe('the SQL twins', () => {
  let db: duckdb.Database;
  const one = <T,>(sql: string) =>
    new Promise<T>((res, rej) => db.all(sql, (e: Error | null, rows: unknown[]) => (e ? rej(e) : res(rows[0] as T))));
  beforeAll(() => { db = new duckdb.Database(':memory:'); });
  afterAll(() => db.close());

  it('agree with the client on every case above', async () => {
    const cases: [number, number, string][] = [
      [20.42 * 2080, 42481, 'hourly'], [20.41 * 2080, 42481, 'hourly'], [35360, 36421, 'hourly'],
      [42480.6, 42481, 'annual_12mo'], [42480.4, 42481, 'annual_12mo'], [0, 42481, 'annual_12mo'],
    ];
    for (const [rate, min, basis] of cases) {
      const { b } = await one<{ b: boolean }>(`SELECT ${belowMinimumSql(String(rate), String(min), `'${basis}'`)} b`);
      expect(b, `${rate} against ${min} ${basis}`).toBe(belowMinimum(rate, { grade: 0, basis, min, max: null }, basis));
    }
  });

  it('scale a band for the older 9-month reporting, and nothing else', async () => {
    const r = await one<{ a: number; n: number; x: number }>(
      `SELECT ${bandScaleSql("'Academic'")} a, ${bandScaleSql("'9 Month'")} n, ${bandScaleSql('NULL')} x`
    );
    expect(r.a).toBeCloseTo(9 / 11, 12);
    expect(r.n).toBe(1);
    expect(r.x).toBe(1);
  });
});
