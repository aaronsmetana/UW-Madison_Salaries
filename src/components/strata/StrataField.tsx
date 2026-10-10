import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  COLS, COL_DOLLARS, DROP_MS, FADE_MS, DROP_ROW_MS, DROP_WAVE_MS, MAG_COLS, MAG_GUTTER, MAG_MAX_PITCH_D, MOVE_MS, MOVE_WAVE_MS, STEP_MS, VIEW_HOP, VIEW_JITTER,
  VIEW_MOVE, VIEW_MS, VIEW_WAVE, ZOOM_JITTER, ZOOM_MOVE, ZOOM_MS, stepTiming,
  FLOORS, FLOOR_GAP, colHeight, colX, easeInOut, floorOf, floorsGrid, landEase, snap, snapReach, squareAt, squarePixels, stackColumns, strataGrid, tailColumns,
  type Grid, type Px, type Stack, type Strata,
} from '../../lib/strata';
import { parseRgb } from '../../lib/inkMix';
import { followText } from '../../lib/timeline';
import { prefersReducedMotion } from '../../lib/motion';
import { Z } from '../../lib/layers';

/**
 * The landing graph's people as strata (mockup 3a, lib/strata): a square each on one canvas, and the lens
 * on a second over it. The squares are redrawn only while they move — the drop, the pile unrolling — and
 * the lens only while it follows the pointer; at rest nothing runs.
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

/** Unrolled, how far inside the right edge the top salary stands, CSS px. */
const TOP_INSET = 8;

/** Played once per session: after that the squares are simply there. */
const SEEN_KEY = 'strata-entrance';
const readSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const writeSession = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };
/** Whether the page plays the drop as it opens: once a session, never under reduced motion or in a hidden tab. */
export function useEntranceOnce(): boolean {
  const [play] = useState(() => !readSession() && !prefersReducedMotion() && !(typeof document !== 'undefined' && document.hidden));
  useEffect(() => { if (play) writeSession(); }, [play]);
  return play;
}

/** Who is dim under a filter: 1 for a square that fades, 0 for one of the group; one per square. */
export interface Dim { main: Uint8Array; pile: Uint8Array }
export type Field = 'main' | 'pile';
export interface Spot { field: Field; index: number }

export type StrataView = 'hist' | 'floors' | 'magnify';

