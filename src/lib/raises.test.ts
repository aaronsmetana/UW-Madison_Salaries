import { describe, expect, it } from 'vitest';
import { annualized, logMean, whereTheDifferenceCameFrom } from './raises';

describe('annualized', () => {
  it('compounds the steps and spreads them over the time they span', () => {
    // +10% then +10% over exactly two years is 10% a year.
    const r = annualized([
      { from: '2020-01-01', to: '2021-01-01', rate: 0.1 },
      { from: '2021-01-01', to: '2022-01-01', rate: 0.1 },
    ]);
    expect(r).toBeCloseTo(0.1, 2);
  });

  it('counts only the time inside the steps, not the gaps between them', () => {
    // A title-change step left out leaves a hole; the hole is not a year of zero growth.
    const r = annualized([
      { from: '2020-01-01', to: '2021-01-01', rate: 0.05 },
      { from: '2023-01-01', to: '2024-01-01', rate: 0.05 },
    ]);
    expect(r).toBeCloseTo(0.05, 2);
  });

  it('declines to annualize under half a year', () => {
    expect(annualized([{ from: '2020-01-01', to: '2020-04-01', rate: 0.02 }])).toBeNull();
    expect(annualized([])).toBeNull();
  });
});


describe('logMean', () => {
  it('is the logarithmic mean, and the amount itself when the two are equal', () => {
    expect(logMean(200, 100)).toBeCloseTo(100 / Math.log(2), 9);
    expect(logMean(100, 100)).toBe(100);
    expect(logMean(100, 100 * (1 + 1e-12))).toBeCloseTo(100, 6);
    expect(logMean(0, 100)).toBeNaN();
  });
});

describe('whereTheDifferenceCameFrom', () => {
  it('splits the gap into shares that add up to exactly the gap', () => {
    const steps = [
      { toId: 's1', from: 50000, to: 51000, typical: 1.02, reporting: 1 },
      { toId: 's2', from: 51000, to: 60000, typical: 1.0, reporting: 1 }, // a promotion
      { toId: 's3', from: 60000, to: 62400, typical: 1.035, reporting: 1 },
    ];
    const r = whereTheDifferenceCameFrom(steps);
    expect(r.actual).toBeCloseTo(62400, 6);
    expect(r.typical).toBeCloseTo(50000 * 1.02 * 1.0 * 1.035, 6);
    const sum = r.shares.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBeCloseTo(r.actual - r.typical, 6);
    // The promotion is where most of it came from.
    const big = r.shares.reduce((m, x) => (x.amount > m.amount ? x : m));
    expect(big.toId).toBe('s2');
  });

  it('holds when the two paths end at the same pay (the case a plain ratio divides by zero)', () => {
    const steps = [
      { toId: 's1', from: 100, to: 110, typical: 1.0, reporting: 1 },
      { toId: 's2', from: 110, to: 100, typical: 1.0, reporting: 1 },
    ];
    const r = whereTheDifferenceCameFrom(steps);
    expect(r.actual - r.typical).toBeCloseTo(0, 9);
    expect(r.shares[0].amount).toBeCloseTo(100 * Math.log(1.1), 9);
    expect(r.shares[0].amount + r.shares[1].amount).toBeCloseTo(0, 9);
  });

  it('names a reporting change on its own row and never counts it as a raise', () => {
    // A 9-month member who got exactly the typical 3% across Sep 2025, reported ×11/9.
    const steps = [{ toId: '2025-09', from: 90000, to: 90000 * 1.03 * (11 / 9), typical: 1.03 * (11 / 9), reporting: 11 / 9 }];
    const r = whereTheDifferenceCameFrom(steps);
    expect(r.shares.map((s) => s.kind)).toEqual(['reporting', 'step']);
    expect(r.shares[0].amount).toBe(0);
    expect(r.shares[1].amount).toBeCloseTo(0, 6);
  });
});
