/** One histogram bucket: `bucket` is the bucket's lower edge in dollars, `n` the headcount in it. */
export interface Bin { bucket: number; n: number }

/**
 * Width of the smoothing kernel, in dollars.
 *
 * The landing curve is a *density estimate*, not a polyline through raw counts, because raw counts at
 * a useful resolution are unreadable. Payroll is not a smooth quantity: people are hired onto round
 * numbers, so the histogram carries a comb of spikes at $35k, $40k, $50k and so on. Measured on the
 * 2026-03 snapshot, drawing more points makes the line *worse*, not better — mean |second difference|
 * over the mean count runs 0.19 at $10k buckets, 0.47 at $2.5k and 0.88 at $500. Every extra point
 * resolves more comb.
 *
 * Silverman's rule of thumb for this distribution (n=21,837, sd=$44.4k, IQR=$48.3k) gives a bandwidth
 * of ~$4.4k. This is deliberately a little wider: the rule assumes a smooth underlying density and
 * ours has the round-number comb sitting on top of one, so erring wide is the safe direction. It is
 * as wide as it can be and still keep the two features that are actually in the data — the shoulder
 * around $57k where University Staff sit, and the step near $130k where the faculty tail begins. At
 * $10k both are gone and the curve is a featureless lognormal blob.
 */
export const KERNEL_SIGMA = 5000;

/** Above this many buckets a "distribution" is a rendering bug, not data — see `densify`. */
const MAX_BUCKETS = 2000;

/**
 * The gap between adjacent buckets, in dollars, inferred from the data rather than passed in.
 *
 * Inferred because two different producers feed this chart with two different widths in play over
 * time: the precomputed `home-stats.json` and the live SQL fallback Home runs when a visitor has
 * pinned an older snapshot. A constant here would be a fourth place to keep in step with those two.
 *
 * The *minimum* positive gap, not the first one: a gappy series (a bucket nobody falls into) would
 * otherwise report the width of its first hole as the step.
 */
export function binStep(bins: Bin[]): number {
  let step = Infinity;
  for (let i = 1; i < bins.length; i++) {
    const d = bins[i].bucket - bins[i - 1].bucket;
    if (d > 0 && d < step) step = d;
  }
  return Number.isFinite(step) ? step : 0;
}

/**
 * Fill in buckets the source omitted, so an empty bucket is an explicit zero rather than a missing x.
 *
 * `GROUP BY bucket` emits no row for a bucket nobody falls into. Plotted directly that reads as a
 * straight line bridging the hole — the curve quietly interpolates across a gap in the data — and it
 * breaks the kernel below, which walks neighbours by array index and would otherwise reach further in
 * dollars on one side of a hole than the other.
 *
 * The current snapshot has no holes at $1k buckets (22k people over 250 buckets), so this is
 * insurance for the sparser snapshots the SQL fallback can be pointed at, not everyday work.
 */
export function densify(bins: Bin[]): Bin[] {
  const step = binStep(bins);
  if (step <= 0 || bins.length < 2) return bins;
  const lo = bins[0].bucket, hi = bins[bins.length - 1].bucket;
  // A malformed series (one stray bucket far from the rest) would otherwise allocate unboundedly.
  if ((hi - lo) / step + 1 > MAX_BUCKETS) return bins;
  const have = new Map(bins.map((b) => [b.bucket, b.n]));
  const out: Bin[] = [];
  for (let v = lo; v <= hi; v += step) out.push({ bucket: v, n: have.get(v) ?? 0 });
  return out;
}

/**
 * Headcount within `radius` dollars of `center`, read off the RAW counts.
 *
 * The curve the chart draws is a smoothed density, so its y-value is not a number of people and must
 * never be presented as one. A hover readout that says "1,240 people" has to add up buckets that
 * actually hold 1,240 people, which is what this does — the smoothing decides where the mound is,
 * the raw bins say how many are standing on it.
 *
 * Inclusive at both edges, and it does not care whether `bins` is dense: it filters by dollar
 * distance rather than walking neighbours by index.
 */
export function countWithin(bins: Bin[], center: number, radius: number): number {
  let total = 0;
  for (const b of bins) if (Math.abs(b.bucket - center) <= radius) total += b.n;
  return total;
}

/**
 * Gaussian-smooth a histogram into the curve the chart draws.
 *
 * A weighted moving average over the buckets — Gaussian weights truncated at 3σ, renormalised by the
 * weight actually used so the ends don't dive toward zero for want of neighbours on one side. The
 * returned `n` is a smoothed density, no longer a headcount, and is only ever used for geometry.
 *
 * Densifies first: the kernel works in bucket *index* space, so it is only proportional to dollars
 * when the buckets are evenly spaced. Doing that here rather than asking callers to means there is no
 * ordering to get wrong — the failure would be silent and slightly wrong, which is the worst kind.
 */
export function smoothBins(bins: Bin[], sigma: number = KERNEL_SIGMA): Bin[] {
  const dense = densify(bins);
  const step = binStep(dense);
  if (sigma <= 0 || step <= 0 || dense.length < 3) return dense;

  const s = sigma / step;
  const radius = Math.max(1, Math.ceil(s * 3));
  const kernel: number[] = [];
  for (let i = -radius; i <= radius; i++) kernel.push(Math.exp(-(i * i) / (2 * s * s)));

  return dense.map((b, i) => {
    let acc = 0, weight = 0;
    for (let j = -radius; j <= radius; j++) {
      const at = i + j;
      if (at < 0 || at >= dense.length) continue;
      acc += dense[at].n * kernel[j + radius];
      weight += kernel[j + radius];
    }
    return { bucket: b.bucket, n: weight > 0 ? acc / weight : b.n };
  });
}
