/**
 * The landing graph as strata (mockup 3a): one square per person, in $1k columns a few squares wide,
 * filled from the baseline up, each column's people stacked by employment type so the field reads as
 * horizontal bands of colour. Everything here is a pure function of the counts and the plot's size —
 * who sits where, the grid's measures, the lens's fisheye, the pins' rows, the motions' timing — so the
 * canvas (components/strata/StrataField) only draws what these say.
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
/** The largest a square's pitch grows, CSS px (full page on a wide screen). */
export const MAX_PITCH = 4;

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
  categories?: readonly { name: string; over: number; counts: readonly number[]; over_pays?: readonly number[] }[] | null;
}

export interface Strata {
  /** Under the cap, one each, in `dotSpots` order: the $1k column, the category, the band key. */
  col: Uint8Array;
  kind: Uint8Array;
  key: Uint32Array;
  /** Past the cap, in the pile's order. */
  pileKind: Uint8Array;
  pileKey: Uint32Array;
  /** Past the cap, each one's own pay, in the pile's order — what the pile unrolls to. Null where the counts
   *  do not carry them (an older snapshot): that pile stays a pile. */
  pilePay: Float64Array | null;
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
  let pilePay: Float64Array | null = over > 0 && cats.every((c) => (c.over_pays?.length ?? -1) === c.over) ? new Float64Array(over) : null;
  let j = 0;
  cats.forEach((c, k) => {
    for (let r = 0; r < c.over; r++, j++) {
      pileKind[j] = k;
      pileKey[j] = stableKey(n + j);
      if (pilePay) pilePay[j] = c.over_pays![r];
    }
  });
  if (pilePay && !pilePay.every((v) => v > 0)) pilePay = null;
  return { col, kind, key, pileKind, pileKey, pilePay, colCount, rank: typeRanks(cats.map((c) => c.name)), names: cats.map((c) => c.name) };
}

export interface Stack {
  /** Each person's slot in their column, 0 at the baseline. */
  slot: Uint16Array;
  /** Per column, its people in slot order: column c's are `order[start[c]] … order[start[c + 1] - 1]`. */
  order: Int32Array;
  start: Int32Array;
}

/**
 * Who stands where in each column: by type rank, then by band key — every column the same bands in the same
 * order. A filter never moves anyone: it lights its people where they stand.
 */
export function stackColumns(col: ArrayLike<number>, kind: ArrayLike<number>, key: ArrayLike<number>, rank: ArrayLike<number>, cols: number): Stack {
  const n = col.length;
  const start = new Int32Array(cols + 1);
  for (let i = 0; i < n; i++) start[col[i] + 1]++;
  for (let c = 0; c < cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[col[i]]++] = i;
  const cmp = (a: number, b: number) => rank[kind[a]] - rank[kind[b]] || key[a] - key[b] || a - b;
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
  /** Across, CSS px: exactly a column's width over `per`, so every column's squares lie on one even lattice —
   *  a column's last square as far from the next column's first as from its own neighbour, with no seam. */
  pitch: number;
  /** Up, CSS px: a whole number of device pixels, so the rows are even. */
  rowPitch: number;
  /** The gap between squares, device px, the same across and up. */
  gap: number;
  /** A square's height, and its width on average, CSS px: the pitch less the gap. Drawn on whole device
   *  pixels, a square is that wide or a pixel either side; the gap is always the gap. */
  sq: number;
  sqW: number;
}

/**
 * The largest squares that fit: `per` a row in a column `colW` wide, the tallest column (`peak` people) in
 * `rowsH`. Across, the lattice is the column's width over `per`, to the hundredth of a pixel, so the columns
 * meet without a seam; up, it is whole device pixels. A gap of a device pixel (two for big squares) parts
 * every square from the next both ways; where a row is under two device pixels (a phone's narrow plot) there
 * is no room for one, and the stack is a solid histogram of bands.
 */
