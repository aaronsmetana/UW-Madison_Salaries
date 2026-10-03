/**
 * The landing graph as strata (mockup 3a): one square per person, in $1k columns a few squares wide,
 * filled from the baseline up, each column's people stacked by employment type so the field reads as
 * horizontal bands of colour. Everything here is a pure function of the counts and the plot's size —
 * who sits where, the grid's measures, the lens's fisheye, the pins' rows, the motions' timing — so the
 * canvas (components/chart/StrataField) only draws what these say.
 *
 * People are indexed exactly as `dotSpots` (lib/homePeople) indexes them: under the cap, $100 bucket by
 * bucket, each bucket's categories in the counts' order; past it, each category's block in turn. So a
 * filter's mask (`emphasis`) and a search's marks apply to the squares unchanged.
 */

/** $0–$250k in $1k columns. */
export const COLS = 250;
export const COL_DOLLARS = 1000;
/** The pile past the cap: this many squares a row. */
export const PILE_PER_ROW = 14;
/** From the baseline up (3a): the two largest bands at the floor, so the skyline's shape is theirs. */
export const TYPE_ORDER = ['Academic Staff', 'University Staff', 'Employees in Training', 'Faculty', 'Limited'] as const;
/** The readout counts the columns this far either side of the one under the lens: ±$5k. */
export const READ_RADIUS = 5;

/** Each category's stacking rank: its place in TYPE_ORDER, and any other after those, in the counts' order. */
export function typeRanks(names: readonly string[]): Uint8Array {
  const out = new Uint8Array(names.length);
  names.forEach((n, i) => {
    const r = (TYPE_ORDER as readonly string[]).indexOf(n);
    out[i] = r >= 0 ? r : TYPE_ORDER.length + i;
  });
  return out;
}

