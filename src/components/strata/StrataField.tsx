import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  COLS, COL_DOLLARS, DOWN, LEFT, FADE_MS, MAG_COLS, MAG_GUTTER, MAG_MAX_PITCH_D, MOVE_MS, MOVE_WAVE_MS, NEW, TYPE_FADE, UP,
  VIEW_HOP, VIEW_JITTER, VIEW_MOVE, VIEW_MS, VIEW_WAVE, ZOOM_JITTER, ZOOM_MOVE, ZOOM_MS, moveTiming, sortTiming, type PacePlan, type StepMode,
  FLOORS, FLOOR_GAP, colHeight, colX, easeInOut, floorOf, floorsGrid, snap, snapReach, squareAt, squarePixels, stackColumns, strataGrid, tailColumns,
  hermite, monoTangent, stableKey, type Grid, type Px, type Stack, type Strata,
} from '../../lib/strata';
import { parseRgb } from '../../lib/inkMix';
import { followText, type StepCounts } from '../../lib/timeline';
import { prefersReducedMotion } from '../../lib/motion';
import { Z } from '../../lib/layers';

/**
 * The landing graph's people as strata (mockup 3a, lib/strata): a square each on one canvas, and the lens
 * on a second over it. The squares are redrawn only while they move — a timeline step, a change of view, the
 * pile unrolling — and the lens only while it follows the pointer; at rest nothing runs.
 */

/** The lens's radius at full size, CSS px, and how far it moves toward the pointer each frame. */
export const LENS_R = { phone: 56, wide: 76 };
const LENS_FOLLOW = 0.34;
const LENS_GROW = 0.28;
/** The loupe's magnification (3a): over the histogram, and over the floors. */
export const LOUPE_ZOOM = { hist: 4, floors: 2.5 };
/** A square the lens names is drawn at least this big, CSS px, however near the rim it sits. */
const PICK_MIN = 7;
/** Under a filter, a lit square is drawn at least this many device pixels each way. */
const LIT_MIN = 3;

/** A square's device pixels, worked out afresh for each square drawn: one, kept, rather than one a square. */
const BOX: Px = { X: 0, Y: 0, w: 0, h: 0 };
/** Each frame's cost goes on the page's performance timeline for the frame-budget guards; past this many of a
 *  name, the oldest go, so a long play never piles them up. */
const MEASURES_KEPT = 4000;
const measured = new Map<string, number>();
function measure(name: string, start: number) {
  try {
    performance.measure(name, { start, end: performance.now() });
    const k = (measured.get(name) ?? 0) + 1;
    if (k > MEASURES_KEPT) { performance.clearMeasures(name); measured.set(name, 0); } else measured.set(name, k);
  } catch { /* unsupported */ }
}

/** Unrolled, how far inside the right edge the top salary stands, CSS px. */
const TOP_INSET = 8;

/** Played once per session: after that the squares are simply there. */
const SEEN_KEY = 'strata-entrance';
const readSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const writeSession = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };
/** Whether the page plays the intro as it opens (3a §12): once a session, never under reduced motion or in a hidden
 *  tab. */
export function useIntroOnce(): boolean {
  const [play] = useState(() => !readSession() && !prefersReducedMotion() && !(typeof document !== 'undefined' && document.hidden));
  useEffect(() => { if (play) writeSession(); }, [play]);
  return play;
}

/** Who is dim under a filter: 1 for a square that fades, 0 for one of the group; one per square. */
export interface Dim { main: Uint8Array; pile: Uint8Array }
export type Field = 'main' | 'pile';
export interface Spot { field: Field; index: number }

export type StrataView = 'hist' | 'floors' | 'magnify';

/** Each field's columns sorted by salary, or by type then salary (lib/strata `stackColumns`), once: a pan or a
 *  resize lays out the same order. */
const stacks = new WeakMap<Strata, { salary?: { main: Stack; pile: Stack }; type?: { main: Stack; pile: Stack } }>();
function columnStacks(s: Strata, byType: boolean) {
  let by = stacks.get(s);
  if (!by) stacks.set(s, (by = {}));
  const k = byType ? 'type' : 'salary';
  return (by[k] ??= {
    main: stackColumns(s.col, s.pay, s.kind, s.key, s.rank, COLS, byType),
    pile: stackColumns(new Uint8Array(s.pileKind.length), s.pilePay, s.pileKind, s.pileKey, s.rank, 1, byType),
  });
}

export interface StrataLayout {
  W: number;
  H: number;
  dpr: number;
  /** The baseline's y; the squares stand on it. */
  base: number;
  /** How tall a column may stand: the baseline less the band the pins keep at the top. */
  room: number;
  /** CSS px per $5k column, and the main plot's width: $0 at 0, $250k at `mainW`, the pile's column after it. */
  colW: number;
  mainW: number;
  /** The pile's column: its left edge and width (none while it is unrolled). */
  pileLeft: number;
  pileW: number;
  grid: Grid;
  main: Stack;
  /** The pile's one column, or unrolled, the tail's columns. */
  pile: Stack;
  /** Each square's top-left corner at rest. */
  mx: Float64Array;
  my: Float64Array;
  px: Float64Array;
  py: Float64Array;
  /** The scale: the most people a column holds at full height. */
  peak: number;
  /** The highest any square stands: the top of the tallest column or of the pile. */
  peakY: number;
  /** The histogram; the floors, everyone in $10k bands stacked from the bottom up (lib/strata `floorOf`); or the
   *  histogram magnified, six columns to the plot, panned `ox` px along it (0 but magnified). */
  view: StrataView;
  ox: number;
  /** Floors: each one's bottom, height and people, from the lowest up; and the blocks' left and right edges. */
  floors: { base: number; h: number; n: number }[] | null;
  floorX: { left: number; right: number } | null;
  /** Unrolled: the pile's people at their own pay on an axis from $0 to the top salary (`top`, `scale` px a
   *  dollar), and the graph squeezed to its true share of it, `capX` px wide (`squeeze` of its own width).
   *  Null while the pile is a pile. */
  tail: { top: number; scale: number; capX: number; squeeze: number; topIndex: number } | null;
}

/**
 * Where everyone stands, for a plot `W` by `H` whose squares may rise to `top`: fifty $5k columns and the pile
 * past the cap as a fifty-first, each as wide as the others; the grid (lib/strata `strataGrid`) for the room
 * there is; each column sorted by salary (`stackColumns`); and each square's corner. Unrolled, the pile's people
 * stand at their own pay on an axis run out to the top salary, with the graph squeezed to its share of that axis.
 */
export function layoutStrata(
  s: Strata,
  /** `peak`: the scale, the most people a column holds at full height — the tallest column in any snapshot (the
   *  build's `column_peak`), so every snapshot is drawn to one. Never less than this field's own tallest. */
  opts: { W: number; H: number; top: number; dpr: number; phone: boolean; peak?: number; view?: StrataView; magLeft?: number; byType?: boolean },
  unroll = false,
): StrataLayout {
  const { W, H, top, dpr } = opts;
  const base = H - 1;
  if (opts.view === 'floors') return layoutFloors(s, opts);
  const rowsH = Math.max(20, base - top);
  let peak = Math.max(opts.peak ?? 0, s.pileKind.length);
  for (let c = 0; c < COLS; c++) peak = Math.max(peak, s.colCount[c]);
  // Magnified: six columns to the plot, much larger squares, the window `magLeft` dollars along the axis.
  const mag = opts.view === 'magnify';
  const colW = W / (mag ? MAG_COLS : COLS + 1);
  const ox = mag ? snap(((opts.magLeft ?? 0) / COL_DOLLARS) * colW, dpr) : 0;
  const mainW = COLS * colW;
  const grid = mag ? strataGrid({ colW, rowsH, peak, dpr, maxPitch: MAG_MAX_PITCH_D, gutter: MAG_GUTTER }) : strataGrid({ colW, rowsH, peak, dpr });
  const n = s.col.length, m = s.pileKind.length;
  const { main, pile: pileStack } = columnStacks(s, !!opts.byType);
  const mx = new Float64Array(n), my = new Float64Array(n);
  const lefts = Float64Array.from({ length: COLS + 1 }, (_, c) => colX(c, colW, grid, dpr) - ox);
  for (let i = 0; i < n; i++) {
    const at = squareAt(lefts[s.col[i]], main.slot[i], grid.per, grid, base);
    mx[i] = at.x;
    my[i] = at.y;
  }
  const px = new Float64Array(m), py = new Float64Array(m);
  let pile: Stack, tail: StrataLayout['tail'] = null, pileLeft = W, pileW = 0, pileTop = 0;
  if (unroll && !mag && s.pilePay && m > 0) {
    let topIndex = 0;
    for (let j = 1; j < m; j++) if (s.pilePay[j] >= s.pilePay[topIndex]) topIndex = j;
    const topPay = s.pilePay[topIndex];
    // The top salary a ring's width inside the right edge, so the ring round it is drawn whole.
    const scale = (W - grid.pitch - TOP_INSET) / topPay;
    const squeeze = (COL_DOLLARS / colW) * scale;
    for (let i = 0; i < n; i++) mx[i] *= squeeze;
    const cols = tailColumns(s.pilePay, scale, grid.pitch);
    let last = 0;
    for (let j = 0; j < m; j++) last = Math.max(last, cols[j]);
    pile = stackColumns(cols, s.pilePay, s.pileKind, s.pileKey, s.rank, last + 1, opts.byType);
    for (let j = 0; j < m; j++) {
      px[j] = cols[j] * grid.pitch;
      py[j] = base - (pile.slot[j] + 1) * grid.rowPitch;
      pileTop = Math.max(pileTop, (pile.slot[j] + 1) * grid.rowPitch);
    }
    tail = { top: topPay, scale, capX: COLS * COL_DOLLARS * scale, squeeze, topIndex };
  } else {
    pileLeft = mainW - ox;
    pileW = colW;
    pile = pileStack;
    for (let j = 0; j < m; j++) {
      const at = squareAt(lefts[COLS], pile.slot[j], grid.per, grid, base);
      px[j] = at.x;
      py[j] = at.y;
    }
    pileTop = m ? colHeight(m, grid) : 0;
  }
  const peakY = base - Math.max(colHeight(peak, grid), pileTop);
  return { W, H, dpr, base, room: rowsH, colW, mainW, pileLeft, pileW, grid, main, pile, mx, my, px, py, peak, peakY, tail, view: mag ? 'magnify' : 'hist', ox, floors: null, floorX: null };
}

