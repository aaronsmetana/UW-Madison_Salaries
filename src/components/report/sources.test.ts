import { describe, it, expect } from 'vitest';
import { POLICY } from './sources';

describe('POLICY.payDifferential', () => {
  it('matches the UW guideline\'s own formula: (higher − lower) / lower', () => {
    expect(POLICY.payDifferential(115_000, 100_000)).toBeCloseTo(0.15, 5);
    expect(POLICY.payDifferential(120_000, 100_000)).toBeCloseTo(0.2, 5);
    expect(POLICY.payDifferential(100_000, 100_000)).toBe(0);
  });
  it('the 15%/20% guideline tiers are exposed as data', () => {
    expect(POLICY.supervisorDifferential).toBe(0.15);
    expect(POLICY.directorDifferential).toBe(0.2);
  });
});
