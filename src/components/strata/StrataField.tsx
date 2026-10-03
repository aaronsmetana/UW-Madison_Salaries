import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  COLS, DROP_MS, DROP_ROW_MS, DROP_WAVE_MS, PILE_PER_ROW, RESTACK_MS, RESTACK_WAVE_MS,
  colHeight, colLeft, easeInOut, fisheye, landEase, snap, squareAt, stackColumns, strataGrid,
  type Grid, type Stack, type Strata,
} from '../../lib/strata';
import { parseRgb } from '../../lib/inkMix';
import { prefersReducedMotion } from '../../lib/motion';
import { Z } from '../../lib/layers';

/**
 * The landing graph's people as strata (mockup 3a, lib/strata): a square each on one canvas, and the lens
 * on a second over it. The squares are redrawn only while they move — the drop, a filter's re-stack — and
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
/** How far past a magnified square's edge the pointer still finds it, CSS px. */
const PICK_REACH = 2.5;

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
  /** The pile's left edge and width. */
  pileLeft: number;
  pileW: number;
  grid: Grid;
  main: Stack;
  pile: Stack;
  /** Each square's top-left corner at rest. */
  mx: Float32Array;
  my: Float32Array;
  px: Float32Array;
  py: Float32Array;
  /** The highest any square stands: the top of the tallest column or of the pile. */
  peakY: number;
}

/**
 * Where everyone stands, for a plot `W` by `H` whose squares may rise to `top`: the grid (lib/strata
 * `strataGrid`) for the room there is, the columns stacked (`stackColumns`) with a filter's people at the
 * floor when `sink`, and each square's corner. The pile is fourteen squares a row past a break at the right.
 */
export function layoutStrata(s: Strata, opts: { W: number; H: number; top: number; dpr: number; phone: boolean }, dim: Dim | null, sink: boolean): StrataLayout {
  const { W, H, top, dpr, phone } = opts;
  const base = H - 1;
  const rowsH = Math.max(20, base - top);
  let peak = 0;
  for (let c = 0; c < COLS; c++) peak = Math.max(peak, s.colCount[c]);
  const gap = phone ? PILE_GAP.phone : PILE_GAP.wide;
  const hasPile = s.pileKind.length > 0;
  // The pile's width follows the pitch, and the pitch the columns' width: settled in a few rounds.
  let grid = strataGrid({ colW: (W - gap - PILE_PER_ROW * 1.5) / COLS, rowsH, peak, dpr });
  let mainW = W;
  for (let k = 0; k < 3; k++) {
    const pileW = hasPile ? PILE_PER_ROW * grid.pitch : 0;
    mainW = W - (hasPile ? gap + pileW : 0);
    const next = strataGrid({ colW: mainW / COLS, rowsH, peak, dpr });
    if (next.pitch === grid.pitch && next.per === grid.per) break;
    grid = next;
  }
  const colW = mainW / COLS;
  const pileW = hasPile ? PILE_PER_ROW * grid.pitch : 0;
  const pileLeft = snap(W - pileW, dpr);
  const pileDim = dim && sink ? dim.pile : null;
  const main = stackColumns(s.col, s.kind, s.key, s.rank, dim && sink ? dim.main : null, COLS);
  const pile = stackColumns(new Uint8Array(s.pileKind.length), s.pileKind, s.pileKey, s.rank, pileDim, 1);
  const n = s.col.length;
  const mx = new Float32Array(n), my = new Float32Array(n);
  const lefts = new Float32Array(COLS);
  for (let c = 0; c < COLS; c++) lefts[c] = colLeft(c, colW, grid, dpr);
  for (let i = 0; i < n; i++) {
    const at = squareAt(lefts[s.col[i]], main.slot[i], grid.per, grid.pitch, base);
    mx[i] = at.x;
    my[i] = at.y;
  }
  const m = s.pileKind.length;
  const px = new Float32Array(m), py = new Float32Array(m);
  for (let j = 0; j < m; j++) {
    const at = squareAt(pileLeft, pile.slot[j], PILE_PER_ROW, grid.pitch, base);
    px[j] = at.x;
    py[j] = at.y;
  }
  const peakY = base - Math.max(colHeight(peak, grid), hasPile ? Math.ceil(m / PILE_PER_ROW) * grid.pitch : 0);
  return { W, H, dpr, base, colW, mainW, pileLeft, pileW, grid, main, pile, mx, my, px, py, peakY };
}

/** The x of a pay on the main plot, CSS px. */
export const payX = (L: Pick<StrataLayout, 'colW'>, pay: number) => (pay / 1000) * L.colW;
/** The top of column `c`'s stack. */
export const colTopY = (s: Strata, L: StrataLayout, c: number) => L.base - colHeight(s.colCount[Math.max(0, Math.min(COLS - 1, c))], L.grid);

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
interface Inks { kinds: string[]; dim: string; match: string; ink: string; card: string; lensBg: string; lensRim: string; lensShadow: string }
function readInks(el: HTMLElement, kinds: readonly string[]): Inks {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  el.appendChild(probe);
  const read = (v: string) => { probe.style.color = v; return canvasColor(getComputedStyle(probe).color); };
  const out = {
    kinds: kinds.map(read), dim: read('var(--strata-dim)'), match: read('var(--strata-match)'), ink: read('var(--mantine-color-text)'),
    card: read('var(--surface)'), lensBg: read('var(--lens-bg)'), lensRim: read('var(--lens-rim)'), lensShadow: read('var(--lens-shadow)'),
  };
  probe.remove();
  return out;
}