/** Floors: the columns either side of the blocks, CSS px — the band's name at the left, its people at the right. */
export const FLOOR_SIDES = { phone: { left: 66, right: 44 }, wide: { left: 96, right: 120 } };
/** A floor is never shorter than its label's line, CSS px (a phone's labels are a size smaller); and the floors
 *  start this far below the plot's top. */
const FLOOR_LABEL_H = { phone: 13, wide: 14 };
const FLOORS_TOP = 6;

/** Everyone in their floor (3a), the pile's people with the rest of $200k+: see lib/strata `floorsGrid`. */
function layoutFloors(s: Strata, opts: { W: number; H: number; dpr: number; phone: boolean; peak?: number; byType?: boolean }): StrataLayout {
  const { W, H, dpr, phone } = opts;
  const base = H - 1, room = base - FLOORS_TOP;
  const sides = phone ? FLOOR_SIDES.phone : FLOOR_SIDES.wide;
  const n = s.col.length, m = s.pileKind.length;
  // One list, the pile's people after the graph's: the pile is past $200k, so in the top floor with the rest.
  const fl = new Uint8Array(n + m), pay = new Float64Array(n + m), kind = new Uint8Array(n + m), key = new Uint32Array(n + m);
  const counts = new Uint32Array(FLOORS);
  for (let i = 0; i < n; i++) { pay[i] = s.pay[i]; fl[i] = floorOf(s.pay[i]); kind[i] = s.kind[i]; key[i] = s.key[i]; counts[fl[i]]++; }
  for (let j = 0; j < m; j++) {
    const k = n + j;
    pay[k] = s.pilePay ? s.pilePay[j] : Number.MAX_VALUE;
    fl[k] = FLOORS - 1;
    kind[k] = s.pileKind[j];
    key[k] = s.pileKey[j];
    counts[FLOORS - 1]++;
  }
  const left = snap(sides.left, dpr);
  const least = phone ? FLOOR_LABEL_H.phone : FLOOR_LABEL_H.wide;
  const g = floorsGrid({ width: W - sides.left - sides.right, room, counts, least, dpr, gapLeast: phone ? FLOOR_GAP.phone : FLOOR_GAP.least });
  const pd = Math.round(g.pitch * dpr), gap = pd >= 2 ? 1 : 0;
  const grid: Grid = { per: g.per, pitch: g.pitch, rowPitch: g.pitch, gap, sq: (pd - gap) / dpr, sqW: (pd - gap) / dpr, off: 0 };
  const floors: { base: number; h: number; n: number }[] = [];
  let y = base;
  for (let f = 0; f < FLOORS; f++) {
    const h = Math.max(least, Math.max(1, Math.ceil(counts[f] / g.per)) * g.pitch);
    floors.push({ base: snap(y, dpr), h, n: counts[f] });
    y -= h + g.gap;
  }
  const stack = stackColumns(fl, pay, kind, key, s.rank, FLOORS, opts.byType);
  const mx = new Float64Array(n), my = new Float64Array(n), px = new Float64Array(m), py = new Float64Array(m);
  for (let k = 0; k < n + m; k++) {
    const at = squareAt(left, stack.slot[k], g.per, grid, floors[fl[k]].base);
    if (k < n) { mx[k] = at.x; my[k] = at.y; } else { px[k - n] = at.x; py[k - n] = at.y; }
  }
  const main: Stack = { slot: stack.slot.slice(0, n), order: new Int32Array(0), start: new Int32Array(0) };
  const pile: Stack = { slot: stack.slot.slice(n), order: new Int32Array(0), start: new Int32Array(0) };
  const colW = W / (COLS + 1);
  return {
    W, H, dpr, base, room, colW, mainW: COLS * colW, pileLeft: W, pileW: 0, grid, main, pile, mx, my, px, py,
    peak: opts.peak ?? 0, peakY: Math.max(0, y + g.gap), tail: null, view: 'floors', ox: 0, floors, floorX: { left, right: left + g.per * g.pitch },
  };
}

/** The x of a pay on the main plot, CSS px. */
export const payX = (L: Pick<StrataLayout, 'colW' | 'ox'>, pay: number) => (pay / COL_DOLLARS) * L.colW - L.ox;
/** The top of column `c`'s stack. */
export const colTopY = (s: Strata, L: StrataLayout, c: number) => L.base - colHeight(s.colCount[Math.max(0, Math.min(COLS - 1, c))], L.grid);

/**
 * A search mark's centre, from its square's: on a pixel's centre where a mark is an odd number of device pixels
 * across (9 and 13 CSS px at 1x and 3x), on a pixel's edge where it is even (2x), so its edges and ring are
 * crisp. The squares themselves lie on a lattice finer than the pixels.
 */
export const markAt = (v: number, dpr: number) => {
  const o = Math.round(dpr) % 2 ? 0.5 : 0;
  return (Math.round(v * dpr - o) + o) / dpr;
};

/** A colour the canvas can take, from a CSS colour the page resolved (`color(srgb …)` included). */
function canvasColor(css: string): string {
  const rgb = parseRgb(css);
  return rgb ? `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})` : css;
}

/** A canvas colour as one pixel's four bytes, as an ImageData's Uint32 view holds them (little-endian: ABGR). */
const packCache = new Map<string, number>();
function packed(css: string): number {
  let v = packCache.get(css);
  if (v == null) {
    const [r, g, b] = parseRgb(css) ?? [0, 0, 0];
    v = ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
    packCache.set(css, v);
  }
  return v;
}

/** The inks the field draws in, read from the page's tokens in the scheme it is showing. */
interface Inks {
  kinds: string[]; dim: string; match: string; up: string; down: string; joined: string; neutral: string; ink: string; mute: string; card: string; lensBg: string; lensRim: string; lensShadow: string;
  inverseBg: string; inverseInk: string; inverseEdge: string; font: string;
}
function readInks(el: HTMLElement, kinds: readonly string[]): Inks {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  el.appendChild(probe);
  const read = (v: string) => { probe.style.color = v; return canvasColor(getComputedStyle(probe).color); };
  const out = {
    kinds: kinds.map(read), dim: read('var(--strata-dim)'), match: read('var(--strata-match)'), up: read('var(--strata-up)'), down: read('var(--strata-down)'),
    joined: read('var(--strata-new)'), neutral: read('var(--strata-neutral)'), ink: read('var(--mantine-color-text)'),
    mute: read('var(--mantine-color-dimmed)'),
    card: read('var(--surface)'), lensBg: read('var(--lens-bg)'), lensRim: read('var(--lens-rim)'), lensShadow: read('var(--lens-shadow)'),
    inverseBg: read('var(--inverse-bg)'), inverseInk: read('var(--inverse-ink)'), inverseEdge: read('var(--inverse-edge)'),
    font: getComputedStyle(el).fontFamily,
  };
  probe.remove();
  return out;
}

export interface StrataFieldHandle {
  /** A square's place at rest and its side, CSS px. */
  positionOf(field: Field, index: number): { x: number; y: number; s: number } | null;
}

export interface LensHit extends Spot { x: number; y: number; s: number }

/** A timeline step's phase (3a): its people moving, held for the countdown, or re-sorting; and when it ends. */
export interface StepPhase { phase: 'move' | 'hold' | 'sort'; start: number; end: number }

/**
 * The person followed (3a §9): their square marked as a search's people are, and a dark label on a leader —
 * "{name} · $pay". Carried by a timeline step, the pay counts from `from` to `pay` as their square travels, and
 * once there the label adds the change.
 */
export interface Follow extends Spot { name: string; pay: number | null; from: number | null }

/**
 * A timeline step onto `to` (3a §8). Each of its squares: where it sets off — its person's place the snapshot before,
 * or for someone who joined, where they will stand — and what it does (lib/strata STAY, UP, DOWN, NEW: by its column,
 * or in the floors its floor). Staged (raises and cuts, at Slow or Medium), `mid` is where each stands while the step
 * is held — in each column who stayed in their old order, those who came stacked on top of them: cuts, raises, then
 * new hires — and `rank` its share of the way up its column once sorted, for the re-sort's ripple from the bottom.
 * Who left fades out where they stood. `plan` is the pace's phases; `fade`, back to an earlier snapshot: a cross-fade.
 */
