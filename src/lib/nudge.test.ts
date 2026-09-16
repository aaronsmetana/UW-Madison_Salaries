import { describe, it, expect } from 'vitest';
import { NUDGE_MAX, nudgeApart, type NudgePoint } from './nudge';

const R = 2.5, GAP = 0.8, PITCH = 2 * R + GAP;

/** A seeded crowd: `n` points round (cx, cy), `spread` px either way, and `stack` on one exact spot. */
function crowd(n: number, spread: number, stack = 0, cx = 100, cy = 100): NudgePoint[] {
  let s = 7;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32; };
  const out: NudgePoint[] = [];
  for (let i = 0; i < n; i++) out.push({ x: cx + (rnd() - 0.5) * 2 * spread, y: cy + (rnd() - 0.5) * 2 * spread });
  for (let i = 0; i < stack; i++) out.push({ x: cx, y: cy });
  return out;
}

describe('nudgeApart', () => {
  it('gives every dot its own room where there is room, moving none further than the most allowed', () => {
    // Seven dots fit within 10px of one spot (a hexagon round it); four stacked, among others spread wide.
    const pts = crowd(60, 60, 4);
    const d = nudgeApart(pts, R, NUDGE_MAX, GAP);
    expect(d.crowded).toBe(0);
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(d.xs[i] - pts[i].x, d.ys[i] - pts[i].y)).toBeLessThanOrEqual(NUDGE_MAX + 1e-9);
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(d.xs[i] - d.xs[j], d.ys[i] - d.ys[j]), `dots ${i} and ${j} overlap`).toBeGreaterThanOrEqual(PITCH - 1e-6);
      }
    }
    expect(d.maxShift).toBeGreaterThan(0);
    expect(d.maxShift).toBeLessThanOrEqual(NUDGE_MAX);
  });
  it('leaves a dot that is already clear exactly where its values put it', () => {
    const pts = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 10, y: 40 }];
    const d = nudgeApart(pts, R);
    expect([...d.xs]).toEqual([10, 40, 10]);
    expect([...d.ys]).toEqual([10, 10, 40]);
    expect(d.maxShift).toBe(0);
  });
  it('owns up to a stack too big for the room: those dots stay on their values and are counted', () => {
    // Four hundred people on one spot cannot fit inside 10px of it.
    const pts = crowd(0, 0, 400);
    const d = nudgeApart(pts, R, NUDGE_MAX, GAP);
    expect(d.crowded).toBeGreaterThan(0);
    let atHome = 0;
    for (let i = 0; i < pts.length; i++) {
      const moved = Math.hypot(d.xs[i] - pts[i].x, d.ys[i] - pts[i].y);
      expect(moved).toBeLessThanOrEqual(NUDGE_MAX + 1e-9);
      if (moved === 0) atHome++;
    }
    // The first on the spot, and every one that found no room.
    expect(atHome).toBe(d.crowded + 1);
  });
  it('never moves a fixed dot, whatever is under it, and places it first', () => {
    const pts: NudgePoint[] = [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50, fixed: true }];
    const d = nudgeApart(pts, R);
    expect([d.xs[2], d.ys[2]]).toEqual([50, 50]);
    expect(Math.hypot(d.xs[0] - 50, d.ys[0] - 50)).toBeGreaterThanOrEqual(PITCH - 1e-6);
    expect(Math.hypot(d.xs[1] - 50, d.ys[1] - 50)).toBeGreaterThanOrEqual(PITCH - 1e-6);
  });
  it("spaces dots of different sizes by their own radii: a big mark's neighbours stand clear of it", () => {
    const pts: NudgePoint[] = [{ x: 50, y: 50, r: 7.5, fixed: true }, ...crowd(0, 0, 6, 50, 50)];
    const d = nudgeApart(pts, R, NUDGE_MAX, GAP);
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(d.xs[i] - 50, d.ys[i] - 50) === 0) continue;
      expect(Math.hypot(d.xs[i] - 50, d.ys[i] - 50), `dot ${i} overlaps the big mark`).toBeGreaterThanOrEqual(7.5 + R + GAP - 1e-6);
    }
  });
  it('keeps nudged dots inside bounds', () => {
    const pts = crowd(0, 0, 12, 20, 5);
    const d = nudgeApart(pts, R, NUDGE_MAX, GAP, { x0: 0, y0: 0, x1: 200, y1: 10 });
    for (let i = 1; i < pts.length; i++) {
      expect(d.ys[i]).toBeGreaterThanOrEqual(0);
      expect(d.ys[i]).toBeLessThanOrEqual(10);
    }
  });
  it('draws the same picture for the same input', () => {
    const pts = crowd(120, 30, 40);
    const a = nudgeApart(pts, R), b = nudgeApart(pts, R);
    expect([...a.xs]).toEqual([...b.xs]);
    expect([...a.ys]).toEqual([...b.ys]);
  });
});