export function strataGrid({ colW, rowsH, peak, dpr }: { colW: number; rowsH: number; peak: number; dpr: number }): Grid {
  let best: Grid | null = null;
  const tall = Math.max(1, peak);
  for (let per = 1; per <= 8; per++) {
    const pitch = colW / per;
    if (!(pitch > 0) || (pitch > MAX_PITCH && per < 8)) continue;
    const up = Math.min(pitch, rowsH / Math.ceil(tall / per));
    const ud = Math.floor(up * dpr + 1e-6);
    const rowPitch = ud >= 1 ? ud / dpr : up;
    const gap = ud >= 2 ? Math.max(1, Math.round(ud * 0.2)) : 0;
    // The tallest rows; between equals (a 1x screen, where several give one pixel), the nearest to 3a's three a row.
    if (!best || rowPitch > best.rowPitch + 1e-9 || (Math.abs(rowPitch - best.rowPitch) <= 1e-9 && Math.abs(per - 3) < Math.abs(best.per - 3))) {
      best = { per, pitch, rowPitch, gap, sq: rowPitch - gap / dpr, sqW: pitch - gap / dpr };
    }
  }
  return best ?? { per: 1, pitch: colW, rowPitch: 1, gap: 0, sq: 1, sqW: colW };
}

/** On the device's pixel grid. */
export const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

/**
 * A square's device-pixel box, from its corner `x, y` (CSS px): from its corner's pixel to the next lattice
 * place's, less the gap — every gap the same, the squares a pixel either side of their width. Where a square
 * is under two device pixels (a 1x screen) that pixel is half of it; there every square is the same instead,
 * and now and then a gap is a pixel wider. Lined up, those would draw a dark line down every fifth column, so
 * each row is set over by its own fraction of a pixel (the golden ratio's steps, which never repeat) and the
 * wider gaps scatter through the field.
 */
export interface Px { X: number; Y: number; w: number; h: number }
/** To the nearest pixel, a hair short of half rounding down: the same lattice place, reached as one column's
 *  last square plus a pitch or as the next column's first, lands on the same pixel. */
const px = (v: number) => Math.floor(v + 0.5 - 1e-6);
export function squarePixels(x: number, y: number, g: Grid, dpr: number, out: Px = { X: 0, Y: 0, w: 0, h: 0 }): Px {
  const Y = px(y * dpr);
  const ud = Math.max(1, px(g.rowPitch * dpr));
  out.Y = Y;
  out.h = Math.max(1, ud - g.gap);
  if (g.gap > 0 && g.sqW * dpr < 2) {
    const shift = ((Math.floor(Y / ud) * 0.6180339887) % 1) - 0.5;
    out.X = px(x * dpr + shift);
    out.w = Math.max(1, Math.floor(g.pitch * dpr) - g.gap);
  } else {
    out.X = px(x * dpr);
    out.w = Math.max(1, px((x + g.pitch) * dpr) - out.X - g.gap);
  }
  return out;
}

/** The left edge of column `c`'s squares. */
export const colLeft = (c: number, colW: number, x0 = 0) => x0 + c * colW;

/** A square's top-left corner, from its slot: across its column's row, then up from the baseline. */
export function squareAt(left: number, slot: number, per: number, g: Pick<Grid, 'pitch' | 'rowPitch'>, base: number): { x: number; y: number } {
  return { x: left + (slot % per) * g.pitch, y: base - (Math.floor(slot / per) + 1) * g.rowPitch };
}

/** How tall a column of `n` stands, CSS px. */
export const colHeight = (n: number, grid: Grid) => Math.ceil(n / grid.per) * grid.rowPitch;

/**
 * The pile unrolled: its people on an axis from $0 to the top salary at `scale` px a dollar, each in the
 * column of the lattice (`pitch` wide, one square a row) that their own pay falls in.
 */
export function tailColumns(pays: ArrayLike<number>, scale: number, pitch: number): Int32Array {
  const out = new Int32Array(pays.length);
  for (let j = 0; j < pays.length; j++) out[j] = Math.max(0, Math.floor((pays[j] * scale) / pitch));
  return out;
}

/**
 * How far the lens reaches for someone to name, CSS px of the field: about the spacing of the people it could
 * name there — `n` of them within its radius `R` — so where they crowd it names the one under the pointer, and
 * where a filter leaves a few it reaches across the lens for the nearest. Never under `least`, never past `R`.
 */
export function snapReach(n: number, R: number, least: number): number {
  if (n <= 0) return 0;
  return Math.min(R, Math.max(least, 2.5 * R * Math.sqrt(Math.PI / n)));
}

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

/** A move from one layout to another — the pile unrolling or folding back: this long, cubic in and out, set
 *  off left to right over MOVE_WAVE_MS. */
export const MOVE_MS = 425;
export const MOVE_WAVE_MS = 130;
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
