import { describe, it, expect } from 'vitest';
import { percentile, leastSquares, ordinal } from './stats';

describe('ordinal', () => {
  it('suffixes 1/2/3 and everything else', () => {
    expect([1, 2, 3, 4, 50, 78].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '50th', '78th']);
  });
  it('keeps the teens on "th"', () => {
    // The case a naive `n % 10` gets wrong, and the reason two call sites hardcoding "th" only
    // looked correct: most percentiles happen not to be 1, 2 or 3.
    expect([11, 12, 13, 111, 112, 113].map(ordinal)).toEqual(['11th', '12th', '13th', '111th', '112th', '113th']);
  });
  it('resumes after the teens', () => {
    expect([21, 22, 23, 31, 42, 93].map(ordinal)).toEqual(['21st', '22nd', '23rd', '31st', '42nd', '93rd']);
  });
  it('rounds a fractional percentile before suffixing it', () => {
    expect(ordinal(20.6)).toBe('21st');
  });
});

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

describe('percentile — values from outside the pool', () => {
  it('never reports more than 100%', () => {
    // A person's total pay across two appointments, measured against a cohort of single-appointment
    // peers: every peer is below them, and n/(n-1) is 101%. That comparison is the caller's bug, but a
    // percentile above 100 is nonsense whatever caused it.
    expect(percentile(216_320, Array(173).fill(124_800))).toBe(100);
  });

  it('still reports 0 when nobody is below', () => {
    expect(percentile(50_000, [50_000, 60_000, 70_000])).toBe(0);
  });
});
