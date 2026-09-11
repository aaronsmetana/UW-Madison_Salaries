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

/** Fewer same-title peers with a recorded tenure than this and there is no trend to fit — a line
 *  through seven points says more about those seven people than about the title. The comparison
 *  brief already required this many; the person page drew a line and a verdict from two. */
export const TENURE_MIN_PEERS = 8;

/** A gap smaller than this share of pay is "on the curve". The brief's own rule ("under 2% of pay —
 *  omitted as too small to claim"), now the only rule: the person page called a 1.2% gap "Below". */
export const TENURE_ON_BAND = 0.02;

export interface TenureFit {
  /** Peers in the fit — never the subject. */
  n: number;
  slope: number;
  intercept: number;
  /** What tenure alone predicts at the subject's tenure. */
  expected: number;
  /** Subject's pay minus `expected`: negative means below the curve. */
  gap: number;
  /** Share of pay differences in the group that tenure accounts for (0–1). */
  r2: number;
  /** Typical distance of a peer from the line, in dollars. */
  residualSd: number;
  /** Share of peers whose pay sits further below the line than the subject's (0–100). */
  adjustedPercentile: number;
  verdict: 'above' | 'below' | 'on';
}

/**
 * What tenure predicts for one person, from their peers — the one fit the scatter, its callout and
 * the comparison brief all read.
 *
 * The subject is excluded from the fit: a line that includes the person it is judging bends toward
 * them. `peers` must not contain the subject; `self` is the subject's own tenure (x) and pay (y).
 */
export function tenureFit(peers: { x: number; y: number }[], self: { x: number; y: number }): TenureFit | null {
  if (peers.length < TENURE_MIN_PEERS) return null;
  const reg = leastSquares(peers);
  if (!reg) return null;
  const at = (x: number) => reg.intercept + reg.slope * x;
  const yBar = peers.reduce((s, p) => s + p.y, 0) / peers.length;
  let sse = 0, sst = 0;
  const residuals = peers.map((p) => {
    const r = p.y - at(p.x);
    sse += r * r;
    sst += (p.y - yBar) ** 2;
    return r;
  });
  const expected = at(self.x);
  const gap = self.y - expected;
  const below = residuals.filter((r) => r < gap).length;
  const verdict: TenureFit['verdict'] = Math.abs(gap) < TENURE_ON_BAND * Math.abs(self.y) ? 'on' : gap > 0 ? 'above' : 'below';
  return {
    n: peers.length,
    slope: reg.slope,
    intercept: reg.intercept,
    expected,
    gap,
    r2: sst > 0 ? Math.max(0, 1 - sse / sst) : 0,
    residualSd: Math.sqrt(sse / Math.max(1, peers.length - 2)),
    adjustedPercentile: Math.round((below / peers.length) * 100),
    verdict,
  };
}
