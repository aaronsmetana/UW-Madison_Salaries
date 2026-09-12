/**
 * One scale for a column of box plots, so equal widths mean equal dollars on every row. Each row used
 * to be scaled to its own minimum and maximum, which drew a $10k spread and a $450k spread the same
 * width.
 *
 * The scale runs from $0 to a round figure just above nearly every row's 75th percentile (all of them
 * below 20 rows, the 98th percentile of them above), so one extreme row — a coach's title — cannot
 * flatten the rest. Whiskers and
 * the odd box that run past it are cut at the edge and marked there.
 */
export interface RangeScale {
  lo: number;
  hi: number;
  /** Round values for faint gridlines, inside the scale. */
  ticks: number[];
}

const roundUp = (v: number, steps: readonly number[]) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of steps) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
};

/** The scale's end: the smallest round figure (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ) at or above
 *  `v`. Finer than tick steps, so a column whose widest box reaches $260k ends at $300k, not $500k. */
export function niceCeil(v: number): number {
  return roundUp(v, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]);
}

/** A gridline step: 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceStep(v: number): number {
  return roundUp(v, [1, 2, 2.5, 5, 10]);
}

export function rangeScale(p75s: readonly (number | null | undefined)[]): RangeScale {
  const v = p75s.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
  // With few rows every box fits; with many, the widest 2% may run past the edge.
  const top = v.length ? v[v.length < 20 ? v.length - 1 : Math.floor(0.98 * (v.length - 1))] : 1;
  const hi = niceCeil(top * 1.05);
  const step = niceStep(hi / 5);
  const ticks: number[] = [];
  for (let t = step; t < hi - 1e-9; t += step) ticks.push(t);
  return { lo: 0, hi, ticks };
}

/** A value's position across `width` pixels, cut to the scale. */
export function scaleX(s: RangeScale, v: number, width: number, pad = 1): number {
  const f = (Math.min(Math.max(v, s.lo), s.hi) - s.lo) / (s.hi - s.lo || 1);
  return pad + f * (width - 2 * pad);
}

/**
 * Round money ticks covering [lo, hi]: a 1, 2, 2.5 or 5 × 10ᵏ step giving about `count` of them.
 * Recharts' own "nice" steps are not: the starting-group chart read $0 / $35,000 / $70,000, and a
 * professor's tenure scatter $0k / $115k / $230k.
 */
export function moneyTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (!(hi > lo)) return [lo];
  const step = niceStep((hi - lo) / (count - 1));
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let k = 0; a + k * step <= b + step * 1e-6; k++) out.push(Math.round((a + k * step) * 100) / 100);
  return out;
}
