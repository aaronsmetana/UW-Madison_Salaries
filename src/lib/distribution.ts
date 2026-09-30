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
 * Dollars per point the curve is drawn at, where the counts per $100 are there to draw from.
 *
 * The line used to be built from the same $1k bins the readout counts: 250 points, which across a
 * page-wide plot is a corner every five pixels — a polyline the eye reads as faceted rather than a
 * curve. The artifact already carries counts per $100 (the dots are laid out from them), so the line
 * is rebuilt five times as fine. The kernel is unchanged and is measured in dollars, so the curve is
 * the same shape, sampled closely enough that its corners stop showing; and a peak now lands on the
 * $200 it belongs to rather than at the foot of its $1k bin.
 *
 * Not $100 itself: `densify` refuses a series longer than `MAX_BUCKETS`, and $100 buckets over the
 * $250k the graph draws is 2,500 of them. Not $250 either, tempting as a round quarter-thousand is:
 * it is two and a half of the artifact's buckets, so the bins would land on $150, $400, $650 and the
 * grid the whole chart is read against would be off the round numbers it names.
 */
export const CURVE_STEP = 200;

/**
 * Bins summed from counts per $100 — `lo100` is the first count's bucket, in $100s
 * (`home-stats.json` `pay_counts`).
 *
 * `step` is in dollars and is rounded to a whole number of those $100 buckets: a step that split one
 * would put the bins on a grid the source cannot answer for.
 *
 * Dense by construction and aligned to whole multiples of the step, which is what the kernel needs: it
 * walks neighbours by index, so an uneven or gappy series would reach further in dollars on one side
 * of a point than the other.
 */
export function binsFromCounts(lo100: number, counts: readonly number[], step: number): Bin[] {
  const per = Math.max(1, Math.round(step / 100));
  if (!counts.length) return [];
  const first = Math.floor(lo100 / per);
  const last = Math.floor((lo100 + counts.length - 1) / per);
  const out: Bin[] = [];
  for (let b = first; b <= last; b++) out.push({ bucket: b * per * 100, n: 0 });
  for (let i = 0; i < counts.length; i++) {
    if (counts[i]) out[Math.floor((lo100 + i) / per) - first].n += counts[i];
  }
  return out;
}

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

/**
 * A group's people per $100 on the campus curve's own grid — `lo100` and `length` from `pay_counts` — and
 * how many are at or past the cap. Fed to `binsFromCounts` and `smoothBins` exactly as `pay_counts` is, the
 * group's curve comes out of the same kernel, step and scale as the campus one, so any difference between
 * the two lines is the people. Everyone in the group gives back `pay_counts`.
 */
export function groupCounts(pays: readonly number[], lo100: number, length: number, cap: number): { counts: number[]; over: number } {
  const counts = new Array<number>(length).fill(0);
  let over = 0;
  for (const p of pays) {
    if (!(p > 0)) continue;
    if (p >= cap) { over++; continue; }
    const b = Math.floor(p / 100) - lo100;
    if (b >= 0 && b < length) counts[b]++;
  }
  return { counts, over };
}

/**
 * How wide a group's curve is smoothed, in dollars. The campus kernel suits 22,000 people. A group of a
 * thousand run through it zigzagged with chance, $10k to $10k across Professor's range, and at its own
 * scale every zig drew as a peak. Silverman's rule of thumb, `0.9·min(sd, IQR/1.34)·n^-1/5`, halved:
 * the rule aims at the smoothest honest curve, and half of it keeps a step a title's pay really has
 * (Research Associate's at $62k). Never under the campus kernel. Over the pays under the cap, which are
 * all the curve draws.
 */
export function groupSigma(pays: readonly number[], cap: number): number {
  const v = pays.filter((p) => p > 0 && p < cap).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return KERNEL_SIGMA;
  const mean = v.reduce((t, p) => t + p, 0) / n;
  const sd = Math.sqrt(v.reduce((t, p) => t + (p - mean) ** 2, 0) / (n - 1));
  const q = (f: number) => {
    const x = f * (n - 1), i = Math.floor(x);
    return v[i] + (v[Math.min(n - 1, i + 1)] - v[i]) * (x - i);
  };
  const iqr = (q(0.75) - q(0.25)) / 1.34;
  const spread = iqr > 0 ? Math.min(sd, iqr) : sd;
  return Math.max(KERNEL_SIGMA, 0.45 * spread * n ** -0.2);
}

/**
 * A group's curve over everyone's, as the plot draws them: `W` wide and `H` tall, the campus curve's peak
 * `head` below the top. On the campus curve's own scale, so its height is how many of the group are at a
 * pay, and on the same grid, where it is held to everyone's: a group is never more than all of campus,
 * though its wider kernel would lift it over a narrow dip in everyone's. It runs from its first point with
 * anyone to its last; the flat zero either side only doubled the axis in dashes.
 *
 * Drawn however low it is. It used to be left out under 12px, and a title spread across a wide range never
 * rises that far on campus's scale: Professor and Assistant Professor peak near 9px, Associate Professor
 * near 5, so half of the largest titles showed only a median line while Research Associate showed its
 * shape. Low, it is still the true count: a dashed line along the floor that lifts where the group's
 * people are. Null only for a group with no one under the cap, which has nothing here to draw.
 */
export function groupLine(group: readonly Bin[], campus: readonly Bin[], box: { W: number; H: number; head: number }): string | null {
  if (!group.length || !campus.length) return null;
  const lo = campus[0].bucket, hi = campus[campus.length - 1].bucket, span = hi - lo || 1;
  const max = Math.max(1, ...campus.map((b) => b.n));
  const everyone = new Map(campus.map((b) => [b.bucket, b.n]));
  const pts = group.map((b) => ({ bucket: b.bucket, n: Math.min(b.n, everyone.get(b.bucket) ?? 0) }));
  const tall = (n: number) => (n / max) * (box.H - box.head - 2);
  const peak = Math.max(0, ...pts.map((p) => p.n));
  if (!(peak > 0)) return null;
  const floor = peak * 0.002;
  let a = 0, z = pts.length - 1;
  while (a < z && pts[a].n <= floor) a++;
  while (z > a && pts[z].n <= floor) z--;
  return pts.slice(Math.max(0, a - 1), Math.min(pts.length, z + 2))
    .map((b, i) => `${i ? 'L' : 'M'}${(((b.bucket - lo) / span) * box.W).toFixed(1)},${(box.H - tall(b.n) - 2).toFixed(1)}`)
    .join(' ');
}
