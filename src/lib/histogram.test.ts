import { describe, it, expect } from 'vitest';
import { binSalaries, binsForSpread } from './histogram';

describe('binSalaries', () => {
  it('returns no bins for empty input', () => {
    expect(binSalaries([])).toEqual([]);
  });

  it('returns a single bin when all values are equal', () => {
    const bins = binSalaries([100000, 100000]);
    expect(bins).toHaveLength(1);
    expect(bins[0].n).toBe(2);
  });

  it('ignores non-positive values and counts every positive value exactly once', () => {
    const vals = [0, -5, 50000, 60000, 70000];
    const bins = binSalaries(vals);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(3);
  });

  it('bins a crowded middle finer than a range stretched by a few outliers would (T7)', () => {
    // 360 people between $60k and $72k, and two at $150k and $180k.
    const vals = [...Array.from({ length: 360 }, (_, i) => 60_000 + (i % 120) * 100), 150_000, 180_000];
    const tenAcross = binSalaries(vals, 10);
    const bySpread = binSalaries(vals, binsForSpread(vals));
    const widest = (bs: { n: number }[]) => Math.max(...bs.map((b) => b.n));
    expect(widest(bySpread)).toBeLessThan(widest(tenAcross) / 2);
    expect(bySpread.length).toBeLessThanOrEqual(41);
  });

  it('asks for between 8 and 40 bins', () => {
    expect(binsForSpread([1, 2, 3])).toBe(10);
    expect(binsForSpread(Array.from({ length: 50 }, (_, i) => 50_000 + i * 1000))).toBeGreaterThanOrEqual(8);
    expect(binsForSpread([...Array.from({ length: 1000 }, () => 50_000), 50_001, 1_000_000])).toBeLessThanOrEqual(40);
  });

  it('uses nice, contiguous, ascending bins covering the range', () => {
    const bins = binSalaries([31000, 35000, 40000, 48000]);
    expect(bins.length).toBeGreaterThan(1);
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i].lo).toBeGreaterThanOrEqual(bins[i - 1].lo);
      expect(bins[i].lo).toBeCloseTo(bins[i - 1].hi, 5); // contiguous
    }
    expect(bins[0].lo).toBeLessThanOrEqual(31000);
    expect(bins[bins.length - 1].hi).toBeGreaterThanOrEqual(48000);
  });
});
