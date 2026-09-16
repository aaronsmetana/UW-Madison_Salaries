import { LENS_D } from './fisheye';

/**
 * The landing dots' motion. A click bursts the dots round it outward, behind a shockwave, and a spring
 * brings each back to its place; past the burst the shockwave runs on as a ripple across the rest of the
 * graph; a drag with the button held parts the dots in a wake behind it. A group soloed away falls through the floor, and brought back it rains in from above and
 * bounces into its places. At rest a dot's x is its pay (DotField): only a burst moves it aside, and
 * only for a moment.
 */

/** Gravity, px per ms²: a dot dropped from 60px lands in about 0.2s. */
export const GRAVITY = 0.0025;
/** The share of its speed a landing dot keeps, and the speed under which it rests. */
export const RESTITUTION = 0.35;
export const REST_SPEED = 0.03;

/** The sizes below are for a plot this tall; a field scales them by its own height (`burstSizes`). */
export const BURST_REF_H = 375;
/** How far a click's burst reaches on that plot, px: three times the magnifying glass's radius, so it spreads well
 *  past the glass that sits on the click. And how fast it throws the dot under it, px/ms: about 125px
 *  out, so the hole itself shows wide round the glass. */
export const BURST_R = 1.5 * LENS_D;
export const BURST_SPEED = 2.88;
/** How long the shockwave's front takes to cross the burst's reach, ms — about 0.93px/ms, a pace the eye
 *  can follow as it runs on across the whole graph — and how strong its ring starts. */
export const WAVE_MS = 225;
export const RING_ALPHA = 0.55;
/** The front's ring and its echoes, a ripple's period apart — each this share of the one before — and
 *  how much stronger the rings draw once past the burst, where they are the ripple. */
export const RING_ECHOES = 3;
export const RING_ECHO = 0.55;
export const RING_RIPPLE = 1.2;
/** A second click on dots still flying throws them further, up to this multiple of a click's speed. */
export const CLICK_CAP = 2;
/** A drag with the button held stirs the dots as a wake (`stirKick`): at the pointer and every STIR_STEP
 *  px along its path, the dots behind it — within STIR_R back — part square off the stroke about 15px,
 *  and close up again further back. That is a slow drag's stir; a faster one reaches further and throws
 *  harder (`stirSizes`). */
export const STIR_R = 36;
export const STIR_SPEED = 0.3;
export const STIR_STEP = 10;
/** The wake's wedge: its tip is the pointer, this share of the stir's reach wide each side there, and its
 *  sides open this many px each side for each px back — a V behind the pointer, so a dot beside its path
 *  parts a moment after the pointer passes it, the further out the later. Nothing ahead of the pointer
 *  moves. */
export const WAKE_TIP = 0.1;
export const WAKE_SPREAD = 0.75;
/** How far along its path a drag's direction takes to turn to a new one, px: a mouse's one-pixel steps
 *  go only eight ways, and the wake would swing with each. */
export const WAKE_TURN_PX = 8;
/** A drag's speed, px/ms, at and under which it stirs as gently as a slow drag always has, and at and
 *  over which it stirs its hardest: STIR_REACH_MAX times as far and STIR_SPEED_MAX times as hard — about
 *  110px and a 60px parting, half a click's burst. */
export const STIR_SLOW = 0.25;
export const STIR_FAST = 3;
export const STIR_REACH_MAX = 3;
export const STIR_SPEED_MAX = 4.5;
/** At its hardest, how much of a stir's kick pushes the dots on along the stroke. */
export const STIR_DRAG = 0.25;
/** How quickly a drag's measured speed follows its moves, ms: long enough to smooth one move's jitter,
 *  short enough that a flick is felt within a few frames. */
