import { describe, it, expect } from 'vitest';
import { toReal, REAL_BASE_YEAR } from './cpi';

describe('cpi', () => {
  it('leaves an amount unchanged when converting the base year to itself', () => {
    expect(toReal(100000, REAL_BASE_YEAR)).toBeCloseTo(100000, 5);
  });
  it('scales a past-year amount up to base-year purchasing power', () => {
    // 2021 CPI-U (270.97) is below the base year's, so $100k in 2021 is worth more in base-year dollars.
    const real = toReal(100000, 2021);
    expect(real).toBeGreaterThan(100000);
  });
  it('a more recent year converts by a smaller factor than an older year', () => {
    const from2021 = toReal(100000, 2021) - 100000;
    const from2024 = toReal(100000, 2024) - 100000;
    expect(from2024).toBeLessThan(from2021);
  });
  it('clamps years outside the known table instead of throwing or returning NaN', () => {
    expect(Number.isFinite(toReal(100000, 1990))).toBe(true);
    expect(Number.isFinite(toReal(100000, 2099))).toBe(true);
    // Clamped low/high should match the nearest known boundary year's conversion.
    expect(toReal(100000, 1990)).toBeCloseTo(toReal(100000, 2021), 5);
    expect(toReal(100000, 2099)).toBeCloseTo(toReal(100000, REAL_BASE_YEAR), 5);
  });
  it('rounds a fractional year before lookup', () => {
    expect(toReal(100000, 2022.4)).toBeCloseTo(toReal(100000, 2022), 5);
  });
});