/** Each field's columns sorted by salary (lib/strata `stackColumns`), once: a pan or a resize lays out the same order. */
const stacks = new WeakMap<Strata, { main: Stack; pile: Stack }>();
function columnStacks(s: Strata) {
  let st = stacks.get(s);
  if (!st) {
    st = { main: stackColumns(s.col, s.pay, s.kind, s.key, s.rank, COLS), pile: stackColumns(new Uint8Array(s.pileKind.length), s.pilePay, s.pileKind, s.pileKey, s.rank, 1) };
    stacks.set(s, st);
  }
  return st;
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
  opts: { W: number; H: number; top: number; dpr: number; phone: boolean; peak?: number; view?: StrataView; magLeft?: number },
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
  const { main, pile: pileStack } = columnStacks(s);
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
    pile = stackColumns(cols, s.pilePay, s.pileKind, s.pileKey, s.rank, last + 1);
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
function layoutFloors(s: Strata, opts: { W: number; H: number; dpr: number; phone: boolean; peak?: number }): StrataLayout {
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
  const stack = stackColumns(fl, pay, kind, key, s.rank, FLOORS);
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
  kinds: string[]; dim: string; match: string; up: string; down: string; ink: string; mute: string; card: string; lensBg: string; lensRim: string; lensShadow: string;
  inverseBg: string; inverseInk: string; inverseEdge: string; font: string;
}
function readInks(el: HTMLElement, kinds: readonly string[]): Inks {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  el.appendChild(probe);
  const read = (v: string) => { probe.style.color = v; return canvasColor(getComputedStyle(probe).color); };
  const out = {
    kinds: kinds.map(read), dim: read('var(--strata-dim)'), match: read('var(--strata-match)'), up: read('var(--text-pos)'), down: read('var(--text-neg)'), ink: read('var(--mantine-color-text)'),
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

/**
 * The person followed (3a §9): their square marked as a search's people are, and a dark label on a leader —
 * "{name} · $pay". Carried by a timeline step, the pay counts from `from` to `pay` as their square travels, and
 * once there the label adds the change.
 */
export interface Follow extends Spot { name: string; pay: number | null; from: number | null }

/**
 * A timeline step onto `to`: where each of its squares sets off — its person's place in the snapshot before, or
 * for someone who joined, where they will stand — how high a big mover arcs on the way (0 for the rest), and who
 * left: fading out where they stood, gone when the step ends.
 */
export interface Step {
  to: StrataLayout;
  from: { mx: Float64Array; my: Float64Array; px: Float64Array; py: Float64Array };
  arc: { main: Float32Array; pile: Float32Array } | null;
  /** Who joined this step (1), fading in where they stand once the rest are on their way. */
  joined: { main: Uint8Array; pile: Uint8Array };
  ghosts: { x: Float64Array; y: Float64Array; kind: Uint8Array } | null;
  /** Back to an earlier snapshot (3a): the field cross-fades to it, no one moving. */
  fade?: boolean;
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
  entrance: boolean;
  /** Bumped to drop everyone again. */
  replay: number;
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
  /** A timeline step's movers, by square: +1 up, −1 down — drawn on top in the up and down inks. */
  hues?: { main: Int8Array; pile: Int8Array } | null;
  /** How to arrive at `layout`, when it is a timeline step's, and how fast: the timeline's 1×, 2× or 4×. */
  step?: Step | null;
  speed?: number;
  /** Hold every motion where it is (the plot scrolled out of sight), and go on from there when let go. */
  hold?: boolean;
  follow?: Follow | null;
  className?: string;
}>(function StrataField({ strata, layout, kindInks, dim, matchSearch, marks, big, entrance, replay, lensAt, lensFrom = null, pointer, lensR, onPick, onMoving, hues = null, step = null, speed = 1, hold = false, follow = null, className }, ref) {
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
    start: number; fromMx: Float64Array; fromMy: Float64Array; fromPx: Float64Array; fromPy: Float64Array; wait: Float64Array; pwait: Float64Array; ms: number; land: boolean;
    /** A timeline step's own time for each square, where it is not `ms` (lib/strata `stepTiming`). */
    msM?: Float64Array; msP?: Float64Array;
    arcM?: Float32Array; arcP?: Float32Array;
    /** Who left, fading out where they stood. */
    ghost?: { x: Float64Array; y: Float64Array; wait: Float64Array; ms: number; kind: Uint8Array };
    /** Who joined, fading in: by square, and how far in each is (1 for everyone else). */
    fadeIn?: { main: Int32Array; pile: Int32Array; aM: Float32Array; aP: Float32Array };
    /** The frame's time, for the fades. */
    now?: number;
  } | null>(null);
  const raf = useRef(0);
  const inks = useRef<Inks | null>(null);
  const [scheme, setScheme] = useState(0);
  const lens = useRef({ x: 0, y: 0, r: 0 });
  const picked = useRef<string>('');
  const props = useRef({ lensAt, lensFrom, pointer, lensR, onPick, onMoving });
  props.current = { lensAt, lensFrom, pointer, lensR, onPick, onMoving };
  const movingRef = useRef(false);
  const px32 = useRef<{ img: ImageData; buf: Uint32Array } | null>(null);

  // Each square's ink: its kind's, the search's, or the faded one. Painted in that order, so a filter's
  // people lie over the faded ones they have left.
  // Ink C is the faded, C + 1 the search's, C + 2 and C + 3 a timeline step's movers, up and down.
  const tint = useMemo(() => {
    const C = kindInks.length;
    const of = (kinds: Uint8Array, mask: Uint8Array | null, hue: Int8Array | null) => {
      const out = new Uint8Array(kinds.length);
      for (let i = 0; i < kinds.length; i++) {
        out[i] = mask ? (mask[i] ? C : matchSearch ? C + 1 : kinds[i]) : kinds[i];
        if (hue && hue[i] && out[i] !== C) out[i] = hue[i] > 0 ? C + 2 : C + 3;
      }
      return out;
    };
    const main = of(strata.kind, dim?.main ?? null, hues?.main ?? null), pile = of(strata.pileKind, dim?.pile ?? null, hues?.pile ?? null);
    // Each ink's squares, listed once, so a frame paints ink by ink without looking at everyone each time.
    const lists = (t: Uint8Array) => {
      const n = new Int32Array(C + 4);
      for (let i = 0; i < t.length; i++) n[t[i]]++;
      const out = Array.from(n, (k) => new Int32Array(k));
      n.fill(0);
      for (let i = 0; i < t.length; i++) out[t[i]][n[t[i]]++] = i;
      return out;
    };
    return { main, pile, C, mainBy: lists(main), pileBy: lists(pile), order: [C, ...Array.from({ length: C }, (_, k) => k), C + 1, C + 2, C + 3] };
  }, [strata, dim, matchSearch, kindInks.length, hues]);

  // The page's tokens, again whenever the scheme changes.
  useEffect(() => {
    const obs = new MutationObserver(() => setScheme((k) => k + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    return () => obs.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (wrapRef.current) inks.current = readInks(wrapRef.current, kindInks);
  }, [kindInks, scheme]);

  const ink = (k: number) => {
    const t = inks.current!;
    return k < tint.C ? t.kinds[k] : k === tint.C ? t.dim : k === tint.C + 1 ? t.match : k === tint.C + 2 ? t.up : t.down;
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
    const least = (k: number) => ((dim && k !== tint.C) || k >= tint.C + 2 ? LIT_MIN : 1);
    const box: Px = { X: 0, Y: 0, w: 0, h: 0 };
    // `least`: under a filter its people stand where they are, scattered through the faded; on a 1x screen a
    // square of one pixel is a speck, so each is drawn at least LIT_MIN pixels each way, round its own place.
    const put = (x: number, y: number, c: number, least: number) => {
      let { X, Y, w, h } = squarePixels(x, y, grid, dpr, box);
      if (w < least) { X -= (least - w) >> 1; w = least; }
      if (h < least) { Y -= (least - h) >> 1; h = least; }
      // Clipped to the canvas, not clamped to it: a square above the plot (one dropping in) is not drawn at
      // all, rather than along its top edge.
      if (X < 0) { w += X; X = 0; }
      if (Y < 0) { h += Y; Y = 0; }
      w = Math.min(w, cw - X);
      h = Math.min(h, ch - Y);
      if (w <= 0 || h <= 0) return;
      for (let r = 0; r < h; r++) { const o = (Y + r) * cw + X; for (let q = 0; q < w; q++) buf[o + q] = c; }
    };
    // A step's comings and goings, first: who left fading out where they stood, who joined fading in where they
    // stand (lib/strata `stepTiming`). A pixel is written, not blended, so anyone moving over them is drawn whole.
    const mv = move.current;
    const into = (wait: number, ms: number) => (mv ? easeInOut(Math.min(1, Math.max(0, ((mv.now ?? mv.start) - mv.start - wait) / ms))) : 1);
    const faded = (c: number, a: number) => ((c & 0xffffff) | (Math.round(255 * a) << 24)) >>> 0;
    const gh = mv?.ghost;
    if (gh) for (let g = 0; g < gh.x.length; g++) {
      const a = 1 - into(gh.wait[g], gh.ms);
      if (a > 0) put(gh.x[g], gh.y[g], faded(packed(dim ? t.dim : t.kinds[gh.kind[g]] ?? t.dim), a), 1);
    }
    const fi = mv?.fadeIn;
    if (mv && fi) {
      const fade = (idx: Int32Array, A: Float32Array, X: Float64Array, Y: Float64Array, T: Uint8Array, wait: Float64Array, ms: Float64Array) => {
        for (const i of idx) {
          const a = (A[i] = into(wait[i], ms[i]));
          if (a > 0 && a < 1) put(X[i], Y[i], faded(packed(ink(T[i])), a), least(T[i]));
        }
      };
      fade(fi.main, fi.aM, mx, my, tint.main, mv.wait, mv.msM!);
      fade(fi.pile, fi.aP, px, py, tint.pile, mv.pwait, mv.msP!);
    }
    const aM = fi?.aM, aP = fi?.aP;
    for (const k of order) {
      const c = packed(ink(k)), l = least(k);
      const a = tint.mainBy[k], b = tint.pileBy[k];
      for (let q = 0; q < a.length; q++) if (!aM || aM[a[q]] === 1) put(mx[a[q]], my[a[q]], c, l);
      for (let q = 0; q < b.length; q++) if (!aP || aP[b[q]] === 1) put(px[b[q]], py[b[q]], c, l);
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
      const mv = move.current;
      let e = 1;
      if (mv && !mv.land) {
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
    const lists: { field: Field; idx: number[] }[] = [{ field: 'main', idx: [] }, { field: 'pile', idx: [] }];
    if (layout.view === 'floors') {
      for (let i = 0; i < n; i++) if (Math.abs(mx[i] - sx) <= reachField && Math.abs(my[i] - sy) <= reachField) lists[0].idx.push(i);
      for (let j = 0; j < m; j++) if (Math.abs(px[j] - sx) <= reachField && Math.abs(py[j] - sy) <= reachField) lists[1].idx.push(j);
    } else {
      for (let c = c0; c <= c1; c++) for (let q = layout.main.start[c]; q < layout.main.start[c + 1]; q++) lists[0].idx.push(layout.main.order[q]);
      if (m && (tail || sx + reachField >= layout.pileLeft)) for (let j = 0; j < m; j++) lists[1].idx.push(j);
    }
    // Who it can name: the graph's people, or the tail's once the pile is unrolled (the pile itself is the way
    // to unroll it, and the squeezed graph the way to fold it back); with a filter on, only its own — the faded
    // ones are the rest, not who is being read.
    const nameable = (field: Field, k: number) => (layout.view === 'floors' || (field === 'pile') === !!tail) && !(dim && k === tint.C);
    // The pointer's place in the field: what the loupe shows under it.
    const qx = ptr ? sx + (ptr.x - cx) / z : 0, qy = ptr ? sy + (ptr.y - cy) / z : 0;
    let near: { field: Field; index: number; x: number; y: number; d: number } | null = null;
    let followed: { x: number; y: number } | null = null;
    let nameableHere = 0;
    const draws: { k: number; x: number; y: number }[] = [];
    const w = grid.sqW * z, h = grid.sq * z;
    for (const { field, idx } of lists) {
      const X = field === 'main' ? mx : px, Y = field === 'main' ? my : py, T = field === 'main' ? tint.main : tint.pile;
      for (const i of idx) {
        const x = cx + (X[i] - sx) * z, y = cy + (Y[i] - sy) * z;
        if (x + w < cx - R || x > cx + R || y + h < cy - R || y > cy + R) continue;
        draws.push({ k: T[i], x, y });
        if (follow && follow.field === field && follow.index === i) followed = { x: x + w / 2, y: y + h / 2 };
        if (ptr && nameable(field, T[i])) {
          nameableHere++;
          const d = Math.hypot(X[i] + hw - qx, Y[i] + hh - qy);
          if (!near || d < near.d) near = { field, index: i, x: x + w / 2, y: y + h / 2, d };
        }
      }
    }
    // Named: the nearest within a reach that widens as the people the loupe could name thin out (lib/strata
    // `snapReach`) — the one under the pointer where they crowd, across the loupe where a filter leaves a few.
    const reach = snapReach(nameableHere, R / z, Math.max(grid.sq, grid.sqW) / 2 + 0.75);
    const best: LensHit | null = near && near.d <= reach ? { field: near.field, index: near.index, x: near.x, y: near.y, s: Math.max(h, PICK_MIN) } : null;
    for (const k of tint.order) {
      ctx.fillStyle = ink(k);
      ctx.beginPath();
      for (const d of draws) if (d.k === k) ctx.rect(d.x, d.y, w, h);
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
    if (mv) {
      const t0 = performance.now();
      const { mx, my, px, py } = cur.current;
      let done = true;
      const go = (from: Float64Array, to: Float64Array, out: Float64Array, wait: Float64Array, i: number, axis: 0 | 1, arc?: Float32Array, ms?: Float64Array) => {
        const p = Math.min(1, Math.max(0, (now - mv.start - wait[i]) / (ms ? ms[i] : mv.ms)));
        if (p < 1) done = false;
        const e = mv.land ? (axis === 1 ? landEase(p) : 1) : easeInOut(p);
        // A big mover rises over its path as it goes: highest halfway, back down as it lands.
        out[i] = from[i] + (to[i] - from[i]) * e - (axis === 1 && arc ? arc[i] * 4 * e * (1 - e) : 0);
      };
      for (let i = 0; i < n; i++) { go(mv.fromMx, layout.mx, mx, mv.wait, i, 0, undefined, mv.msM); go(mv.fromMy, layout.my, my, mv.wait, i, 1, mv.arcM, mv.msM); }
      for (let j = 0; j < m; j++) { go(mv.fromPx, layout.px, px, mv.pwait, j, 0, undefined, mv.msP); go(mv.fromPy, layout.py, py, mv.pwait, j, 1, mv.arcP, mv.msP); }
      const gh = mv.ghost;
      if (gh) for (let g = 0; g < gh.x.length; g++) if (now - mv.start - gh.wait[g] < gh.ms) done = false;
      mv.now = now;
      drawBase();
      // Each moving frame's cost, for the frame-budget guards (diagnostic only).
      try { performance.measure('strata-frame', { start: t0, end: performance.now() }); } catch { /* unsupported */ }
      if (done) { move.current = null; setMoving(false); } else again = true;
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
    if (L.r > 0.5) try { performance.measure('lens-frame', { start: t1, end: performance.now() }); } catch { /* unsupported */ }
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

  // A new layout: every square moves from where it is to its new place — dropped in, the first time, where
  // the page plays it; after, the pile unrolling or folding back, or the plot resized. Under reduced motion,
  // or with nothing drawn yet, it is simply there.
  const first = useRef(true);
  const lastReplay = useRef(replay);
  // A field of other people (another snapshot) arrives by its step, or not at all: it is simply there.
  const lastStrata = useRef(strata);
  // The view laid out last: a change of view is everyone moving to their place in the other.
  const lastView = useRef(layout.view);
  // Whether a frame of this field has been shown: laid out again before then (going full page, measured
  // at its height before the first paint), it is simply at the new layout — there is nothing to move from.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const was = cur.current;
    const fresh = was.mx.length !== n || was.px.length !== m || lastStrata.current !== strata;
    const drop = (first.current && entrance) || replay !== lastReplay.current;
    const stepped = !!step && step.to === layout && !drop && shown.current;
    const prevView = lastView.current;
    const morphing = layout.view !== prevView && !drop && !stepped;
    lastView.current = layout.view;
    // Panned along the magnified axis (or resized there): simply there, as a page scrolls.
    const panned = !morphing && !drop && !stepped && layout.view === 'magnify' && prevView === 'magnify';
    first.current = false;
    lastReplay.current = replay;
    lastStrata.current = strata;
    if (prefersReducedMotion() || ((fresh || !shown.current) && !drop && !stepped) || panned) {
      cur.current = { mx: layout.mx.slice(), my: layout.my.slice(), px: layout.px.slice(), py: layout.py.slice() };
      move.current = null;
      setMoving(false);
      drawBase();
      kick();
      return;
    }
    const now = performance.now();
    if (drop) {
      // From 10–150px above the plot, a column's floor first, left to right across it.
      let seed = 0x2545f491 ^ replay;
      const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const fromMy = new Float64Array(n), fromPy = new Float64Array(m), wait = new Float64Array(n), pwait = new Float64Array(m);
      for (let i = 0; i < n; i++) {
        fromMy[i] = -10 - rand() * 140;
        wait[i] = (layout.mx[i] / W) * DROP_WAVE_MS + layout.main.slot[i] / grid.per * DROP_ROW_MS;
      }
      for (let j = 0; j < m; j++) {
        fromPy[j] = -10 - rand() * 140;
        pwait[j] = (layout.px[j] / W) * DROP_WAVE_MS + layout.pile.slot[j] / grid.per * DROP_ROW_MS;
      }
      cur.current = { mx: layout.mx.slice(), my: fromMy.slice(), px: layout.px.slice(), py: fromPy.slice() };
      move.current = { start: now, fromMx: layout.mx.slice(), fromMy, fromPx: layout.px.slice(), fromPy, wait, pwait, ms: DROP_MS, land: true };
    } else if (stepped && step?.fade && baseRef.current && fadeRef.current) {
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
      a.onfinish = () => { fctx?.clearRect(0, 0, was.width, was.height); setMoving(false); };
      kick();
      return;
    } else if (stepped && step) {
      // A timeline step: from each person's place before, the big movers launching together, who left fading
      // out first and who joined fading in last (lib/strata `stepTiming`).
      const { from, arc, joined, ghosts } = step;
      const wait = new Float64Array(n), pwait = new Float64Array(m), msM = new Float64Array(n), msP = new Float64Array(m);
      const role = (arcs: Float32Array | undefined, join: Uint8Array, i: number) => (join[i] ? 'join' : arcs?.[i] ? 'arc' : 'stay');
      for (let i = 0; i < n; i++) ({ wait: wait[i], ms: msM[i] } = stepTiming(role(arc?.main, joined.main, i), layout.mx[i], W, speed));
      for (let j = 0; j < m; j++) ({ wait: pwait[j], ms: msP[j] } = stepTiming(role(arc?.pile, joined.pile, j), layout.px[j], W, speed));
      cur.current = { mx: from.mx.slice(), my: from.my.slice(), px: from.px.slice(), py: from.py.slice() };
      const g = ghosts && ghosts.x.length
        ? { x: ghosts.x, y: ghosts.y, wait: Float64Array.from(ghosts.x, (x) => stepTiming('leave', x, W, speed).wait), ms: stepTiming('leave', 0, W, speed).ms, kind: ghosts.kind }
        : undefined;
      const who = (join: Uint8Array) => Int32Array.from(join.keys()).filter((i) => join[i] === 1);
      const fadeIn = { main: who(joined.main), pile: who(joined.pile), aM: new Float32Array(n).fill(1), aP: new Float32Array(m).fill(1) };
      for (const i of fadeIn.main) fadeIn.aM[i] = 0;
      for (const j of fadeIn.pile) fadeIn.aP[j] = 0;
      move.current = { start: now, fromMx: from.mx, fromMy: from.my, fromPx: from.px, fromPy: from.py, wait, pwait, ms: STEP_MS / speed, msM, msP, land: false, arcM: arc?.main, arcP: arc?.pile, ghost: g, fadeIn };
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
      move.current = { start: now, fromMx: was.mx.slice(), fromMy: was.my.slice(), fromPx: was.px.slice(), fromPy: was.py.slice(), wait, pwait, ms: moving, msM, msP, land: false, arcM, arcP };
    } else {
      const wait = new Float64Array(n), pwait = new Float64Array(m);
      for (let i = 0; i < n; i++) wait[i] = (layout.mx[i] / W) * MOVE_WAVE_MS;
      for (let j = 0; j < m; j++) pwait[j] = (layout.px[j] / W) * MOVE_WAVE_MS;
      move.current = { start: now, fromMx: was.mx.slice(), fromMy: was.my.slice(), fromPx: was.px.slice(), fromPy: was.py.slice(), wait, pwait, ms: MOVE_MS, land: false };
    }
    setMoving(true);
    drawBase();
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, replay]);

  // A change of ink or marks with the squares at rest: one redraw.
  useLayoutEffect(() => {
    if (!move.current) drawBase();
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
  // Held (out of sight): the frames stop; let go, a move in flight goes on from where it was.
  const heldAt = useRef<number | null>(null);
  useEffect(() => {
    if (hold) { heldAt.current = performance.now(); cancelAnimationFrame(raf.current); raf.current = 0; return; }
    if (heldAt.current == null) return;
    const mv = move.current;
    if (mv) mv.start += performance.now() - heldAt.current;
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
