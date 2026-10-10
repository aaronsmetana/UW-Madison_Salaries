/**
 * The landing graph (mockup 3a): one square per person, in $5k columns from $0 to $250k and a last column for
 * everyone paid more, each column's people sorted by salary from the baseline up — the lowest paid at the
 * bottom left — and coloured by employment type. Everything here is a pure function of the counts and the
 * plot's size — who sits where, the grid's measures, the pins' rows, the motions' timing —
 * so the canvas (components/strata/StrataField) only draws what these say.
 *
 * People are indexed exactly as `dotSpots` (lib/homePeople) indexes them: under the cap, $100 bucket by
 * bucket, each bucket's categories in the counts' order; past it, each category's block in turn. So a
 * filter's mask (`emphasis`) and a search's marks apply to the squares unchanged.
 */

/** $0–$250k in $5k columns; the pile past the cap is the column after them. */
export const COLS = 50;
export const COL_DOLLARS = 5000;
/** The legend's order (3a's: the largest first), and the tie-break between equal pays. */
export const TYPE_ORDER = ['Academic Staff', 'University Staff', 'Faculty', 'Employees in Training', 'Limited'] as const;
/** The readout counts the columns this far either side of the one under the lens: ±$5k. */
export const READ_RADIUS = 1;
/** The largest a square's pitch grows, device px (full page on a big screen). */
export const MAX_PITCH_D = 12;
/** The gutter between two columns' squares, CSS px, and at most this share of a column (a phone's narrow ones). */
export const GUTTER = 3;
export const GUTTER_SHARE = 0.125;

/** Each category's rank: its place in TYPE_ORDER, and any other after those, in the counts' order. */
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
  /** Under the cap, one each, in `dotSpots` order: the $5k column, the category, a fixed key, and the pay each is
   *  sorted by in their column — their own, or from the counts their $100 bucket's. */
  col: Uint8Array;
  kind: Uint8Array;
  key: Uint32Array;
  pay: Float64Array;
  /** Past the cap, in the pile's order. */
  pileKind: Uint8Array;
  pileKey: Uint32Array;
  /** Past the cap, each one's own pay, in the pile's order — what the pile unrolls to. Null where the counts
   *  do not carry them (an older snapshot): that pile stays a pile. */
  pilePay: Float64Array | null;
  /** People under the cap per column. */
  colCount: Uint32Array;
  /** Category index → rank (`typeRanks`). */
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
  const col = new Uint8Array(n), kind = new Uint8Array(n), key = new Uint32Array(n), pay = new Float64Array(n);
  const colCount = new Uint32Array(COLS);
  let i = 0;
  for (let b = 0; b < pc.counts.length; b++) {
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(((pc.lo100 + b) * 100) / COL_DOLLARS)));
    let inBucket = 0;
    for (let k = 0; k < cats.length; k++) {
      const m = cats[k].counts[b] ?? 0;
      inBucket += m;
      if (i + m > n) return null;
      for (let r = 0; r < m; r++, i++) { col[i] = c; kind[i] = k; key[i] = stableKey(i); pay[i] = (pc.lo100 + b) * 100; }
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
  return { col, kind, key, pay, pileKind, pileKey, pilePay, colCount, rank: typeRanks(cats.map((c) => c.name)), names: cats.map((c) => c.name) };
}

export interface Stack {
  /** Each person's slot in their column, 0 at the baseline. */
  slot: Uint16Array;
  /** Per column, its people in slot order: column c's are `order[start[c]] … order[start[c + 1] - 1]`. */
  order: Int32Array;
  start: Int32Array;
}

/**
 * Who stands where in each column: by salary from the baseline up, the lowest paid at the bottom left — ties
 * (the counts know a pay only to its $100) by type, then by a fixed key. A filter never moves anyone: it lights
 * its people where they stand. Without pays (a pile whose pays the counts do not carry), by type, then key.
 * `byType` (3a's sort-order setting): by type first, then salary, so each column stands in clean bands of colour.
 */
