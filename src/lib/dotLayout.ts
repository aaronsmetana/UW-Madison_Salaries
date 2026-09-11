/**
 * Where each person's dot goes in a "one dot per person" distribution: at their own pay along x, and
 * somewhere under the curve along y. Height means nothing beyond "under the curve" — within each
 * one-pixel column the column's dots are spread evenly from the baseline up to the curve, so dots fill
 * the area about evenly wherever the curve is. Jitter is fixed (a seeded generator), so the same data
 * draws the same picture every time — a screenshot, a redraw on resize, a second visit.
 */

/** A small, fast, seeded generator (mulberry32): the same seed gives the same sequence. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DotLayoutInput {
  /** Each dot's x, in CSS pixels, in any order. */
  xs: ArrayLike<number>;
  /** The curve's height above the baseline at x, in CSS pixels. */
  heightAt: (x: number) => number;
  /** The baseline's y, in CSS pixels. */
  baseY: number;
  /** Dot radius: every dot is kept at least this far inside the curve and above the baseline. */
  r: number;
  seed?: number;
}

/**
 * The dots as [x0, y0, x1, y1, …]. Each x moves at most half a pixel from its value; each y is between
 * the baseline and the curve, a radius inside both.
 */
export function layoutDots({ xs, heightAt, baseY, r, seed = 1 }: DotLayoutInput): Float32Array {
  const n = xs.length;
  const out = new Float32Array(n * 2);
  const rand = seeded(seed);
  // Group by one-pixel column.
  const cols = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = Math.floor(xs[i]);
    const list = cols.get(c);
    if (list) list.push(i);
    else cols.set(c, [i]);
  }
  for (const [c, list] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    // Shuffle, so a column's lowest dots are not always its lowest pays.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const k = list.length;
    const usable = Math.max(0, heightAt(c + 0.5) - 2 * r);
    for (let j = 0; j < k; j++) {
      const i = list[j];
      const jx = rand() - 0.5;
      const jy = rand() - 0.5;
      const x = xs[i] + jx * 0.999;
      // Even slots from the baseline up, each nudged within its own slot, so no two share a height.
      const f = Math.min(1, Math.max(0, (j + 0.5 + jy * 0.98) / k));
      out[2 * i] = x;
      out[2 * i + 1] = baseY - r - f * usable;
    }
  }
  return out;
}

/**
 * The people a count-per-$100 histogram describes, as pays: each bucket's people spread evenly across
 * its $100, so a dot lands inside the dollars its person earns.
 */
export function paysFromCounts(lo100: number, counts: readonly number[]): Float64Array {
  let n = 0;
  for (const c of counts) n += c;
  const out = new Float64Array(n);
  let k = 0;
  for (let b = 0; b < counts.length; b++) {
    const c = counts[b];
    for (let i = 0; i < c; i++) out[k++] = (lo100 + b) * 100 + ((i + 0.5) / c) * 100;
  }
  return out;
}
