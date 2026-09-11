import { describe, expect, it } from 'vitest';
import { annualized } from './raises';

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
