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
  return Math.round((below / (salaries.length - 1)) * 100);
}