export function stackColumns(col: ArrayLike<number>, pay: ArrayLike<number> | null, kind: ArrayLike<number>, key: ArrayLike<number>, rank: ArrayLike<number>, cols: number, byType = false): Stack {
  const n = col.length;
  const start = new Int32Array(cols + 1);
  for (let i = 0; i < n; i++) start[col[i] + 1]++;
  for (let c = 0; c < cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[col[i]]++] = i;
  const cmp = byType
    ? (a: number, b: number) => rank[kind[a]] - rank[kind[b]] || (pay ? pay[a] - pay[b] : 0) || key[a] - key[b] || a - b
    : (a: number, b: number) => (pay ? pay[a] - pay[b] : 0) || rank[kind[a]] - rank[kind[b]] || key[a] - key[b] || a - b;
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
  /** A square's pitch across and up, CSS px: a whole number of device pixels, the same both ways — except a
   *  solid run's (`gap` 0), whose rows stretch to stand the tallest column in the room. */
  pitch: number;
  rowPitch: number;
  /** The gap between squares, device px: one, or none in a solid run. */
  gap: number;
  /** A square's height and width, CSS px: the pitch less the gap. */
  sq: number;
  sqW: number;
  /** From a column's left edge (on its device pixel) to its first square, device px: the bar centred in it. */
  off: number;
}

/** A bar is never narrower than this share of its column (less the gutter). */
export const BAR_MIN = 2 / 3;

/**
 * The largest squares that fit (3a): the largest whole number of device pixels for a square's pitch with which the
 * tallest column (`peak` people) still fits in `rowsH`, a bar as wide as its column less a gutter. Each square is a
 * device pixel short of its pitch, so a gap always parts it from the next. Then as few a row as still stand that
 * column in the room — the pitch is whole pixels, so the widest bars could leave a third of it empty (56% of a
 * 1440x900 plot) — but never a bar under BAR_MIN of its column. Where no pitch of two pixels fits (a phone; a 1x
 * screen), the bars are solid runs of single-pixel columns, their rows stretched to fill the room.
 */
export function strataGrid({ colW, rowsH, peak, dpr, maxPitch = MAX_PITCH_D, gutter: gutterCss = GUTTER }: { colW: number; rowsH: number; peak: number; dpr: number; maxPitch?: number; gutter?: number }): Grid {
  const tall = Math.max(1, peak);
  const cw = Math.floor(colW * dpr + 1e-6), ph = Math.floor(rowsH * dpr + 1e-6);
  const gutter = Math.max(1, Math.round(Math.min(gutterCss, colW * GUTTER_SHARE) * dpr));
  const room = Math.max(1, cw - gutter);
  const off = (wide: number) => Math.floor((cw - wide) / 2);
  for (let pd = maxPitch; pd >= 2; pd--) {
    const most = Math.floor(room / pd);
    if (most < 1 || Math.ceil(tall / most) * pd > ph) continue;
    const per = Math.min(most, Math.max(Math.ceil(tall / Math.floor(ph / pd)), Math.ceil((BAR_MIN * room) / pd)));
    return { per, pitch: pd / dpr, rowPitch: pd / dpr, gap: 1, sq: (pd - 1) / dpr, sqW: (pd - 1) / dpr, off: off(per * pd) };
  }
  const per = Math.min(room, Math.max(Math.ceil(tall / Math.max(1, ph)), Math.ceil(BAR_MIN * room)));
  const rowPitch = rowsH / Math.ceil(tall / per);
  return { per, pitch: 1 / dpr, rowPitch, gap: 0, sq: rowPitch, sqW: 1 / dpr, off: off(per) };
}

/** On the device's pixel grid. */
export const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

/** A square's device-pixel box, from its corner `x, y` (CSS px): on the corner's pixel, to the next row's first
 *  pixel less the gap (a solid run's stretched rows differ by a pixel), and its width. */
export interface Px { X: number; Y: number; w: number; h: number }
/** To the nearest pixel, a hair short of half rounding down. */
const px = (v: number) => Math.floor(v + 0.5 - 1e-6);
export function squarePixels(x: number, y: number, g: Grid, dpr: number, out: Px = { X: 0, Y: 0, w: 0, h: 0 }): Px {
  out.X = px(x * dpr);
  out.Y = px(y * dpr);
  out.w = Math.max(1, px(g.sqW * dpr));
  out.h = Math.max(1, px((y + g.rowPitch) * dpr) - out.Y - g.gap);
  return out;
}

