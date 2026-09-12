import { describe, expect, it } from 'vitest';
import { niceCeil, niceStep, rangeScale, scaleX, moneyTicks } from './rangeScale';

describe('niceCeil and niceStep', () => {
  it('ends a scale at the next round figure, finely enough not to double it', () => {
    expect(niceCeil(83_000)).toBe(100_000);
    expect(niceCeil(160_000)).toBe(200_000);
    expect(niceCeil(276_000)).toBe(300_000);
    expect(niceCeil(410_000)).toBe(500_000);
  });
  it('steps gridlines by 1, 2, 2.5 or 5', () => {
    expect(niceStep(60_000)).toBe(100_000);
    expect(niceStep(30_000)).toBe(50_000);
  });
});

describe('rangeScale', () => {
  it('runs from $0 to a round figure above nearly every 75th percentile', () => {
    const s = rangeScale([90_000, 120_000, 180_000, 95_000]);
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(200_000);
    expect(s.ticks).toEqual([50_000, 100_000, 150_000]);
  });
  it('is not stretched by one extreme row', () => {
    const rows = Array.from({ length: 100 }, (_, i) => 60_000 + i * 1000);
    rows.push(2_500_000);
    expect(rangeScale(rows).hi).toBe(200_000);
  });
  it('gives equal dollars equal pixels on every row, and cuts at the edge', () => {
    const s = rangeScale([100_000]);
    const px = (a: number, b: number) => scaleX(s, b, 200) - scaleX(s, a, 200);
    expect(px(10_000, 20_000)).toBeCloseTo(px(70_000, 80_000), 9);
    expect(scaleX(s, 5_000_000, 200)).toBe(scaleX(s, s.hi, 200));
  });
});

describe('moneyTicks', () => {
  it('steps by 1, 2, 2.5 or 5 × 10ⁿ, from a round floor to a round top', () => {
    // The starting group ($35,000 steps before), a trend chart topped by its grade band, a professor's scatter.
    expect(moneyTicks(0, 140000)).toEqual([0, 50000, 100000, 150000]);
    expect(moneyTicks(0, 178232)).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(moneyTicks(44639, 440611)).toEqual([0, 100000, 200000, 300000, 400000, 500000]);
    expect(moneyTicks(90000, 150000)).toEqual([80000, 100000, 120000, 140000, 160000]);
  });
  it('gives one tick for a single value', () => {
    expect(moneyTicks(5, 5)).toEqual([5]);
  });
});
