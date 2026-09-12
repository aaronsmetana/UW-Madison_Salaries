import { describe, it, expect } from 'vitest';
import {
  AIR_BEFORE_REST, AIR_EPS, BURST_OMEGA, BURST_R, BURST_SPEED, BURST_ZETA, CLICK_CAP, GRAVITY, REST_EPS, STIR_SPEED, WAVE_MS,
  burstKick, burstSizes, springPose, springRestAfter, stepFall, stepThrough, stirPath, thrown, type Kick, type Pose,
} from './dotPhysics';

/** A dot thrown up at this speed (px/ms) rises about 60px under GRAVITY: the fall's own tests. */
const UP = 0.55;

describe('springPose', () => {
  const pose = (): Pose => ({ ox: 0, oy: 0, vx: 0, vy: 0 });
  it('is the spring itself: a fine numerical integration of it agrees to a hundredth of a pixel', () => {
    // RK4 at 0.1ms on x'' = −ω²x − 2ζωx', from an offset and a speed on each axis.
    const w2 = BURST_OMEGA ** 2, c = 2 * BURST_ZETA * BURST_OMEGA;
    const f = (x: number, v: number) => -w2 * x - c * v;
    let x = 12, v = 0.7, y = -30, u = -0.2;
    const out = pose();
    for (let step = 1; step <= 20000; step++) {
      const h = 0.1;
      const rk = (p: number, q: number) => {
        const k1x = q, k1v = f(p, q);
        const k2x = q + (h / 2) * k1v, k2v = f(p + (h / 2) * k1x, q + (h / 2) * k1v);
        const k3x = q + (h / 2) * k2v, k3v = f(p + (h / 2) * k2x, q + (h / 2) * k2v);
        const k4x = q + h * k3v, k4v = f(p + h * k3x, q + h * k3v);
        return [p + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x), q + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)];
      };
      [x, v] = rk(x, v);
      [y, u] = rk(y, u);
      if (step % 500 === 0) {
        springPose(12, -30, 0.7, -0.2, step * h, out);
        expect(Math.abs(out.ox - x)).toBeLessThan(0.01);
        expect(Math.abs(out.oy - y)).toBeLessThan(0.01);
        expect(Math.abs(out.vx - v)).toBeLessThan(1e-4);
        expect(Math.abs(out.vy - u)).toBeLessThan(1e-4);
      }
    }
  });
  it('throws a dot out and brings it home: furthest at about 120ms, a small settle, still by 1.2s', () => {
    const out = pose();
    let peak = 0, peakAt = 0, crossed = 0, settle = 0;
    for (let t = 0; t <= 2000; t++) {
      const o = springPose(0, 0, BURST_SPEED, 0, t, out).ox;
      if (o > peak) { peak = o; peakAt = t; }
      if (!crossed && t > peakAt && o < 0) crossed = t;
      if (crossed) settle = Math.max(settle, -o);
      if (t >= 800) expect(Math.abs(o)).toBeLessThan(1);
    }
    expect(peak).toBeGreaterThan(40);
    expect(peak).toBeLessThan(50);
    expect(peakAt).toBeGreaterThanOrEqual(100);
    expect(peakAt).toBeLessThanOrEqual(140);
    expect(crossed).toBeLessThan(520);
    expect(settle).toBeGreaterThan(0);
    expect(settle).toBeLessThan(0.1 * peak);
    const rest = springRestAfter(0, 0, BURST_SPEED, 0);
    expect(rest).toBeGreaterThan(1000);
    expect(rest).toBeLessThan(1200);
    for (let t = rest; t < rest + 3000; t += 7) expect(Math.hypot(springPose(0, 0, BURST_SPEED, 0, t, out).ox, out.oy)).toBeLessThan(REST_EPS + 1e-9);
  });
  it('comes down out of the air, under a pixel, a fixed time before it is home', () => {
    const out = pose();
    const rest = springRestAfter(5, -20, 0.4, -0.6);
    const air = rest - AIR_BEFORE_REST;
    expect(air).toBeGreaterThan(0);
    for (let t = air; t < rest + 2000; t += 5) expect(Math.hypot(springPose(5, -20, 0.4, -0.6, t, out).ox, out.oy)).toBeLessThan(AIR_EPS + 1e-9);
    expect(springRestAfter(0.01, 0, 0, 0)).toBe(0);
  });
});

