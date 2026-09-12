/**
 * The landing dots' flight: a splash throws the dots near a click up, and they fall back under gravity
 * and bounce into their places; a group soloed away falls through the floor; brought back, it rains in
 * from above. Everything here is a dot's vertical offset from its resting place and its vertical
 * speed — there is no x in it, because a dot's x is its pay (DotField).
 */

/** Gravity, px per ms²: a dot thrown 60px up is back down in about 0.45s. */
export const GRAVITY = 0.0025;
/** The share of its speed a landing dot keeps, and the speed under which it rests. */
export const RESTITUTION = 0.35;
export const REST_SPEED = 0.03;
/** How far from a click a splash reaches, px, and how fast it throws the dot under it (px/ms, ~60px up). */
export const SPLASH_R = 60;
export const SPLASH_SPEED = 0.55;

/**
 * The upward speed (negative: up) a splash at `dx, dy` from a dot gives it: strongest under the click,
 * falling away to nothing at SPLASH_R. `i` jitters it by up to a quarter either way, fixed for each
 * dot, so a splash reads as a spray rather than a lens.
 */
export function splashKick(dx: number, dy: number, i = 0): number {
  const d = Math.hypot(dx, dy);
  if (d >= SPLASH_R) return 0;
  const f = 1 - (d / SPLASH_R) ** 2;
  const jitter = 0.75 + 0.5 * (((Math.imul(i + 7, 2246822519) >>> 0) % 1000) / 999);
  return -SPLASH_SPEED * f * f * jitter;
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
