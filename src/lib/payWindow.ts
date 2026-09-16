import { niceStep } from './rangeScale';

/**
 * The pay a title's charts zoom to: where the middle 90% of its people are paid, when a few people far
 * out would otherwise squeeze everyone else into a sliver of the axis.
 *
 * Research Associate is the case that asked for it: 653 people, paid $495 to $133,676, with half of
 * them between $60k and $65k and 90% between $52k and $72k — 15% of the axis. The strip drew one spike
 * and two long flat tails, and the tenure scatter one thick line. Zoomed to the middle 90%, the people
 * outside it are not dropped: the strip piles them at each end, the scatter pins them to its edges, and
 * both say how many there are.
 *
 * Only where it helps: a title of at least WINDOW_MIN_PEOPLE (below that a 5th percentile is one or two
 * people, and nothing is squeezed that a reader cannot see), and whose middle 90% spans under
 * WINDOW_SQUEEZE of its whole range. That is 36 of the 109 titles with 40 or more people in Mar 2026;
 * every other title's charts are unchanged.
 */
export const WINDOW_MIN_PEOPLE = 40;
export const WINDOW_SQUEEZE = 0.5;
export const WINDOW_QUANTILES = [0.05, 0.95] as const;

export interface PayWindow {
  /** The window's ends: the 5th and 95th percentiles, rounded out to a round step. */
  lo: number;
  hi: number;
  /** How many people are paid under `lo` and over `hi`. */
  below: number;
  above: number;
}

/** The `p` quantile of ascending `sorted`, interpolated between neighbours as DuckDB's
 *  `quantile_cont` is, so a window matches the percentiles the rest of the page computes. */
export function quantile(sorted: readonly number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * The window for a title whose people are paid `pays`, or null where the whole range is drawn. Its ends
 * round OUT to a step of a twentieth of the middle 90% (1, 2, 2.5 or 5 × 10ⁿ), so an axis reads
 * "$51k–$73k" rather than "$51,777–$72,100", and nobody inside the middle 90% lands in a pile.
 */
export function payWindow(pays: readonly number[]): PayWindow | null {
  const s = pays.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length < WINDOW_MIN_PEOPLE) return null;
  const min = s[0], max = s[s.length - 1];
  const p5 = quantile(s, WINDOW_QUANTILES[0]), p95 = quantile(s, WINDOW_QUANTILES[1]);
  if (!(max > min) || !(p95 - p5 < WINDOW_SQUEEZE * (max - min))) return null;
  const step = niceStep((p95 - p5) / 20);
  const lo = Math.floor(p5 / step) * step;
  const hi = Math.ceil(p95 / step) * step;
  let below = 0, above = 0;
  for (const v of s) {
    if (v < lo) below++;
    else if (v > hi) above++;
  }
  if (!below && !above) return null;
  return { lo, hi, below, above };
}

/** Which side of `w` a pay falls: -1 under it, 1 over it, 0 inside (or no window). */
export function sideOf(w: PayWindow | null | undefined, pay: number): -1 | 0 | 1 {
  if (!w) return 0;
  return pay < w.lo ? -1 : pay > w.hi ? 1 : 0;
}
