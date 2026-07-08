import { describe, it, expect } from 'vitest';
import { percentile, leastSquares } from './stats';

describe('percentile', () => {
  it('is the share of the other values strictly below, with an n-1 denominator', () => {
    expect(percentile(105_000, [90_000, 100_000, 105_000, 110_000, 120_000])).toBe(50);
  });
  it('returns 0 for a single-value or empty group', () => {
    expect(percentile(100_000, [100_000])).toBe(0);
    expect(percentile(100_000, [])).toBe(0);
  });
});

describe('leastSquares', () => {
  it('fits a perfect line exactly', () => {
    const pts = [{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }, { x: 3, y: 16 }];
    const reg = leastSquares(pts)!;
    expect(reg.slope).toBeCloseTo(2, 5);
    expect(reg.intercept).toBeCloseTo(10, 5);
  });
  it('returns null with fewer than 2 points', () => {
    expect(leastSquares([])).toBeNull();
    expect(leastSquares([{ x: 1, y: 1 }])).toBeNull();
  });
  it('returns null when every point shares the same x (zero variance, undefined slope)', () => {
    expect(leastSquares([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }])).toBeNull();
  });
});