export const STIR_SMOOTH_MS = 40;
/** On a field taller than BURST_REF_H, how much harder a stir throws beyond its scale `k`: k to this
 *  power, times its strength. The hand moves as fast full page, so the pointer takes k times as long to
 *  cross the wake's reach, and the dots on its line (parted first) are on their way home before the wake
 *  widens to the dots further out (the spring's time does not scale). Measured full page at 1280x720,
 *  1440x900 and 2560x1440 (k 1.44, 1.92, 3.43): scaled by k alone a 3px/ms drag parted the dots 0.97,
 *  0.89 and 0.92 of k as wide as in place, a 1px/ms drag 0.93-0.99; with this, 0.98-1.04 and 1.00-1.03. */
export const STIR_WAIT = 0.25;

/** Past the burst's reach, a ripple: the dots rocked out from the click and back, a time or two, as
 *  the shockwave's front passes them, so rings of bunched-up dots run on across the graph. Its swing
 *  where it leaves the burst, px — fading in over the burst's last quarter-reach, then falling off as
 *  1/√distance, as a ripple on water does. */
export const RIPPLE_A = 30;

/** A spring home: its damping per ms (ζω), its damped frequency (ω_d), ω², and how far a dot it holds
 *  swings at the most per px/ms it was thrown from rest (so a swing can be asked for in px). */
export interface Spring { zw: number; wd: number; w2: number; reach: number }
function spring(omega: number, zeta: number): Spring {
  const zw = zeta * omega, wd = omega * Math.sqrt(1 - zeta * zeta);
  const t = Math.atan2(wd, zw) / wd;
  return { zw, wd, w2: omega * omega, reach: (Math.exp(-zw * t) * Math.sin(wd * t)) / wd };
}
/** The burst's spring: all but critically damped, so a dot comes home without passing its place — the
 *  dots from all round a click, overshooting, met in a dark knot at its centre. From a click a dot is
 *  furthest out at about 120ms and still by about 1.1s. */
export const BURST_OMEGA = 0.009;
export const BURST_ZETA = 0.9;
export const BURST_SPRING = spring(BURST_OMEGA, BURST_ZETA);
/** The ripple's: a 180ms swing, lightly damped, so a dot goes out, back past its place and out again
 *  before it settles — rings, not a single push. */
export const RIPPLE_OMEGA = (2 * Math.PI) / 180;
export const RIPPLE_ZETA = 0.2;
export const RIPPLE_SPRING = spring(RIPPLE_OMEGA, RIPPLE_ZETA);
/** The time between a rippled dot's outward swings, ms: how far apart, in time, the rings run. */
export const RIPPLE_PERIOD = (2 * Math.PI) / RIPPLE_SPRING.wd;
/** How close to its place a dot is home, px, and how far out it still counts as in the air. */
export const REST_EPS = 0.1;
export const AIR_EPS = 1;
/** How long before it is home a burst's dot comes down out of the air, ms: its envelope's fall from
 *  AIR_EPS to REST_EPS. */
export const AIR_BEFORE_REST = Math.log(AIR_EPS / REST_EPS) / BURST_SPRING.zw;

/** A field's scale for its bursts: its height over BURST_REF_H, taller or shorter. Full page, where the
 *  graph is 1.9 times as tall on a 1440x900 screen and 3.4 times at 2560x1440, a click bursts and a drag
 *  parts the dots that many times as far — the same share of the graph as in its place — while the
 *  glass stays its size. (Held at 1 there once, a burst looked small on the big graph.) */
export function fieldScale(height: number): number {
  return height / BURST_REF_H;
}

/** A burst's, its ripple's and a slow stir's reach (px), speed (px/ms) and swing (px) for a field
 *  `height` px tall. */
export function burstSizes(height: number) {
  const k = fieldScale(height);
  return { reach: BURST_R * k, speed: BURST_SPEED * k, ripple: RIPPLE_A * k, stirReach: STIR_R * k, stirSpeed: STIR_SPEED * k };
}

/** How hard a drag going `v` px/ms stirs: 0 at STIR_SLOW and under, 1 at STIR_FAST and over, easing out
 *  between, so a brisk drag already shows. */
