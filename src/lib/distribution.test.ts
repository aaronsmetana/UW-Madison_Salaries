import { describe, it, expect } from 'vitest';
import { binStep, binsFromCounts, countBelow, countWithin, densify, smoothBins, CURVE_STEP, KERNEL_SIGMA, type Bin } from './distribution';

const bins = (step: number, counts: number[], from = 0): Bin[] =>
  counts.map((n, i) => ({ bucket: from + i * step, n }));

/** Mean |second difference| over the mean level — the "how much does this zig-zag" measure the
 *  bandwidth was chosen against. Lower is smoother. */
function roughness(series: Bin[]): number {
  const ys = series.map((b) => b.n);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let acc = 0;
  for (let i = 1; i < ys.length - 1; i++) acc += Math.abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]);
  return acc / (ys.length - 2) / mean;
}

describe('binStep', () => {
  it('reads the step off evenly spaced buckets', () => {
    expect(binStep(bins(1000, [1, 2, 3]))).toBe(1000);
  });

  it('takes the smallest gap, not the first one', () => {
    // A hole at the front: buckets 0, 3000, 4000, 5000. The first gap is the hole, not the step.
    const gappy: Bin[] = [
      { bucket: 0, n: 1 }, { bucket: 3000, n: 2 }, { bucket: 4000, n: 3 }, { bucket: 5000, n: 4 },
    ];
    expect(binStep(gappy)).toBe(1000);
  });

  it('reports no step for a series too short to have one', () => {
    expect(binStep([{ bucket: 0, n: 1 }])).toBe(0);
    expect(binStep([])).toBe(0);
  });
});

describe('densify', () => {
  it('turns an omitted bucket into an explicit zero rather than a bridged gap', () => {
    const gappy: Bin[] = [{ bucket: 0, n: 5 }, { bucket: 1000, n: 7 }, { bucket: 3000, n: 2 }];
    expect(densify(gappy)).toEqual([
      { bucket: 0, n: 5 }, { bucket: 1000, n: 7 }, { bucket: 2000, n: 0 }, { bucket: 3000, n: 2 },
    ]);
  });

  it('leaves an already-dense series alone', () => {
    const dense = bins(2500, [1, 2, 3, 4]);
    expect(densify(dense)).toEqual(dense);
  });

  it('refuses to expand a malformed series into millions of buckets', () => {
    // One stray bucket $500M away from a $1k series: filling it would allocate 500,000 entries.
    const stray: Bin[] = [{ bucket: 0, n: 1 }, { bucket: 1000, n: 1 }, { bucket: 500_000_000, n: 1 }];
    expect(densify(stray)).toEqual(stray);
  });
});

