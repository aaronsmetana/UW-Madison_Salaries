import { GRAVITY } from './dotPhysics';

/**
 * The landing dots' entrance, as rain: each column of the picture fills from the floor up, a drop at a
 * time, each drop falling under the field's own gravity to its place and settling there.
 *
 * It used to be a metronome. Every column started at once and dot k of any column left at exactly k times
 * the same gap, so the whole field rose as one level line; and every drop took the same 650ms whatever its
 * distance, a short one crawling and a long one hurrying. Here each column starts after a small head start
 * of its own, each drop waits a varied interval for the one beneath it, drops appear from slightly
 * different heights, and a drop's fall takes as long as falling that far takes. What must not change is
 * still true: within a column the pile builds upward, and a taller column takes longer — the one thing
 * about this chart the rain exists to show.
 *
 * Irregular, but seeded: a play of the rain is fixed by its seed, so the first play on a page is the same
 * every time (tests read it), and "Drop again" moves the seed on so a replay never repeats the last.
 */

/** Head starts: each column waits up to this share of the rain's span before its first drop. Small, so a
 *  thin column is still done long before the crowded middle. */
export const RAIN_HEAD = 0.1;
/** A drop's wait for the one beneath it: the mean gap times somewhere in [1 - this, 1 + this]. */
export const RAIN_JITTER = 0.5;
/** How far above the plot's top a drop may appear, px. */
export const RAIN_LIFT = 40;
/** The share of its landing speed a drop keeps on the bounce — before the cap below. */
export const RAIN_BOUNCE = 0.3;

/** A number in [0, 1) from two integers — the same every time (a 32-bit mix, not a random draw). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The highest a drop may bounce back up after landing, px: about a dot's width, never a spring. */
export const bounceCap = (r: number) => Math.max(3, 2 * r);

/**
 * Where a drop is `t` ms after it starts to fall from `from` to its resting place `to` (px down the plot,
 * `to` below `from`): falling under GRAVITY, then one small bounce of at most `cap`, then still.
 */
export function fallAt(t: number, from: number, to: number, cap: number): number {
  const d = to - from;
  if (!(d > 0)) return to;
  if (t <= 0) return from;
  const land = Math.sqrt((2 * d) / GRAVITY);
  if (t < land) return from + 0.5 * GRAVITY * t * t;
  const up = bounceSpeed(d, cap);
  const tb = t - land;
  if (tb >= (2 * up) / GRAVITY) return to;
  return to - (up * tb - 0.5 * GRAVITY * tb * tb);
}

/** How long a fall of `d` px takes, landing and bounce together, ms. */
export function fallTime(d: number, cap: number): number {
  if (!(d > 0)) return 0;
  return Math.sqrt((2 * d) / GRAVITY) + (2 * bounceSpeed(d, cap)) / GRAVITY;
}

/** The speed a drop leaves the ground with on its bounce: RAIN_BOUNCE of its landing speed, held to a
 *  bounce no higher than `cap`. */
function bounceSpeed(d: number, cap: number): number {
  const landing = Math.sqrt(2 * GRAVITY * d);
  const height = Math.min(cap, (RAIN_BOUNCE * landing) ** 2 / (2 * GRAVITY));
  return Math.sqrt(2 * GRAVITY * Math.max(0, height));
}

export interface RainPlan {
  /** When each dot starts to fall, ms after the rain begins. */
  start: Float32Array;
  /** How far above the plot's top each drop appears, px. */
  lift: Float32Array;
  /** When the last drop has landed and settled, ms after the rain begins. */
  end: number;
}

/**
 * Each dot's start and height, and when the rain is over.
 *
 * - `rank` is a dot's place up its column, 0 at the floor; `column` is which column it is in (0-based).
 * - `rest` is where it comes to rest, px down the plot; `r` is the dots' radius.
 * - `gap` is the mean wait between one drop in a column and the next; `span` is the latest any drop may
 *   start. Where the varied waits would run past it, the whole schedule is scaled back to end on it.
 */
export function rainSchedule(
  rank: ArrayLike<number>,
  column: ArrayLike<number>,
  rest: ArrayLike<number>,
  r: number,
  opts: { gap: number; span: number; seed: number },
): RainPlan {
  const n = rank.length;
  const start = new Float32Array(n);
  const lift = new Float32Array(n);
  if (!n) return { start, lift, end: 0 };
  // Each column's dots in rank order: counting sort by column, then by rank within one.
  let columns = 0;
  for (let i = 0; i < n; i++) columns = Math.max(columns, column[i] + 1);
  const count = new Int32Array(columns + 1);
  for (let i = 0; i < n; i++) count[column[i] + 1]++;
  for (let c = 0; c < columns; c++) count[c + 1] += count[c];
  const at = count.slice(0, columns);
  const byColumn = new Int32Array(n);
  for (let i = 0; i < n; i++) byColumn[at[column[i]]++] = i;
  const seed = opts.seed | 0;
  let latest = 0;
  for (let c = 0; c < columns; c++) {
    const list = Array.from(byColumn.subarray(count[c], count[c + 1])).sort((a, b) => rank[a] - rank[b]);
    let t = hash01(c, seed * 2 + 1) * RAIN_HEAD * opts.span;
    list.forEach((i, k) => {
      if (k > 0) t += opts.gap * (1 - RAIN_JITTER + 2 * RAIN_JITTER * hash01(i, seed * 2 + 2));
      start[i] = t;
    });
    latest = Math.max(latest, t);
  }
  if (latest > opts.span) {
    const k = opts.span / latest;
    for (let i = 0; i < n; i++) start[i] *= k;
  }
  const cap = bounceCap(r);
  let end = 0;
  for (let i = 0; i < n; i++) {
    lift[i] = hash01(i, seed * 2 + 3) * RAIN_LIFT;
    end = Math.max(end, start[i] + fallTime(rest[i] + r + lift[i], cap));
  }
  return { start, lift, end };
}