export function stirStrength(v: number): number {
  const s = Math.min(1, Math.max(0, (v - STIR_SLOW) / (STIR_FAST - STIR_SLOW)));
  return 1 - (1 - s) ** 2;
}

/** A stir of strength `s` (`stirStrength`) on a field `height` px tall: how far it reaches, px, how hard
 *  it throws the dot under the pointer, px/ms, and the most it lets a dot go, px/ms. On a taller field
 *  than BURST_REF_H it throws harder still (STIR_WAIT), so its parting grows with the field as a
 *  click's hole does. */
export function stirSizes(s: number, height: number) {
  const k = fieldScale(height);
  const speed = STIR_SPEED * (1 + (STIR_SPEED_MAX - 1) * s) * k * Math.max(1, k) ** (STIR_WAIT * s);
  return { reach: STIR_R * (1 + (STIR_REACH_MAX - 1) * s) * k, speed, cap: speed * (1 + STIR_DRAG * s) };
}

/** A drag's measured speed, px/ms, after a move of `dist` px over `dt` ms, from `prev`: eased toward the
 *  move's own speed over STIR_SMOOTH_MS. */
export function dragSpeed(prev: number, dist: number, dt: number): number {
  if (!(dt > 0)) return prev;
  return prev + (dist / dt - prev) * (1 - Math.exp(-dt / STIR_SMOOTH_MS));
}

/** A dot on the spring home: its offset from its place (px) and its speed (px/ms), each way. */
export interface Pose { ox: number; oy: number; vx: number; vy: number }

/**
 * Where a dot on spring `k` is, and how fast it goes, `tau` ms after it was at `ox0, oy0` going
 * `vx0, vy0` — written into `out`. The damped spring's own solution, not a step of it: a burst is a
 * pure function of time, so it looks the same at 60Hz, at 120Hz and on a slow machine, and a tab
 * hidden mid-burst comes back to it finished rather than resuming in slow motion.
 */
export function springPose(k: Spring, ox0: number, oy0: number, vx0: number, vy0: number, tau: number, out: Pose): Pose {
  const e = Math.exp(-k.zw * tau);
  const c = Math.cos(k.wd * tau);
  const s = Math.sin(k.wd * tau);
  out.ox = e * (ox0 * c + ((vx0 + k.zw * ox0) / k.wd) * s);
  out.oy = e * (oy0 * c + ((vy0 + k.zw * oy0) / k.wd) * s);
  out.vx = e * (vx0 * c - ((k.zw * vx0 + k.w2 * ox0) / k.wd) * s);
  out.vy = e * (vy0 * c - ((k.zw * vy0 + k.w2 * oy0) / k.wd) * s);
  return out;
}

/** How long, ms, until a dot on spring `k` that left `ox0, oy0` going `vx0, vy0` stays within `eps` px
 *  of its place: when its motion's envelope has fallen under `eps` (0 if it already has). */
export function springRestAfter(k: Spring, ox0: number, oy0: number, vx0: number, vy0: number, eps = REST_EPS): number {
  const bx = (vx0 + k.zw * ox0) / k.wd;
  const by = (vy0 + k.zw * oy0) / k.wd;
  const amp = Math.sqrt(ox0 * ox0 + bx * bx + oy0 * oy0 + by * by);
  return amp > eps ? Math.log(amp / eps) / k.zw : 0;
}

/** A kick: the speed it gives a dot, px/ms each way, and how long after the click it arrives, ms. */
export interface Kick { vx: number; vy: number; delay: number }

