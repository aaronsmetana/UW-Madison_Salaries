import { describe, it, expect } from 'vitest';
import { splashKick, stepFall, stepThrough, SPLASH_R, SPLASH_SPEED, GRAVITY } from './dotPhysics';

describe('splashKick', () => {
  it('throws the dots nearest the click up hardest, and those at the reach not at all', () => {
    const near = splashKick(0, 1, 3);
    const mid = splashKick(30, 0, 3);
    expect(near).toBeLessThan(0);
    expect(mid).toBeLessThan(0);
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(mid));
    expect(splashKick(SPLASH_R, 0, 3)).toBe(0);
    expect(splashKick(0, -SPLASH_R - 1, 3)).toBe(0);
  });
  it('jitters by a quarter at most, the same way for the same dot', () => {
    for (let i = 0; i < 200; i++) {
      const k = -splashKick(0, 0, i);
      expect(k).toBeGreaterThanOrEqual(SPLASH_SPEED * 0.75 - 1e-9);
      expect(k).toBeLessThanOrEqual(SPLASH_SPEED * 1.25 + 1e-9);
      expect(splashKick(0, 0, i)).toBe(splashKick(0, 0, i));
    }
  });
});

describe('stepFall', () => {
  /** Flies a dot from rest with speed v0 until it rests; the path of offsets, and whether it did. */
  const fly = (v0: number, ceiling = Infinity) => {
    let o = 0, v = v0, t = 0;
    const path: number[] = [];
    let bounces = 0;
    while (t < 5000) {
      const s = stepFall(o, v, 16, ceiling);
      if (s.v < 0 && v > 0) bounces++;
      o = s.o; v = s.v; t += 16;
      path.push(o);
      if (s.rest) return { path, rest: true, t, bounces };
    }
    return { path, rest: false, t, bounces };
  };
  it('rises, falls, bounces at its place and comes to rest there', () => {
    const f = fly(-SPLASH_SPEED);
    const top = Math.min(...f.path);
    // About v²/2g up, give or take the step.
    expect(-top).toBeGreaterThan((SPLASH_SPEED ** 2 / (2 * GRAVITY)) * 0.85);
    expect(f.bounces).toBeGreaterThanOrEqual(1);
    expect(f.rest).toBe(true);
    expect(f.t).toBeLessThan(1200);
    expect(f.path[f.path.length - 1]).toBe(0);
    // Never below its place: it bounces there, it does not sink.
    expect(Math.max(...f.path)).toBeLessThanOrEqual(0);
  });
  it('never goes above the ceiling', () => {
    const f = fly(-SPLASH_SPEED * 3, 20);
    expect(Math.min(...f.path)).toBeGreaterThanOrEqual(-20);
    expect(f.rest).toBe(true);
  });
  it('lets a dot fall in from above to its place', () => {
    let o = -200, v = 0, rested = false;
    for (let t = 0; t < 3000 && !rested; t += 16) { const s = stepFall(o, v, 16, 10); o = s.o; v = s.v; rested = s.rest; }
    expect(rested).toBe(true);
    expect(o).toBe(0);
  });
});

describe('stepThrough', () => {
  it('falls, faster and faster, with nothing to stop it', () => {
    let o = 0, v = 0;
    const seen: number[] = [];
    for (let t = 0; t < 400; t += 16) { const s = stepThrough(o, v, 16); o = s.o; v = s.v; seen.push(o); }
    expect(seen.every((x, i) => i === 0 || x > seen[i - 1])).toBe(true);
    expect(o).toBeGreaterThan(150);
  });
});