/** The left edge of column `c`, CSS px, on its device pixel. */
export const colLeft = (c: number, colW: number, dpr = 1, x0 = 0) => x0 + Math.round(c * colW * dpr) / dpr;
/** Where column `c`'s first square is, CSS px: its left edge and the grid's offset. */
export const colX = (c: number, colW: number, g: Pick<Grid, 'off'>, dpr: number, x0 = 0) => colLeft(c, colW, dpr, x0) + g.off / dpr;

/** A square's top-left corner, from its slot: across its column's row, then up from the baseline. */
export function squareAt(left: number, slot: number, per: number, g: Pick<Grid, 'pitch' | 'rowPitch'>, base: number): { x: number; y: number } {
  return { x: left + (slot % per) * g.pitch, y: base - (Math.floor(slot / per) + 1) * g.rowPitch };
}

/** How tall a column of `n` stands, CSS px. */
export const colHeight = (n: number, grid: Grid) => Math.ceil(n / grid.per) * grid.rowPitch;

/**
 * Magnify (3a): the histogram's columns six to the plot — a $30k window — with much larger squares, the window
 * panned along the axis; a strip over it shows the whole of it and where the window is.
 */
export const MAG_COLS = 6;
/** Magnified, a square's pitch grows to this many device pixels, and columns stand this far apart, CSS px. */
export const MAG_MAX_PITCH_D = 30;
export const MAG_GUTTER = 12;
/** The window's left edge, in dollars, at its furthest: the pile's column the last in view. */
export const MAG_LEFT_MAX = (COLS + 1 - MAG_COLS) * COL_DOLLARS;
/** The window centred on a pay's column, as far as it goes. */
export const magLeftFor = (pay: number) =>
  Math.max(0, Math.min(MAG_LEFT_MAX, (Math.min(COLS, Math.floor(pay / COL_DOLLARS)) + 0.5) * COL_DOLLARS - (MAG_COLS * COL_DOLLARS) / 2));

/**
 * Floors (3a): a second layout of everyone, in $10k bands stacked from the bottom up — under $30k, $30–40k …
 * $190–200k, and $200k or more — each band a block of squares as wide as the others, wrapping into rows, sorted by
 * salary from its bottom row up. The band's name stands at its left and its people at its right.
 */
export const FLOORS = 19;
export const floorOf = (pay: number) => (pay < 30_000 ? 0 : pay >= 200_000 ? FLOORS - 1 : Math.floor((pay - 30_000) / 10_000) + 1);
export const floorLabel = (f: number) => (f === 0 ? 'Under $30k' : f === FLOORS - 1 ? '$200k+' : `$${20 + f * 10}–${30 + f * 10}k`);
/** The lowest pay a floor holds. */
export const floorPay = (f: number) => (f === 0 ? 0 : 20_000 + f * 10_000);
/** A floor's square, CSS px, at most (3a's 6px): smaller where the floors would not all fit. */
export const FLOOR_PITCH = 6;
/** The gap between floors, CSS px: at least (on a phone, less), and at most where there is room to spare. */
export const FLOOR_GAP = { least: 3, phone: 2, most: 10 };

export interface FloorsGrid {
  /** Squares a row, every floor alike; the pitch, CSS px (whole device pixels); the gap between floors. */
  per: number;
  pitch: number;
  gap: number;
}
/**
 * The largest squares, up to FLOOR_PITCH, with which every floor fits a block `width` wide in `room`: each floor as
 * many rows as its people (`counts`, `headroom` more for another snapshot's), and never shorter than `least` (its
 * label's line). The gap between floors is what is left, within FLOOR_GAP.
 */
