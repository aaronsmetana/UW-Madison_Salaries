import { describe, it, expect } from 'vitest';
import { binStep, countWithin, densify, smoothBins, KERNEL_SIGMA, type Bin } from './distribution';

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
