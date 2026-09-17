import { describe, expect, it } from 'vitest';
import { layoutDots, packDots, paysFromCounts, peopleFromCounts, seeded } from './dotLayout';

const curve = (x: number) => 60 * Math.exp(-(((x - 300) / 120) ** 2)) + 4;

describe('layoutDots', () => {
  const xs = Array.from({ length: 5000 }, (_, i) => 50 + ((i * 7919) % 50000) / 100);
  const pts = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });

  it('keeps every dot under the curve and above the baseline, a radius inside both', () => {
    for (let i = 0; i < xs.length; i++) {
      const y = pts[2 * i + 1];
      const top = 100 - curve(Math.floor(xs[i]) + 0.5);
      expect(y).toBeLessThanOrEqual(100 - 0.6 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(top + 0.6 - 1e-4);
    }
  });

  it('keeps every dot within half a pixel of its value', () => {
    for (let i = 0; i < xs.length; i++) expect(Math.abs(pts[2 * i] - xs[i])).toBeLessThanOrEqual(0.5);
  });

  it('draws the same picture every time', () => {
    const again = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });
    expect(Array.from(again)).toEqual(Array.from(pts));
    const other = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 8 });
    expect(Array.from(other)).not.toEqual(Array.from(pts));
  });

  it('spreads a column from the baseline to the curve', () => {
    const col = Array.from({ length: 40 }, () => 300.2);
    const p = layoutDots({ xs: col, heightAt: curve, baseY: 100, r: 0.6 });
    const ys = Array.from({ length: 40 }, (_, i) => p[2 * i + 1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.9 * (curve(300.5) - 1.2));
  });
});