export function floorsGrid({ width, room, counts, least, dpr, gapLeast = FLOOR_GAP.least, headroom = 1.05 }: { width: number; room: number; counts: ArrayLike<number>; least: number; dpr: number; gapLeast?: number; headroom?: number }): FloorsGrid {
  const tallBy = (p: number, per: number, k: number) => {
    let h = 0;
    for (let f = 0; f < counts.length; f++) h += Math.max(least, Math.max(1, Math.ceil((counts[f] * k) / per)) * p);
    return h;
  };
  for (let pd = Math.round(FLOOR_PITCH * dpr); pd >= 1; pd--) {
    const pitch = pd / dpr, per = Math.floor(width / pitch);
    if (per < 1 || tallBy(pitch, per, headroom) + (counts.length - 1) * gapLeast > room) continue;
    const gap = Math.min(FLOOR_GAP.most, Math.max(gapLeast, (room - tallBy(pitch, per, 1)) / Math.max(1, counts.length - 1)));
    return { per, pitch, gap };
  }
  return { per: Math.max(1, Math.floor(width * dpr)), pitch: 1 / dpr, gap: gapLeast };
}

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

/** People within ±`radius` columns of `c`. */
export function within(colCount: ArrayLike<number>, c: number, radius = READ_RADIUS): number {
  let t = 0;
  for (let k = Math.max(0, c - radius); k <= Math.min(colCount.length - 1, c + radius); k++) t += colCount[k];
  return t;
}

/**
 * Where a person's pay stands among everyone's (`desc`, highest first): their rank — one more than how many are
 * paid more — and how many are paid less. The share of the others paid less is the app's standing (lib/stats
 * `percentile`), so the person is never counted against themself.
 */
