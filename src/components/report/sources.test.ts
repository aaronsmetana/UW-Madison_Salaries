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

describe('POLICY.compressionFloor', () => {
  it('picks 8% for exempt, 5% for non-exempt', () => {
    expect(POLICY.compressionFloor(true)).toBe(0.08);
    expect(POLICY.compressionFloor(false)).toBe(0.05);
  });
  it('falls back to the conservative 5% when FLSA status is unknown', () => {
    expect(POLICY.compressionFloor(null)).toBe(0.05);
  });
});

describe('POLICY.gradePosition', () => {
  it('maps compa-ratio to the guideline\'s grade-position vocabulary', () => {
    expect(POLICY.gradePosition(0.84)).toBe('Emerging in Grade');
    expect(POLICY.gradePosition(0.85)).toBe('Established in Grade');
    expect(POLICY.gradePosition(1.0)).toBe('Established in Grade');
    expect(POLICY.gradePosition(1.15)).toBe('Established in Grade');
    expect(POLICY.gradePosition(1.16)).toBe('Advanced in Grade');
  });
  it('the market-competitive band edges match the guideline (85%–115% / 25%–75%)', () => {
    expect(POLICY.marketCompetitive.compaLow).toBe(0.85);
    expect(POLICY.marketCompetitive.compaHigh).toBe(1.15);
    expect(POLICY.marketCompetitive.pirLow).toBe(0.25);
    expect(POLICY.marketCompetitive.pirHigh).toBe(0.75);
  });
});
