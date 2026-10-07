import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  COLS, COL_DOLLARS, DROP_MS, DROP_ROW_MS, DROP_WAVE_MS, MOVE_MS, MOVE_WAVE_MS, PILE_PER_ROW, STEP_MS, stepTiming,
  colHeight, colLeft, easeInOut, fisheye, landEase, snap, snapReach, squareAt, squarePixels, stackColumns, strataGrid, tailColumns,
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

/** The break between the plot and the pile past the cap, CSS px, on a phone and wider. */
export const PILE_GAP = { phone: 12, wide: 20 };
/** The lens's radius at full size, CSS px, and how far it moves toward the pointer each frame. */
export const LENS_R = { phone: 56, wide: 76 };
const LENS_FOLLOW = 0.34;
const LENS_GROW = 0.28;
/** Under the lens, by how much it is magnified: drawn in full, then fainter toward the rim. */
const RIM_ALPHA: readonly (readonly [number, number])[] = [[0, 1], [1, 0.7], [2, 0.4]];
/** The lens's magnification at its centre (lib/strata `fisheye`, d = 5): the pointer's place in the field is
 *  its offset from the centre over this. */
const LENS_MAG = 6;
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

export interface StrataLayout {
  W: number;
  H: number;
  dpr: number;
  /** The baseline's y; the squares stand on it. */
  base: number;
  /** CSS px per $1k column, and the main plot's width: $0 at 0, $250k at `mainW`. */
  colW: number;
  mainW: number;
  /** The pile's left edge and width (none while it is unrolled). */
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
  /** The highest any square stands: the top of the tallest column or of the pile. */
  peakY: number;
  /** Unrolled: the pile's people at their own pay on an axis from $0 to the top salary (`top`, `scale` px a
   *  dollar), and the graph squeezed to its true share of it, `capX` px wide (`squeeze` of its own width).
   *  Null while the pile is a pile. */
  tail: { top: number; scale: number; capX: number; squeeze: number; topIndex: number } | null;
}

/**
 * Where everyone stands, for a plot `W` by `H` whose squares may rise to `top`: the grid (lib/strata
 * `strataGrid`) for the room there is, the columns stacked by type (`stackColumns`), and each square's corner.
 * The pile is fourteen squares a row past a break at the right — or, `unroll`ed, each of its people at their
 * own pay on an axis run out to the top salary, with the graph squeezed to its share of that axis.
 */
export function layoutStrata(
  s: Strata,
  /** `peak`: the tallest column to make room for, if more than this field's own — the timeline's tallest in any
   *  snapshot, so each is drawn to one scale. */
  opts: { W: number; H: number; top: number; dpr: number; phone: boolean; peak?: number },
  unroll = false,
): StrataLayout {
  const { W, H, top, dpr, phone } = opts;
  const base = H - 1;
  const rowsH = Math.max(20, base - top);
  let peak = opts.peak ?? 0;
  for (let c = 0; c < COLS; c++) peak = Math.max(peak, s.colCount[c]);
  const gap = phone ? PILE_GAP.phone : PILE_GAP.wide;
  const hasPile = s.pileKind.length > 0;
  // The pile is as wide as fourteen of the columns' squares, and they follow the columns' width: so the plot's
  // share, for a given number a row, is (W − gap) over 1 + 14 / (250 × per). Settled in a round or two.
  let mainW = hasPile ? W - gap - PILE_PER_ROW * 1.5 : W;
  let grid = strataGrid({ colW: mainW / COLS, rowsH, peak, dpr });
  for (let k = 0; k < 4 && hasPile; k++) {
    mainW = (W - gap) / (1 + PILE_PER_ROW / (COLS * grid.per));
    const next = strataGrid({ colW: mainW / COLS, rowsH, peak, dpr });
    if (next.per === grid.per && Math.abs(next.pitch - grid.pitch) < 1e-9) { grid = next; break; }
    grid = next;
  }
  const colW = mainW / COLS;
  const n = s.col.length, m = s.pileKind.length;
  const main = stackColumns(s.col, s.kind, s.key, s.rank, COLS);
  const mx = new Float64Array(n), my = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const at = squareAt(colLeft(s.col[i], colW), main.slot[i], grid.per, grid, base);
    mx[i] = at.x;
    my[i] = at.y;
  }
  const px = new Float64Array(m), py = new Float64Array(m);
  let pile: Stack, tail: StrataLayout['tail'] = null, pileLeft = W, pileW = 0, pileTop = 0;
  if (unroll && s.pilePay && m > 0) {
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
    pile = stackColumns(cols, s.pileKind, s.pileKey, s.rank, last + 1);
    for (let j = 0; j < m; j++) {
      px[j] = cols[j] * grid.pitch;
      py[j] = base - (pile.slot[j] + 1) * grid.rowPitch;
      pileTop = Math.max(pileTop, (pile.slot[j] + 1) * grid.rowPitch);
    }
    tail = { top: topPay, scale, capX: COLS * COL_DOLLARS * scale, squeeze, topIndex };
  } else {
    pileW = hasPile ? PILE_PER_ROW * grid.pitch : 0;
    pileLeft = snap(W - pileW, dpr);
    pile = stackColumns(new Uint8Array(m), s.pileKind, s.pileKey, s.rank, 1);
    for (let j = 0; j < m; j++) {
      const at = squareAt(pileLeft, pile.slot[j], PILE_PER_ROW, grid, base);
      px[j] = at.x;
      py[j] = at.y;
    }
    pileTop = hasPile ? Math.ceil(m / PILE_PER_ROW) * grid.rowPitch : 0;
  }
  const peakY = base - Math.max(colHeight(peak, grid), pileTop);
  return { W, H, dpr, base, colW, mainW, pileLeft, pileW, grid, main, pile, mx, my, px, py, peakY, tail };
}