describe('packDots', () => {
  // People spread as the curve is, and a spike of 30 sharing one pay at the peak — a streak in 1px columns.
  const rand = seeded(11);
  const spread: number[] = [];
  while (spread.length < 5000) { const x = rand() * 600; if (rand() * 64 < curve(x)) spread.push(x); }
  const xs = [...spread, ...Array.from({ length: 30 }, () => 300.2)];
  const kinds = xs.map((_, i) => (i * 7) % 3);
  const at2 = packDots({ xs, heightAt: curve, baseY: 100, width: 600, dpr: 2, spill: 3, stack: kinds, seed: 5 });
  /** The column pitch the packer actually chose, read back from the layout. */
  const pitchOf = (pts: Float32Array, n: number) => {
    const col = [...new Set(Array.from({ length: n }, (_, i) => pts[2 * i]))].sort((a, b) => a - b);
    let m = Infinity;
    for (let i = 1; i < col.length; i++) m = Math.min(m, col[i] - col[i - 1]);
    return m;
  };
  /**
   * How far a dot may end up from its pay: the spill it is allowed, plus the column it sits in. Read
   * from the layout, not assumed — the pitch follows the room each dot has, so the curve or the count
   * moves it, and a hardcoded 1.5 went on describing a pitch that had since narrowed to 1.0. A column
   * is the honest term rather than half of one: the centres are on device-pixel centres, which at this
   * pitch puts them three-quarters of the way across their column, so a dot can start 0.75 from its own
   * centre before it moves at all. The tight user-facing bound is the e2e's, measured on real pays.
   */
  const reach = (pts: Float32Array, n: number) => 3 + pitchOf(pts, n);
  /** The pairs of dots closer than `min`, found through a grid: all of them, and those in different
   *  columns (different x). */
  const tooClose = (pts: Float32Array, min: number, near?: (x: number) => boolean) => {
    const grid = new Map<string, number[]>();
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(pts[2 * i] / min)},${Math.floor(pts[2 * i + 1] / min)}`;
      grid.set(k, [...(grid.get(k) ?? []), i]);
    }
    let pairs = 0, across = 0;
    for (let i = 0; i < n; i++) {
      if (near && !near(pts[2 * i])) continue;
      const gx = Math.floor(pts[2 * i] / min), gy = Math.floor(pts[2 * i + 1] / min);
      for (let ax = gx - 1; ax <= gx + 1; ax++) for (let ay = gy - 1; ay <= gy + 1; ay++) {
        for (const j of grid.get(`${ax},${ay}`) ?? []) {
          if (j > i && Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]) < min) {
            pairs++;
            if (pts[2 * j] !== pts[2 * i]) across++;
          }
        }
      }
    }
    return { pairs, across };
  };

  it('gives every dot its own room: never too near a dot in another column, the spike absorbed', () => {
    const min = 0.95 * 2 * at2.r;
    const all = tooClose(at2.pts, min);
    // Columns are a dot-width apart: no dot overlaps one in the next.
    expect(all.across).toBe(0);
    // The spike of 30 at one pay spread into its neighbours: nothing near it is crowded.
    expect(tooClose(at2.pts, min, (x) => Math.abs(x - 300) < 8).pairs).toBe(0);
    // What is left is a few chance clumps in the thin tails, where every column within the spill is as
    // full: counted, small, and only ever within a column.
    expect(at2.crowded).toBeLessThan(0.01 * xs.length);
    if (at2.crowded === 0) expect(all.pairs).toBe(0);
    // One-pixel columns, for contrast, crowd dots everywhere. Stated as a ratio to the packed field
    // rather than as a fraction of the dots: `min` is a dot-width, so the count scales with whatever
    // radius the packer picks for this field, and a fixed fraction of n silently re-tunes itself every
    // time the pitch moves. What is being claimed is the contrast — two orders of magnitude — not a
    // particular count.
    const plain = layoutDots({ xs, heightAt: curve, baseY: 100, r: at2.r, seed: 5 });
    expect(tooClose(plain, min).pairs).toBeGreaterThan(100 * (all.pairs + 1));
    // And the room is used: giving every dot its own room is trivially satisfiable by shrinking the
    // dots until nothing touches, which draws an empty graph. This is the other half of the bargain,
    // and it is the half the contrast count above used to guard only by accident — `min` comes from
    // the packer's own radius, so a packer that collapses its dots also shrinks the yardstick it is
    // measured by, and the crowding count falls with it. Collapsing the pitch to one device pixel
    // leaves this field at a fifteenth of its area inked; a healthy pack covers about a quarter.
    let area = 0;
    for (let c = 0; c < 600; c++) area += Math.max(0, curve(c + 0.5));
    expect((xs.length * Math.PI * at2.r ** 2) / area).toBeGreaterThan(0.15);
  });

  it('keeps every dot within the spill and its column of its pay, and in pay order', () => {
    const bound = reach(at2.pts, xs.length) + 1e-9;
    for (let i = 0; i < xs.length; i++) expect(Math.abs(at2.pts[2 * i] - xs[i])).toBeLessThanOrEqual(bound);
    expect(at2.maxShift).toBeLessThanOrEqual(bound);
    const byPay = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
    for (let q = 1; q < byPay.length; q++) expect(at2.pts[2 * byPay[q]]).toBeGreaterThanOrEqual(at2.pts[2 * byPay[q - 1]]);
  });

  it('keeps every dot under the curve and above the baseline, a radius inside both', () => {
    for (let i = 0; i < xs.length; i++) {
      const x = at2.pts[2 * i], y = at2.pts[2 * i + 1];
      expect(y).toBeLessThanOrEqual(100 - at2.r + 1e-4);
      expect(y).toBeGreaterThanOrEqual(100 - curve(x) + at2.r - 1e-4);
    }
  });

  it('puts every dot on a device-pixel centre from 2x up, where its sprite stamps unresampled', () => {
    for (let i = 0; i < xs.length; i++) {
      for (const v of [at2.pts[2 * i] * 2 - 0.5, at2.pts[2 * i + 1] * 2 - 0.5]) expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-4);
    }
  });

  it('stacks the kinds within each column, lower keys lower', () => {
    const cols = new Map<number, number[]>();
    xs.forEach((_, i) => { const c = at2.pts[2 * i]; cols.set(c, [...(cols.get(c) ?? []), i]); });
    for (const list of cols.values()) {
      for (let k = 0; k < 2; k++) {
        const top = Math.min(...list.filter((i) => kinds[i] === k).map((i) => at2.pts[2 * i + 1]));
        const next = list.filter((i) => kinds[i] === k + 1).map((i) => at2.pts[2 * i + 1]);
        if (next.length && Number.isFinite(top)) expect(Math.max(...next)).toBeLessThan(top);
      }
    }
  });

  it('draws the same picture every time', () => {
    const again = packDots({ xs, heightAt: curve, baseY: 100, width: 600, dpr: 2, spill: 3, stack: kinds, seed: 5 });
    expect(Array.from(again.pts)).toEqual(Array.from(at2.pts));
  });

  it('owns up to a spike too big for its neighbours: counted crowded, and still within bounds', () => {
    // 800, not 400. The spill is given in pixels, so a narrower column pitch buys the spike more
    // columns to spread into, and 400 at one pay is now absorbed without crowding — the guard passed
    // while proving nothing. This is the size that still exceeds what the neighbours can hold.
    const big = [...spread, ...Array.from({ length: 800 }, () => 300.2)];
    const p = packDots({ xs: big, heightAt: curve, baseY: 100, width: 600, dpr: 2, spill: 3 });
    expect(p.crowded).toBeGreaterThan(200);
    expect(p.maxShift).toBeLessThanOrEqual(reach(p.pts, big.length) + 1e-9);
  });

  it("sizes a phone's dots to its screen: two device pixels apart at 3x, no bigger than they fit", () => {
    const dense = Array.from({ length: 20000 }, (_, i) => spread[i % spread.length]);
    const p = packDots({ xs: dense, heightAt: curve, baseY: 100, width: 600, dpr: 3, spill: 3 });
    expect(p.r * 3).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(2 * p.r).toBeLessThanOrEqual(0.95 * (Math.round(2 * 0.42 * Math.sqrt(15163 / 20000) * 3) / 3) + 0.05);
  });
});

describe('seeded', () => {
  it('repeats for a seed', () => {
    const a = seeded(3), b = seeded(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('paysFromCounts', () => {
  it('puts each person inside their own $100', () => {
    const pays = paysFromCounts(500, [2, 0, 1]);
    expect(Array.from(pays)).toEqual([50025, 50075, 50250]);
  });
});

describe('layoutDots with a stacking key', () => {
  // Three kinds, mixed through every column.
  const xs = Array.from({ length: 6000 }, (_, i) => 100 + ((i * 7919) % 40000) / 100);
  const kinds = xs.map((_, i) => (i * 31) % 3);
  const plain = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });
  const stacked = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7, stack: kinds });

  it('puts every dot of a lower kind below every dot of a higher kind, column by column', () => {
    const cols = new Map<number, number[]>();
    xs.forEach((x, i) => { const c = Math.floor(x); cols.set(c, [...(cols.get(c) ?? []), i]); });
    for (const list of cols.values()) {
      for (let k = 0; k < 2; k++) {
        const top = Math.min(...list.filter((i) => kinds[i] === k).map((i) => stacked[2 * i + 1]));
        const next = list.filter((i) => kinds[i] === k + 1).map((i) => stacked[2 * i + 1]);
        // y grows downward: the kind above sits at smaller y than all of the kind below.
        if (next.length && Number.isFinite(top)) expect(Math.max(...next)).toBeLessThan(top);
      }
    }
  });

  it('moves no dot along x, and keeps every dot inside the curve', () => {
    for (let i = 0; i < xs.length; i++) {
      expect(Math.abs(stacked[2 * i] - xs[i])).toBeLessThanOrEqual(0.5);
      expect(stacked[2 * i + 1]).toBeLessThanOrEqual(100 - 0.6 + 1e-4);
      expect(stacked[2 * i + 1]).toBeGreaterThanOrEqual(100 - curve(Math.floor(xs[i]) + 0.5) + 0.6 - 1e-4);
    }
  });

  it('without a key, draws exactly what it drew before', () => {
    expect(Array.from(layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7, stack: undefined }))).toEqual(Array.from(plain));
  });
});

describe('peopleFromCounts', () => {
  it("gives each person their pay and their category, and the same pays paysFromCounts gives", () => {
    const counts = [2, 0, 3];
    const cats = [{ counts: [1, 0, 1] }, { counts: [1, 0, 2] }];
    const { pays, kinds } = peopleFromCounts(500, counts, cats);
    expect(Array.from(pays)).toEqual(Array.from(paysFromCounts(500, counts)));
    expect(Array.from(kinds!)).toEqual([0, 1, 0, 1, 1]);
  });
  it('refuses categories that do not add up to the counts', () => {
    expect(peopleFromCounts(500, [2], [{ counts: [1] }]).kinds).toBeNull();
    expect(peopleFromCounts(500, [2], null).kinds).toBeNull();
  });
});
