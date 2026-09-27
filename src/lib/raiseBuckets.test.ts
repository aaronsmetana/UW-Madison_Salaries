import { describe, expect, it } from 'vitest';
import duckdb from 'duckdb';
import { raiseBucket, raiseBucketSql, raiseBucketLabel, raiseBuckets, RAISE_BIN_HI, RAISE_BIN_LO } from './raiseBuckets';

describe('raiseBucket', () => {
  it('gives no change a bin of its own: whatever prints as 0%', () => {
    expect(raiseBucket(0)).toBe(0);
    expect(raiseBucket(0.00001)).toBe(0);
    expect(raiseBucket(0.0004)).toBe(0);
    expect(raiseBucket(-0.0004)).toBe(0);
    expect(raiseBucket(0.0006)).toBe(1);
  });
  it('bins by 1%, a raise printed up to and including its bin edge', () => {
    expect(raiseBucket(0.004)).toBe(1);
    expect(raiseBucket(0.02)).toBe(2);
    // A 2% step rounded to the cent: $20.42 → $20.83 is +2.008%, printed "+2.0%", and in the +2% bin.
    expect(raiseBucket(20.83 / 20.42 - 1)).toBe(2);
    expect(raiseBucket(0.0204)).toBe(2);
    expect(raiseBucket(0.0206)).toBe(3);
    expect(raiseBucket(-0.02)).toBe(-2);
    expect(raiseBucket(-0.0204)).toBe(-2);
    expect(raiseBucket(-0.004)).toBe(-1);
  });
  it('gathers the tails', () => {
    expect(raiseBucket(0.35)).toBe(RAISE_BIN_HI + 1);
    expect(raiseBucket(-0.4)).toBe(RAISE_BIN_LO - 1);
    expect(raiseBucketLabel(RAISE_BIN_HI + 1)).toBe('> +20%');
    expect(raiseBucketLabel(RAISE_BIN_LO - 1)).toBe('< −10%');
    expect(raiseBucketLabel(-3)).toBe('−3%');
  });
  it('lists every bin in order', () => {
    const b = raiseBuckets();
    expect(b[0]).toBe(RAISE_BIN_LO - 1);
    expect(b[b.length - 1]).toBe(RAISE_BIN_HI + 1);
    expect(b).toContain(0);
  });
  it('is the same in SQL', async () => {
    const rs = [0, 0.00001, 0.0004, 0.0006, 0.004, 0.01, 0.0100001, 0.02, 0.0201, 0.0204, 0.0206, 20.83 / 20.42 - 1, 0.035, 0.2, 0.2001, 0.2006, 0.35, -0.0004, -0.004, -0.01, -0.02, -0.0206, -0.1, -0.1001, -0.1006, -0.4];
    const db = new duckdb.Database(':memory:');
    const rows = await new Promise<{ r: number; k: number }[]>((res, rej) =>
      db.all(`SELECT r, ${raiseBucketSql('r')} k FROM (VALUES ${rs.map((r) => `(${r}::DOUBLE)`).join(',')}) t(r)`, (e, x) => (e ? rej(e) : res(x as unknown as { r: number; k: number }[])))
    );
    db.close();
    expect(rows.map((x) => Number(x.k))).toEqual(rs.map(raiseBucket));
  });
});
