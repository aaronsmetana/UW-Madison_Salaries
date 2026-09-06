/** One histogram bucket: `bucket` is the bucket's lower edge in dollars, `n` the headcount in it. */
export interface Bin { bucket: number; n: number }

/**
 * Width of the drawing kernel, in dollars.
 *
 * This was $5,000 — Silverman's rule for this distribution — on the reasoning that the comb of spikes
 * at $35k, $40k, $50k was noise to be cleared. That reasoning was wrong about what the spikes ARE.
 * They are not sampling noise: they are people, hired onto round numbers, and a chart that erases
 * them is hiding a real and legible fact about how pay is set. Silverman's rule assumes a smooth
 * underlying density; this one genuinely has teeth.
 *
 * So the kernel is now only as wide as it takes to stop 250 points becoming pixel noise, and no
 * wider. Measured on the 2026-03 snapshot at the shipped geometry (mean |second difference| over the
 * mean count): raw $1k buckets score 0.579 and read as static, $5k scores 0.003 and is a featureless
 * lognormal blob, and this lands at 0.059 — the round-number spikes intact, the line between them
 * still a line.
 */
export const KERNEL_SIGMA = 1200;

/**
 * Radius the hover readout counts over, in dollars — deliberately NOT the drawing kernel.
 *
 * These were one constant, which was fine while the kernel was $5k and coincidentally a sensible
 * neighbourhood to count. It is not one decision: the kernel answers "how much should the line
 * wobble", and this answers "how far either side of this salary is still "around here" to a reader".
 * Tying the readout to the kernel would have quietly turned "2,848 people ±$5k" into
 * "700 people ±$1.2k" the moment the drawing got sharper.
 */
export const READOUT_RADIUS = 5000;

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
/**
 * How many people earn less than `center`, counted from the RAW bins.
 *
 * Never from the smoothed curve, for the same reason `countWithin` isn't: the kernel moves weight
 * into neighbouring buckets, so a cumulative sum over it answers a question about the drawing
 * rather than about the payroll.
 *
 * The caller supplies the denominator, because this file cannot know it. The bins stop at the cap
 * ($250k), and the ~546 people above it are real — dividing by the binned total would call the top
 * of the drawn range the 100th percentile when it is not.
 */
export function countBelow(bins: Bin[], center: number): number {
  let below = 0;
  for (const b of bins) if (b.bucket < center) below += b.n;
  return below;
}

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