/**
 * The kick a burst at `dx, dy` from a dot (the dot's position less the click's) gives it, written into
 * `out`; false beyond `reach`. Outward from the click, strongest there and falling to nothing at the
 * reach as (1 − (d/reach)²)², so the dots nearest the click go furthest and a clean hole opens, its
 * dots bunched into a ring round it; a dot dead on the click goes a fixed way of its own. `i` jitters it by up to a quarter either way, fixed for
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

/**
 * The kick a stir of strength `s` at the pointer gives a dot `dx, dy` from it (the dot's position less the
 * pointer's), the drag going the unit way `ux, uy`, written into `out`; false outside its wake. The wake
 * is a wedge behind the pointer (WAKE_TIP, WAKE_SPREAD) out to `reach` back: a dot ahead of the pointer,
 * or beside it further out than the wedge is wide there, is not touched. One inside goes square off the
 * stroke, away from it on its own side (a dot on the line goes a fixed way of its own), hardest on the
 * line and not at all at the wedge's side, and pushed on a little along it — the dots part to either side behind a
 * drag, as water does behind a hand, and are carried a little with it. `i` jitters it as a burst does.
 */
export function stirKick(dx: number, dy: number, i: number, reach: number, speed: number, s: number, ux: number, uy: number, out: Kick): boolean {
  const back = -(dx * ux + dy * uy);
  if (!(back >= 0) || !(back < reach)) return false;
  const across = ux * dy - uy * dx;
  const half = reach * WAKE_TIP + back * WAKE_SPREAD;
  const a = Math.abs(across);
  if (!(a < half)) return false;
  const f = 1 - (a / half) ** 2;
  const jitter = 0.75 + 0.5 * (((Math.imul(i + 7, 2246822519) >>> 0) % 1000) / 999);
  const m = speed * f * jitter;
  const side = across > 0 ? 1 : across < 0 ? -1 : (i & 1 ? 1 : -1);
  out.vx = (-uy * side + ux * STIR_DRAG * s) * m;
  out.vy = (ux * side + uy * STIR_DRAG * s) * m;
  out.delay = 0;
  return true;
}

/** How far from the pointer a stir reaching `reach` can touch a dot, px: its wedge's far corners. */
export function wakeExtent(reach: number): number {
  return reach * Math.hypot(1, WAKE_TIP + WAKE_SPREAD);
}

/** A drag's direction, eased from `ux, uy` (0, 0 before it has one) toward a move `mx, my` px, over
 *  WAKE_TURN_PX of path; the unit way it now goes, written into `out`. Unchanged for a move of nothing. */
export function wakeTurn(ux: number, uy: number, mx: number, my: number, out: { ux: number; uy: number }) {
  const len = Math.hypot(mx, my);
  if (!(len > 0)) { out.ux = ux; out.uy = uy; return out; }
  const keep = Math.exp(-len / WAKE_TURN_PX);
  const x = ux * keep + (mx / len) * (1 - keep), y = uy * keep + (my / len) * (1 - keep);
  const l = Math.hypot(x, y);
  if (l > 1e-9) { out.ux = x / l; out.uy = y / l; } else { out.ux = mx / len; out.uy = my / len; }
  return out;
}

/**
 * A stir's kick `out` on a dot already on the burst spring, `ox, oy` px from its place going `vx, vy`
 * px/ms: cut to what brings the dot's swing, along the kick, out to the swing the kick gives from rest
 * and no further — false when it is already on its way there. A drag keeps a dot in its reach for
 * several moves; a whole kick every move kept it going out at full speed, and a fast drag threw dots
 * 140px, further than a click. Where the dot will swing to is read as its offset plus its speed times
 * the spring's reach (`Spring.reach`), which is exact from rest and near it otherwise.
 */
export function stirTopUp(ox: number, oy: number, vx: number, vy: number, out: Kick): boolean {
  const km = Math.hypot(out.vx, out.vy);
  if (!(km > 0)) return false;
  const ux = out.vx / km, uy = out.vy / km;
  const add = Math.min(km, km - (ox * ux + oy * uy) / BURST_SPRING.reach - (vx * ux + vy * uy));
  if (!(add > 1e-6)) return false;
  out.vx = ux * add;
  out.vy = uy * add;
  return true;
}

/**
 * The ripple a burst at `dx, dy` from a dot sends it, written into `out`; false inside the burst's
 * `reach`, where the burst itself throws the dot. Outward from the click, swinging the dot `amp` px where
 * it leaves the burst — nothing at the reach itself, all of it a quarter-reach on — then less as
 * 1/√distance; arriving `wave · d / reach` ms after the click, the burst's own front run on.
 */
