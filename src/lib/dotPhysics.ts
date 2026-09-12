/**
 * The landing dots' motion. A click bursts the dots round it outward, behind a shockwave, and a spring
 * brings each back to its place; a drag with the button held stirs them with smaller bursts along its
 * path. A group soloed away falls through the floor, and brought back it rains in from above and
 * bounces into its places. At rest a dot's x is its pay (DotField): only a burst moves it aside, and
 * only for a moment.
 */

/** Gravity, px per ms²: a dot dropped from 60px lands in about 0.2s. */
export const GRAVITY = 0.0025;
/** The share of its speed a landing dot keeps, and the speed under which it rests. */
export const RESTITUTION = 0.35;
export const REST_SPEED = 0.03;

/** The sizes below are for a plot this tall; a field scales them by its own height (`burstSizes`). */
export const BURST_REF_H = 300;
/** How far a click's burst reaches, px, and how fast it throws the dot under it, px/ms — about 45px out. */
export const BURST_R = 90;
export const BURST_SPEED = 0.9;
/** How long the shockwave's front takes to cross the burst's reach, ms; how far its ring grows before
 *  it has faded out, as a multiple of the reach; and how strong the ring starts. */
export const WAVE_MS = 150;
export const RING_REACH = 1.15;
export const RING_ALPHA = 0.55;
/** A second click on dots still flying throws them further, up to this multiple of a click's speed. */
export const CLICK_CAP = 2;
/** A drag with the button held: smaller bursts STIR_STEP px apart along its path, each reaching
 *  STIR_R and parting the dots about 15px — the dots part round the pointer and close behind it. */
export const STIR_R = 36;
export const STIR_SPEED = 0.3;
export const STIR_STEP = 10;

/** The spring home: its natural frequency, per ms, and damping ratio. Under-damped, so a dot passes its
 *  place by a hair and settles back — the entrance's bounce. From a click it is furthest out at about
 *  120ms, back across its place at about 0.5s, and still at about 1.15s. */
export const BURST_OMEGA = 0.009;
export const BURST_ZETA = 0.7;
const ZW = BURST_ZETA * BURST_OMEGA;
const WD = BURST_OMEGA * Math.sqrt(1 - BURST_ZETA * BURST_ZETA);
/** How close to its place a dot is home, px, and how far out it still counts as in the air. */
export const REST_EPS = 0.1;
export const AIR_EPS = 1;
/** How long before it is home a dot comes down out of the air, ms: the envelope's fall from AIR_EPS to
 *  REST_EPS. */
export const AIR_BEFORE_REST = Math.log(AIR_EPS / REST_EPS) / ZW;

/** A burst's and a stir's reach (px) and speed (px/ms) for a field `height` px tall. */
export function burstSizes(height: number) {
  const k = height / BURST_REF_H;
  return { reach: BURST_R * k, speed: BURST_SPEED * k, stirReach: STIR_R * k, stirSpeed: STIR_SPEED * k };
}

/** A dot on the spring home: its offset from its place (px) and its speed (px/ms), each way. */
export interface Pose { ox: number; oy: number; vx: number; vy: number }

/**
 * Where a dot on the spring home is, and how fast it goes, `tau` ms after it was at `ox0, oy0` going
 * `vx0, vy0` — written into `out`. The damped spring's own solution, not a step of it: a burst is a
 * pure function of time, so it looks the same at 60Hz, at 120Hz and on a slow machine, and a tab
 * hidden mid-burst comes back to it finished rather than resuming in slow motion.
 */
export function springPose(ox0: number, oy0: number, vx0: number, vy0: number, tau: number, out: Pose): Pose {
  const e = Math.exp(-ZW * tau);
  const c = Math.cos(WD * tau);
  const s = Math.sin(WD * tau);
  const w2 = BURST_OMEGA * BURST_OMEGA;
  out.ox = e * (ox0 * c + ((vx0 + ZW * ox0) / WD) * s);
  out.oy = e * (oy0 * c + ((vy0 + ZW * oy0) / WD) * s);
  out.vx = e * (vx0 * c - ((ZW * vx0 + w2 * ox0) / WD) * s);
  out.vy = e * (vy0 * c - ((ZW * vy0 + w2 * oy0) / WD) * s);
  return out;
}

/** How long, ms, until a dot that left `ox0, oy0` going `vx0, vy0` stays within `eps` px of its place:
 *  when its motion's envelope has fallen under `eps` (0 if it already has). */