/** A person's fixed place in their band: a hash of their index, the same on every render and every visit. */
export function stableKey(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

export interface StrataCounts {
  lo100: number;
  counts: readonly number[];
  categories?: readonly { name: string; over: number; counts: readonly number[] }[] | null;
}

export interface Strata {
  /** Under the cap, one each, in `dotSpots` order: the $1k column, the category, the band key. */
  col: Uint8Array;
  kind: Uint8Array;
  key: Uint32Array;
  /** Past the cap, in the pile's order. */
  pileKind: Uint8Array;
  pileKey: Uint32Array;
  /** People under the cap per column. */
  colCount: Uint32Array;
  /** Category index → stacking rank (`typeRanks`). */
  rank: Uint8Array;
  names: string[];
}

/** Everyone in the counts, as squares. Null where the counts carry no categories, or the categories do
 *  not add up to the counts (then nothing could be stacked by type honestly). */
export function strataFromCounts(pc: StrataCounts): Strata | null {
  const cats = pc.categories;
  if (!cats?.length) return null;
  let n = 0;
  for (const v of pc.counts) n += v;
  const col = new Uint8Array(n), kind = new Uint8Array(n), key = new Uint32Array(n);
  const colCount = new Uint32Array(COLS);
  let i = 0;
  for (let b = 0; b < pc.counts.length; b++) {
    const c = Math.min(COLS - 1, Math.max(0, Math.floor((pc.lo100 + b) / 10)));
    let inBucket = 0;
    for (let k = 0; k < cats.length; k++) {
      const m = cats[k].counts[b] ?? 0;
      inBucket += m;
      if (i + m > n) return null;
      for (let r = 0; r < m; r++, i++) { col[i] = c; kind[i] = k; key[i] = stableKey(i); }
    }
    if (inBucket !== pc.counts[b]) return null;
    colCount[c] += inBucket;
  }
  const over = cats.reduce((t, c) => t + c.over, 0);
  const pileKind = new Uint8Array(over), pileKey = new Uint32Array(over);
  let j = 0;
  cats.forEach((c, k) => { for (let r = 0; r < c.over; r++, j++) { pileKind[j] = k; pileKey[j] = stableKey(n + j); } });
  return { col, kind, key, pileKind, pileKey, colCount, rank: typeRanks(cats.map((c) => c.name)), names: cats.map((c) => c.name) };
}

export interface Stack {
  /** Each person's slot in their column, 0 at the baseline. */
  slot: Uint16Array;
  /** Per column, its people in slot order: column c's are `order[start[c]] … order[start[c + 1] - 1]`. */
  order: Int32Array;
  start: Int32Array;
}

/**
 * Who stands where in each column: the people a filter lights first (`dim[i] === 0`, when there is a
 * filter), then by type rank, then by band key. So with a filter on, its people sink to the floor in
 * their own shape inside the campus's, which does not change; with none, every column is the same
 * bands in the same order.
 */
export function stackColumns(
  col: ArrayLike<number>, kind: ArrayLike<number>, key: ArrayLike<number>, rank: ArrayLike<number>,
  dim: ArrayLike<number> | null, cols: number,
): Stack {
  const n = col.length;
  const start = new Int32Array(cols + 1);
  for (let i = 0; i < n; i++) start[col[i] + 1]++;
  for (let c = 0; c < cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[col[i]]++] = i;
  const cmp = (a: number, b: number) =>
    (dim ? dim[a] - dim[b] : 0) || rank[kind[a]] - rank[kind[b]] || key[a] - key[b] || a - b;
  const slot = new Uint16Array(n);
  for (let c = 0; c < cols; c++) {
    const part = order.subarray(start[c], start[c + 1]);
    part.sort(cmp);
    for (let s = 0; s < part.length; s++) slot[part[s]] = s;
  }
  return { slot, order, start };
}

export interface Grid {
  /** Squares a row in a column. */
  per: number;
  /** From one square to the next, CSS px. */
  pitch: number;
  /** A square's side, CSS px. */
  sq: number;
}

/**
 * The largest squares that fit: `per` a row in a column `colW` wide, the tallest column (`peak` people)
 * in `rowsH`. 3a's 1.5px pitch with 1.05px squares, three a row, is what a 1,125px plot gives; a wider
 * or taller one (full page) gets bigger squares, a phone's smaller ones. On whole device pixels, a
 * square and its gap, where the pitch is two or more of them — crisp at any density; at one, a solid
 * run (a 1x screen); under one (a phone's narrow plot), the stack is a solid histogram of bands.
 */
export function strataGrid({ colW, rowsH, peak, dpr }: { colW: number; rowsH: number; peak: number; dpr: number }): Grid {
  let best: Grid | null = null;
  const tall = Math.max(1, peak);
  for (let per = 1; per <= 8; per++) {
    const p = Math.min(colW / per, rowsH / Math.ceil(tall / per), 4);
    if (!(p > 0)) continue;
    const pd = Math.floor(p * dpr + 1e-6);
    const pitch = pd >= 1 ? pd / dpr : p;
    const sq = pd >= 2 ? Math.max(1, Math.round(pd * 0.7)) / dpr : pitch;
    // The largest pitch; between equals (a 1x screen, where several give one pixel), the nearest to 3a's three a row.
    if (!best || pitch > best.pitch + 1e-9 || (Math.abs(pitch - best.pitch) <= 1e-9 && Math.abs(per - 3) < Math.abs(best.per - 3))) best = { per, pitch, sq };
  }
  return best ?? { per: 1, pitch: 1, sq: 1 };
}

/** On the device's pixel grid. */
export const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

/** The left edge of column `c`'s squares: centred in its share of the plot, on the pixel grid. */
export function colLeft(c: number, colW: number, grid: Grid, dpr: number, x0 = 0): number {
  return snap(x0 + c * colW + (colW - grid.per * grid.pitch) / 2, dpr);
}

/** A square's top-left corner, from its slot: across its column's row, then up from the baseline. */
export function squareAt(left: number, slot: number, per: number, pitch: number, base: number): { x: number; y: number } {
  return { x: left + (slot % per) * pitch, y: base - (Math.floor(slot / per) + 1) * pitch };
}

/** How tall a column of `n` stands, CSS px. */
export const colHeight = (n: number, grid: Grid) => Math.ceil(n / grid.per) * grid.pitch;

/**
 * The lens (3a §5): a Sarkar–Brown fisheye of distortion `d` over radius `R`. A point `dx, dy` from the
 * centre moves out to `g·R` along the same line, `g = (d+1)u / (du+1)` for `u = r/R`, and is drawn
 * `scale = (d+1) / (du+1)²` times its size — about six times at the centre, crowding into a ring at the rim.
 * Null outside the lens.
 */
export function fisheye(dx: number, dy: number, R: number, d = 5): { x: number; y: number; scale: number } | null {
  const r = Math.hypot(dx, dy);
  if (r >= R) return null;
  const u = r / R;
  const k = d * u + 1;
  if (r === 0) return { x: 0, y: 0, scale: d + 1 };
  const g = ((d + 1) * u) / k;
  const f = (g * R) / r;
  return { x: dx * f, y: dy * f, scale: (d + 1) / (k * k) };
}

/** People within ±`radius` columns of `c`. */
export function within(colCount: ArrayLike<number>, c: number, radius = READ_RADIUS): number {
  let t = 0;
  for (let k = Math.max(0, c - radius); k <= Math.min(colCount.length - 1, c + radius); k++) t += colCount[k];
  return t;
}

/** Where column `c` stands among everyone (`total`, the pile too): those in lower columns and half of
 *  its own, as a share. */
export function shareAt(colCount: ArrayLike<number>, c: number, total: number): number {
  let below = 0;
  for (let k = 0; k < Math.min(c, colCount.length); k++) below += colCount[k];
  return total > 0 ? (below + colCount[c] / 2) / total : 0;
}

/**
 * Rows for the percentile pins' labels (3a §4). In priority order each takes the first of: row 0 right of
 * its line, row 0 left of it, row 1 right, row 1 left, … that keeps `pad` clear of every label already in
 * that row and stays inside `[0, width]`. One that fits nowhere goes in the last row, clamped inside.
 */
export function placePins(pins: readonly { x: number; w: number }[], width: number, rows = 3, pad = 12, gap = 5): { row: number; left: number }[] {
  const taken: { left: number; right: number }[][] = Array.from({ length: rows }, () => []);
  return pins.map((p) => {
    for (let row = 0; row < rows; row++) {
      for (const left of [p.x + gap, p.x - gap - p.w]) {
        const right = left + p.w;
        if (left < 0 || right > width) continue;
        if (taken[row].some((t) => left < t.right + pad && t.left < right + pad)) continue;
        taken[row].push({ left, right });
        return { row, left };
      }
    }
    const left = Math.max(0, Math.min(width - p.w, p.x + gap));
    taken[rows - 1].push({ left, right: left + p.w });
    return { row: rows - 1, left };
  });
}

/** A filter's re-stack (3a §7): this long, cubic in and out, set off left to right over WAVE_MS. */
export const RESTACK_MS = 425;
export const RESTACK_WAVE_MS = 130;
/** The drop (3a §10): each square from 10–150px above the plot, set off left to right over DROP_WAVE_MS
 *  and a row's worth later each row up, so the floor lands first. */
export const DROP_MS = 350;
export const DROP_WAVE_MS = 210;
export const DROP_ROW_MS = 0.55;

export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
/** A fall that speeds up as it drops, then a hop of 4.5% of the fall as it lands. */
export function landEase(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p < 0.8 ? (p / 0.8) ** 2 : 1 - 0.045 * Math.sin((Math.PI * (p - 0.8)) / 0.2);
}
