/**
 * Percentile rank (0–100) of `value` within `salaries`, using the app's shared definition so every
 * stat on a page agrees: the share of the OTHER values strictly below `value` (n − 1 denominator),
 * so a person is never counted against themselves.
 *
 *   percentile = round( count(s < value) / (salaries.length - 1) * 100 )
 */
export function percentile(value: number, salaries: number[]): number {
  if (salaries.length <= 1) return 0;
  const below = salaries.reduce((n, s) => n + (s < value ? 1 : 0), 0);
  // The n−1 denominator assumes `value` is one of `salaries`. When a caller passes a figure from
  // outside the pool — a projection, or a person's total pay against a single-title cohort — every
  // member can be below it and the share comes out above 100, which is not a percentile. Callers
  // should compare like with like; this makes the output honest either way.
  return Math.min(100, Math.round((below / (salaries.length - 1)) * 100));
}

/**
 * "1st", "2nd", "3rd", "11th", "21st" — the suffix for a rank or a percentile. Lives beside
 * `percentile()` because it exists to label its output, and because two hand-rolled copies had
 * already drifted apart on whether they round their input.
 */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const v = r % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return r + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Ordinary least-squares fit of y on x. Returns null with fewer than 2 points or zero x-variance
 *  (a vertical fit is undefined). Shared by the tenure-vs-pay scatter and the comparison report's
 *  tenure-trend regression, so both read the exact same line for the same cohort. */
export function leastSquares(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const xBar = points.reduce((s, p) => s + p.x, 0) / n;
  const yBar = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.x - xBar) * (p.y - yBar);
    den += (p.x - xBar) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: yBar - slope * xBar };
}