describe('smoothBins', () => {
  it('takes the static off a raw histogram without taking the shape with it', () => {
    // A comb tooth ~4x its neighbours, like $35k in the snapshot. Raw, this scores ~0.94 and reads as
    // static at 250 points; the kernel has to bring that down without erasing the tooth, which is the
    // job the two assertions below split between them.
    const comb = bins(1000, Array.from({ length: 61 }, (_, i) => (i % 10 === 5 ? 400 : 100)));
    const before = roughness(comb);
    const after = roughness(smoothBins(comb));
    expect(before).toBeGreaterThan(0.8);
    expect(after).toBeLessThan(before / 3);
    expect(after, 'the kernel has gone back to erasing the comb').toBeGreaterThan(before / 40);
  });

  it('does not sag at the ends for want of neighbours', () => {
    // Without renormalising by the weight actually used, the first and last buckets would be
    // averaged against a half-empty kernel and the curve would dive to zero at both edges.
    const flat = smoothBins(bins(1000, Array(60).fill(100)));
    for (const b of flat) expect(b.n).toBeCloseTo(100, 6);
  });

  it('keeps the peak where the data puts it', () => {
    const peakAt = 40;
    const hump = bins(1000, Array.from({ length: 81 }, (_, i) => 100 + 500 * Math.exp(-((i - peakAt) ** 2) / 200)));
    const out = smoothBins(hump);
    const argmax = out.reduce((best, b, i) => (b.n > out[best].n ? i : best), 0);
    expect(argmax).toBe(peakAt);
  });

  it('smooths gappy input, not just dense input', () => {
    const gappy: Bin[] = [{ bucket: 0, n: 10 }, { bucket: 1000, n: 10 }, { bucket: 3000, n: 10 }];
    const out = smoothBins(gappy, 1000);
    expect(out.map((b) => b.bucket)).toEqual([0, 1000, 2000, 3000]);
    // The omitted $2k bucket is a zero being averaged in, so nothing here can still read a full 10.
    expect(Math.max(...out.map((b) => b.n))).toBeLessThan(10);
  });

  it('never widens or narrows the range it was given', () => {
    const src = bins(1000, Array.from({ length: 50 }, (_, i) => i));
    const out = smoothBins(src);
    expect(out[0].bucket).toBe(src[0].bucket);
    expect(out[out.length - 1].bucket).toBe(src[src.length - 1].bucket);
  });

  it('passes the data straight through when smoothing is switched off', () => {
    const src = bins(1000, [5, 9, 2, 8]);
    expect(smoothBins(src, 0)).toEqual(src);
  });

  it('uses a bandwidth in dollars, so the same curve comes back at any bucket width', () => {
    // Same underlying hump sampled at $1k and at $2k. The kernel is specified in dollars, so the two
    // smoothed curves must agree where they share a bucket — if the kernel were specified in buckets
    // the $2k series would come out twice as smoothed.
    const f = (v: number) => 100 + 500 * Math.exp(-((v - 40000) ** 2) / (2 * 8000 ** 2));
    const fine = smoothBins(Array.from({ length: 81 }, (_, i) => ({ bucket: i * 1000, n: f(i * 1000) })));
    const coarse = smoothBins(Array.from({ length: 41 }, (_, i) => ({ bucket: i * 2000, n: f(i * 2000) })));
    for (const c of coarse) {
      const match = fine.find((b) => b.bucket === c.bucket)!;
      expect(c.n / match.n).toBeCloseTo(1, 1);
    }
  });

  it('ships a bandwidth that keeps the round-number spikes rather than clearing them', () => {
    // This assertion used to run the other way — it required the comb to be GONE, on the reasoning
    // that spikes at round salaries were noise. They are not noise; they are people hired onto round
    // numbers, and the chart is meant to show them. A tooth 4x its neighbours, like $35k in the real
    // snapshot, has to survive as a clear local maximum.
    const comb = bins(1000, Array.from({ length: 61 }, (_, i) => (i % 10 === 5 ? 400 : 100)));
    const out = smoothBins(comb, KERNEL_SIGMA);
    const tooth = out[25].n; // one of the 400s
    expect(tooth, 'the kernel flattened a round-number spike into its neighbours')
      .toBeGreaterThan(out[23].n * 1.5);

    // …and still wide enough that the line is a line. Raw, this fixture scores ~0.94.
    expect(roughness(out)).toBeLessThan(roughness(comb) / 3);
  });

  it('keeps a genuine shoulder, which is what a wider kernel used to destroy', () => {
    // The $57k one: a second, smaller mode $18k below the peak.
    const at = (v: number) => 300 * Math.exp(-((v - 75000) ** 2) / (2 * 12000 ** 2))
                            + 170 * Math.exp(-((v - 57000) ** 2) / (2 * 7000 ** 2));
    const src = Array.from({ length: 200 }, (_, i) => ({ bucket: i * 1000, n: at(i * 1000) }));
    const out = smoothBins(src, KERNEL_SIGMA);
    // A shoulder is a sign change in the slope: still rising, less steeply, then steeply again.
    const slope = out.slice(1).map((b, i) => b.n - out[i].n);
    const shoulder = slope.slice(45, 70).some((d, i, a) => i > 0 && d < a[i - 1] && d > 0);
    expect(shoulder).toBe(true);
  });
});

describe('countWithin', () => {
  const src = bins(1000, [10, 20, 30, 40, 50]); // buckets 0..4000

  it('adds up every bucket inside the radius, inclusive of both edges', () => {
    // centre 2000, radius 1000 -> buckets 1000, 2000, 3000
    expect(countWithin(src, 2000, 1000)).toBe(20 + 30 + 40);
  });

  it('counts a single bucket at radius 0', () => {
    expect(countWithin(src, 3000, 0)).toBe(40);
  });

  it('clips at the ends rather than wrapping or extrapolating', () => {
    expect(countWithin(src, 0, 1000)).toBe(10 + 20);
    expect(countWithin(src, 4000, 1000)).toBe(40 + 50);
  });

  it('reads raw counts, not the smoothed density', () => {
    // The whole point: the curve says where the mound is, the raw bins say how many are on it.
    // A comb tooth must survive into the count even though smoothing flattens it in the drawing.
    const comb = bins(1000, [5, 5, 400, 5, 5]);
    expect(countWithin(comb, 2000, 1000)).toBe(410);
    expect(countWithin(smoothBins(comb), 2000, 1000)).toBeLessThan(410);
  });

  it('is zero when nothing is in range', () => {
    expect(countWithin(src, 99_000, 1000)).toBe(0);
    expect(countWithin([], 2000, 1000)).toBe(0);
  });
});