export interface Step {
  to: StrataLayout;
  from: { mx: Float64Array; my: Float64Array; px: Float64Array; py: Float64Array };
  mid: { mx: Float64Array; my: Float64Array; px: Float64Array; py: Float64Array } | null;
  kind: { main: Uint8Array; pile: Uint8Array };
  rank: { main: Float32Array; pile: Float32Array };
  ghosts: { x: Float64Array; y: Float64Array; kind: Uint8Array } | null;
  plan: PacePlan;
  mode: StepMode;
  fade?: boolean;
  /** How many moved up, down, joined and left: the legend's, while the step shows them. */
  counts?: StepCounts;
  /** Fast (3a §10): one flow, everyone on a curve through their places snapshot after snapshot — leaving with the
   *  tangent from where they were a snapshot before (`pm`, while playing on from the step before), arriving with
   *  the one to where they will be next (`p2`, while playing on); NaN where they were not or will not be. */
  flow?: { pm: Places | null; p2: Places | null } | null;
  /** A catch-up step, one of several on at once. */
  quick?: boolean;
}
/** Each square's place, by field. */
export interface Places { mx: Float64Array; my: Float64Array; px: Float64Array; py: Float64Array }

/** A place in a layout's lattice: column (or floor) `g`, `slot` squares up it from the bottom left. */
export function slotPlace(L: StrataLayout, g: number, slot: number): { x: number; y: number } {
  const per = L.grid.per, across = (slot % per) * L.grid.pitch, up = (Math.floor(slot / per) + 1) * L.grid.rowPitch;
  if (L.floors && L.floorX) return { x: L.floorX.left + across, y: L.floors[g].base - up };
  return { x: (colX(g, L.colW, L.grid, L.dpr) - L.ox + across) * (L.tail && g < COLS ? L.tail.squeeze : 1), y: L.base - up };
}

/** A step's colours (3a): each type's ink fading to the neutral one, and the neutral to up, down and joined, in
 *  BLEND + 1 shades each; packed as the canvas's pixels hold them. */
const BLEND = 16;
function blendPacked(a: number, b: number, t: number): number {
  const ch = (v: number, s: number) => (v >>> s) & 255;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return ((255 << 24) | mix(16) | mix(8) | mix(0)) >>> 0;
}
const shades = (a: number, b: number) => Uint32Array.from({ length: BLEND + 1 }, (_, l) => blendPacked(a, b, l / BLEND));
const shade = (t: number) => Math.round(Math.min(1, Math.max(0, t)) * BLEND);
/** Grows past its size and settles (3a's new hires). */
const backOut = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2);
/** A packed colour at alpha `a`: written, not blended, so the canvas shows it that faint over whatever is under. */
const withAlpha = (c: number, a: number) => ((c & 0xffffff) | (Math.round(255 * Math.min(1, Math.max(0, a))) << 24)) >>> 0;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Under this long, a step's people all move together (Fast, and the quick catch-up steps): no wave, no arcs. */
const TOGETHER_MS = 400;
/** A flow step that sets off within this long of the last one's end runs on from it. */
const FLOW_CHAIN_MS = 250;

/** A timeline step in flight (3a): its clock and each square's own timing — set off at `dl`, for `du`, as shares of
 *  the move; arcing `arc` px; re-sorted from `sdl` — and each frame's scale and colour (packed, with alpha) per
 *  square, the trails behind the movers, and who left: what `drawBase` paints. */
interface Stage {
  step: Step;
  start: number;
  /** The countdown, ms: the plan's, or shorter where the speed changed while it held. */
  cd: number;
  dlM: Float32Array; duM: Float32Array; arcM: Float32Array; sdlM: Float32Array;
  dlP: Float32Array; duP: Float32Array; arcP: Float32Array; sdlP: Float32Array;
  gdl: Float32Array; gdu: Float32Array;
  scM: Float32Array; colM: Uint32Array; scP: Float32Array; colP: Uint32Array;
  gx: Float64Array; gy: Float64Array; gsc: Float32Array; gcol: Uint32Array;
  tx: Float64Array; ty: Float64Array; tsc: Float32Array; tcol: Uint32Array; tn: number;
  /** The phase last told (`onPhase`), and when it was told to end. */
  phase: StepPhase['phase'] | null;
  phaseEnd: number;
  /** Held for the countdown, nothing moves: drawn once, until something else asks (`redraw`). */
  still: boolean;
  redraw: boolean;
  /** A flow step set off as the one before landed: it leaves with that one's speed. */
  chained: boolean;
}

