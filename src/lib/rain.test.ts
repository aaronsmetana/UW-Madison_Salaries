import { describe, expect, it } from 'vitest';
import { GRAVITY } from './dotPhysics';
import { bounceCap, fallAt, fallTime, hash01, rainSchedule, RAIN_HEAD, RAIN_LIFT } from './rain';

/** Columns of the given heights, side by side: each dot's rank up its column, its column, and a resting y
 *  that stacks upward from a floor at 300px. */
function field(heights: number[]) {
  const rank: number[] = [], column: number[] = [], rest: number[] = [];
  heights.forEach((h, c) => { for (let k = 0; k < h; k++) { rank.push(k); column.push(c); rest.push(300 - 2 * k); } });
  return { rank, column, rest };
}
const SPAN = 5300;
const GAP = 120;

describe('rainSchedule', () => {
  it('builds every column from the floor up: a dot never starts before the one beneath it', () => {
    const f = field([1, 7, 40, 3, 120, 60]);
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    for (let i = 0; i < f.rank.length; i++) {
      for (let j = 0; j < f.rank.length; j++) {
        if (f.column[i] === f.column[j] && f.rank[j] === f.rank[i] + 1) expect(plan.start[j]).toBeGreaterThan(plan.start[i]);
      }
    }
  });

  it('keeps a thin column done long before a tall one: the thing the rain exists to show', () => {
    const f = field([5, 200]);
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    const lastOf = (c: number) => Math.max(...f.column.flatMap((cc, i) => (cc === c ? [plan.start[i]] : [])));
    expect(lastOf(0)).toBeLessThan(lastOf(1) / 3);
  });

  it('gives no column more than its small head start, so no thin column waits long to begin', () => {
    const heights = Array.from({ length: 300 }, (_, c) => 1 + (c % 9));
    const f = field(heights);
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 3 });
    f.rank.forEach((k, i) => { if (k === 0) expect(plan.start[i]).toBeLessThanOrEqual(RAIN_HEAD * SPAN + 1e-3); });
  });

  it('is not a metronome: columns begin at different moments, and one column’s waits differ', () => {
    const f = field(Array.from({ length: 50 }, () => 30));
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    const firsts = new Set(f.rank.flatMap((k, i) => (k === 0 ? [Math.round(plan.start[i])] : [])));
    expect(firsts.size).toBeGreaterThan(40);
    const waits = f.column.flatMap((c, i) => (c === 0 && f.rank[i] > 0 ? [plan.start[i] - plan.start[i - 1]] : []));
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(GAP * 0.5);
  });

  it('starts nothing after the span, however the waits add up, and ends when the last drop has settled', () => {
    const f = field([2000, 30]);
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: SPAN / 1999, span: SPAN, seed: 1 });
    expect(Math.max(...plan.start)).toBeLessThanOrEqual(SPAN + 1e-3);
    const longest = Math.max(...f.rest.map((y, i) => fallTime(y + 1 + plan.lift[i], bounceCap(1))));
    expect(plan.end).toBeLessThanOrEqual(SPAN + longest + 1e-3);
    expect(plan.end).toBeGreaterThan(SPAN * 0.9);
  });

  it('is the same play for the same seed, and a different one for the next', () => {
    const f = field([10, 20, 30]);
    const a = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    const b = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    const c = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 1 });
    expect([...a.start]).toEqual([...b.start]);
    expect([...a.lift]).toEqual([...b.lift]);
    expect([...a.start]).not.toEqual([...c.start]);
  });

  it('drops appear from different heights above the plot, none higher than RAIN_LIFT', () => {
    const f = field([200]);
    const plan = rainSchedule(f.rank, f.column, f.rest, 1, { gap: GAP, span: SPAN, seed: 0 });
    expect(Math.max(...plan.lift)).toBeLessThanOrEqual(RAIN_LIFT);
    expect(new Set([...plan.lift].map((v) => Math.round(v))).size).toBeGreaterThan(20);
  });
});

describe('fallAt', () => {
  const cap = bounceCap(1);
  it('falls under gravity: no faster than a free fall, and landing when a free fall would', () => {
    const from = -10, to = 590, d = to - from;
    const land = Math.sqrt((2 * d) / GRAVITY);
    let last = from;
    for (let t = 0; t < land; t += 5) {
      const y = fallAt(t, from, to, cap);
      expect(y).toBeGreaterThanOrEqual(last);
      expect(y).toBeLessThanOrEqual(to);
      last = y;
    }
    expect(fallAt(land, from, to, cap)).toBeCloseTo(to, 6);
  });

  it('a short drop is quick and a long one takes longer, as a fall does', () => {
    expect(fallTime(100, cap)).toBeLessThan(fallTime(600, cap) * 0.5);
  });

  it('bounces once, never higher than the cap and never through the floor, then is still', () => {
    const from = 0, to = 600;
    const land = Math.sqrt((2 * to) / GRAVITY);
    let highest = to;
    for (let t = land; t < land + 400; t += 1) {
      const y = fallAt(t, from, to, cap);
      expect(y).toBeLessThanOrEqual(to + 1e-9);
      highest = Math.min(highest, y);
    }
    expect(to - highest).toBeGreaterThan(0);
    expect(to - highest).toBeLessThanOrEqual(cap + 1e-9);
    expect(fallAt(fallTime(to, cap) + 1, from, to, cap)).toBe(to);
  });

  it('is at its start before it starts, and at rest if it has nowhere to fall', () => {
    expect(fallAt(-5, 3, 90, cap)).toBe(3);
    expect(fallAt(50, 90, 90, cap)).toBe(90);
  });
});

describe('hash01', () => {
  it('stays in [0, 1) and spreads', () => {
    const xs = Array.from({ length: 2000 }, (_, i) => hash01(i, 7));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((t, v) => t + v, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