export function springRestAfter(ox0: number, oy0: number, vx0: number, vy0: number, eps = REST_EPS): number {
  const bx = (vx0 + ZW * ox0) / WD;
  const by = (vy0 + ZW * oy0) / WD;
  const amp = Math.sqrt(ox0 * ox0 + bx * bx + oy0 * oy0 + by * by);
  return amp > eps ? Math.log(amp / eps) / ZW : 0;
}

/** A kick: the speed it gives a dot, px/ms each way, and how long after the click it arrives, ms. */
export interface Kick { vx: number; vy: number; delay: number }

/**
 * The kick a burst at `dx, dy` from a dot (the dot's position less the click's) gives it, written into
 * `out`; false beyond `reach`. Outward from the click, strongest there and falling to nothing at the
 * reach as (1 − (d/reach)²)², which keeps a nearer dot inside a farther one so a clean hole opens; a dot
 * dead on the click goes a fixed way of its own. `i` jitters it by up to a quarter either way, fixed for
 * each dot, so a burst reads as a spray. It arrives `wave · d / reach` ms after the click: the
 * shockwave's front (0 for none).
 */
export function burstKick(dx: number, dy: number, i: number, reach: number, speed: number, wave: number, out: Kick): boolean {
  const d = Math.hypot(dx, dy);
  if (!(d < reach)) return false;
  const f = 1 - (d / reach) ** 2;
  const jitter = 0.75 + 0.5 * (((Math.imul(i + 7, 2246822519) >>> 0) % 1000) / 999);
  const m = speed * f * f * jitter;
  let ux: number, uy: number;
  if (d > 1e-6) { ux = dx / d; uy = dy / d; } else {
    const a = (((Math.imul(i + 11, 2654435761) >>> 0) % 6283) / 1000);
    ux = Math.cos(a); uy = Math.sin(a);
  }
  out.vx = ux * m;
  out.vy = uy * m;
  out.delay = wave * (d / reach);
  return true;
}

/** A dot's speed after a kick `kx, ky`: the two added, but never faster than `cap` or than it already
 *  went — so a second click throws further, up to its cap, and a drag that passes the same dots again
 *  and again never throws them further than one stir. Written into `out`. */
export function thrown(vx: number, vy: number, kx: number, ky: number, cap: number, out: { vx: number; vy: number }) {
  const nx = vx + kx, ny = vy + ky;
  const limit = Math.max(Math.hypot(vx, vy), cap);
  const sp = Math.hypot(nx, ny);
  const k = sp > limit ? limit / sp : 1;
  out.vx = nx * k;
  out.vy = ny * k;
  return out;
}

/** The points a drag from `a` to `b` stirs at: every `step` px along it, after `a`, up to `b` — so a
 *  quick drag, whose moves jump further than a step, leaves no gaps. None for a move under a step. */
export function stirPath(ax: number, ay: number, bx: number, by: number, step: number): { x: number; y: number }[] {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.floor(len / step);
  const out: { x: number; y: number }[] = [];
  for (let k = 1; k <= n; k++) {
    const t = (k * step) / len;
    out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
  }
  return out;
}

/**
 * One step of a dot in flight, `dt` ms on: its offset `o` from its resting place (negative is above it)
 * and its speed `v`. Gravity pulls it down; at its resting place it bounces, keeping RESTITUTION of its
 * speed, until it is too slow to — then it rests. Going up it never passes `ceiling` px above its
 * resting place (the top of the canvas). Returns the new offset and speed, and whether it has come to
 * rest.
 */
export function stepFall(o: number, v: number, dt: number, ceiling: number): { o: number; v: number; rest: boolean } {
  v += GRAVITY * dt;
  o += v * dt;
  if (v < 0 && o < -ceiling) { o = -ceiling; v = 0; }
  if (o >= 0 && v > 0) {
    if (v * RESTITUTION < REST_SPEED) return { o: 0, v: 0, rest: true };
    return { o: 0, v: -v * RESTITUTION, rest: false };
  }
  return { o, v, rest: false };
}

/** One step of a dot falling through the floor, `dt` ms on: gravity and no bounce. */
export function stepThrough(o: number, v: number, dt: number): { o: number; v: number } {
  v += GRAVITY * dt;
  return { o: o + v * dt, v };
}