describe('burstKick', () => {
  const k = (): Kick => ({ vx: 0, vy: 0, delay: 0 });
  it('throws each dot outward from the click, hardest nearest it, not at all at the reach', () => {
    const a = k(), b = k(), c = k();
    expect(burstKick(10, -4, 3, BURST_R, BURST_SPEED, WAVE_MS, a)).toBe(true);
    expect(a.vx).toBeGreaterThan(0);
    expect(a.vy).toBeLessThan(0);
    expect(burstKick(-40, 0, 3, BURST_R, BURST_SPEED, WAVE_MS, b)).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(Math.abs(b.vy)).toBeLessThan(1e-12);
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(Math.hypot(b.vx, b.vy));
    expect(burstKick(BURST_R, 0, 3, BURST_R, BURST_SPEED, WAVE_MS, c)).toBe(false);
    expect(burstKick(0, -BURST_R - 1, 3, BURST_R, BURST_SPEED, WAVE_MS, c)).toBe(false);
  });
  it('keeps the ring in order: a nearer dot never passes a farther one', () => {
    // At the burst's furthest, a dot at d is at d + its throw's reach; that grows with d.
    const out = k();
    let last = -Infinity;
    for (let d = 0.5; d < BURST_R; d += 0.5) {
      burstKick(d, 0, 0, BURST_R, BURST_SPEED, WAVE_MS, out);
      const at = d + out.vx * 50.9;
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });
  it('throws a dot dead on the click too, the same way every time', () => {
    const a = k(), b = k();
    expect(burstKick(0, 0, 17, BURST_R, BURST_SPEED, WAVE_MS, a)).toBe(true);
    burstKick(0, 0, 17, BURST_R, BURST_SPEED, WAVE_MS, b);
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(BURST_SPEED * 0.7);
    expect([a.vx, a.vy]).toEqual([b.vx, b.vy]);
  });
  it('jitters by a quarter at most, the same way for the same dot', () => {
    const out = k();
    for (let i = 0; i < 200; i++) {
      burstKick(0.001, 0, i, BURST_R, BURST_SPEED, WAVE_MS, out);
      const sp = Math.hypot(out.vx, out.vy);
      expect(sp).toBeGreaterThanOrEqual(BURST_SPEED * 0.75 - 1e-6);
      expect(sp).toBeLessThanOrEqual(BURST_SPEED * 1.25 + 1e-6);
    }
  });
  it('arrives later the further out the dot: the shockwave crosses the reach in WAVE_MS', () => {
    const out = k();
    let last = -1;
    for (let d = 0; d < BURST_R; d += 5) {
      burstKick(d, 0, 1, BURST_R, BURST_SPEED, WAVE_MS, out);
      expect(out.delay).toBeGreaterThan(last);
      expect(out.delay).toBeLessThan(WAVE_MS);
      last = out.delay;
    }
    burstKick(20, 0, 1, BURST_R, BURST_SPEED, 0, out);
    expect(out.delay).toBe(0);
  });
});

describe('burstSizes', () => {
  it("scales with the plot's height: a phone's 220px plot gets 0.733 of a 300px one's", () => {
    const wide = burstSizes(300), phone = burstSizes(220);
    for (const key of ['reach', 'speed', 'stirReach', 'stirSpeed'] as const) expect(phone[key] / wide[key]).toBeCloseTo(220 / 300, 6);
    expect(wide.reach).toBe(BURST_R);
  });
});

describe('thrown', () => {
  it('lets a drag passing the same dots again and again throw them no further than one stir', () => {
    let v = { vx: 0, vy: 0 };
    for (let n = 0; n < 30; n++) v = thrown(v.vx, v.vy, 0.2, -0.1, STIR_SPEED, { vx: 0, vy: 0 });
    expect(Math.hypot(v.vx, v.vy)).toBeLessThanOrEqual(STIR_SPEED + 1e-12);
  });
  it('lets a second click throw further, up to its cap, and never slows a dot', () => {
    const cap = CLICK_CAP * BURST_SPEED;
    const once = thrown(0, 0, BURST_SPEED, 0, cap, { vx: 0, vy: 0 });
    const twice = thrown(once.vx, once.vy, BURST_SPEED, 0, cap, { vx: 0, vy: 0 });
    const thrice = thrown(twice.vx, twice.vy, BURST_SPEED, 0, cap, { vx: 0, vy: 0 });
    expect(twice.vx).toBeCloseTo(2 * BURST_SPEED, 9);
    expect(thrice.vx).toBeCloseTo(cap, 9);
    // A stir on a dot a click threw leaves it as fast as it was.
    const stirred = thrown(twice.vx, 0, STIR_SPEED, 0, STIR_SPEED, { vx: 0, vy: 0 });
    expect(stirred.vx).toBeCloseTo(twice.vx, 9);
  });
});

describe('stirPath', () => {
  it('stirs every step along the drag, in order, on its line, and nowhere for a short move', () => {
    const pts = stirPath(10, 20, 110, 20 + 0.5 * 100, 10);
    const len = Math.hypot(100, 50);
    expect(pts).toHaveLength(Math.floor(len / 10));
    pts.forEach((p, k) => {
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo((k + 1) * 10, 9);
      expect(p.y - 20).toBeCloseTo((p.x - 10) * 0.5, 9);
    });
    expect(stirPath(0, 0, 6, 7, 10)).toEqual([]);
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
    const f = fly(-UP);
    const top = Math.min(...f.path);
    // About v²/2g up, give or take the step.
    expect(-top).toBeGreaterThan((UP ** 2 / (2 * GRAVITY)) * 0.85);
    expect(f.bounces).toBeGreaterThanOrEqual(1);
    expect(f.rest).toBe(true);
    expect(f.t).toBeLessThan(1200);
    expect(f.path[f.path.length - 1]).toBe(0);
    // Never below its place: it bounces there, it does not sink.
    expect(Math.max(...f.path)).toBeLessThanOrEqual(0);
  });
  it('never goes above the ceiling', () => {
    const f = fly(-UP * 3, 20);
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
