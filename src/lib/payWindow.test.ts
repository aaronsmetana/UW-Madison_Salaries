import { describe, it, expect } from 'vitest';
import { WINDOW_MIN_PEOPLE, payWindow, quantile, sideOf } from './payWindow';

/** `n` pays: a tight crowd round $60k, and `lows` / `highs` far out either side. */
function title(n: number, lows: number[] = [], highs: number[] = []): number[] {
  const crowd = n - lows.length - highs.length;
  const out: number[] = [];
  for (let i = 0; i < crowd; i++) out.push(55_000 + (10_000 * i) / Math.max(1, crowd - 1));
  return [...out, ...lows, ...highs];
}

describe('quantile', () => {
  it("interpolates between neighbours, as DuckDB's quantile_cont does", () => {
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
    expect(quantile([0, 100], 0.05)).toBeCloseTo(5, 9);
  });
});

describe('payWindow', () => {
  it('zooms a title whose far-out few squeeze everyone else, counting who is outside', () => {
    // 100 people: 90 between $55k and $65k, 5 paid about $1k, 5 about $130k.
    const pays = title(100, [500, 800, 900, 1000, 1200], [128_000, 129_000, 130_000, 131_000, 133_000]);
    const w = payWindow(pays)!;
    expect(w).not.toBeNull();
    expect(w.lo).toBeLessThanOrEqual(quantile([...pays].sort((a, b) => a - b), 0.05));
    expect(w.hi).toBeGreaterThanOrEqual(quantile([...pays].sort((a, b) => a - b), 0.95));
    expect(w.below).toBe(pays.filter((v) => v < w.lo).length);
    expect(w.above).toBe(pays.filter((v) => v > w.hi).length);
    expect(w.below + w.above).toBeGreaterThan(0);
  });
  it('rounds its ends out to a round step, so nobody in the middle 90% is left out', () => {
    // A $20,323 middle 90% steps by $1k: $51,777 → $51k and $72,100 → $73k.
    const s = [...Array(1000)].map((_, i) => 51_777.2 + ((72_100 - 51_777.2) * i) / 999);
    const pays = [...s.slice(0, 900), ...[...Array(50)].map((_, i) => 495 + i * 1000), ...[...Array(50)].map((_, i) => 72_100.5 + i * 1200)];
    const w = payWindow(pays)!;
    const sorted = [...pays].sort((a, b) => a - b);
    const step = 1000;
    expect(w.lo % step).toBe(0);
    expect(w.hi % step).toBe(0);
    expect(w.lo).toBeLessThanOrEqual(quantile(sorted, 0.05));
    expect(w.hi).toBeGreaterThanOrEqual(quantile(sorted, 0.95));
    expect(quantile(sorted, 0.05) - w.lo).toBeLessThan(step);
    expect(w.hi - quantile(sorted, 0.95)).toBeLessThan(step);
  });
  it('leaves a title alone whose middle 90% already fills half its axis, just past the line either way', () => {
    // A crowd from $55k to $65k and one person out past each end, `d` beyond it: the 5th and 95th
    // percentiles stay in the crowd whatever `d` is, so the range alone decides — and it crosses twice
    // the middle 90% at d0. $150 either side of that.
    const base = title(100);
    const at = (d: number) => [...base.slice(2), 55_000 - d, 65_000 + d];
    const probe = at(0).sort((a, b) => a - b);
    const d0 = quantile(probe, 0.95) - quantile(probe, 0.05) - 5_000;
    const squeezed = at(d0 + 150);
    const fits = at(d0 - 150);
    const sq = [...squeezed].sort((a, b) => a - b), fi = [...fits].sort((a, b) => a - b);
    expect((quantile(sq, 0.95) - quantile(sq, 0.05)) / (sq[sq.length - 1] - sq[0])).toBeLessThan(0.5);
    expect((quantile(fi, 0.95) - quantile(fi, 0.05)) / (fi[fi.length - 1] - fi[0])).toBeGreaterThan(0.5);
    expect(payWindow(squeezed)).not.toBeNull();
    expect(payWindow(fits)).toBeNull();
  });
  it(`needs ${WINDOW_MIN_PEOPLE} people`, () => {
    const lows = [500, 700], highs = [140_000, 150_000];
    expect(payWindow(title(WINDOW_MIN_PEOPLE, lows, highs))).not.toBeNull();
    expect(payWindow(title(WINDOW_MIN_PEOPLE - 1, lows, highs))).toBeNull();
  });
  it('ignores pays that are not pay, and a title everyone is paid the same', () => {
    expect(payWindow([...Array(60)].map(() => 124_800))).toBeNull();
    const pays = title(100, [500, 800, 900, 1000, 1200], [128_000, 129_000, 130_000, 131_000, 133_000]);
    expect(payWindow([...pays, 0, -5, NaN])).toEqual(payWindow(pays));
  });
});

describe('sideOf', () => {
  it('says which side of the window a pay is, and inside for no window', () => {
    const w = { lo: 50_000, hi: 70_000, below: 3, above: 2 };
    expect(sideOf(w, 49_999)).toBe(-1);
    expect(sideOf(w, 50_000)).toBe(0);
    expect(sideOf(w, 70_000)).toBe(0);
    expect(sideOf(w, 70_001)).toBe(1);
    expect(sideOf(null, 1)).toBe(0);
  });
});
