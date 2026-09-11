import { describe, expect, it } from 'vitest';
import { layoutDots, paysFromCounts, peopleFromCounts, seeded, wakeOffset, WAKE_LIFT, WAKE_REACH } from './dotLayout';

const curve = (x: number) => 60 * Math.exp(-(((x - 300) / 120) ** 2)) + 4;

describe('layoutDots', () => {
  const xs = Array.from({ length: 5000 }, (_, i) => 50 + ((i * 7919) % 50000) / 100);
  const pts = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });

  it('keeps every dot under the curve and above the baseline, a radius inside both', () => {
    for (let i = 0; i < xs.length; i++) {
      const y = pts[2 * i + 1];
      const top = 100 - curve(Math.floor(xs[i]) + 0.5);
      expect(y).toBeLessThanOrEqual(100 - 0.6 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(top + 0.6 - 1e-4);
    }
  });

  it('keeps every dot within half a pixel of its value', () => {
    for (let i = 0; i < xs.length; i++) expect(Math.abs(pts[2 * i] - xs[i])).toBeLessThanOrEqual(0.5);
  });

  it('draws the same picture every time', () => {
    const again = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });
    expect(Array.from(again)).toEqual(Array.from(pts));
    const other = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 8 });
    expect(Array.from(other)).not.toEqual(Array.from(pts));
  });

  it('spreads a column from the baseline to the curve', () => {
    const col = Array.from({ length: 40 }, () => 300.2);
    const p = layoutDots({ xs: col, heightAt: curve, baseY: 100, r: 0.6 });
    const ys = Array.from({ length: 40 }, (_, i) => p[2 * i + 1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.9 * (curve(300.5) - 1.2));
  });
});

describe('seeded', () => {
  it('repeats for a seed', () => {
    const a = seeded(3), b = seeded(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('paysFromCounts', () => {
  it('puts each person inside their own $100', () => {
    const pays = paysFromCounts(500, [2, 0, 1]);
    expect(Array.from(pays)).toEqual([50025, 50075, 50250]);
  });
});

describe('layoutDots with a stacking key', () => {
  // Three kinds, mixed through every column.
  const xs = Array.from({ length: 6000 }, (_, i) => 100 + ((i * 7919) % 40000) / 100);
  const kinds = xs.map((_, i) => (i * 31) % 3);
  const plain = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });
  const stacked = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7, stack: kinds });

  it('puts every dot of a lower kind below every dot of a higher kind, column by column', () => {
    const cols = new Map<number, number[]>();
    xs.forEach((x, i) => { const c = Math.floor(x); cols.set(c, [...(cols.get(c) ?? []), i]); });
    for (const list of cols.values()) {
      for (let k = 0; k < 2; k++) {
        const top = Math.min(...list.filter((i) => kinds[i] === k).map((i) => stacked[2 * i + 1]));
        const next = list.filter((i) => kinds[i] === k + 1).map((i) => stacked[2 * i + 1]);
        // y grows downward: the kind above sits at smaller y than all of the kind below.
        if (next.length && Number.isFinite(top)) expect(Math.max(...next)).toBeLessThan(top);
      }
    }
  });

  it('moves no dot along x, and keeps every dot inside the curve', () => {
    for (let i = 0; i < xs.length; i++) {
      expect(Math.abs(stacked[2 * i] - xs[i])).toBeLessThanOrEqual(0.5);
      expect(stacked[2 * i + 1]).toBeLessThanOrEqual(100 - 0.6 + 1e-4);
      expect(stacked[2 * i + 1]).toBeGreaterThanOrEqual(100 - curve(Math.floor(xs[i]) + 0.5) + 0.6 - 1e-4);
    }
  });

  it('without a key, draws exactly what it drew before', () => {
    expect(Array.from(layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7, stack: undefined }))).toEqual(Array.from(plain));
  });
});

describe('peopleFromCounts', () => {
  it("gives each person their pay and their category, and the same pays paysFromCounts gives", () => {
    const counts = [2, 0, 3];
    const cats = [{ counts: [1, 0, 1] }, { counts: [1, 0, 2] }];
    const { pays, kinds } = peopleFromCounts(500, counts, cats);
    expect(Array.from(pays)).toEqual(Array.from(paysFromCounts(500, counts)));
    expect(Array.from(kinds!)).toEqual([0, 1, 0, 1, 1]);
  });
  it('refuses categories that do not add up to the counts', () => {
    expect(peopleFromCounts(500, [2], [{ counts: [1] }]).kinds).toBeNull();
    expect(peopleFromCounts(500, [2], null).kinds).toBeNull();
  });
});

describe('wakeOffset', () => {
  const room = { up: 50, down: 50 };
  it('moves a dot away from the pointer: up above it, down below it', () => {
    expect(wakeOffset({ dx: 0, dy: -5, speed: 2, room })).toBeLessThan(0);
    expect(wakeOffset({ dx: 0, dy: 5, speed: 2, room })).toBeGreaterThan(0);
    expect(Math.abs(wakeOffset({ dx: 0, dy: -1, speed: 2, room }))).toBeLessThanOrEqual(WAKE_LIFT);
  });
  it('is nothing beyond reach, and nothing at rest', () => {
    expect(wakeOffset({ dx: WAKE_REACH, dy: 1, speed: 2, room })).toBe(0);
    expect(wakeOffset({ dx: 0, dy: 1, speed: 0, room })).toBe(0);
  });
  it('fades with distance across and grows with speed', () => {
    const near = wakeOffset({ dx: 2, dy: 3, speed: 2, room });
    const far = wakeOffset({ dx: 20, dy: 3, speed: 2, room });
    expect(near).toBeGreaterThan(far);
    expect(wakeOffset({ dx: 2, dy: 3, speed: 0.3, room })).toBeLessThan(near);
  });
  it('never takes a dot out of the curve or through the baseline', () => {
    expect(wakeOffset({ dx: 0, dy: -1, speed: 5, room: { up: 1.5, down: 50 } })).toBe(-1.5);
    expect(wakeOffset({ dx: 0, dy: 1, speed: 5, room: { up: 50, down: 0.25 } })).toBe(0.25);
  });
});
