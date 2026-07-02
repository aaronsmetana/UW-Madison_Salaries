import { describe, it, expect } from 'vitest';
import { niceCurrencyTicks } from './chartStyle';

describe('niceCurrencyTicks', () => {
  it('picks round ticks for an all-negative range abutting zero', () => {
    expect(niceCurrencyTicks(-28500, 0)).toEqual([-30000, -20000, -10000, 0]);
  });
  it('picks round ticks for an all-positive range', () => {
    expect(niceCurrencyTicks(100000, 150000)).toEqual([100000, 120000, 140000, 160000]);
  });
  it('includes 0 automatically when the range crosses zero', () => {
    const ticks = niceCurrencyTicks(-5000, 15000);
    expect(ticks).toContain(0);
    expect(ticks).toEqual([-5000, 0, 5000, 10000, 15000]);
  });
  it('returns a small symmetric range for a degenerate min === max', () => {
    const ticks = niceCurrencyTicks(50000, 50000);
    expect(ticks).toEqual([40000, 50000, 60000]);
  });
  it('handles a degenerate range at exactly zero', () => {
    const ticks = niceCurrencyTicks(0, 0);
    expect(ticks.length).toBe(3);
    expect(ticks[1]).toBe(0);
  });
});