export function rippleKick(dx: number, dy: number, reach: number, amp: number, wave: number, out: Kick): boolean {
  const d = Math.hypot(dx, dy);
  if (!(d >= reach) || !(reach > 0)) return false;
  const s = Math.min(1, (d - reach) / (0.25 * reach));
  const swing = amp * s * s * (3 - 2 * s) * Math.sqrt(reach / d);
  const sp = swing / RIPPLE_SPRING.reach;
  out.vx = (dx / d) * sp;
  out.vy = (dy / d) * sp;
  out.delay = wave * (d / reach);
  return true;
}

/**
 * How strong ring `k` of a shockwave draws at `rad` px from its click (0 the front, then its echoes, a
 * ripple's period behind): the front from RING_ALPHA at the click, easing through the burst; past the
 * burst's `reach` — the ripple — the front growing to RING_RIPPLE over the burst's next quarter-reach
 * and the echoes fading in there from nothing, each a RING_ECHO of the one before, all falling off as
 * 1/√distance; and all of them fading out before `far`, the furthest corner of the plot from the click.
 * 0 where nothing draws.
 */
export function ringAlpha(rad: number, k: number, reach: number, far: number): number {
  if (!(rad > 0) || !(reach > 0) || rad >= far) return 0;
  const edge = Math.min(1, (far - rad) / (0.2 * far));
  const inner = 0.8;
  if (rad < reach) return k === 0 ? RING_ALPHA * (1 - (1 - inner) * (rad / reach)) * edge : 0;
  const s = Math.min(1, (rad - reach) / (0.25 * reach));
  const ease = s * s * (3 - 2 * s);
  const strength = k === 0 ? inner + (RING_RIPPLE - inner) * ease : RING_RIPPLE * ease;
  return Math.min(0.9, RING_ALPHA * strength * Math.sqrt(reach / rad) * RING_ECHO ** k * edge);
}

/** The bloom at a blast: a soft glow in the accent that swells at the click and fades out over
 *  BLOOM_MS, as the dots burst out of it. */
export const BLOOM_MS = 250;
export const BLOOM_ALPHA = 0.3;

/** The bloom `age` ms after a click whose burst reaches `reach`: its radius, px, and strength; null once
 *  it has faded. It swells quickly to half the reach, easing out, and fades as the square of its life. */
export function bloomAt(age: number, reach: number): { rad: number; alpha: number } | null {
  if (!(age >= 0) || age >= BLOOM_MS) return null;
  const p = age / BLOOM_MS;
  return { rad: reach * (0.15 + 0.35 * (1 - (1 - p) ** 2)), alpha: BLOOM_ALPHA * (1 - p) ** 2 };
}

/** A fast drag's wake: a streak along its path in the accent, fading out over TRAIL_MS — none for a stir
 *  under TRAIL_MIN strength, so a slow drag leaves nothing — at its widest TRAIL_W px, and TRAIL_ALPHA
 *  strong. */
export const TRAIL_MS = 300;
export const TRAIL_MIN = 0.15;
export const TRAIL_W = 8;
export const TRAIL_ALPHA = 0.5;

/** The wake `age` ms after a stir of strength `s` passed: how wide it draws there, px, and how strong;
 *  null where it draws nothing. It fades as the square of its life, narrowing a little as it goes. */
export function trailAt(age: number, s: number): { w: number; alpha: number } | null {
  if (!(age >= 0) || age >= TRAIL_MS || !(s >= TRAIL_MIN)) return null;
  const p = age / TRAIL_MS;
  return { w: (2 + (TRAIL_W - 2) * s) * (1 - 0.4 * p), alpha: TRAIL_ALPHA * ((s - TRAIL_MIN) / (1 - TRAIL_MIN)) * (1 - p) ** 2 };
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