export const StrataField = forwardRef<StrataFieldHandle, {
  strata: Strata;
  layout: StrataLayout;
  /** Each category's ink, as CSS (a var()). */
  kindInks: readonly string[];
  dim: Dim | null;
  /** A search's people in the search's own ink; a type's keep their own. */
  matchSearch: boolean;
  marks: { main: readonly number[]; pile: readonly number[] };
  big: Spot | null;
  /** Where the lens is wanted, in the field's px (null: put it away), and the pointer, which picks the square. */
  lensAt: { x: number; y: number } | null;
  /** What it magnifies, when that is not where it is drawn: under a finger, with the lens above it. The
   *  point maps to the lens's centre. */
  lensFrom?: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
  lensR: number;
  /** The square the lens has under the pointer, when it changes. */
  onPick?: (hit: LensHit | null) => void;
  /** Whether the squares are moving, when it changes. */
  onMoving?: (moving: boolean) => void;
  /** Arrived at a layout: after a move (`moved`), or simply there. */
  onLanded?: (moved: boolean) => void;
  /** A timeline step's phase (3a), as it changes: moving, held for the countdown, re-sorting — or over (null) —
   *  with when it ends (performance.now() ms). */
  onPhase?: (phase: StepPhase | null) => void;
  /** Bumped to cut a step's countdown short (the speed changed while it was held): on to the re-sort. */
  skipHold?: number;
  /** How to arrive at `layout`, when it is a timeline step's. */
  step?: Step | null;
  /** Hold every motion where it is (the plot scrolled out of sight), and go on from there when let go. */
  hold?: boolean;
  follow?: Follow | null;
  className?: string;
}>(function StrataField({ strata, layout, kindInks, dim, matchSearch, marks, big, lensAt, lensFrom = null, pointer, lensR, onPick, onMoving, onLanded, onPhase, skipHold = 0, step = null, hold = false, follow = null, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  // The picture a cross-fade leaves, fading out over the new one.
  const fadeRef = useRef<HTMLCanvasElement>(null);
  const { W, H, dpr, grid } = layout;
  const n = strata.col.length, m = strata.pileKind.length;

  // Positions now, and the move in flight: where each square set off from, how long it waits, and the ease.
  const cur = useRef({ mx: new Float64Array(0), my: new Float64Array(0), px: new Float64Array(0), py: new Float64Array(0) });
  const move = useRef<{
    start: number; fromMx: Float64Array; fromMy: Float64Array; fromPx: Float64Array; fromPy: Float64Array; wait: Float64Array; pwait: Float64Array; ms: number;
    /** A change of view's own time for each square, where it is not `ms`, and its hop. */
    msM?: Float64Array; msP?: Float64Array;
    arcM?: Float32Array; arcP?: Float32Array;
    /** A timeline step (3a): its own clock, phases and frame (`stageFrame`). */
    stage?: Stage;
  } | null>(null);
  const raf = useRef(0);
  // When Fast's last flow step ended (its clock's end), for the next to run on from.
  const flowEnd = useRef(-Infinity);
  const inks = useRef<Inks | null>(null);
  const [scheme, setScheme] = useState(0);
  const lens = useRef({ x: 0, y: 0, r: 0 });
  const picked = useRef<string>('');
  const props = useRef({ lensAt, lensFrom, pointer, lensR, onPick, onMoving, onLanded, onPhase });
  props.current = { lensAt, lensFrom, pointer, lensR, onPick, onMoving, onLanded, onPhase };
  const movingRef = useRef(false);
  const px32 = useRef<{ img: ImageData; buf: Uint32Array } | null>(null);
  // The loupe's squares, frame to frame: each one's ink and place, grown when the field outgrows them.
  const lensBuf = useRef({
    k: new Uint8Array(0), x: new Float32Array(0), y: new Float32Array(0),
    grow(size: number) { this.k = new Uint8Array(size); this.x = new Float32Array(size); this.y = new Float32Array(size); },
  });
  // Each ink, packed, for a step's frames under a filter: filled in place each frame.
  const litBuf = useRef(new Uint32Array(0));

  // Each square's ink: its kind's, the search's, or the faded one. Painted in that order, so a filter's
  // people lie over the faded ones they have left.
  // Ink C is the faded, C + 1 the search's.
  const tint = useMemo(() => {
    const C = kindInks.length;
    const of = (kinds: Uint8Array, mask: Uint8Array | null) => {
      const out = new Uint8Array(kinds.length);
      for (let i = 0; i < kinds.length; i++) out[i] = mask ? (mask[i] ? C : matchSearch ? C + 1 : kinds[i]) : kinds[i];
      return out;
    };
    const main = of(strata.kind, dim?.main ?? null), pile = of(strata.pileKind, dim?.pile ?? null);
    // Each ink's squares, listed once, so a frame paints ink by ink without looking at everyone each time.
    const lists = (t: Uint8Array) => {
      const n = new Int32Array(C + 2);
      for (let i = 0; i < t.length; i++) n[t[i]]++;
      const out = Array.from(n, (k) => new Int32Array(k));
      n.fill(0);
      for (let i = 0; i < t.length; i++) out[t[i]][n[t[i]]++] = i;
      return out;
    };
    return { main, pile, C, mainBy: lists(main), pileBy: lists(pile), order: [C, ...Array.from({ length: C }, (_, k) => k), C + 1] };
  }, [strata, dim, matchSearch, kindInks.length]);

  // The page's tokens, again whenever the scheme changes.
  useEffect(() => {
    const obs = new MutationObserver(() => setScheme((k) => k + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    return () => obs.disconnect();
  }, []);
  // A step's colours (3a), packed: each type to the neutral, and the neutral to up, down and joined.
  const pal = useRef<{ N: number; toType: Uint32Array[]; toUp: Uint32Array; toDown: Uint32Array; toNew: Uint32Array } | null>(null);
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const t = (inks.current = readInks(wrapRef.current, kindInks)), N = packed(t.neutral);
    pal.current = { N, toType: t.kinds.map((c) => shades(N, packed(c))), toUp: shades(N, packed(t.up)), toDown: shades(N, packed(t.down)), toNew: shades(N, packed(t.joined)) };
  }, [kindInks, scheme]);

  const ink = (k: number) => {
    const t = inks.current!;
    return k < tint.C ? t.kinds[k] : k === tint.C ? t.dim : t.match;
  };
  const drawBase = () => {
    const cv = baseRef.current, t = inks.current;
    if (!cv || !t) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { mx, my, px, py } = cur.current;
    // Written straight into the canvas's pixels, a square a few writes, on whole device pixels (lib/strata
    // `squarePixels`): twenty thousand fillRect calls cost a moving frame more than its budget, and a square
    // in flight is between places anyway, so drawn on the grid it looks no different.
    const cw = cv.width, ch = cv.height;
    if (!px32.current || px32.current.img.width !== cw || px32.current.img.height !== ch) {
      const img = ctx.createImageData(cw, ch);
      px32.current = { img, buf: new Uint32Array(img.data.buffer) };
    }
    const { img, buf } = px32.current;
    buf.fill(0);
    // The faded first, then each kind, then the search's own, then a step's movers on top of all.
    const order = tint.order;
    const least = (k: number) => (dim && k !== tint.C ? LIT_MIN : 1);
    const box = BOX;
    // `least`: under a filter its people stand where they are, scattered through the faded; on a 1x screen a
    // square of one pixel is a speck, so each is drawn at least LIT_MIN pixels each way, round its own place.
    const put = (x: number, y: number, c: number, least: number, sc = 1) => {
      let { X, Y, w, h } = squarePixels(x, y, grid, dpr, box);
      if (sc !== 1) { const w2 = Math.max(1, Math.round(w * sc)), h2 = Math.max(1, Math.round(h * sc)); X += (w - w2) >> 1; Y += (h - h2) >> 1; w = w2; h = h2; }
      if (w < least) { X -= (least - w) >> 1; w = least; }
      if (h < least) { Y -= (least - h) >> 1; h = least; }
      // Clipped to the canvas, not clamped to it: a square above the plot (one arcing high) is not drawn at
      // all, rather than along its top edge.
      if (X < 0) { w += X; X = 0; }
      if (Y < 0) { h += Y; Y = 0; }
      w = Math.min(w, cw - X);
      h = Math.min(h, ch - Y);
      if (w <= 0 || h <= 0) return;
      for (let r = 0; r < h; r++) { const o = (Y + r) * cw + X; for (let q = 0; q < w; q++) buf[o + q] = c; }
    };
    const mv = move.current, st = mv?.stage;
    if (st) {
      // A timeline step (3a): who left, fading; then who stayed, who joined, the movers' trails, and the movers on
      // top. Under a filter its own keep their ink and the rest the faded one, wherever the step has them.
      for (let g = 0; g < st.gx.length; g++) if (st.gcol[g] >>> 24) put(st.gx[g], st.gy[g], st.gcol[g], 1, st.gsc[g]);
      const K = st.step.kind;
      if (litBuf.current.length !== order.length) litBuf.current = new Uint32Array(order.length);
      const lit = litBuf.current;
      for (let k = 0; k < order.length; k++) lit[k] = packed(ink(k));
      const paint = (pass: (k: number) => boolean) => {
        for (let i = 0; i < n; i++) {
          if (!pass(K.main[i])) continue;
          const c = dim ? withAlpha(lit[tint.main[i]], (st.colM[i] >>> 24) / 255) : st.colM[i];
          if (c >>> 24) put(mx[i], my[i], c, least(tint.main[i]), st.scM[i]);
        }
        for (let j = 0; j < m; j++) {
          if (!pass(K.pile[j])) continue;
          const c = dim ? withAlpha(lit[tint.pile[j]], (st.colP[j] >>> 24) / 255) : st.colP[j];
          if (c >>> 24) put(px[j], py[j], c, least(tint.pile[j]), st.scP[j]);
        }
      };
      paint((k) => k !== UP && k !== DOWN && k !== NEW);
      paint((k) => k === NEW);
      for (let q = 0; q < st.tn; q++) put(st.tx[q], st.ty[q], st.tcol[q], 1, st.tsc[q]);
      paint((k) => k === UP || k === DOWN);
    } else {
      for (const k of order) {
        const c = packed(ink(k)), l = least(k);
        const a = tint.mainBy[k], b = tint.pileBy[k];
        for (let q = 0; q < a.length; q++) put(mx[a[q]], my[a[q]], c, l);
        for (let q = 0; q < b.length; q++) put(px[b[q]], py[b[q]], c, l);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The search's people: a white square ringed in ink, with their type's colour at its heart.
    const mark = (x: number, y: number, kind: number, size: number) => {
      const cx = markAt(x + grid.sqW / 2, dpr), cy = markAt(y + grid.sq / 2, dpr), h = size / 2;
      ctx.fillStyle = t.card;
      ctx.fillRect(cx - h, cy - h, size, size);
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(cx - h, cy - h, size, size);
      ctx.fillStyle = t.kinds[kind] ?? t.ink;
      ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    };
    for (const i of marks.main) if (i < n) mark(mx[i], my[i], strata.kind[i], big?.field === 'main' && big.index === i ? 13 : 9);
    for (const j of marks.pile) if (j < m) mark(px[j], py[j], strata.pileKind[j], big?.field === 'pile' && big.index === j ? 13 : 9);
    // The person followed: their mark, a leader and their label, on top of everything.
    const f = follow;
    if (f && f.index < (f.field === 'main' ? n : m)) {
      const X = f.field === 'main' ? mx : px, Y = f.field === 'main' ? my : py;
      const x0 = X[f.index], y0 = Y[f.index];
      mark(x0, y0, f.field === 'main' ? strata.kind[f.index] : strata.pileKind[f.index], 11);
      const cx = x0 + grid.sqW / 2, cy = y0 + grid.sq / 2;
      // How far along their own move they are: the pay counts with them.
      const mv = move.current, st = mv?.stage;
      let e = 1;
      if (st) {
        const u = f.field === 'main' ? st.duM[f.index] : st.duP[f.index], d = f.field === 'main' ? st.dlM[f.index] : st.dlP[f.index];
        e = easeInOut(clamp01(((performance.now() - st.start) / st.step.plan.mv - d) / u));
      } else if (mv) {
        const wait = f.field === 'main' ? mv.wait[f.index] : mv.pwait[f.index];
        e = easeInOut(Math.min(1, Math.max(0, (performance.now() - mv.start - wait) / mv.ms)));
      }
      const text = followText(f, e);
      ctx.font = `600 12px ${t.font}`;
      const w = Math.ceil(ctx.measureText(text).width) + 16, h = 22;
      let lx = cx + 12, ly = cy - h - 14;
      if (lx + w > W - 2) lx = cx - 12 - w;
      if (ly < 2) ly = cy + 14;
      lx = Math.max(2, lx);
      ctx.lineWidth = 1;
      ctx.strokeStyle = t.ink;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sign(lx + w / 2 - cx) * 7, cy + Math.sign(ly + h / 2 - cy) * 7);
      ctx.lineTo(lx + w / 2 < cx ? lx + w - 6 : lx + 6, ly + h / 2 < cy ? ly + h : ly);
      ctx.stroke();
      ctx.fillStyle = t.inverseBg;
      ctx.beginPath();
      ctx.roundRect(lx, ly, w, h, h / 2);
      ctx.fill();
      if (t.inverseEdge !== 'rgba(0, 0, 0, 0)') { ctx.strokeStyle = t.inverseEdge; ctx.stroke(); }
      ctx.fillStyle = t.inverseInk;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx + 8, ly + h / 2 + 0.5);
    }
  };

  // Magnified: who stands at a point, by the lattice (columns from the axis, rows from the baseline) — a faded square,
  // under a filter, is no one to name.
  const squareUnder = (x: number, y: number): Spot | null => {
    const L = layout, g = grid, wx = x + L.ox, c = Math.floor(wx / L.colW);
    if (c < 0 || c > COLS) return null;
    const col = Math.floor((wx - colX(c, L.colW, g, dpr)) / g.pitch), row = Math.floor((L.base - y) / g.rowPitch);
    if (col < 0 || col >= g.per || row < 0) return null;
    const slot = row * g.per + col;
    const st = c === COLS ? L.pile : L.main, k = c === COLS ? 0 : c;
    if (slot >= st.start[k + 1] - st.start[k]) return null;
    const index = st.order[st.start[k] + slot], field: Field = c === COLS ? 'pile' : 'main';
    if (dim && (field === 'main' ? tint.main : tint.pile)[index] === tint.C) return null;
    return { field, index };
  };
  const drawLens = (): LensHit | null => {
    const cv = lensRef.current, t = inks.current;
    if (!cv || !t) return null;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Magnified, no glass: the square under the pointer is ringed where it stands (3a).
    if (layout.view === 'magnify') {
      const ptr = props.current.pointer;
      const hit = ptr && props.current.lensAt ? squareUnder(ptr.x, ptr.y) : null;
      if (!hit) return null;
      const { mx, my, px, py } = cur.current;
      const x = (hit.field === 'main' ? mx : px)[hit.index] + grid.sqW / 2, y = (hit.field === 'main' ? my : py)[hit.index] + grid.sq / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.ink;
      ctx.beginPath();
      ctx.arc(x, y, grid.sq / 2 + 3, 0, Math.PI * 2);
      ctx.stroke();
      return { ...hit, x, y, s: Math.max(grid.sq, PICK_MIN) };
    }
    const { x: cx, y: cy, r: R } = lens.current;
    if (R < 0.5) return null;
    // Where the magnified picture is taken from: the lens's own place, or a finger's, drawn above it.
    const from = props.current.lensFrom;
    const sx = from ? from.x : cx, sy = from ? from.y : cy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    // Over the plot only, above its baseline.
    ctx.beginPath();
    ctx.rect(0, 0, W, layout.base);
    ctx.clip();
    ctx.save();
    ctx.shadowColor = t.lensShadow;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = t.lensBg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const { mx, my, px, py } = cur.current;
    const hw = grid.sqW / 2, hh = grid.sq / 2;
    const ptr = props.current.pointer;
    const tail = layout.tail;
    // A plain loupe (3a): what is under it, LOUPE_ZOOM times as large — 4× over the histogram, 2.5× over the floors.
    const z = layout.view === 'floors' ? LOUPE_ZOOM.floors : LOUPE_ZOOM.hist;
    const reachField = R / z + Math.max(grid.sq, grid.sqW);
    // Who could be under it: the columns within its reach (squeezed, while the pile is unrolled), and the pile
    // where it overlaps; in the floors, whoever is within its square.
    const cw = layout.colW * (tail ? tail.squeeze : 1);
    const c0 = Math.max(0, Math.floor((sx - reachField) / cw) - 1), c1 = Math.min(COLS - 1, Math.ceil((sx + reachField) / cw) + 1);
    // Who it can name: the graph's people, or the tail's once the pile is unrolled (the pile itself is the way
    // to unroll it, and the squeezed graph the way to fold it back); with a filter on, only its own — the faded
    // ones are the rest, not who is being read.
    const nameable = (field: Field, k: number) => (layout.view === 'floors' || (field === 'pile') === !!tail) && !(dim && k === tint.C);
    // The pointer's place in the field: what the loupe shows under it.
    const qx = ptr ? sx + (ptr.x - cx) / z : 0, qy = ptr ? sy + (ptr.y - cy) / z : 0;
    // Each square it shows, by ink, into buffers kept from frame to frame (3a §13: nothing made new per square
    // per frame); the nearest it can name, as plain numbers.
    const w = grid.sqW * z, h = grid.sq * z;
    const B = lensBuf.current;
    if (B.k.length < n + m) B.grow(n + m);
    let count = 0, nearField: Field | null = null, nearIndex = -1, nearX = 0, nearY = 0, nearD = Infinity, fx = NaN, fy = NaN, nameableHere = 0;
    const consider = (field: Field, i: number) => {
      const X = field === 'main' ? mx : px, Y = field === 'main' ? my : py, k = (field === 'main' ? tint.main : tint.pile)[i];
      const x = cx + (X[i] - sx) * z, y = cy + (Y[i] - sy) * z;
      if (x + w < cx - R || x > cx + R || y + h < cy - R || y > cy + R) return;
      B.k[count] = k;
      B.x[count] = x;
      B.y[count] = y;
      count++;
      if (follow && follow.field === field && follow.index === i) { fx = x + w / 2; fy = y + h / 2; }
      if (ptr && nameable(field, k)) {
        nameableHere++;
        const d = Math.hypot(X[i] + hw - qx, Y[i] + hh - qy);
        if (d < nearD) { nearD = d; nearField = field; nearIndex = i; nearX = x + w / 2; nearY = y + h / 2; }
      }
    };
    if (layout.view === 'floors') {
      for (let i = 0; i < n; i++) if (Math.abs(mx[i] - sx) <= reachField && Math.abs(my[i] - sy) <= reachField) consider('main', i);
      for (let j = 0; j < m; j++) if (Math.abs(px[j] - sx) <= reachField && Math.abs(py[j] - sy) <= reachField) consider('pile', j);
    } else {
      for (let c = c0; c <= c1; c++) for (let q = layout.main.start[c]; q < layout.main.start[c + 1]; q++) consider('main', layout.main.order[q]);
      if (m && (tail || sx + reachField >= layout.pileLeft)) for (let j = 0; j < m; j++) consider('pile', j);
    }
    // Named: the nearest within a reach that widens as the people the loupe could name thin out (lib/strata
    // `snapReach`) — the one under the pointer where they crowd, across the loupe where a filter leaves a few.
    const reach = snapReach(nameableHere, R / z, Math.max(grid.sq, grid.sqW) / 2 + 0.75);
    const best: LensHit | null = nearField && nearD <= reach ? { field: nearField, index: nearIndex, x: nearX, y: nearY, s: Math.max(h, PICK_MIN) } : null;
    const followed = Number.isNaN(fx) ? null : { x: fx, y: fy };
    for (const k of tint.order) {
      ctx.fillStyle = ink(k);
      ctx.beginPath();
      for (let d = 0; d < count; d++) if (B.k[d] === k) ctx.rect(B.x[d], B.y[d], w, h);
      ctx.fill();
    }
    ctx.restore();
    // The rim.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = t.lensRim;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // The person followed, outlined where the loupe shows them.
    if (followed) {
      const o = Math.max(h, 4) / 2 + 1.5;
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(followed.x - o, followed.y - o, 2 * o, 2 * o);
    }
    // The square it names, outlined — reached for from across the loupe, a faint line from the centre says which.
    if (best) {
      const far = Math.hypot(best.x - cx, best.y - cy);
      const o = best.s / 2 + 3;
      if (far > R * 0.3) {
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.ink;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(best.x - ((best.x - cx) / far) * (o + 1), best.y - ((best.y - cy) / far) * (o + 1));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (best.s > h) {
        ctx.fillStyle = ink((best.field === 'main' ? tint.main : tint.pile)[best.index]);
        ctx.fillRect(best.x - best.s / 2, best.y - best.s / 2, best.s, best.s);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(best.x - o, best.y - o, 2 * o, 2 * o);
    }
    ctx.restore();
    // How much it magnifies, under its rim — or, where the plot ends first, by it at its lower right.
    ctx.font = `500 11px ${t.font}`;
    ctx.fillStyle = t.mute;
    ctx.textBaseline = 'alphabetic';
    const below = cy + R + 14;
    if (below <= H - 2) { ctx.textAlign = 'center'; ctx.fillText(`${z}×`, cx, below); }
    else { ctx.textAlign = 'left'; ctx.fillText(`${z}×`, Math.min(W - 24, cx + R * 0.72 + 6), Math.min(H - 4, cy + R * 0.72 + 10)); }
    return best;
  };

  // A step's frame (3a): each square's place, size and colour at `now`, by phase — the move (to its staged place,
  // or straight to its sorted one), the countdown that holds it there, the re-sort into salary order — and who left,
  // fading. True once it is over.
  const stageFrame = (now: number): boolean => {
    const mv = move.current, st = mv?.stage, pl = pal.current;
    if (!mv || !st || !pl) return true;
    const S = st.step, P = S.plan, staged = !!S.mid, change = S.mode === 'change';
    const el = now - st.start, mt = el / P.mv, holdEnd = P.mv + st.cd;
    const sorting = staged && el >= holdEnd, holding = staged && !sorting && el >= P.mv;
    const sp = sorting ? (P.so > 0 ? (el - holdEnd) / P.so : 1) : 0;
    st.still = holding && st.phase === 'hold' && !st.redraw && Math.abs(st.phaseEnd - (st.start + holdEnd)) <= 1;
    if (st.still) return false;
    st.redraw = false;
    // Who stays fades from their type's colour to the neutral over the move's first part (raises and cuts).
    const fp = 1 - clamp01(mt / TYPE_FADE);
    const L = layout, mid = S.mid;
    const { mx, my, px, py } = cur.current;
    let tn = 0;
    if (S.flow) return flowFrame(st, el);
    const field = (K: Uint8Array, kinds: Uint8Array, FX: Float64Array, FY: Float64Array, MX: Float64Array | null, MY: Float64Array | null,
      TX: Float64Array, TY: Float64Array, dl: Float32Array, du: Float32Array, arc: Float32Array, sdl: Float32Array,
      OX: Float64Array, OY: Float64Array, SC: Float32Array, CO: Uint32Array) => {
      for (let i = 0; i < K.length; i++) {
        const k = K[i], T = pl.toType[kinds[i]] ?? pl.toType[0];
        const toX = MX ? MX[i] : TX[i], toY = MY ? MY[i] : TY[i];
        const C = k === UP ? pl.toUp : k === DOWN ? pl.toDown : k === NEW ? pl.toNew : null;
        let x: number, y: number, sc = 1, c: number;
        if (sorting && MX && MY) {
          // Into salary order, the column rippling up from the bottom; the change colour through the neutral back to
          // the type's.
          const q = clamp01((sp - sdl[i]) / 0.42), e = easeInOut(q);
          x = MX[i] + (TX[i] - MX[i]) * e;
          y = MY[i] + (TY[i] - MY[i]) * e;
          c = q < 0.5 ? (C ? C[shade(1 - 2 * q)] : pl.N) : T[shade(2 * q - 1)];
        } else if (holding) {
          x = toX;
          y = toY;
          c = C ? C[BLEND] : pl.N;
        } else {
          const p = clamp01((mt - dl[i]) / du[i]), e = easeInOut(p);
          if (k === NEW) {
            x = toX;
            y = toY;
            sc = Math.max(0.05, backOut(p));
          } else {
            x = FX[i] + (toX - FX[i]) * e;
            y = FY[i] + (toY - FY[i]) * e - arc[i] * 4 * e * (1 - e);
          }
          if (!change) c = T[BLEND];
          else if (!staged) c = C ? C[BLEND] : T[BLEND];
          else {
            c = k === NEW ? pl.toNew[BLEND] : C && p > 0 ? C[shade(0.35 + p / 0.15)] : T[shade(fp)];
            if (C && k !== NEW) {
              // A mover pops as it lands, and trails two fading squares on its way (3a).
              if (p >= 1) { const a = mt - dl[i] - du[i]; if (a < 0.07) sc = 1 + 0.8 * Math.sin((Math.PI * a) / 0.07); }
              else if (p > 0) for (let q = 1; q <= 2; q++) {
                const e2 = easeInOut(clamp01((mt - 0.022 * q - dl[i]) / du[i]));
                st.tx[tn] = FX[i] + (toX - FX[i]) * e2;
                st.ty[tn] = FY[i] + (toY - FY[i]) * e2 - arc[i] * 4 * e2 * (1 - e2);
                st.tsc[tn] = q === 1 ? 0.9 : 0.78;
                st.tcol[tn] = withAlpha(C[BLEND], q === 1 ? 0.5 : 0.24);
                tn++;
              }
            }
          }
          // Who joined comes in: growing, and fading up.
          if (k === NEW) c = withAlpha(c, p / 0.3);
        }
        OX[i] = x;
        OY[i] = y;
        SC[i] = sc;
        CO[i] = c;
      }
    };
    field(S.kind.main, strata.kind, S.from.mx, S.from.my, mid?.mx ?? null, mid?.my ?? null, L.mx, L.my, st.dlM, st.duM, st.arcM, st.sdlM, mx, my, st.scM, st.colM);
    field(S.kind.pile, strata.pileKind, S.from.px, S.from.py, mid?.px ?? null, mid?.py ?? null, L.px, L.py, st.dlP, st.duP, st.arcP, st.sdlP, px, py, st.scP, st.colP);
    // Who left: fading where they stood, a little smaller, a little lower (in the neutral, raising and cutting).
    const gh = S.ghosts;
    if (gh) for (let g = 0; g < st.gx.length; g++) {
      const p = holding || sorting ? 1 : clamp01((mt - st.gdl[g]) / st.gdu[g]);
      const base = pl.toType[gh.kind[g]] ?? pl.toType[0];
      st.gy[g] = gh.y[g] + 8 * p;
      st.gsc[g] = 1 - 0.5 * p;
      st.gcol[g] = withAlpha(change ? (staged && p <= 0 ? base[shade(fp)] : pl.N) : base[BLEND], 1 - p);
    }
    st.tn = tn;
    const done = staged ? el >= holdEnd + P.so : el >= P.mv;
    const ph = done ? null : sorting ? 'sort' : holding ? 'hold' : 'move';
    const end = st.start + (ph === 'move' ? P.mv : ph === 'hold' ? holdEnd : holdEnd + P.so);
    if (ph !== st.phase || (ph && Math.abs(end - st.phaseEnd) > 1)) {
      st.phase = ph;
      st.phaseEnd = end;
      props.current.onPhase?.(ph ? { phase: ph, start: ph === 'move' ? st.start : ph === 'hold' ? st.start + P.mv : st.start + holdEnd, end } : null);
    }
    return done;
  };
  // A flow step's frame (3a §10): everyone along their Hermite curve at a steady clock — no wave, no hold, no
  // re-sort — who joined growing in, who left shrinking out where they stood; raising and cutting, the movers in
  // the up and down inks and who joined in amber over their types, else everyone in their type's.
  const flowFrame = (st: Stage, el: number): boolean => {
    const S = st.step, pl = pal.current!, F = S.flow!, change = S.mode === 'change';
    const t = clamp01(el / S.plan.mv), L = layout;
    const { mx, my, px, py } = cur.current;
    const pm = st.chained ? F.pm : null, p2 = F.p2;
    const field = (K: Uint8Array, kinds: Uint8Array, FX: Float64Array, FY: Float64Array, TX: Float64Array, TY: Float64Array,
      AX: Float64Array | undefined, AY: Float64Array | undefined, BX: Float64Array | undefined, BY: Float64Array | undefined,
      OX: Float64Array, OY: Float64Array, SC: Float32Array, CO: Uint32Array) => {
      for (let i = 0; i < K.length; i++) {
        const k = K[i], T = pl.toType[kinds[i]] ?? pl.toType[0];
        if (k === NEW) {
          OX[i] = TX[i];
          OY[i] = TY[i];
          SC[i] = Math.max(0.05, t);
          CO[i] = withAlpha(change ? pl.toNew[BLEND] : T[BLEND], t / 0.3);
          continue;
        }
        const x0 = FX[i], x1 = TX[i], y0 = FY[i], y1 = TY[i];
        OX[i] = hermite(x0, x1, AX ? monoTangent(AX[i], x0, x1) : 0, BX ? monoTangent(x0, x1, BX[i]) : 0, t);
        OY[i] = hermite(y0, y1, AY ? monoTangent(AY[i], y0, y1) : 0, BY ? monoTangent(y0, y1, BY[i]) : 0, t);
        SC[i] = 1;
        CO[i] = change && k === UP ? pl.toUp[BLEND] : change && k === DOWN ? pl.toDown[BLEND] : T[BLEND];
      }
    };
    field(S.kind.main, strata.kind, S.from.mx, S.from.my, L.mx, L.my, pm?.mx, pm?.my, p2?.mx, p2?.my, mx, my, st.scM, st.colM);
    field(S.kind.pile, strata.pileKind, S.from.px, S.from.py, L.px, L.py, pm?.px, pm?.py, p2?.px, p2?.py, px, py, st.scP, st.colP);
    const gh = S.ghosts;
    if (gh) for (let g = 0; g < st.gx.length; g++) {
      st.gy[g] = gh.y[g];
      st.gsc[g] = Math.max(0.05, 1 - t);
      st.gcol[g] = withAlpha(change ? pl.N : (pl.toType[gh.kind[g]] ?? pl.toType[0])[BLEND], 1 - t);
    }
    st.tn = 0;
    st.still = false;
    const done = el >= S.plan.mv, end = st.start + S.plan.mv;
    const ph = done ? null : 'move';
    if (ph !== st.phase || (ph && Math.abs(end - st.phaseEnd) > 1)) {
      st.phase = ph;
      st.phaseEnd = end;
      props.current.onPhase?.(ph ? { phase: ph, start: st.start, end } : null);
    }
    return done;
  };
  const setMoving = (on: boolean) => {
    if (movingRef.current === on) return;
    movingRef.current = on;
    wrapRef.current?.setAttribute('data-settled', on ? 'false' : 'true');
    props.current.onMoving?.(on);
  };

  // One loop, running only while something moves: the squares, or the lens toward the pointer.
  const tick = (now: number) => {
    raf.current = 0;
    shown.current = true;
    let again = false;
    const mv = move.current;
    if (mv?.stage) {
      const t0 = performance.now();
      const done = stageFrame(now);
      if (!mv.stage.still) {
        drawBase();
        measure('strata-frame', t0);
      }
      if (done) {
        const L = layout;
        if (mv.stage.step.flow) flowEnd.current = mv.stage.start + mv.stage.step.plan.mv;
        cur.current = { mx: L.mx.slice(), my: L.my.slice(), px: L.px.slice(), py: L.py.slice() };
        move.current = null;
        drawBase();
        setMoving(false);
        props.current.onLanded?.(true);
      } else again = true;
    } else if (mv) {
      const t0 = performance.now();
      const { mx, my, px, py } = cur.current;
      let done = true;
      const go = (from: Float64Array, to: Float64Array, out: Float64Array, wait: Float64Array, i: number, axis: 0 | 1, arc?: Float32Array, ms?: Float64Array) => {
        const p = Math.min(1, Math.max(0, (now - mv.start - wait[i]) / (ms ? ms[i] : mv.ms)));
        if (p < 1) done = false;
        const e = easeInOut(p);
        // A big mover rises over its path as it goes: highest halfway, back down as it lands.
        out[i] = from[i] + (to[i] - from[i]) * e - (axis === 1 && arc ? arc[i] * 4 * e * (1 - e) : 0);
      };
      for (let i = 0; i < n; i++) { go(mv.fromMx, layout.mx, mx, mv.wait, i, 0, undefined, mv.msM); go(mv.fromMy, layout.my, my, mv.wait, i, 1, mv.arcM, mv.msM); }
      for (let j = 0; j < m; j++) { go(mv.fromPx, layout.px, px, mv.pwait, j, 0, undefined, mv.msP); go(mv.fromPy, layout.py, py, mv.pwait, j, 1, mv.arcP, mv.msP); }
      drawBase();
      // Each moving frame's cost, for the frame-budget guards (diagnostic only).
      measure('strata-frame', t0);
      if (done) { move.current = null; setMoving(false); props.current.onLanded?.(true); } else again = true;
    }
    const want = props.current.lensAt;
    const L = lens.current;
    const tr = want ? props.current.lensR : 0;
    const reduce = prefersReducedMotion();
    if (want) {
      if (L.r < 0.5 || reduce) { L.x = want.x; L.y = want.y; } else { L.x += (want.x - L.x) * LENS_FOLLOW; L.y += (want.y - L.y) * LENS_FOLLOW; }
    }
    L.r = reduce ? tr : L.r + (tr - L.r) * LENS_GROW;
    if (Math.abs(L.r - tr) < 0.3) L.r = tr;
    if (want && (Math.abs(want.x - L.x) > 0.2 || Math.abs(want.y - L.y) > 0.2)) again = true;
    else if (want) { L.x = want.x; L.y = want.y; }
    if (L.r !== tr) again = true;
    const t1 = performance.now();
    const hit = move.current ? null : drawLens();
    if (L.r > 0.5) measure('lens-frame', t1);
    const id = hit ? `${hit.field}:${hit.index}` : '';
    if (id !== picked.current) { picked.current = id; props.current.onPick?.(hit); }
    if (again) raf.current = requestAnimationFrame(frame);
  };
  // Every frame runs the latest render's `tick`, which reads that render's layout, inks and marks: a frame
  // asked for by an earlier render (the field drawn, then laid out again at the full page's measured
  // height before it had moved) animated toward the earlier layout, and left the squares where it said.
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const frame = (t: number) => tickRef.current(t);
  const kick = () => { if (!raf.current && heldAt.current == null) raf.current = requestAnimationFrame(frame); };

  // Sized for the plot at the device's density.
  useLayoutEffect(() => {
    for (const cv of [baseRef.current, lensRef.current, fadeRef.current]) {
      if (!cv) continue;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
  }, [W, H, dpr]);

  // A new layout: every square moves from where it is to its new place — a timeline step, a change of view, the
  // pile unrolling or folding back, the plot resized. Under reduced motion, or with nothing drawn yet, it is simply
  // there.
  // A field of other people (another snapshot) arrives by its step, or not at all: it is simply there.
  const lastStrata = useRef(strata);
  // The view laid out last: a change of view is everyone moving to their place in the other.
  const lastView = useRef(layout.view);
  // Whether a frame of this field has been shown: laid out again before then (going full page, measured
  // at its height before the first paint), it is simply at the new layout — there is nothing to move from.
  const shown = useRef(false);
  // The layout and step last arrived at: the same layout again, with no new step onto it, is nothing to do.
  const lastLayout = useRef<StrataLayout | null>(null);
  const lastStep = useRef<Step | null>(null);
  useLayoutEffect(() => {
    const newStep = !!step && step !== lastStep.current;
    lastStep.current = step;
    if (layout === lastLayout.current && !newStep) return;
    lastLayout.current = layout;
    const was = cur.current;
    const fresh = was.mx.length !== n || was.px.length !== m || lastStrata.current !== strata;
    const stepped = !!step && step.to === layout && shown.current;
    const prevView = lastView.current;
    const morphing = layout.view !== prevView && !stepped;
    lastView.current = layout.view;
    // Panned along the magnified axis (or resized there): simply there, as a page scrolls.
    const panned = !morphing && !stepped && layout.view === 'magnify' && prevView === 'magnify';
    lastStrata.current = strata;
    if (prefersReducedMotion() || ((fresh || !shown.current) && !stepped) || panned) {
      cur.current = { mx: layout.mx.slice(), my: layout.my.slice(), px: layout.px.slice(), py: layout.py.slice() };
      if (move.current?.stage?.phase) props.current.onPhase?.(null);
      move.current = null;
      setMoving(false);
      drawBase();
      kick();
      props.current.onLanded?.(false);
      return;
    }
    const now = performance.now();
    if (stepped && step?.fade && baseRef.current && fadeRef.current) {
      // Back to an earlier snapshot (3a): the picture as it was fades out over the new one, no one moving.
      const was = fadeRef.current, base = baseRef.current, fctx = was.getContext('2d');
      fctx?.setTransform(1, 0, 0, 1, 0, 0);
      fctx?.clearRect(0, 0, was.width, was.height);
      fctx?.drawImage(base, 0, 0);
      cur.current = { mx: layout.mx.slice(), my: layout.my.slice(), px: layout.px.slice(), py: layout.py.slice() };
      move.current = null;
      drawBase();
      setMoving(true);
      const opts = { duration: FADE_MS, easing: 'ease-in-out', fill: 'both' as const };
      was.animate([{ opacity: 1 }, { opacity: 0 }], opts);
      const a = base.animate([{ opacity: 0 }, { opacity: 1 }], opts);
      a.onfinish = () => { fctx?.clearRect(0, 0, was.width, was.height); setMoving(false); props.current.onLanded?.(true); };
      kick();
      return;
    } else if (stepped && step) {
      // A timeline step (3a §8): each square's own part of it — set off along a left-to-right wave by where it
      // stands, a little at random, a mover arcing (raises and cuts) — and, staged, the re-sort's ripple up each
      // column from the bottom. All together where the step is quick (Fast, a catch-up).
      const { from, kind, rank, ghosts, plan, mode } = step;
      const together = plan.mv < TOGETHER_MS;
      const target = step.mid ?? { mx: layout.mx, my: layout.my, px: layout.px, py: layout.py };
      const h = (k: number, at: number) => ((k >>> at) % 1024) / 1024;
      const timing = (K: Uint8Array, FX: Float64Array, TX: Float64Array, keys: Uint32Array, rk: Float32Array, followed: number) => {
        const dl = new Float32Array(K.length), du = new Float32Array(K.length), arc = new Float32Array(K.length), sdl = new Float32Array(K.length);
        for (let i = 0; i < K.length; i++) {
          if (together) { du[i] = 1; continue; }
          const tm = moveTiming(K[i], clamp01((K[i] === NEW ? TX[i] : FX[i]) / W), h(keys[i], 0), TX[i] - FX[i]);
          dl[i] = tm.dl;
          du[i] = tm.du;
          // Raises and cuts arc to their new column (3a); the person followed always does.
          if ((mode === 'change' && (K[i] === UP || K[i] === DOWN)) || i === followed) arc[i] = moveTiming(UP, 0, 0, TX[i] - FX[i]).arc;
          sdl[i] = sortTiming(rk[i], 1, h(keys[i], 10)).dl;
        }
        return { dl, du, arc, sdl };
      };
      const tM = timing(kind.main, from.mx, target.mx, strata.key, rank.main, follow?.field === 'main' ? follow.index : -1);
      const tP = timing(kind.pile, from.px, target.px, strata.pileKey, rank.pile, follow?.field === 'pile' ? follow.index : -1);
      const gn = ghosts?.x.length ?? 0, gdl = new Float32Array(gn), gdu = new Float32Array(gn).fill(1);
      for (let g = 0; g < gn && !together; g++) ({ dl: gdl[g], du: gdu[g] } = moveTiming(LEFT, clamp01(ghosts!.x[g] / W), h(stableKey(g), 0)));
      cur.current = { mx: from.mx.slice(), my: from.my.slice(), px: from.px.slice(), py: from.py.slice() };
      const stage: Stage = {
        step, start: now, cd: plan.cd,
        dlM: tM.dl, duM: tM.du, arcM: tM.arc, sdlM: tM.sdl, dlP: tP.dl, duP: tP.du, arcP: tP.arc, sdlP: tP.sdl, gdl, gdu,
        scM: new Float32Array(n).fill(1), colM: new Uint32Array(n), scP: new Float32Array(m).fill(1), colP: new Uint32Array(m),
        gx: ghosts ? ghosts.x.slice() : new Float64Array(0), gy: ghosts ? ghosts.y.slice() : new Float64Array(0), gsc: new Float32Array(gn), gcol: new Uint32Array(gn),
        tx: new Float64Array(2 * (n + m)), ty: new Float64Array(2 * (n + m)), tsc: new Float32Array(2 * (n + m)), tcol: new Uint32Array(2 * (n + m)), tn: 0,
        phase: null, phaseEnd: 0, still: false, redraw: false, chained: false,
      };
      // Fast's flow (3a §10): on from the step before as it lands, its clock running on from that one's end (t0 +=
      // duration), so the motion never stops between snapshots.
      if (step.flow && now - flowEnd.current < FLOW_CHAIN_MS) { stage.start = flowEnd.current; stage.chained = true; }
      // A step cut short by the next: its phase is over.
      if (move.current?.stage?.phase) props.current.onPhase?.(null);
      // For the label of the person followed, counting their pay along: where they set off and how long they take.
      move.current = {
        start: stage.start, fromMx: from.mx, fromMy: from.my, fromPx: from.px, fromPy: from.py,
        wait: Float64Array.from(tM.dl, (d) => d * plan.mv), pwait: Float64Array.from(tP.dl, (d) => d * plan.mv), ms: plan.mv * (together ? 1 : 0.4), stage,
      };
      stageFrame(now);
    } else if (morphing) {
      // A change of view (3a). To or from the floors: everyone from where they are to their place in the other view,
      // staggered — into the floors from the bottom up, back left to right, a little at random — each on a small hop,
      // over VIEW_MS. In or out of the magnified view: everyone together but for a little at random, over ZOOM_MS.
      const zoom = layout.view !== 'floors' && prevView !== 'floors';
      const total = zoom ? ZOOM_MS : VIEW_MS, moving = (zoom ? ZOOM_MOVE : VIEW_MOVE) * total;
      const wait = new Float64Array(n), pwait = new Float64Array(m);
      const msM = new Float64Array(n).fill(moving), msP = new Float64Array(m).fill(moving);
      const arcM = new Float32Array(n), arcP = new Float32Array(m);
      const along = (x: number, y: number) => Math.min(1, Math.max(0, layout.view === 'floors' ? (H - y) / H : x / W));
      const frac = (k: number, at: number) => ((k >>> at) % 1024) / 1024;
      const setOff = (x: number, y: number, k: number) => total * (zoom ? ZOOM_JITTER * frac(k, 0) : VIEW_WAVE * along(x, y) + VIEW_JITTER * frac(k, 0));
      for (let i = 0; i < n; i++) {
        wait[i] = setOff(layout.mx[i], layout.my[i], strata.key[i]);
        if (!zoom) arcM[i] = VIEW_HOP * frac(strata.key[i], 10);
      }
      for (let j = 0; j < m; j++) {
        pwait[j] = setOff(layout.px[j], layout.py[j], strata.pileKey[j]);
        if (!zoom) arcP[j] = VIEW_HOP * frac(strata.pileKey[j], 10);
      }
      move.current = { start: now, fromMx: was.mx.slice(), fromMy: was.my.slice(), fromPx: was.px.slice(), fromPy: was.py.slice(), wait, pwait, ms: moving, msM, msP, arcM, arcP };
    } else {
      const wait = new Float64Array(n), pwait = new Float64Array(m);
      for (let i = 0; i < n; i++) wait[i] = (layout.mx[i] / W) * MOVE_WAVE_MS;
      for (let j = 0; j < m; j++) pwait[j] = (layout.px[j] / W) * MOVE_WAVE_MS;
      move.current = { start: now, fromMx: was.mx.slice(), fromMy: was.my.slice(), fromPx: was.px.slice(), fromPy: was.py.slice(), wait, pwait, ms: MOVE_MS };
    }
    setMoving(true);
    drawBase();
    kick();
    // A step's own change (the last one again, in another mode) is a move too, onto the same layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, step]);

  // A change of ink or marks with the squares at rest: one redraw.
  useLayoutEffect(() => {
    if (!move.current) drawBase();
    else if (move.current.stage) move.current.stage.redraw = true;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tint, marks, big, scheme, follow]);
  // The lens follows: start the loop whenever the pointer or the wanted lens moves.
  const lensKey = lensAt ? `${lensAt.x},${lensAt.y}` : '';
  const pointerKey = pointer ? `${pointer.x},${pointer.y}` : '';
  const fromKey = lensFrom ? `${lensFrom.x},${lensFrom.y}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { kick(); }, [lensKey, pointerKey, fromKey, lensR]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // The speed changed while a step's countdown held it: on to the re-sort now.
  useEffect(() => {
    const st = move.current?.stage;
    if (!st?.step.mid) return;
    const el = performance.now() - st.start, mv = st.step.plan.mv;
    if (el >= mv && el < mv + st.cd) st.cd = el - mv;
  }, [skipHold]);
  // Held (out of sight): the frames stop; let go, a move in flight goes on from where it was.
  const heldAt = useRef<number | null>(null);
  useEffect(() => {
    if (hold) { heldAt.current = performance.now(); cancelAnimationFrame(raf.current); raf.current = 0; return; }
    if (heldAt.current == null) return;
    const mv = move.current, d = performance.now() - heldAt.current;
    if (mv) mv.start += d;
    if (mv?.stage) mv.stage.start += d;
    heldAt.current = null;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  // For a test to read who is lit and where everyone stands, without 44,000 numbers in the markup: a print of
  // each field's lit squares (how many, and the sum and sum of squares of their indices), and functions on the
  // field's box for every square's resting centre and slot.
  const litPrint = (mask: Uint8Array | undefined) => {
    if (!mask) return undefined;
    let c = 0, sum = 0, sq = 0;
    for (let i = 0; i < mask.length; i++) if (!mask[i]) { c++; sum += i; sq += i * i; }
    return `${c}:${sum}:${sq}`;
  };
  useEffect(() => {
    const el = wrapRef.current as (HTMLDivElement & { squarePlaces?: (f: Field) => number[]; squareSlots?: (f: Field) => number[]; squareNow?: (f: Field) => number[] }) | null;
    if (!el) return;
    el.squarePlaces = (f) => {
      const X = f === 'main' ? layout.mx : layout.px, Y = f === 'main' ? layout.my : layout.py;
      const out: number[] = [];
      for (let i = 0; i < X.length; i++) out.push(X[i] + grid.sqW / 2, Y[i] + grid.sq / 2);
      return out;
    };
    el.squareSlots = (f) => Array.from(f === 'main' ? layout.main.slot : layout.pile.slot);
    // Where each square is drawn this moment (in a move, on its way): its centre, x then y.
    el.squareNow = (f) => {
      const X = f === 'main' ? cur.current.mx : cur.current.px, Y = f === 'main' ? cur.current.my : cur.current.py;
      const out: number[] = [];
      for (let i = 0; i < X.length; i++) out.push(X[i] + grid.sqW / 2, Y[i] + grid.sq / 2);
      return out;
    };
  }, [layout, grid]);

  useImperativeHandle(ref, () => ({
    positionOf(field, index) {
      const X = field === 'main' ? layout.mx : layout.px, Y = field === 'main' ? layout.my : layout.py;
      if (index < 0 || index >= X.length) return null;
      return { x: X[index] + grid.sqW / 2, y: Y[index] + grid.sq / 2, s: grid.sq };
    },
  }), [layout, grid]);

  return (
    <div
      ref={wrapRef} className={className} data-settled="true" data-per={grid.per} data-pitch={grid.pitch} data-row-pitch={grid.rowPitch}
      data-sq={grid.sq} data-sq-w={grid.sqW} data-gap={grid.gap}
      data-col-w={layout.colW} data-pile-left={layout.pileLeft} data-base={layout.base} data-room={layout.room} data-peak={layout.peak} data-unrolled={layout.tail ? 'true' : undefined}
      data-lit={litPrint(dim?.main)} data-pile-lit={litPrint(dim?.pile)}
      data-marks={marks.main.length ? marks.main.map((i) => (i < n ? `${i}:${markAt(layout.mx[i] + grid.sqW / 2, dpr).toFixed(2)}:${markAt(layout.my[i] + grid.sq / 2, dpr).toFixed(2)}` : `${i}`)).join(' ') : undefined}
      data-pile-marks={marks.pile.length ? marks.pile.join(' ') : undefined}
      data-mark-big={big ? `${big.field}:${big.index}` : undefined}
      data-follow={follow ? `${follow.field}:${follow.index}` : undefined} data-follow-label={follow ? followText(follow, 1) : undefined}
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none' }}>
      <canvas ref={baseRef} className="strata-base" style={{ position: 'absolute', inset: 0, width: W, height: H }} />
      <canvas ref={fadeRef} className="strata-fade" style={{ position: 'absolute', inset: 0, width: W, height: H, pointerEvents: 'none' }} />
      {/* Over the pins and their lines, which are drawn after the field: the glass lies on everything it shows. */}
      <canvas ref={lensRef} className="strata-lens" style={{ position: 'absolute', inset: 0, width: W, height: H, zIndex: Z.content }} />
    </div>
  );
});