export interface StrataFieldHandle {
  /** A square's place at rest and its side, CSS px. */
  positionOf(field: Field, index: number): { x: number; y: number; s: number } | null;
}

export interface LensHit extends Spot { x: number; y: number; s: number }

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
  className?: string;
}>(function StrataField({ strata, layout, kindInks, dim, matchSearch, marks, big, entrance, replay, lensAt, lensFrom = null, pointer, lensR, onPick, onMoving, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  const { W, H, dpr, grid } = layout;
  const n = strata.col.length, m = strata.pileKind.length;

  // Positions now, and the move in flight: where each square set off from, how long it waits, and the ease.
  const cur = useRef({ mx: new Float32Array(0), my: new Float32Array(0), px: new Float32Array(0), py: new Float32Array(0) });
  const move = useRef<{ start: number; fromMx: Float32Array; fromMy: Float32Array; fromPx: Float32Array; fromPy: Float32Array; wait: Float32Array; pwait: Float32Array; ms: number; land: boolean } | null>(null);
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
    return { main, pile, C, mainBy: lists(main), pileBy: lists(pile) };
  }, [strata, dim, matchSearch, kindInks.length]);

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
    return k < tint.C ? t.kinds[k] : k === tint.C ? t.dim : t.match;
  };

  const drawBase = () => {
    const cv = baseRef.current, t = inks.current;
    if (!cv || !t) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { mx, my, px, py } = cur.current;
    const s = grid.sq;
    // Written straight into the canvas's pixels, a square a few writes, on whole device pixels: twenty
    // thousand fillRect calls cost a moving frame more than its budget, and a square in flight is between
    // places anyway, so drawn on the grid it looks no different.
    const cw = cv.width, ch = cv.height;
    if (!px32.current || px32.current.img.width !== cw || px32.current.img.height !== ch) {
      const img = ctx.createImageData(cw, ch);
      px32.current = { img, buf: new Uint32Array(img.data.buffer) };
    }
    const { img, buf } = px32.current;
    buf.fill(0);
    const d = Math.max(1, Math.round(s * dpr));
    // The faded first, then each kind, then the search's own.
    const order = [tint.C, ...Array.from({ length: tint.C }, (_, k) => k), tint.C + 1];
    const put = (x: number, y: number, c: number) => {
      const X = Math.round(x * dpr), Y = Math.round(y * dpr);
      if (X < 0 || Y < 0 || X + d > cw || Y + d > ch) return;
      for (let r = 0; r < d; r++) { const o = (Y + r) * cw + X; for (let q = 0; q < d; q++) buf[o + q] = c; }
    };
    for (const k of order) {
      const c = packed(ink(k));
      const a = tint.mainBy[k], b = tint.pileBy[k];
      for (let q = 0; q < a.length; q++) put(mx[a[q]], my[a[q]], c);
      for (let q = 0; q < b.length; q++) put(px[b[q]], py[b[q]], c);
    }
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The search's people: a white square ringed in ink, with their type's colour at its heart.
    const mark = (x: number, y: number, kind: number, size: number) => {
      const cx = x + s / 2, cy = y + s / 2, h = size / 2;
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
    const s = grid.sq;
    const ptr = props.current.pointer;
    let best: LensHit | null = null, bestD = Infinity;
    // Who could be under the lens: the columns within its reach, and the pile where it overlaps.
    const c0 = Math.max(0, Math.floor((sx - R) / layout.colW) - 1), c1 = Math.min(COLS - 1, Math.ceil((sx + R) / layout.colW) + 1);
    const lists: { field: Field; idx: number[] }[] = [{ field: 'main', idx: [] }, { field: 'pile', idx: [] }];
    for (let c = c0; c <= c1; c++) for (let q = layout.main.start[c]; q < layout.main.start[c + 1]; q++) lists[0].idx.push(layout.main.order[q]);
    if (m && sx + R >= layout.pileLeft) for (let j = 0; j < m; j++) lists[1].idx.push(j);
    // `a`: how strongly it is drawn — full where the lens magnifies, fainter in the crowded ring at its rim,
    // where whole columns are squeezed into lines and at full ink read as spokes rather than people.
    const draws: { k: number; x: number; y: number; z: number; a: number }[] = [];
    for (const { field, idx } of lists) {
      const X = field === 'main' ? mx : px, Y = field === 'main' ? my : py, T = field === 'main' ? tint.main : tint.pile;
      for (const i of idx) {
        const f = fisheye(X[i] + s / 2 - sx, Y[i] + s / 2 - sy, R);
        if (!f) continue;
        const z = Math.max(0.7, s * f.scale * 0.92);
        const x = cx + f.x, y = cy + f.y;
        draws.push({ k: T[i], x, y, z, a: f.scale >= 0.7 ? 0 : f.scale >= 0.35 ? 1 : 2 });
        // With a filter on, only its own people are named: the faded ones are the rest, not who is being read.
        if (ptr && !(dim && T[i] === tint.C)) {
          const d = Math.max(Math.abs(ptr.x - x), Math.abs(ptr.y - y));
          if (d <= z / 2 + PICK_REACH && d < bestD) { bestD = d; best = { field, index: i, x, y, s: z }; }
        }
      }
    }
    const order = [tint.C, ...Array.from({ length: tint.C }, (_, k) => k), tint.C + 1];
    for (const k of order) {
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
    // The square under the pointer, ringed.
    if (best) {
      const h = best.s / 2 + 2.5;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.ink;
      ctx.strokeRect(best.x - h, best.y - h, 2 * h, 2 * h);
    }
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
      const step = (from: Float32Array, to: Float32Array, out: Float32Array, wait: Float32Array, i: number, axis: 0 | 1) => {
        const p = Math.min(1, Math.max(0, (now - mv.start - wait[i]) / mv.ms));
        if (p < 1) done = false;
        const e = mv.land ? (axis === 1 ? landEase(p) : 1) : easeInOut(p);
        out[i] = from[i] + (to[i] - from[i]) * e;
      };
      for (let i = 0; i < n; i++) { step(mv.fromMx, layout.mx, mx, mv.wait, i, 0); step(mv.fromMy, layout.my, my, mv.wait, i, 1); }
      for (let j = 0; j < m; j++) { step(mv.fromPx, layout.px, px, mv.pwait, j, 0); step(mv.fromPy, layout.py, py, mv.pwait, j, 1); }
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
  // the page plays it; re-stacked, after. Under reduced motion, or with nothing drawn yet, it is simply there.
  const first = useRef(true);
  const lastReplay = useRef(replay);
  // Whether a frame of this field has been shown: laid out again before then (going full page, measured
  // at its height before the first paint), it is simply at the new layout — there is nothing to move from.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const was = cur.current;
    const fresh = was.mx.length !== n || was.px.length !== m;
    const drop = (first.current && entrance) || replay !== lastReplay.current;
    first.current = false;
    lastReplay.current = replay;
    if (prefersReducedMotion() || ((fresh || !shown.current) && !drop)) {
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
      const fromMy = new Float32Array(n), fromPy = new Float32Array(m), wait = new Float32Array(n), pwait = new Float32Array(m);
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
    } else {
      const wait = new Float32Array(n), pwait = new Float32Array(m);
      for (let i = 0; i < n; i++) wait[i] = (layout.mx[i] / W) * RESTACK_WAVE_MS;
      for (let j = 0; j < m; j++) pwait[j] = (layout.px[j] / W) * RESTACK_WAVE_MS;
      move.current = { start: now, fromMx: was.mx.slice(), fromMy: was.my.slice(), fromPx: was.px.slice(), fromPy: was.py.slice(), wait, pwait, ms: RESTACK_MS, land: false };
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
  }, [tint, marks, big, scheme]);
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
      for (let i = 0; i < X.length; i++) out.push(X[i] + grid.sq / 2, Y[i] + grid.sq / 2);
      return out;
    };
    el.squareSlots = (f) => Array.from(f === 'main' ? layout.main.slot : layout.pile.slot);
  }, [layout, grid]);

  useImperativeHandle(ref, () => ({
    positionOf(field, index) {
      const X = field === 'main' ? layout.mx : layout.px, Y = field === 'main' ? layout.my : layout.py;
      if (index < 0 || index >= X.length) return null;
      return { x: X[index] + grid.sq / 2, y: Y[index] + grid.sq / 2, s: grid.sq };
    },
  }), [layout, grid]);

  return (
    <div
      ref={wrapRef} className={className} data-settled="true" data-per={grid.per} data-pitch={grid.pitch} data-sq={grid.sq}
      data-col-w={layout.colW} data-pile-left={layout.pileLeft} data-base={layout.base}
      data-lit={litPrint(dim?.main)} data-pile-lit={litPrint(dim?.pile)}
      data-marks={marks.main.length ? marks.main.map((i) => (i < n ? `${i}:${(layout.mx[i] + grid.sq / 2).toFixed(1)}:${(layout.my[i] + grid.sq / 2).toFixed(1)}` : `${i}`)).join(' ') : undefined}
      data-pile-marks={marks.pile.length ? marks.pile.join(' ') : undefined}
      data-mark-big={big ? `${big.field}:${big.index}` : undefined}
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none' }}>
      <canvas ref={baseRef} className="strata-base" style={{ position: 'absolute', inset: 0, width: W, height: H }} />
      {/* Over the pins and their lines, which are drawn after the field: the glass lies on everything it shows. */}
      <canvas ref={lensRef} className="strata-lens" style={{ position: 'absolute', inset: 0, width: W, height: H, zIndex: Z.content }} />
    </div>
  );
});