describe('countBelow', () => {
  const bins = [
    { bucket: 10_000, n: 5 },
    { bucket: 20_000, n: 10 },
    { bucket: 30_000, n: 20 },
  ];

  it('counts everyone strictly below the bucket asked about', () => {
    expect(countBelow(bins, 10_000)).toBe(0);
    expect(countBelow(bins, 20_000)).toBe(5);
    expect(countBelow(bins, 30_000)).toBe(15);
  });

  /**
   * The denominator is the caller's, and it matters. The bins stop at the $250k cap while ~546
   * people earn more, so dividing by the binned total (35 here) would call the top of the drawn
   * range the 100th percentile. Against a true headcount it cannot reach 100.
   */
  it('leaves room above the top bucket when the caller knows the real headcount', () => {
    const binned = bins.reduce((a, b) => a + b.n, 0);
    const headcount = binned + 10; // ten people above the cap
    expect(countBelow(bins, 30_000) / binned).toBeCloseTo(15 / 35);
    expect(countBelow(bins, 40_000) / headcount).toBeLessThan(1);
  });
});

describe('binsFromCounts', () => {
  it('sums the counts per $100 into bins of the step, losing nobody', () => {
    // Ten $100 buckets from $10,000: five $200 bins' worth.
    const counts = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const out = binsFromCounts(100, counts, CURVE_STEP);
    expect(out.map((b) => b.n).reduce((a, b) => a + b, 0)).toBe(39);
    // Aligned to whole multiples of the step, not to wherever the counts happen to start.
    expect(out[0].bucket % CURVE_STEP).toBe(0);
    expect(out[0].bucket).toBe(10_000);
    expect(binStep(out)).toBe(CURVE_STEP);
    // $10,000 and $10,100 fall in the first bin, $10,200 and $10,300 in the second.
    expect(out[0].n).toBe(3 + 1);
    expect(out[1].n).toBe(4 + 1);
  });

  it('puts the bins on a grid the counts can answer for, whatever step it is handed', () => {
    // $250 is two and a half $100 buckets. Splitting one is not something the source can do, so the
    // step is rounded to whole buckets rather than quietly landing the grid on $150, $400, $650.
    for (const b of binsFromCounts(0, [1, 2, 3, 4, 5, 6, 7, 8], 250)) expect(b.bucket % 100).toBe(0);
  });

  it('is dense: a bin nobody falls into is an explicit zero, not a missing point', () => {
    const counts = [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    const out = binsFromCounts(0, counts, CURVE_STEP);
    expect(out.length).toBe(6);
    expect(out.map((b) => b.n)).toEqual([7, 0, 0, 0, 0, 2]);
  });

  it('has nothing to say about no counts', () => {
    expect(binsFromCounts(0, [], CURVE_STEP)).toEqual([]);
  });
});

describe('the curve the landing graph draws', () => {
  // A distribution shaped like the real one, sampled per $100: a lognormal-ish hump with a round-number
  // spike on it, which is what the $1k bins were quantising.
  const per100 = Array.from({ length: 2000 }, (_, i) => {
    const v = i * 100;
    const hump = 400 * Math.exp(-((Math.log(Math.max(v, 1)) - Math.log(70_000)) ** 2) / (2 * 0.45 ** 2));
    return Math.round(hump + (v === 50_000 ? 900 : 0));
  });
  const fine = smoothBins(binsFromCounts(0, per100, CURVE_STEP));
  const coarse = smoothBins(binsFromCounts(0, per100, 1000));

  it('draws several points for every one the $1k bins gave it', () => {
    expect(1000 % CURVE_STEP, 'the fine grid has to contain the $1k one, or no point is shared').toBe(0);
    expect(fine.length).toBeGreaterThan(coarse.length * 4.5);
  });

  it('is the same curve, not a different one: it agrees with the $1k line where they share a point', () => {
    // The kernel is specified in dollars, so resampling must not change the shape — only how closely
    // it is sampled. Away from the ends (where a bin's own width shifts its centre) they track within
    // a few percent.
    const scale = (b: { n: number }[]) => Math.max(...b.map((x) => x.n));
    const fs = scale(fine), cs = scale(coarse);
    for (const c of coarse.slice(20, -20)) {
      const match = fine.find((b) => b.bucket === c.bucket)!;
      expect(Math.abs(match.n / fs - c.n / cs)).toBeLessThan(0.03);
    }
  });

  it('turns less sharply at every corner, which is what "less jagged" means on screen', () => {
    // The line is drawn across the same plot however many points it has, so compare the two in the
    // same box: the average turn from one segment to the next, in degrees. The average rather than the
    // worst turn — the worst is at the round-number spike, which the finer line RESOLVES rather than
    // smooths, and that corner is data.
    const sharpest = (series: Bin[]) => {
      const W = 1200, H = 380;
      const lo = series[0].bucket, span = series[series.length - 1].bucket - lo;
      const top = Math.max(...series.map((b) => b.n));
      const pts = series.map((b) => [((b.bucket - lo) / span) * W, H - (b.n / top) * H] as const);
      let turn = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
        const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
        turn += Math.abs(((b - a + Math.PI) % (2 * Math.PI)) - Math.PI);
      }
      return ((turn / (pts.length - 2)) * 180) / Math.PI;
    };
    expect(sharpest(fine)).toBeLessThan(sharpest(coarse) / 2);
  });
});
