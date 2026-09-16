import { describe, it, expect } from 'vitest';
import {
  AIR_BEFORE_REST, AIR_EPS, BURST_OMEGA, BURST_R, BURST_SPEED, BURST_SPRING, BURST_ZETA, CLICK_CAP, GRAVITY, REST_EPS,
  RING_ALPHA, RING_ECHO, RING_RIPPLE, RIPPLE_A, RIPPLE_OMEGA, RIPPLE_SPRING, RIPPLE_ZETA, STIR_SPEED, WAVE_MS,
  BLOOM_ALPHA, BLOOM_MS, bloomAt, burstKick, burstSizes, ringAlpha, rippleKick, springPose, springRestAfter, stepFall, stepThrough, stirPath, thrown, type Kick, type Pose, type Spring,
  STIR_DRAG, STIR_FAST, STIR_R, STIR_SLOW, STIR_WAIT, TRAIL_MIN, TRAIL_MS, dragSpeed, fieldScale, stirKick, stirSizes, stirStrength, stirTopUp, trailAt,
} from './dotPhysics';
import { LENS_D } from './fisheye';

/** A dot thrown up at this speed (px/ms) rises about 60px under GRAVITY: the fall's own tests. */
const UP = 0.55;

describe('springPose', () => {
  const pose = (): Pose => ({ ox: 0, oy: 0, vx: 0, vy: 0 });
  const springs: [string, Spring, number, number][] = [['burst', BURST_SPRING, BURST_OMEGA, BURST_ZETA], ['ripple', RIPPLE_SPRING, RIPPLE_OMEGA, RIPPLE_ZETA]];
  for (const [name, k, omega, zeta] of springs) {
    it(`is the ${name}'s spring itself: a fine numerical integration of it agrees to a hundredth of a pixel`, () => {
      // RK4 at 0.1ms on x'' = −ω²x − 2ζωx', from an offset and a speed on each axis.
      const w2 = omega ** 2, c = 2 * zeta * omega;
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
          springPose(k, 12, -30, 0.7, -0.2, step * h, out);
          expect(Math.abs(out.ox - x)).toBeLessThan(0.01);
          expect(Math.abs(out.oy - y)).toBeLessThan(0.01);
          expect(Math.abs(out.vx - v)).toBeLessThan(1e-4);
          expect(Math.abs(out.vy - u)).toBeLessThan(1e-4);
        }
      }
    });
    it(`knows how far the ${name}'s spring swings a dot thrown from rest`, () => {
      const out = pose();
      let peak = 0;
      for (let t = 0; t <= 600; t += 0.25) peak = Math.max(peak, springPose(k, 0, 0, 1, 0, t, out).ox);
      expect(peak).toBeCloseTo(k.reach, 3);
    });
  }
  it('throws a burst dot out past the glass and brings it home without passing its place: furthest at about 120ms, still by 1.2s', () => {
    const out = pose();
    let peak = 0, peakAt = 0, past = 0;
    for (let t = 0; t <= 2000; t++) {
      const o = springPose(BURST_SPRING, 0, 0, BURST_SPEED, 0, t, out).ox;
      if (o > peak) { peak = o; peakAt = t; }
      past = Math.max(past, -o);
      if (t >= 800) expect(Math.abs(o)).toBeLessThan(1);
    }
    // Past the glass's rim (LENS_D / 2), so the hole shows round it.
    expect(peak).toBeGreaterThan(115);
    expect(peak).toBeLessThan(135);
    expect(peak).toBeGreaterThan(LENS_D / 2 + 40);
    expect(peakAt).toBeGreaterThanOrEqual(100);
    expect(peakAt).toBeLessThanOrEqual(140);
    // Home without passing it by more than half a pixel: no knot where the dots from all round meet.
    expect(past).toBeLessThan(0.5);
    const rest = springRestAfter(BURST_SPRING, 0, 0, BURST_SPEED, 0);
    expect(rest).toBeGreaterThan(900);
    expect(rest).toBeLessThan(1200);
    for (let t = rest; t < rest + 3000; t += 7) expect(Math.hypot(springPose(BURST_SPRING, 0, 0, BURST_SPEED, 0, t, out).ox, out.oy)).toBeLessThan(REST_EPS + 1e-9);
  });
  it('rocks a rippled dot out, back past its place and out again before it settles: rings, not one push', () => {
    const out = pose();
    let turns = 0, last = 0, back = 0;
    for (let t = 1; t <= 1500; t++) {
      const o = springPose(RIPPLE_SPRING, 0, 0, 1, 0, t, out).ox;
      if (Math.sign(o) !== Math.sign(last) && Math.abs(o - last) > 0) turns++;
      back = Math.min(back, o);
      last = o;
    }
    expect(turns).toBeGreaterThanOrEqual(3);
    // It swings back past its place by at least a third of its first swing.
    expect(-back).toBeGreaterThan(RIPPLE_SPRING.reach / 3);
    expect(springRestAfter(RIPPLE_SPRING, 0, 0, 1, 0)).toBeLessThan(1000);
  });
  it('comes down out of the air, under a pixel, a fixed time before it is home', () => {
    const out = pose();
    const rest = springRestAfter(BURST_SPRING, 5, -20, 0.4, -0.6);
    const air = rest - AIR_BEFORE_REST;
    expect(air).toBeGreaterThan(0);
    for (let t = air; t < rest + 2000; t += 5) expect(Math.hypot(springPose(BURST_SPRING, 5, -20, 0.4, -0.6, t, out).ox, out.oy)).toBeLessThan(AIR_EPS + 1e-9);
    expect(springRestAfter(BURST_SPRING, 0.01, 0, 0, 0)).toBe(0);
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

describe('rippleKick', () => {
  const k = (): Kick => ({ vx: 0, vy: 0, delay: 0 });
  /** How far the ripple swings a dot at `d` px from the click, at the most. */
  const swing = (d: number) => { const out = k(); rippleKick(d, 0, BURST_R, RIPPLE_A, WAVE_MS, out); return out.vx * RIPPLE_SPRING.reach; };
  it('leaves the dots in the burst to the burst, and rocks every dot past it outward', () => {
    const out = k();
    expect(rippleKick(BURST_R - 1, 0, BURST_R, RIPPLE_A, WAVE_MS, out)).toBe(false);
    expect(rippleKick(-300, 40, BURST_R, RIPPLE_A, WAVE_MS, out)).toBe(true);
    expect(out.vx).toBeLessThan(0);
    expect(out.vy).toBeGreaterThan(0);
  });
  it('swings a dot RIPPLE_A (30px) a quarter-reach past the burst, less its 1/√distance', () => {
    expect(swing(BURST_R * 1.25) * Math.sqrt(1.25)).toBeCloseTo(30, 6);
  });
  it('fades in from nothing at the burst\'s edge, then falls off as 1/√distance across the graph', () => {
    expect(swing(BURST_R)).toBeCloseTo(0, 9);
    expect(swing(BURST_R * 1.25)).toBeCloseTo(RIPPLE_A * Math.sqrt(1 / 1.25), 6);
    expect(swing(BURST_R * 4)).toBeCloseTo(RIPPLE_A / 2, 6);
    expect(swing(1100)).toBeGreaterThan(3);
  });
  it("is the burst's shockwave run on: its front reaches each dot when the burst's would have", () => {
    const out = k();
    for (const d of [BURST_R, 300, 900]) {
      rippleKick(d, 0, BURST_R, RIPPLE_A, WAVE_MS, out);
      expect(out.delay).toBeCloseTo((WAVE_MS * d) / BURST_R, 9);
    }
  });
});

describe('ringAlpha', () => {
  const far = 800;
  it('draws the front from the click, easing through the burst', () => {
    expect(ringAlpha(1, 0, BURST_R, far)).toBeCloseTo(RING_ALPHA, 2);
    expect(ringAlpha(BURST_R * 0.5, 0, BURST_R, far)).toBeLessThan(ringAlpha(1, 0, BURST_R, far));
  });
  it("past the burst draws the ripple's front stronger, growing without a jump, then falling as 1/√distance", () => {
    const wide = 5000;
    const at = (x: number) => ringAlpha(x, 0, BURST_R, wide);
    expect(at(BURST_R + 0.01) / at(BURST_R - 0.01)).toBeCloseTo(1, 2);
    // A quarter-reach on it is RING_RIPPLE / 0.8 = 1.5 times as strong, less its 1/√distance.
    expect(at(BURST_R * 1.25) / at(BURST_R)).toBeCloseTo((RING_RIPPLE / 0.8) * Math.sqrt(1 / 1.25), 6);
    expect(RING_RIPPLE / 0.8).toBeCloseTo(1.5, 9);
    expect(at(BURST_R * 5) / at(BURST_R * 1.25)).toBeCloseTo(0.5, 6);
  });
  it('draws its echoes only past the burst, each fainter than the one before', () => {
    expect(ringAlpha(BURST_R * 0.8, 1, BURST_R, far)).toBe(0);
    expect(ringAlpha(BURST_R * 0.8, 2, BURST_R, far)).toBe(0);
    expect(ringAlpha(400, 1, BURST_R, far) / ringAlpha(400, 0, BURST_R, far)).toBeCloseTo(RING_ECHO, 6);
    expect(ringAlpha(400, 2, BURST_R, far) / ringAlpha(400, 1, BURST_R, far)).toBeCloseTo(RING_ECHO, 6);
  });
  it('fades every ring out before the far corner of the plot, and draws nothing past it', () => {
    expect(ringAlpha(far * 0.95, 0, BURST_R, far)).toBeLessThan(ringAlpha(far * 0.7, 0, BURST_R, far) / 3);
    expect(ringAlpha(far, 0, BURST_R, far)).toBe(0);
    expect(ringAlpha(far + 50, 1, BURST_R, far)).toBe(0);
    expect(ringAlpha(0, 0, BURST_R, far)).toBe(0);
  });
});

describe('burstSizes', () => {
  it("reaches three times the magnifying glass's radius on a 375px plot", () => {
    expect(burstSizes(375).reach).toBe(3 * (LENS_D / 2));
  });
  it('keeps the front at a pace the eye can follow, whatever the reach: about 0.93px/ms', () => {
    expect(BURST_R / WAVE_MS).toBeCloseTo(0.933, 2);
  });
  it("scales with the plot's height: a phone's 275px plot gets 0.733 of a 375px one's", () => {
    const wide = burstSizes(375), phone = burstSizes(275);
    for (const key of ['reach', 'speed', 'ripple', 'stirReach', 'stirSpeed'] as const) expect(phone[key] / wide[key]).toBeCloseTo(275 / 375, 6);
    expect(wide.reach).toBe(BURST_R);
  });
});

describe('fieldScale', () => {
  it('grows a burst and a stir with a taller plot as it shrinks them with a shorter one: full page scales them up', () => {
    expect(fieldScale(375)).toBe(1);
    expect(fieldScale(275)).toBeCloseTo(275 / 375, 12);
    // Full page at 1440x900 (a 719px plot) and at 2560x1440 (1286px).
    for (const h of [719, 1286]) {
      const k = h / 375;
      expect(fieldScale(h)).toBeCloseTo(k, 12);
      const tall = burstSizes(h), home = burstSizes(375);
      for (const key of ['reach', 'speed', 'ripple', 'stirReach', 'stirSpeed'] as const) expect(tall[key] / home[key]).toBeCloseTo(k, 9);
      // A stir reaches k times as far at any strength; a slow one throws k times as hard, a faster one
      // harder still, up to k^(1 + STIR_WAIT) at full strength (the pointer waits longer to pass).
      for (const s of [0, 0.5, 1]) {
        const a = stirSizes(s, h), b = stirSizes(s, 375);
        expect(a.reach / b.reach).toBeCloseTo(k, 9);
        for (const key of ['speed', 'cap'] as const) expect(a[key] / b[key]).toBeCloseTo(k ** (1 + STIR_WAIT * s), 9);
      }
      expect(stirSizes(1, h).speed / stirSizes(1, 375).speed).toBeGreaterThan(k);
    }
  });
  it('throws no harder than its scale on a field at or under 375px, so the graph in its place and on a phone are as they were', () => {
    for (const h of [375, 275, 200]) {
      for (const s of [0, 0.5, 1]) {
        const a = stirSizes(s, h), b = stirSizes(s, 375), k = h / 375;
        for (const key of ['reach', 'speed', 'cap'] as const) expect(a[key] / b[key]).toBeCloseTo(k, 9);
      }
    }
  });
});

describe('stirStrength', () => {
  it('is nothing for a slow drag, everything for a fast one, and grows all the way between', () => {
    expect(stirStrength(0)).toBe(0);
    expect(stirStrength(STIR_SLOW)).toBe(0);
    expect(stirStrength(STIR_FAST)).toBe(1);
    expect(stirStrength(10)).toBe(1);
    let last = 0;
    for (let v = STIR_SLOW + 0.05; v <= STIR_FAST; v += 0.05) {
      const s = stirStrength(v);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
  });
  it('already shows at a brisk 1px/ms', () => {
    expect(stirStrength(1)).toBeGreaterThan(0.4);
  });
});

describe('stirSizes', () => {
  it("is a slow drag's stir, as it always was, at strength 0", () => {
    expect(stirSizes(0, 375)).toEqual({ reach: STIR_R, speed: STIR_SPEED, cap: STIR_SPEED });
    const slow = burstSizes(275);
    expect(stirSizes(0, 275).reach).toBeCloseTo(slow.stirReach, 12);
    expect(stirSizes(0, 275).speed).toBeCloseTo(slow.stirSpeed, 12);
  });
  it('at its fastest reaches three times as far and parts the dots about 60px, still under half a click', () => {
    const fast = stirSizes(1, 375);
    expect(fast.reach).toBeCloseTo(3 * STIR_R, 9);
    expect(fast.speed * BURST_SPRING.reach).toBeGreaterThan(50);
    expect(fast.speed * BURST_SPRING.reach).toBeLessThan(70);
    expect(fast.reach).toBeLessThan(BURST_R / 1.9);
    expect(fast.speed).toBeLessThan(BURST_SPEED / 2);
    expect(fast.cap).toBeCloseTo(fast.speed * (1 + STIR_DRAG), 12);
  });
  it('grows with strength, every size', () => {
    let last = stirSizes(0, 375);
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      const now = stirSizes(s, 375);
      expect(now.reach).toBeGreaterThan(last.reach);
      expect(now.speed).toBeGreaterThan(last.speed);
      expect(now.cap).toBeGreaterThan(last.cap);
      last = now;
    }
  });
});

describe('dragSpeed', () => {
  it("follows a steady drag to its own speed within a few moves, and ignores a move with no time", () => {
    let v = 0;
    for (let k = 0; k < 12; k++) v = dragSpeed(v, 48, 16);
    expect(v).toBeCloseTo(3, 1);
    expect(dragSpeed(1.2, 30, 0)).toBe(1.2);
    // One 16ms move eases a third of the way.
    expect(dragSpeed(0, 48, 16)).toBeCloseTo(3 * (1 - Math.exp(-16 / 40)), 9);
  });
  it('slows as the drag does', () => {
    let v = 3;
    for (let k = 0; k < 12; k++) v = dragSpeed(v, 2, 16);
    expect(v).toBeLessThan(STIR_SLOW);
  });
});

describe('stirKick', () => {
  const at = (dx: number, dy: number, s: number, ux = 1, uy = 0, i = 4) => {
    const out: Kick = { vx: 0, vy: 0, delay: -1 };
    return stirKick(dx, dy, i, 100, 1, s, ux, uy, out) ? out : null;
  };
  it("is a burst's kick with no shockwave at strength 0", () => {
    const b: Kick = { vx: 0, vy: 0, delay: 0 };
    burstKick(30, -20, 4, 100, 1, 0, b);
    expect(at(30, -20, 0)).toEqual(b);
    expect(at(120, 0, 1)).toBeNull();
  });
  it('turns a fast drag\'s kick square off the stroke, each dot away on its own side, and carries it on a little', () => {
    // A dot ahead of the pointer and just above a rightward stroke: a slow stir pushes it on ahead; a fast
    // one mostly up and away, and a little along.
    const slow = at(20, -6, 0)!, fast = at(20, -6, 1)!;
    expect(Math.abs(slow.vx)).toBeGreaterThan(Math.abs(slow.vy));
    expect(Math.abs(fast.vy)).toBeGreaterThan(Math.abs(fast.vx) * 0.9);
    expect(fast.vy).toBeLessThan(0);
    expect(at(20, 6, 1)!.vy).toBeGreaterThan(0);
    // Behind the pointer a fast drag still carries the dot forward, not back.
    expect(at(-20, -6, 1)!.vx).toBeGreaterThan(at(-20, -6, 0)!.vx);
    // As fast as the burst's own kick, plus the push along.
    const b: Kick = { vx: 0, vy: 0, delay: 0 };
    burstKick(20, -6, 4, 100, 1, 0, b);
    expect(Math.hypot(fast.vx, fast.vy)).toBeGreaterThan(Math.hypot(b.vx, b.vy));
    expect(Math.hypot(fast.vx, fast.vy)).toBeLessThanOrEqual(Math.hypot(b.vx, b.vy) * (1 + STIR_DRAG) + 1e-9);
  });
  it('sends a dot dead on the line a fixed way of its own, whatever the stroke', () => {
    const a = at(15, 0, 1, 1, 0, 2)!, b = at(15, 0, 1, 1, 0, 3)!;
    expect(Math.sign(a.vy)).toBe(-Math.sign(b.vy));
    expect(at(15, 0, 1, 1, 0, 2)).toEqual(a);
  });
});

describe('stirTopUp', () => {
  const kick = (vx: number, vy: number): Kick => ({ vx, vy, delay: 0 });
  it('gives a dot at rest the whole kick', () => {
    const k = kick(0.6, -0.8);
    expect(stirTopUp(0, 0, 0, 0, k)).toBe(true);
    expect(k).toEqual(kick(0.6, -0.8));
  });
  it('gives nothing to a dot already going out as fast, or already as far out as the kick would send it', () => {
    expect(stirTopUp(0, 0, 0.6, -0.8, kick(0.6, -0.8))).toBe(false);
    expect(stirTopUp(0.6 * BURST_SPRING.reach, -0.8 * BURST_SPRING.reach, 0, 0, kick(0.6, -0.8))).toBe(false);
  });
  it('tops a dot part-way out up to the swing, and only that', () => {
    const k = kick(1, 0);
    expect(stirTopUp(0.5 * BURST_SPRING.reach, 0, 0.25, 0, k)).toBe(true);
    expect(k.vx).toBeCloseTo(0.25, 9);
    expect(k.vy).toBe(0);
  });
  it('never gives more than the kick, even to a dot coming home from the other way', () => {
    const k = kick(1, 0);
    expect(stirTopUp(-40, 0, -1, 0, k)).toBe(true);
    expect(k.vx).toBeCloseTo(1, 9);
  });
  it("keeps a drag's repeated kicks to the swing of one: a dot kicked every 16ms goes no further", () => {
    // A dot kicked as the pointer passes it, move after move, stepped by the spring's own solution.
    const one = 1.35;
    let bx = 0, by = 0, bvx = 0, bvy = 0, t0 = 0, most = 0;
    const p: Pose = { ox: 0, oy: 0, vx: 0, vy: 0 };
    for (let t = 0; t <= 1200; t += 4) {
      springPose(BURST_SPRING, bx, by, bvx, bvy, t - t0, p);
      most = Math.max(most, Math.hypot(p.ox, p.oy));
      if (t % 16 === 0 && t <= 96) {
        const k = kick(0, -one);
        if (stirTopUp(p.ox, p.oy, p.vx, p.vy, k)) {
          const v = thrown(p.vx, p.vy, k.vx, k.vy, one, { vx: 0, vy: 0 });
          bx = p.ox; by = p.oy; bvx = v.vx; bvy = v.vy; t0 = t;
        }
      }
    }
    expect(most).toBeLessThan(one * BURST_SPRING.reach * 1.1);
    expect(most).toBeGreaterThan(one * BURST_SPRING.reach * 0.9);
  });
});

describe('trailAt', () => {
  it('draws nothing for a slow stir, or once faded', () => {
    expect(trailAt(0, TRAIL_MIN - 0.01)).toBeNull();
    // A leisurely 0.4px/ms drag leaves no wake at all, whatever the threshold is called.
    expect(trailAt(0, stirStrength(0.4))).toBeNull();
    expect(trailAt(0, stirStrength(1))).not.toBeNull();
    expect(trailAt(TRAIL_MS, 1)).toBeNull();
    expect(trailAt(-1, 1)).toBeNull();
  });
  it('fades as it ages and draws wider and stronger for a faster stir', () => {
    expect(trailAt(0, 1)!.alpha).toBeGreaterThan(trailAt(100, 1)!.alpha);
    expect(trailAt(100, 1)!.alpha).toBeGreaterThan(trailAt(250, 1)!.alpha);
    expect(trailAt(50, 1)!.alpha).toBeGreaterThan(trailAt(50, 0.5)!.alpha);
    expect(trailAt(50, 1)!.w).toBeGreaterThan(trailAt(50, 0.5)!.w);
    expect(trailAt(0, TRAIL_MIN)!.alpha).toBe(0);
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

describe('bloomAt', () => {
  it('swells from a small glow to half the reach, easing out, and fades to nothing by BLOOM_MS', () => {
    const at = (t: number) => bloomAt(t, BURST_R)!;
    expect(at(0).rad).toBeCloseTo(0.15 * BURST_R, 9);
    expect(at(0).alpha).toBeCloseTo(BLOOM_ALPHA, 9);
    expect(at(BLOOM_MS / 2).rad).toBeGreaterThan(0.35 * BURST_R);
    for (let t = 10; t < BLOOM_MS; t += 10) {
      expect(at(t).rad).toBeGreaterThan(at(t - 10).rad);
      expect(at(t).alpha).toBeLessThan(at(t - 10).alpha);
      expect(at(t).rad).toBeLessThanOrEqual(0.5 * BURST_R + 1e-9);
    }
    expect(bloomAt(BLOOM_MS, BURST_R)).toBeNull();
    expect(bloomAt(-1, BURST_R)).toBeNull();
  });
});
