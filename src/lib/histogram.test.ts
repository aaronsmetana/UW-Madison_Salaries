import { describe, it, expect } from 'vitest';
import { binSalaries } from './histogram';

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
