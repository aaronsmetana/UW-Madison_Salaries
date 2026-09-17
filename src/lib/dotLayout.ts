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
  /** Optional stacking key per dot: within each column the lower keys take the lower slots, so a
   *  column of several kinds reads as bands. The x of each dot is unaffected. */
  stack?: ArrayLike<number>;
}

/**
 * The dots as [x0, y0, x1, y1, …]. Each x moves at most half a pixel from its value; each y is between
 * the baseline and the curve, a radius inside both.
 */
export function layoutDots({ xs, heightAt, baseY, r, seed = 1, stack }: DotLayoutInput): Float32Array {
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
    // Stacked: kinds in key order from the baseline up, still shuffled within each kind (a stable sort).
    if (stack) list.sort((a, b) => stack[a] - stack[b]);
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

export interface PackInput {
  /** Each dot's x, in CSS pixels, in any order. */
  xs: ArrayLike<number>;
  /** The curve's height above the baseline at x, in CSS pixels. */
  heightAt: (x: number) => number;
  /** The baseline's y, and the plot's width, in CSS pixels. */
  baseY: number;
  width: number;
  /** Device pixels per CSS pixel: the columns and, from 2 up, the dots sit on whole device pixels. */
  dpr: number;
  /** How far, CSS px, a crowded column may pass its surplus to its neighbours. */
  spill: number;
  seed?: number;
  /** As for layoutDots: within each column the lower keys take the lower slots. */
  stack?: ArrayLike<number>;
}

/** A packed field: each dot's [x, y], its radius, how many dots are still crowded (in a column spaced
 *  under a diameter), the furthest any dot sits from its value, CSS px — a value past either edge of the
 *  plot counted from the edge, where it is drawn (off it, it would not be seen at all) — and whether the
 *  dots stand apart (`separate`): below 1.25 device pixels a CSS pixel there are too few pixels for that,
 *  and the field keeps its dense, overlapping one-pixel columns, only evened out. */
export interface Packed { pts: Float32Array; r: number; crowded: number; maxShift: number; separate: boolean }

/** A dot takes this share of its slot, and the field keeps this much room to spare. */
const FILL = 0.95;
const SPARE = 1.2;

/**
 * A dense field where every dot has its own room. layoutDots' one-pixel columns cannot give it: with
 * dots about 1.5px across, a dot overlaps its neighbour in the next column two times in three, and where
 * many people share a pay one column holds several times what the curve has room for — a solid streak.
 *
 * Here columns are one dot-width apart, on whole device pixels. How many dots each column holds follows
 * the counts evened out over `spill` px, kept within each column's room (its height fits so many dots a
 * slot apart) wherever moving no dot further than the spill allows; the counts are then filled with the
 * dots in pay order — so pay reads left to right as before, and no dot sits further from its value than
 * the spill and half a column. Within a column the dots run from the baseline to the curve, each gap a
 * slot and a chance share of the column's free room, lower stacking keys lower. The dot's radius leaves a
 * fifth of the room to spare, and the dots sit on device-pixel centres, where a sprite stamps without
 * resampling. Below 1.25 device pixels a CSS pixel they cannot stand apart, and the field is one-pixel
 * columns, overlapping as layoutDots draws them, but with no column crowded.
 */
export function packDots({ xs, heightAt, baseY, width, dpr, spill, seed = 1, stack }: PackInput): Packed {
  const n = xs.length;
  const out = new Float32Array(n * 2);
  if (!n || !(width > 0)) return { pts: out, r: 0.5, crowded: 0, maxShift: 0, separate: false };
  const rand = seeded(seed);
  let area = 0;
  for (let c = 0; c < width; c++) area += Math.max(0, heightAt(c + 0.5));
  const rArea = 0.42 * Math.sqrt(area / n);
  // Columns one dot-width apart, on whole device pixels, centred on device-pixel centres. On a screen of
  // under 1.25 device pixels a CSS pixel, 21,000 dots cannot each have pixels of their own — separated,
  // the field was four-fifths empty — so the columns stay a pixel apart and the dots overlap across them
  // as ever; only a column is kept from crowding.
  const separate = dpr >= 1.25;
  // Rounded DOWN, not to nearest. The pitch is a whole number of device pixels, so it steps: a field
  // whose average room grows by a few percent can cross the halfway mark and take a whole extra pixel
  // per column, which is a third fewer columns, a third more dots in the busiest ones, and a peak that
  // closes into a solid mass. That is exactly what a finer curve did (its narrow spikes give the field
  // a little more area). Flooring keeps the tighter columns: the dots of neighbouring columns overlap
  // a shade more, which this field has always allowed, and no column is asked to hold more than it can.
  const pitchDev = separate ? Math.max(1, Math.floor(2 * rArea * dpr)) : 1;
  const pitch = pitchDev / dpr;
  const C = Math.max(1, Math.floor(width / pitch));
  const cx = new Float64Array(C);
  for (let j = 0; j < C; j++) cx[j] = (j * pitchDev + Math.floor(pitchDev / 2) + 0.5) / dpr;
  // Dots that stand apart sit on device-pixel centres, where a sprite stamps without resampling.
  const snap = separate;
  // Never under half a device pixel across the radius (under that a dot is lost), else as big as the
  // columns and the room to spare allow — or, not separated, sized to the room as one-pixel columns are.
  const r = separate
    ? Math.max(0.5 / dpr, Math.min(2, rArea, (FILL * pitch) / 2, (FILL * area) / (2 * SPARE * n * pitch)))
    : Math.min(2, Math.max(0.5, rArea));
  // A slot: a dot's width over its fill. Snapped, it is a whole number of device pixels and every dot sits
  // on a whole device row, so snapping can never bring two of a column's dots nearer than a slot.
  const slotDev = Math.ceil((2 * r * dpr) / FILL);
  const slot = snap ? slotDev / dpr : (2 * r) / FILL;
  const usable = new Float64Array(C);
  const rowLo = new Int32Array(C);
  const rowHi = new Int32Array(C);
  const cap = new Int32Array(C);
  for (let j = 0; j < C; j++) {
    usable[j] = Math.max(0, heightAt(cx[j]) - 2 * r);
    const lo = baseY - r - usable[j], hi = baseY - r;
    if (snap) {
      // The device rows whose centres lie between the curve and the baseline, a radius inside both.
      rowLo[j] = Math.ceil(lo * dpr - 0.5);
      rowHi[j] = Math.max(rowLo[j], Math.floor(hi * dpr - 0.5));
      cap[j] = Math.floor((rowHi[j] - rowLo[j]) / slotDev) + 1;
    } else {
      // From the baseline to the curve, ends included: k dots are usable/(k - 1) apart.
      cap[j] = Math.floor(usable[j] / slot) + 1;
    }
  }
  const colOf = (x: number) => Math.min(C - 1, Math.max(0, Math.floor(x / pitch)));
  const want = new Int32Array(C);
  for (let i = 0; i < n; i++) want[colOf(xs[i])]++;
  // How many dots each column holds. The dots are handed out in pay order, so the first T[j] go to columns
  // 0..j; a dot may move at most D columns, so T[j] lies between the dots of columns up to j - D and those
  // up to j + D, and T[j] - T[j - 1] should not pass the column's room. Within those bounds T follows the
  // counts evened out over the same D columns (a triangular blur), so the texture is even rather than full
  // columns beside thin ones. A forward and a backward pass find where the bounds leave room; only where
  // they leave none is a column given more than its room (and counted crowded).
  const D = Math.max(1, Math.round(spill / pitch));
  const cum = new Float64Array(C + 1); // cum[j + 1]: dots in columns 0..j
  for (let j = 0; j < C; j++) cum[j + 1] = cum[j] + want[j];
  const W = (j: number) => cum[Math.min(C, Math.max(0, j + 1))];
  const blur = new Float64Array(C);
  for (let j = 0; j < C; j++) {
    if (!want[j]) continue;
    let wsum = 0;
    for (let d = -D; d <= D; d++) if (j + d >= 0 && j + d < C) wsum += D + 1 - Math.abs(d);
    for (let d = -D; d <= D; d++) if (j + d >= 0 && j + d < C) blur[j + d] += (want[j] * (D + 1 - Math.abs(d))) / wsum;
  }
  const lo = new Float64Array(C), hi = new Float64Array(C);
  for (let j = 0; j < C; j++) {
    const pl = j ? lo[j - 1] : 0, ph = j ? hi[j - 1] : 0;
    lo[j] = Math.max(W(j - D), pl);
    hi[j] = Math.min(W(j + D), ph + cap[j]);
    if (lo[j] > hi[j]) hi[j] = lo[j];
  }
  lo[C - 1] = hi[C - 1] = n;
  for (let j = C - 2; j >= 0; j--) {
    hi[j] = Math.min(hi[j], hi[j + 1]);
    lo[j] = Math.max(lo[j], lo[j + 1] - cap[j + 1]);
    if (lo[j] > hi[j]) lo[j] = hi[j];
  }
  const hold = new Int32Array(C);
  let prev = 0, target = 0;
  for (let j = 0; j < C; j++) {
    target += blur[j];
    const floor = Math.max(lo[j], prev), ceil = Math.min(hi[j], prev + cap[j]);
    const t = j === C - 1 ? n : Math.round(Math.min(Math.max(target, floor), Math.max(floor, ceil)));
    hold[j] = t - prev;
    prev = t;
  }
  // The counts filled with the dots in pay order.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  let crowded = 0, maxShift = 0, at = 0;
  for (let j = 0; j < C; j++) {
    const k = hold[j];
    if (!k) continue;
    const list = order.slice(at, at + k);
    at += k;
    for (let i = list.length - 1; i > 0; i--) {
      const q = Math.floor(rand() * (i + 1));
      [list[i], list[q]] = [list[q], list[i]];
    }
    if (stack) list.sort((a, b) => stack[a] - stack[b]);
    if (k > cap[j]) crowded += k;
    if (snap) {
      // From the baseline row to the curve's, each gap a slot and a chance share of the column's free rows,
      // so no two are ever nearer than a slot and neighbouring columns' rows do not line up. A lone dot
      // anywhere in its column; a crowded column evenly, with no room to share.
      const rows = rowHi[j] - rowLo[j];
      const freeRows = rows - (k - 1) * slotDev;
      const rowsOf: number[] = [];
      if (k === 1) rowsOf.push(rowLo[j] + Math.floor(rand() * (rows + 1)));
      else if (freeRows < 0) for (let q = 0; q < k; q++) rowsOf.push(rowHi[j] - Math.round((q * rows) / (k - 1)));
      else {
        const w = Array.from({ length: k - 1 }, () => 0.5 + rand());
        const wsum = w.reduce((a, b) => a + b, 0);
        const extra = w.map((v) => Math.floor((freeRows * v) / wsum));
        let left = freeRows - extra.reduce((a, b) => a + b, 0);
        for (let q = 0; left > 0; q = (q + 1) % extra.length, left--) extra[q]++;
        let row = rowHi[j];
        rowsOf.push(row);
        for (let q = 1; q < k; q++) { row -= slotDev + extra[q - 1]; rowsOf.push(row); }
      }
      for (let q = 0; q < k; q++) {
        const i = list[q];
        out[2 * i] = cx[j];
        out[2 * i + 1] = (rowsOf[q] + 0.5) / dpr;
        const shift = Math.abs(cx[j] - Math.min(width, Math.max(0, xs[i])));
        if (shift > maxShift) maxShift = shift;
      }
    } else {
      // Overlapping one-pixel columns: each dot jittered across its whole slot, as layoutDots does, or
      // neighbouring columns' rows would line up into contours; kept from crowding by the counts alone.
      const gap = k > 1 ? usable[j] / (k - 1) : 0;
      for (let q = 0; q < k; q++) {
        const i = list[q];
        const up = k > 1 ? q * gap + (rand() - 0.5) * 0.98 * gap : usable[j] * rand();
        out[2 * i] = cx[j];
        out[2 * i + 1] = baseY - r - Math.min(usable[j], Math.max(0, up));
        const shift = Math.abs(cx[j] - Math.min(width, Math.max(0, xs[i])));
        if (shift > maxShift) maxShift = shift;
      }
    }
  }
  return { pts: out, r, crowded, maxShift, separate };
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

/**
 * The people behind per-$100 counts, as pays in ascending order (`paysFromCounts`), and — when the
 * counts are also given by category — each person's category index, in the categories' order. Within a
 * $100 the categories take its people in order, so every pay is the one `paysFromCounts` gives. Without
 * categories, or if theirs do not sum to `counts` bin by bin, `kinds` is null.
 */
export function peopleFromCounts(
  lo100: number,
  counts: readonly number[],
  categories?: readonly { counts: readonly number[] }[] | null,
): { pays: Float64Array; kinds: Uint8Array | null } {
  const pays = paysFromCounts(lo100, counts);
  if (!categories?.length) return { pays, kinds: null };
  const kinds = new Uint8Array(pays.length);
  let k = 0;
  for (let b = 0; b < counts.length; b++) {
    let seen = 0;
    for (let c = 0; c < categories.length; c++) {
      const m = categories[c].counts[b] ?? 0;
      for (let i = 0; i < m; i++) kinds[k + seen + i] = c;
      seen += m;
    }
    if (seen !== counts[b]) return { pays, kinds: null };
    k += seen;
  }
  return { pays, kinds };
}