export function standingIn(desc: ArrayLike<number>, v: number): { rank: number; below: number } {
  const past = (more: boolean) => {
    let lo = 0, hi = desc.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (more ? desc[mid] > v : desc[mid] >= v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return { rank: past(true) + 1, below: desc.length - past(false) };
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

/** A change of view, histogram and floors (3a): about 2.2 s in all — each square sets off over the first VIEW_WAVE
 *  of it (into the floors bottom first, back left first) and VIEW_JITTER more at random, moves for VIEW_MOVE of it,
 *  and hops up to VIEW_HOP px on the way. */
export const VIEW_MS = 2200;
export const VIEW_WAVE = 0.42;
export const VIEW_JITTER = 0.1;
export const VIEW_MOVE = 0.46;
export const VIEW_HOP = 30;
/** Back to an earlier snapshot (3a): a cross-fade, this long. */
export const FADE_MS = 800;
/** A jump of several snapshots on (3a): each step between, quickly — at this share of a step's time. */
export const CATCH_UP = 0.4;
/** Into the magnified view and out (3a): about 1.3 s, every square together but for a little at random. */
export const ZOOM_MS = 1300;
export const ZOOM_JITTER = 0.04;
export const ZOOM_MOVE = 0.92;
/** A move from one layout to another — the pile unrolling or folding back: this long, cubic in and out, set
 *  off left to right over MOVE_WAVE_MS. */
export const MOVE_MS = 425;
export const MOVE_WAVE_MS = 130;
/** The drop (3a §10): each square from 10–150px above the plot, set off left to right over DROP_WAVE_MS
 *  and a row's worth later each row up, so the floor lands first. */
export const DROP_MS = 350;
export const DROP_WAVE_MS = 210;
export const DROP_ROW_MS = 0.55;

/**
 * A timeline step (3a §8): what each square does between two snapshots — stays in its column (or floor), moves up
 * or down to another, joins, or leaves.
 */
export const STAY = 1, UP = 2, DOWN = 3, NEW = 4, LEFT = 5;
/** The speeds (3a §9), and the two ways a step is shown: raises and cuts (staged, in change colours), or by type. */
export type Pace = 'slow' | 'medium' | 'fast';
export type StepMode = 'change' | 'type';
/** A step's phases, ms: the move, the countdown that holds it, the re-sort, and the pause before the next; staged
 *  (raises and cuts at Slow or Medium) or straight from one sorted place to the next. */
export interface PacePlan { mv: number; cd: number; so: number; re: number; staged: boolean }
const PACES = {
  medium: { mv: 1500, cd: 1000, so: 900, re: 700, tmv: 1700, tre: 900 },
  slow: { mv: 2600, so: 1700, re: 1600, tmv: 2600, tre: 1600 },
} as const;
/** Fast: a snapshot every quarter second, straight between sorted places, no pauses. */
export const FAST_MS = 250;
/** Slow's countdown, seconds, unless the reader sets another. */
export const COUNTDOWN_S = 3;
export function pacePlan(pace: Pace, mode: StepMode, countdown = COUNTDOWN_S): PacePlan {
  if (pace === 'fast') return { mv: FAST_MS, cd: 0, so: 0, re: 0, staged: false };
  const p = PACES[pace];
  if (mode === 'type') return { mv: p.tmv, cd: 0, so: 0, re: p.tre, staged: false };
  return { mv: p.mv, cd: pace === 'slow' ? countdown * 1000 : PACES.medium.cd, so: p.so, re: p.re, staged: true };
}
/** Each square's own part of a step's move, as shares of it (3a): when it sets off — a left-to-right wave by its
 *  place across `w` (0–1), and a little at random `h` (0–1) — how long it takes, and, moving up or down `dx` px
 *  across, how high it arcs. Every one is done by the end. */
export function moveTiming(kind: number, w: number, h: number, dx = 0): { dl: number; du: number; arc: number } {
  if (kind === UP || kind === DOWN) return { dl: 0.03 + 0.42 * w + 0.07 * h, du: 0.3 + 0.12 * Math.min(1, Math.abs(dx) / 260), arc: Math.min(110, 10 + 0.3 * Math.abs(dx)) };
  if (kind === NEW) return { dl: 0.25 + 0.35 * w + 0.06 * h, du: 0.3, arc: 0 };
  if (kind === LEFT) return { dl: 0.42 * w + 0.05 * h, du: 0.22, arc: 0 };
  return { dl: 0.1 + 0.42 * w + 0.05 * h, du: 0.28, arc: 0 };
}
/**
 * A staged step's held picture (3a): each square's slot in its group (column, or floor) while the countdown holds
 * — who stayed at the bottom in their old order (`prev`, their slot before), then who came: cuts, raises, then new
 * hires, each by key. So who stayed keeps their seat, give or take the gaps of those who went, and who arrived
 * stands out on top until the re-sort.
 */
export function stagedSlots(group: ArrayLike<number>, kind: ArrayLike<number>, prev: ArrayLike<number>, key: ArrayLike<number>): Uint16Array {
  const n = group.length, at = [0, 0, 2, 1, 3, 4]; // by kind: STAY, then DOWN, UP, NEW
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) =>
    group[a] - group[b] || at[kind[a]] - at[kind[b]] || (kind[a] === STAY ? prev[a] - prev[b] : key[a] - key[b]) || a - b);
  const slot = new Uint16Array(n);
  let g = -1, k = 0;
  for (const i of order) {
    if (group[i] !== g) { g = group[i]; k = 0; }
    slot[i] = k++;
  }
  return slot;
}
/** The re-sort (3a): each column's people into salary order from the bottom row up — `k`th of `m` — a little at
 *  random, as shares of it. */
export const sortTiming = (k: number, m: number, h: number) => ({ dl: (0.5 * k) / Math.max(1, m) + 0.08 * h, du: 0.42 });
/** In the first part of a staged move everyone who stays fades from their type's colour to the neutral one. */
export const TYPE_FADE = 0.18;

/**
 * Fast's flow (3a §10): each square on one smooth curve through its places in snapshot after snapshot, a step a
 * unit of time. The tangent at `b` (between `a` before and `c` after) is monotone — zero where the path turns back
 * or either neighbour is unknown (NaN), and never more than three times the shorter side — so a cubic Hermite
 * piece never overshoots the places it joins (Fritsch–Carlson).
 */
export function monoTangent(a: number, b: number, c: number): number {
  const d0 = b - a, d1 = c - b;
  if (!(d0 * d1 > 0)) return 0;
  const m = (d0 + d1) / 2, l = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  return m > l ? l : m < -l ? -l : m;
}
/** The Hermite cubic from `x0` to `x1` at `t` (0–1), leaving and arriving at the tangents `m0` and `m1`. */
export function hermite(x0: number, x1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h11 = t3 - t2;
  return h00 * x0 + h10 * m0 + (1 - h00) * x1 + h11 * m1;
}

export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
/** A fall that speeds up as it drops, then a hop of 4.5% of the fall as it lands. */
export function landEase(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p < 0.8 ? (p / 0.8) ** 2 : 1 - 0.045 * Math.sin((Math.PI * (p - 0.8)) / 0.2);
}