/** The x of a pay on the main plot, CSS px. */
export const payX = (L: Pick<StrataLayout, 'colW'>, pay: number) => (pay / 1000) * L.colW;
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
  kinds: string[]; dim: string; match: string; up: string; down: string; ink: string; card: string; lensBg: string; lensRim: string; lensShadow: string;
  inverseBg: string; inverseInk: string; inverseEdge: string; font: string;
}
function readInks(el: HTMLElement, kinds: readonly string[]): Inks {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  el.appendChild(probe);
  const read = (v: string) => { probe.style.color = v; return canvasColor(getComputedStyle(probe).color); };
  const out = {
    kinds: kinds.map(read), dim: read('var(--strata-dim)'), match: read('var(--strata-match)'), up: read('var(--text-pos)'), down: read('var(--text-neg)'), ink: read('var(--mantine-color-text)'),
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
 * above the plot for someone who joined — how high a big mover arcs on the way (0 for the rest), and who left:
 * from their old place up out of the top, gone when the step ends.
 */
export interface Step {
  to: StrataLayout;
  from: { mx: Float64Array; my: Float64Array; px: Float64Array; py: Float64Array };
  arc: { main: Float32Array; pile: Float32Array } | null;
  /** Who joined this step (1), dropping in from above the plot once the rest are on their way. */
  joined: { main: Uint8Array; pile: Uint8Array };
  ghosts: { x: Float64Array; y: Float64Array; kind: Uint8Array } | null;
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
  /** How to arrive at `layout`, when it is a timeline step's. */
  step?: Step | null;
  follow?: Follow | null;
  className?: string;
}>(function StrataField({ strata, layout, kindInks, dim, matchSearch, marks, big, entrance, replay, lensAt, lensFrom = null, pointer, lensR, onPick, onMoving, hues = null, step = null, follow = null, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  const { W, H, dpr, grid } = layout;
  const n = strata.col.length, m = strata.pileKind.length;

  // Positions now, and the move in flight: where each square set off from, how long it waits, and the ease.
  const cur = useRef({ mx: new Float64Array(0), my: new Float64Array(0), px: new Float64Array(0), py: new Float64Array(0) });
  const move = useRef<{
    start: number; fromMx: Float64Array; fromMy: Float64Array; fromPx: Float64Array; fromPy: Float64Array; wait: Float64Array; pwait: Float64Array; ms: number; land: boolean;
    /** A timeline step's own time for each square, where it is not `ms` (lib/strata `stepTiming`). */
    msM?: Float64Array; msP?: Float64Array;
    arcM?: Float32Array; arcP?: Float32Array;
    /** Who left, lifting out: from y0 to y1, and where they are now. */
    ghost?: { x: Float64Array; y0: Float64Array; y1: Float64Array; y: Float64Array; wait: Float64Array; ms: number; kind: Uint8Array };
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
    const box: Px = { X: 0, Y: 0, w: 0, h: 0 };
    // `least`: under a filter its people stand where they are, scattered through the faded; on a 1x screen a
    // square of one pixel is a speck, so each is drawn at least LIT_MIN pixels each way, round its own place.
    const put = (x: number, y: number, c: number, least: number) => {
      let { X, Y, w, h } = squarePixels(x, y, grid, dpr, box);
      if (w < least) { X -= (least - w) >> 1; w = least; }
      if (h < least) { Y -= (least - h) >> 1; h = least; }
      // Clipped to the canvas, not clamped to it: a square above the plot (one dropping in, or lifting out) is
      // not drawn at all, rather than along its top edge.
      if (X < 0) { w += X; X = 0; }
      if (Y < 0) { h += Y; Y = 0; }
      w = Math.min(w, cw - X);
      h = Math.min(h, ch - Y);
      if (w <= 0 || h <= 0) return;
      for (let r = 0; r < h; r++) { const o = (Y + r) * cw + X; for (let q = 0; q < w; q++) buf[o + q] = c; }
    };
    for (const k of order) {
      const c = packed(ink(k));
      const least = (dim && k !== tint.C) || k >= tint.C + 2 ? LIT_MIN : 1;
      const a = tint.mainBy[k], b = tint.pileBy[k];
      for (let q = 0; q < a.length; q++) put(mx[a[q]], my[a[q]], c, least);
      for (let q = 0; q < b.length; q++) put(px[b[q]], py[b[q]], c, least);
    }
    // Who left, on their way up and out.
    const gh = move.current?.ghost;
    if (gh) for (let g = 0; g < gh.x.length; g++) put(gh.x[g], gh.y[g], packed(dim ? t.dim : t.kinds[gh.kind[g]] ?? t.dim), 1);
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

  const drawLens = (): LensHit | null => {
    const cv = lensRef.current, t = inks.current;
    if (!cv || !t) return null;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
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
    const hw = grid.sqW / 2, hh = grid.sq / 2, s = (grid.sq + grid.sqW) / 2;
    const ptr = props.current.pointer;
    const tail = layout.tail;
    // Who could be under the lens: the columns within its reach (squeezed, while the pile is unrolled), and
    // the pile where it overlaps.
    const cw = layout.colW * (tail ? tail.squeeze : 1);
    const c0 = Math.max(0, Math.floor((sx - R) / cw) - 1), c1 = Math.min(COLS - 1, Math.ceil((sx + R) / cw) + 1);
    const lists: { field: Field; idx: number[] }[] = [{ field: 'main', idx: [] }, { field: 'pile', idx: [] }];
    for (let c = c0; c <= c1; c++) for (let q = layout.main.start[c]; q < layout.main.start[c + 1]; q++) lists[0].idx.push(layout.main.order[q]);
    if (m && (tail || sx + R >= layout.pileLeft)) for (let j = 0; j < m; j++) lists[1].idx.push(j);
    // Who it can name: the graph's people, or the tail's once the pile is unrolled (the pile itself is the way
    // to unroll it, and the squeezed graph the way to fold it back); with a filter on, only its own — the faded
    // ones are the rest, not who is being read.
    const nameable = (field: Field, k: number) => (field === 'pile') === !!tail && !(dim && k === tint.C);
    // The pointer's place in the field: what the lens shows under it, magnified about six times at its centre.
    const qx = ptr ? sx + (ptr.x - cx) / LENS_MAG : 0, qy = ptr ? sy + (ptr.y - cy) / LENS_MAG : 0;
    let near: { field: Field; index: number; x: number; y: number; z: number; d: number } | null = null;
    let followed: { x: number; y: number; z: number } | null = null;
    let nameableHere = 0;
    // `a`: how strongly it is drawn — full where the lens magnifies, fainter in the crowded ring at its rim,
    // where whole columns are squeezed into lines and at full ink read as spokes rather than people.
    const draws: { k: number; x: number; y: number; z: number; a: number }[] = [];
    for (const { field, idx } of lists) {
      const X = field === 'main' ? mx : px, Y = field === 'main' ? my : py, T = field === 'main' ? tint.main : tint.pile;
      for (const i of idx) {
        const ox = X[i] + hw, oy = Y[i] + hh;
        const f = fisheye(ox - sx, oy - sy, R);
        if (!f) continue;
        const z = Math.max(0.7, s * f.scale * 0.92);
        const x = cx + f.x, y = cy + f.y;
        draws.push({ k: T[i], x, y, z, a: f.scale >= 0.7 ? 0 : f.scale >= 0.35 ? 1 : 2 });
        if (follow && follow.field === field && follow.index === i) followed = { x, y, z };
        if (ptr && nameable(field, T[i])) {
          nameableHere++;
          const d = Math.hypot(ox - qx, oy - qy);
          if (!near || d < near.d) near = { field, index: i, x, y, z, d };
        }
      }
    }
    // Named: the nearest within a reach that widens as the people the lens could name thin out (lib/strata
    // `snapReach`) — the one under the pointer where they crowd, across the lens where a filter leaves a few.
    const reach = snapReach(nameableHere, R, Math.max(grid.sq, grid.sqW) / 2 + 0.75);
    const best: LensHit | null = near && near.d <= reach ? { field: near.field, index: near.index, x: near.x, y: near.y, s: Math.max(near.z, PICK_MIN) } : null;
    for (const k of tint.order) {
      ctx.fillStyle = ink(k);
      for (const [a, alpha] of RIM_ALPHA) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const d of draws) {
          if (d.k !== k || d.a !== a) continue;
          if (d.z > 4) ctx.roundRect(d.x - d.z / 2, d.y - d.z / 2, d.z, d.z, d.z * 0.22);
          else ctx.rect(d.x - d.z / 2, d.y - d.z / 2, d.z, d.z);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // The glass: a highlight up and to the left, and a rim.
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.9);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.lensRim;
    ctx.stroke();
    // The person followed, outlined where the lens shows them.
    if (followed) {
      const h = Math.max(followed.z, 4) / 2 + 1.5;
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(followed.x - h, followed.y - h, 2 * h, 2 * h);
    }
    // The square it names, ringed — drawn up to a size that reads wherever in the lens it is, and whole over
    // the glass's edge; reached for from across the lens, a faint line from the centre says which it is.
    if (best) {
      const k = (best.field === 'main' ? tint.main : tint.pile)[best.index];
      const far = Math.hypot(best.x - cx, best.y - cy);
      const h = best.s / 2 + 2.5;
      if (far > R * 0.3) {
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.ink;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(best.x - ((best.x - cx) / far) * (h + 1), best.y - ((best.y - cy) / far) * (h + 1));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = ink(k);
      ctx.beginPath();
      ctx.roundRect(best.x - best.s / 2, best.y - best.s / 2, best.s, best.s, best.s * 0.22);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(best.x - h, best.y - h, 2 * h, 2 * h);
    }
    ctx.restore();
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
      if (gh) for (let g = 0; g < gh.x.length; g++) {
        const p = Math.min(1, Math.max(0, (now - mv.start - gh.wait[g]) / gh.ms));
        if (p < 1) done = false;
        gh.y[g] = gh.y0[g] + (gh.y1[g] - gh.y0[g]) * p * p;
      }
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
  const kick = () => { if (!raf.current) raf.current = requestAnimationFrame(frame); };

  // Sized for the plot at the device's density.
  useLayoutEffect(() => {
    for (const cv of [baseRef.current, lensRef.current]) {
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
  // Whether a frame of this field has been shown: laid out again before then (going full page, measured
  // at its height before the first paint), it is simply at the new layout — there is nothing to move from.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const was = cur.current;
    const fresh = was.mx.length !== n || was.px.length !== m || lastStrata.current !== strata;
    const drop = (first.current && entrance) || replay !== lastReplay.current;
    const stepped = !!step && step.to === layout && !drop && shown.current;
    first.current = false;
    lastReplay.current = replay;
    lastStrata.current = strata;
    if (prefersReducedMotion() || ((fresh || !shown.current) && !drop && !stepped)) {
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
        pwait[j] = (layout.px[j] / W) * DROP_WAVE_MS + layout.pile.slot[j] / PILE_PER_ROW * DROP_ROW_MS;
      }
      cur.current = { mx: layout.mx.slice(), my: fromMy.slice(), px: layout.px.slice(), py: fromPy.slice() };
      move.current = { start: now, fromMx: layout.mx.slice(), fromMy, fromPx: layout.px.slice(), fromPy, wait, pwait, ms: DROP_MS, land: true };
    } else if (stepped && step) {
      // A timeline step: from each person's place before, the big movers launching together, who left lifting
      // out first and who joined dropping in last (lib/strata `stepTiming`).
      const { from, arc, joined, ghosts } = step;
      const wait = new Float64Array(n), pwait = new Float64Array(m), msM = new Float64Array(n), msP = new Float64Array(m);
      const role = (arcs: Float32Array | undefined, join: Uint8Array, i: number) => (join[i] ? 'join' : arcs?.[i] ? 'arc' : 'stay');
      for (let i = 0; i < n; i++) ({ wait: wait[i], ms: msM[i] } = stepTiming(role(arc?.main, joined.main, i), layout.mx[i], W));
      for (let j = 0; j < m; j++) ({ wait: pwait[j], ms: msP[j] } = stepTiming(role(arc?.pile, joined.pile, j), layout.px[j], W));
      cur.current = { mx: from.mx.slice(), my: from.my.slice(), px: from.px.slice(), py: from.py.slice() };
      const g = ghosts && ghosts.x.length ? (() => {
        let seed = 0x9e3779b1 ^ ghosts.x.length;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const k = ghosts.x.length;
        const y1 = new Float64Array(k), w = new Float64Array(k);
        for (let q = 0; q < k; q++) { y1[q] = -14 - rand() * 60; w[q] = stepTiming('leave', ghosts.x[q], W).wait; }
        return { x: ghosts.x, y0: ghosts.y, y1, y: ghosts.y.slice(), wait: w, ms: stepTiming('leave', 0, W).ms, kind: ghosts.kind };
      })() : undefined;
      move.current = { start: now, fromMx: from.mx, fromMy: from.my, fromPx: from.px, fromPy: from.py, wait, pwait, ms: STEP_MS, msM, msP, land: false, arcM: arc?.main, arcP: arc?.pile, ghost: g };
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
    const el = wrapRef.current as (HTMLDivElement & { squarePlaces?: (f: Field) => number[]; squareSlots?: (f: Field) => number[] }) | null;
    if (!el) return;
    el.squarePlaces = (f) => {
      const X = f === 'main' ? layout.mx : layout.px, Y = f === 'main' ? layout.my : layout.py;
      const out: number[] = [];
      for (let i = 0; i < X.length; i++) out.push(X[i] + grid.sqW / 2, Y[i] + grid.sq / 2);
      return out;
    };
    el.squareSlots = (f) => Array.from(f === 'main' ? layout.main.slot : layout.pile.slot);
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
      data-col-w={layout.colW} data-pile-left={layout.pileLeft} data-base={layout.base} data-unrolled={layout.tail ? 'true' : undefined}
      data-lit={litPrint(dim?.main)} data-pile-lit={litPrint(dim?.pile)}
      data-marks={marks.main.length ? marks.main.map((i) => (i < n ? `${i}:${markAt(layout.mx[i] + grid.sqW / 2, dpr).toFixed(2)}:${markAt(layout.my[i] + grid.sq / 2, dpr).toFixed(2)}` : `${i}`)).join(' ') : undefined}
      data-pile-marks={marks.pile.length ? marks.pile.join(' ') : undefined}
      data-mark-big={big ? `${big.field}:${big.index}` : undefined}
      data-follow={follow ? `${follow.field}:${follow.index}` : undefined} data-follow-label={follow ? followText(follow, 1) : undefined}
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none' }}>
      <canvas ref={baseRef} className="strata-base" style={{ position: 'absolute', inset: 0, width: W, height: H }} />
      {/* Over the pins and their lines, which are drawn after the field: the glass lies on everything it shows. */}
      <canvas ref={lensRef} className="strata-lens" style={{ position: 'absolute', inset: 0, width: W, height: H, zIndex: Z.content }} />
    </div>
  );
});
