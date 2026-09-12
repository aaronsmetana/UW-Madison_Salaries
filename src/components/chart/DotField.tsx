import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutDots, wakeOffset, WAKE_REACH } from '../../lib/dotLayout';
import { luminance, parseRgb, strongerInk, toneInks } from '../../lib/inkMix';
import { bead, type Bead } from '../../lib/dotSprites';
import { prefersReducedMotion } from '../../lib/motion';

/** Played once per session: after that the dots are simply there. */
const SEEN_KEY = 'dotfield-entrance';
/** Each dot's fall, and how far across the plot the last one waits to start. */
const FALL_MS = 650;
export const SPREAD_MS = 550;
/** A change of stacking (All ↔ By employment type): each dot moves up or down its own column to its new slot. */
const RESTACK_MS = 420;
/** A dot drawn alone, and overlapping ones: each is laid down at this alpha, so where dots pile up
 *  the ink builds — the canvas is the accumulation buffer. */
const DOT_ALPHA = 0.85;
/** A highlighted dot's ink: its own, moved toward black (light page) or white (dark page) until it
 *  stands this far apart from it (lib/inkMix). */
export const STRONG_APART = 1.5;
/** Each ink's tones (lib/inkMix `toneInks`), and how many of them depth in the stack spans; the rest
 *  of the range is the per-dot jitter. */
const TONES = 8;
const DEPTH_TONES = 5;
/** The wake's spring, per ms: under critical damping, so a dot overshoots a little on its way back —
 *  the entrance's bounce — and is still within about 400ms. */
const WAKE_OMEGA = 0.024;
const WAKE_ZETA = 0.6;
/** Once the pointer stops, its speed dies away with this time constant (ms). */
const SPEED_TAU = 70;

/** A springy ease that overshoots a little and settles — the "bounce". */
const easeOutBack = (p: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

const readSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const writeSession = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };

/**
 * Whether this page plays the dots' entrance: once a session, never under reduced motion or in a
 * hidden tab. Decided once, by the page, so several fields on it fall together — each deciding for
 * itself, the first to start marked the session seen and the second skipped.
 */
export function useEntranceOnce(): boolean {
  const [play] = useState(() => !readSession() && !prefersReducedMotion() && !(typeof document !== 'undefined' && document.hidden));
  useEffect(() => { if (play) writeSession(); }, [play]);
  return play;
}

/** First index in the ascending `a` whose value is >= v. */
function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A fixed, even-looking jitter of -1, 0 or +1 for dot i (a multiplicative hash, not a generator:
 *  the same dot keeps its tone through every re-layout). */
const jitter = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) % 3 - 1;

/** A point in the field (CSS px), where a magnifying glass draws it, and how much bigger it looks. */
export type LensMap = (x: number, y: number) => { x: number; y: number; scale: number };

/** What a magnifying glass needs from a field: its dots within `R` of `cx, cy` (the field's own CSS
 *  px, less `ox, oy`), drawn through `map` into `ctx` — scaled to the glass's pixels already. */
export interface DotFieldHandle {
  drawInto(ctx: CanvasRenderingContext2D, lens: { cx: number; cy: number; R: number; ox: number; oy: number; dpr: number; map: LensMap }): void;
}

/**
 * A distribution drawn as one dot per person: each at their own value along x, somewhere under the
 * curve along y (lib/dotLayout). Canvas rather than SVG — 21,000 elements would be a slow page — at the
 * device's resolution, so on a 2× screen each person is a separate mark; on a 1× screen or a phone they
 * read as texture, and a magnifying glass (`drawInto`) shows the individuals under the pointer.
 *
 * Each dot is a bead (lib/dotSprites) in one of its ink's tones: deeper toward the bottom of its stack on
 * a light page, brighter toward the top on a dark one, give or take one — every tone further from the
 * card than the ink, so none has less contrast than the ink the 3:1 rule was checked on.
 *
 * Inks come from CSS: the field's own `color`, then `.dot-field-accent` — or, given `inks`, those
 * colours, one per kind — so a theme change redraws in the new ink. No chart library: the landing
 * page loads none.
 *
 * Everything that moves is height only, which means nothing beyond "under the curve": the entrance's
 * fall, a re-stack when `stack` changes, and the pointer's wake. A dot's x is its value, always.
 */
export const DotField = forwardRef<DotFieldHandle, {
  /** One per person, in the units `toX` takes. */
  values: ArrayLike<number>;
  /** Optional: each dot's ink, an index into `inks` (by default 0 the field's colour, 1 the accent). */
  kinds?: ArrayLike<number> | null;
  /** CSS colours, one per kind. */
  inks?: readonly string[];
  /** Stack each column's dots by kind, lowest kind at the baseline, so kinds read as bands. */
  stack?: boolean;
  /** Value → x in CSS px, for a plot `width` wide. */
  toX: (v: number, width: number) => number;
  /** The curve's height above the baseline at x, in CSS px, for a plot `width` wide. */
  heightAt: (x: number, width: number) => number;
  height: number;
  /** Dot radius in CSS px; by default sized so the dots fill the area under the curve. */
  r?: number;
  /** Play the fall into place now (see `useEntranceOnce`). */
  entrance?: boolean;
  /** How long the fall waits to start, ms — a second field lands after the first. */
  delay?: number;
  /** Where the pointer is, in CSS px within the field, or null for none — for a mouse only, which the
   *  caller decides. It drives the wake. */
  lensAt?: { x: number; y: number } | null;
  /** Part the dots near a moving `lensAt`, up and down, and let them spring back. */
  wake?: boolean;
  /** Values in [lo, hi) draw in a stronger ink. Nothing else changes. */
  highlight?: readonly [number, number] | null;
  /** A faint halo round each dot on a dark page, so a dense field glows a little. */
  glow?: boolean;
  /** Called after every paint: a magnifying glass over the field redraws with it. */
  onFrame?: () => void;
  /** The name each animated frame is measured under (`performance.measure`), so a page's fields can
   *  be told apart; the wake's frames are `wake-frame`. */
  frameMark?: string;
  className?: string;
}>(function DotField({
  values, kinds, inks, stack = false, toX, heightAt, height, r: rIn, entrance = false, delay = 0,
  lensAt = null, wake = false, highlight = null, glow = false, onFrame, frameMark = 'dot-frame', className,
}, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const textRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(false);
  const [scheme, setScheme] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Any real change of width re-lays the field. A half-pixel dead band here kept whichever width a
    // resize passed through last within 0.5px of the final one, so after a window resize the dots were
    // laid out for a width the canvas was not drawn at, and differed run to run. Nothing inside the box
    // sizes it (the canvas is absolutely placed), so an exact measure cannot feed back on itself.
    const measure = () => setWidth((w) => { const n = el.getBoundingClientRect().width; return Math.abs(n - w) < 0.01 ? w : n; });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A theme change repaints in the new ink; a move to a screen of another pixel ratio repaints at it.
  useEffect(() => {
    const bump = () => setScheme((s) => s + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', bump);
    let dq: MediaQueryList | undefined;
    const watchDpr = () => {
      dq?.removeEventListener?.('change', onDpr);
      dq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dq?.addEventListener?.('change', onDpr);
    };
    function onDpr() { bump(); watchDpr(); }
    watchDpr();
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', bump); dq?.removeEventListener?.('change', onDpr); };
  }, []);

  const stackKey = stack && kinds ? kinds : undefined;
  const layout = useMemo(() => {
    if (!(width > 0) || !values.length) return null;
    const n = values.length;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = toX(values[i], width);
    let r = rIn;
    if (r == null) {
      // Size the dots to the room: the area under the curve shared out, a dot taking a bit under
      // its share so neighbours stay apart where the screen can show it.
      let area = 0;
      for (let c = 0; c < width; c++) area += Math.max(0, heightAt(c + 0.5, width));
      r = Math.min(2, Math.max(0.5, 0.42 * Math.sqrt(area / n)));
    }
    const pts = layoutDots({ xs, heightAt: (x) => heightAt(x, width), baseY: height, r, stack: stackKey });
    // The dots in x order, for finding the ones in a strip of the canvas without visiting them all.
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => pts[2 * a] - pts[2 * b]);
    const sortedX = new Float32Array(n);
    for (let j = 0; j < n; j++) sortedX[j] = pts[2 * order[j]];
    // How far each dot may move up and down and stay inside the curve and above the baseline, and how
    // high it sits in its stack (0 at the baseline, 1 under the curve), which shades it.
    const up = new Float32Array(n);
    const down = new Float32Array(n);
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = pts[2 * i + 1];
      const h = heightAt(Math.floor(pts[2 * i]) + 0.5, width);
      up[i] = Math.max(0, y - r - (height - h));
      down[i] = Math.max(0, height - r - y);
      depth[i] = Math.min(1, Math.max(0, (height - r - y) / Math.max(1e-6, h - 2 * r)));
    }
    return { pts, r, order, sortedX, up, down, depth, width };
  }, [width, values, toX, heightAt, height, rIn, stackKey]);

  // Everything the animation loop and the painter read, kept current without re-running effects.
  const live = useRef({
    entranceStart: null as number | null,
    restackStart: null as number | null,
    restackFrom: null as Float32Array | null,
    wakeOff: null as Float32Array | null,
    wakeVel: null as Float32Array | null,
    wakeLo: Infinity,
    wakeHi: -Infinity,
    wakePeak: 0,
    px: 0, py: 0, speed: 0, lastMove: 0, lastTick: 0, pointer: false,
    raf: 0,
    ink: [] as string[],
    strong: [] as string[],
    /** Per kind, per tone: the bead each dot is stamped with, plain and highlighted. */
    beads: [] as Bead[][],
    strongBeads: [] as Bead[][],
    /** Per kind, per tone: the colour, for the magnifying glass's larger beads. */
    tones: [] as string[][],
    strongTones: [] as string[][],
    /** Each dot's tone, and the dots of each (kind, tone), for the fast full-field paint. */
    tone: null as Uint8Array | null,
    groups: [] as Uint32Array[],
    dark: false,
    highlight: null as readonly [number, number] | null,
  });
  const prevLayout = useRef<typeof layout>(null);
  const prevStack = useRef<typeof stackKey>(undefined);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // The current y of dot i: at rest, falling in, re-stacking, plus its wake.
  const yOf = (i: number, now: number) => {
    const L = live.current;
    const lay = layout!;
    let y = lay.pts[2 * i + 1];
    if (L.restackStart != null && L.restackFrom) {
      const p = Math.min(1, (now - L.restackStart) / RESTACK_MS);
      const from = L.restackFrom[i];
      y = from + (y - from) * easeOutBack(p);
    }
    if (L.entranceStart != null) {
      const p = Math.min(1, Math.max(0, (now - L.entranceStart - delay - (lay.pts[2 * i] / lay.width) * SPREAD_MS) / FALL_MS));
      y = -lay.r + (y + lay.r) * easeOutBack(p);
    }
    if (L.wakeOff) y += L.wakeOff[i];
    return y;
  };
  const yOfRef = useRef(yOf);
  yOfRef.current = yOf;

  /**
   * Paints the strip [x0, x1) of the field — or all of it — as it stands at `now`: as beads, or `fast`,
   * as squares in the same tones. A bead is a `drawImage`, about five times a square's cost, so 21,000
   * of them every frame held the fall and the re-stack at 16ms a frame; while the whole field moves it
   * is drawn in squares, which at this size and speed read the same, and in beads once it is still.
   * A strip (the wake, the highlight) is a few thousand dots, and stays in beads.
   */
  const paint = (now: number, x0 = -Infinity, x1 = Infinity, fast = false) => {
    const canvas = canvasRef.current;
    const lay = layout;
    const L = live.current;
    if (!canvas || !lay || !L.tone || !L.beads.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = canvas.width / Math.max(1, lay.width);
    const whole = !(x0 > -Infinity) && !(x1 < Infinity);
    const a = whole ? 0 : Math.max(0, Math.floor((x0 - 1) * dpr));
    const b = whole ? canvas.width : Math.min(canvas.width, Math.ceil((x1 + 1) * dpr));
    if (b <= a) return;
    ctx.save();
    if (!whole) { ctx.beginPath(); ctx.rect(a, 0, b - a, canvas.height); ctx.clip(); }
    ctx.clearRect(a, 0, b - a, canvas.height);
    ctx.globalAlpha = DOT_ALPHA;
    const { order, sortedX, r, pts } = lay;
    const reach = (glow && L.dark ? 2 : 1) * r + 1;
    const j0 = whole ? 0 : lowerBound(sortedX, a / dpr - reach);
    const j1 = whole ? order.length : lowerBound(sortedX, b / dpr + reach);
    const hl = L.highlight;
    const kindsN = L.beads.length;
    const tone = L.tone;
    if (fast && whole) {
      // Squares, a fill colour at a time: one pass per (kind, tone), the highlighted dots after.
      const side = 2 * r * dpr;
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        const cols = strong ? L.strongTones : L.tones;
        for (let g = 0; g < L.groups.length; g++) {
          const list = L.groups[g];
          if (!list.length) continue;
          ctx.fillStyle = cols[Math.floor(g / TONES)][g % TONES];
          for (let q = 0; q < list.length; q++) {
            const i = list[q];
            const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
            if (lit !== !!strong) continue;
            ctx.fillRect(pts[2 * i] * dpr - side / 2, yOf(i, now) * dpr - side / 2, side, side);
          }
        }
      }
    } else {
      // The highlighted dots last, so they sit over their neighbours.
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        const set = strong ? L.strongBeads : L.beads;
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          if (lit !== !!strong) continue;
          const bd = set[((kinds ? kinds[i] : 0) || 0) % kindsN][tone[i]];
          ctx.drawImage(bd.img, pts[2 * i] * dpr - bd.half, yOf(i, now) * dpr - bd.half);
        }
      }
    }
    ctx.restore();
    onFrameRef.current?.();
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useImperativeHandle(ref, () => ({
    drawInto(ctx, { cx, cy, R, ox, oy, dpr, map }) {
      const lay = layout;
      const L = live.current;
      if (!lay || !L.tone || !L.tones.length) return;
      const now = performance.now();
      const { order, sortedX, r, pts } = lay;
      // This field's own x of the glass's centre; everything within its radius (plus a dot).
      const fx = cx - ox;
      const j0 = lowerBound(sortedX, fx - R - r);
      const j1 = lowerBound(sortedX, fx + R + r);
      const hl = L.highlight;
      const kindsN = L.tones.length;
      // Beads by (strong, kind, tone, quarter-pixel radius), so a dot costs a lookup, not a key string.
      const beads = new Map<number, Bead>();
      ctx.save();
      ctx.globalAlpha = DOT_ALPHA;
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        const set = strong ? L.strongTones : L.tones;
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          if (lit !== !!strong) continue;
          const sx = pts[2 * i] + ox;
          const sy = yOfRef.current(i, now) + oy;
          if ((sx - cx) ** 2 + (sy - cy) ** 2 > (R + r) ** 2) continue;
          const m = map(sx, sy);
          const k = ((kinds ? kinds[i] : 0) || 0) % kindsN;
          // Toward the rim the glass barely magnifies, and a bead there is a dot's own size: a square
          // in its tone, at a fifth of a bead's cost — most of the glass's dots are out there.
          if (m.scale < 1.6) {
            const side = 2 * r * m.scale * dpr;
            ctx.fillStyle = set[k][L.tone[i]];
            ctx.fillRect(m.x * dpr - side / 2, m.y * dpr - side / 2, side, side);
            continue;
          }
          // Beads come in quarter-pixel sizes, so a sweep of the glass reuses a handful of sprites.
          const q = Math.max(2, Math.round(r * m.scale * dpr * 4));
          const key = ((strong * kindsN + k) * TONES + L.tone[i]) * 256 + q;
          let bd = beads.get(key);
          if (!bd) { bd = bead(set[k][L.tone[i]], q / 4, glow && L.dark); beads.set(key, bd); }
          ctx.drawImage(bd.img, m.x * dpr - bd.half, m.y * dpr - bd.half);
        }
      }
      ctx.restore();
    },
  }), [layout, values, kinds, glow]);

  /** One frame of whatever is moving; schedules the next while anything still is. */
  const tick = (now: number) => {
    const L = live.current;
    const lay = layout;
    L.raf = 0;
    if (!lay) return;
    const t0 = performance.now();
    let full = false;
    let moving = false;
    if (L.entranceStart != null) {
      if (now - L.entranceStart >= delay + SPREAD_MS + FALL_MS) { L.entranceStart = null; setSettled(true); }
      else moving = true;
      full = true;
    }
    if (L.restackStart != null) {
      if (now - L.restackStart >= RESTACK_MS) { L.restackStart = null; L.restackFrom = null; setSettled(true); }
      else moving = true;
      full = true;
    }
    // The wake: a spring per dot toward its offset in the pointer's wake (zero once out of reach).
    let wakeLo = Infinity, wakeHi = -Infinity;
    let wakeFrame = false;
    if (L.wakeOff && L.wakeVel) {
      const dt = Math.min(32, Math.max(1, now - (L.lastTick || now - 16)));
      if (now - L.lastMove > 20) L.speed *= Math.exp(-dt / SPEED_TAU);
      if (L.speed < 0.02) L.speed = 0;
      const reach = WAKE_REACH + 1;
      let lo = L.wakeLo, hi = L.wakeHi;
      if (L.pointer && L.speed > 0) { lo = Math.min(lo, L.px - reach); hi = Math.max(hi, L.px + reach); }
      if (hi >= lo) {
        wakeFrame = true;
        const j0 = lowerBound(lay.sortedX, lo);
        const j1 = lowerBound(lay.sortedX, hi + 1e-6);
        const w2 = WAKE_OMEGA * WAKE_OMEGA;
        const damp = 2 * WAKE_ZETA * WAKE_OMEGA;
        for (let j = j0; j < j1; j++) {
          const i = lay.order[j];
          const x = lay.pts[2 * i];
          const y = lay.pts[2 * i + 1];
          const room = { up: lay.up[i], down: lay.down[i] };
          const target = L.pointer ? wakeOffset({ dx: x - L.px, dy: y - L.py, speed: L.speed, room }) : 0;
          let v = L.wakeVel[i] + (w2 * (target - L.wakeOff[i]) - damp * L.wakeVel[i]) * dt;
          let o = L.wakeOff[i] + v * dt;
          // Never out of the curve or through the baseline, even mid-bounce.
          if (o < -room.up) { o = -room.up; v = 0; }
          if (o > room.down) { o = room.down; v = 0; }
          if (Math.abs(o) < 0.05 && Math.abs(v) < 0.002 && target === 0) { o = 0; v = 0; }
          L.wakeOff[i] = o;
          L.wakeVel[i] = v;
          if (Math.abs(o) > L.wakePeak) L.wakePeak = Math.abs(o);
          if (o !== 0 || v !== 0) { if (x < wakeLo) wakeLo = x; if (x > wakeHi) wakeHi = x; }
        }
        // Repaint where anything moved this frame: what was active, and the pointer's reach.
        if (!full) paintRef.current(now, lo - lay.r - 1, hi + lay.r + 1);
      }
      L.wakeLo = wakeLo;
      L.wakeHi = wakeHi;
      if (wakeHi >= wakeLo || (L.pointer && L.speed > 0)) moving = true;
      if (boxRef.current) {
        boxRef.current.dataset.wake = wakeHi >= wakeLo || (L.pointer && L.speed > 0) ? 'moving' : 'idle';
        // How far the last movement parted the dots, at most: what a guard reads to know it can be seen.
        boxRef.current.dataset.wakePeak = L.wakePeak.toFixed(1);
      }
    }
    L.lastTick = now;
    // In squares while the whole field is moving; the frame that ends the move paints it in beads.
    if (full) paintRef.current(now, -Infinity, Infinity, moving);
    if (full || wakeFrame) {
      try { performance.measure(full ? frameMark : 'wake-frame', { start: t0, end: performance.now() }); } catch { /* diagnostic only */ }
    }
    if (moving) L.raf = requestAnimationFrame(tickRef.current);
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const kick = () => { const L = live.current; if (!L.raf) L.raf = requestAnimationFrame(tickRef.current); };

  // Size the canvas, read the inks, make the beads, and paint — falling in or re-stacking where that applies.
  useEffect(() => {
    const canvas = canvasRef.current;
    const lay = layout;
    if (!canvas || !lay) return;
    const L = live.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(lay.width * dpr);
    canvas.height = Math.round(height * dpr);
    const text = textRef.current ? getComputedStyle(textRef.current).color : 'rgb(0, 0, 0)';
    const base = getComputedStyle(canvas).color;
    const nInks = inks?.length ? inks.length : 2;
    L.ink = Array.from({ length: nInks }, (_, k) => {
      const el = inkRefs.current[k];
      return el ? getComputedStyle(el).color : base;
    });
    if (!inks?.length) L.ink[0] = base;
    L.strong = L.ink.map((c) => strongerInk(c, text, STRONG_APART));
    // A dark page is one whose text is light.
    const t = parseRgb(text);
    L.dark = !!t && luminance(t) > 0.5;
    L.tones = L.ink.map((c) => toneInks(c, text, TONES));
    L.strongTones = L.strong.map((c) => toneInks(c, text, TONES));
    const rd = lay.r * dpr;
    L.beads = L.tones.map((ts) => ts.map((c) => bead(c, rd, glow && L.dark)));
    L.strongBeads = L.strongTones.map((ts) => ts.map((c) => bead(c, rd, glow && L.dark)));
    // Each dot's tone: its depth in the stack — deeper toward the bottom on a light page, brighter
    // toward the top on a dark one — give or take one.
    const n = values.length;
    const tone = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const shade = L.dark ? lay.depth[i] : 1 - lay.depth[i];
      tone[i] = Math.min(TONES - 1, Math.max(0, Math.round(shade * DEPTH_TONES) + jitter(i)));
    }
    L.tone = tone;
    const groups: number[][] = Array.from({ length: L.tones.length * TONES }, () => []);
    for (let i = 0; i < n; i++) groups[(((kinds ? kinds[i] : 0) || 0) % L.tones.length) * TONES + tone[i]].push(i);
    L.groups = groups.map((g) => Uint32Array.from(g));
    if (boxRef.current) {
      boxRef.current.dataset.inks = L.ink.join('|');
      boxRef.current.dataset.strongInks = L.strong.join('|');
      // Every tone of every ink, each ink's separated by '|': what the contrast guard reads.
      boxRef.current.dataset.tones = L.tones.map((ts) => ts.join(';')).join('|');
    }
    // The wake's springs belong to one layout; a new one starts them at rest.
    L.wakeOff = wake ? new Float32Array(values.length) : null;
    L.wakeVel = wake ? new Float32Array(values.length) : null;
    L.wakeLo = Infinity;
    L.wakeHi = -Infinity;

    const motionOk = !prefersReducedMotion() && !document.hidden;
    const prev = prevLayout.current;
    const restacked = prev && prev !== lay && prev.width === lay.width && prev.pts.length === lay.pts.length && prevStack.current !== stackKey;
    prevLayout.current = lay;
    prevStack.current = stackKey;
    const now = performance.now();
    if (restacked && motionOk) {
      // From where each dot is now to its slot in the new stacking, up or down its own column.
      const from = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) from[i] = prev.pts[2 * i + 1];
      L.restackFrom = from;
      L.restackStart = now;
      setSettled(false);
      paint(now, -Infinity, Infinity, true);
      kick();
    } else if (entrance && L.entranceStart == null && !settled && motionOk) {
      L.entranceStart = now;
      setSettled(false);
      paint(now, -Infinity, Infinity, true);
      kick();
    } else {
      L.entranceStart = null;
      L.restackStart = null;
      L.restackFrom = null;
      paint(now);
      setSettled(true);
    }
    return () => { if (L.raf) { cancelAnimationFrame(L.raf); L.raf = 0; } };
    // `scheme` is read through getComputedStyle, which is why a theme change must re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, height, entrance, kinds, inks, scheme, wake, glow]);

  // The highlight: repaint only where it was and where it is.
  const hlLo = highlight?.[0] ?? null;
  const hlHi = highlight?.[1] ?? null;
  useEffect(() => {
    const L = live.current;
    const lay = layout;
    const was = L.highlight;
    const now = hlLo != null && hlHi != null ? ([hlLo, hlHi] as const) : null;
    L.highlight = now;
    if (!lay || L.entranceStart != null || L.restackStart != null) return;
    const span = (h: readonly [number, number] | null): [number, number] | null => (h ? [toX(h[0], lay.width), toX(h[1], lay.width)] : null);
    const a = span(was);
    const b = span(now);
    if (!a && !b) return;
    const x0 = Math.min(a?.[0] ?? Infinity, b?.[0] ?? Infinity) - lay.r - 1;
    const x1 = Math.max(a?.[1] ?? -Infinity, b?.[1] ?? -Infinity) + lay.r + 1;
    paintRef.current(performance.now(), x0, x1);
  }, [hlLo, hlHi, layout, toX]);

  // The wake follows the pointer: its position, and its speed from the last move.
  useEffect(() => {
    const L = live.current;
    if (!wake || !layout || !L.wakeOff) return;
    if (!lensAt) { L.pointer = false; kick(); return; }
    if (prefersReducedMotion() || document.hidden) return;
    const now = performance.now();
    if (!(L.wakeHi >= L.wakeLo) && !(L.speed > 0)) L.wakePeak = 0;
    if (L.pointer && now > L.lastMove) {
      const inst = Math.hypot(lensAt.x - L.px, lensAt.y - L.py) / Math.max(1, now - L.lastMove);
      L.speed = Math.max(inst, L.speed * 0.6);
    }
    L.px = lensAt.x;
    L.py = lensAt.y;
    L.lastMove = now;
    L.pointer = true;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensAt, wake, layout]);

  // What the guards read: how many dots of each kind, and how many the highlight covers.
  const kindCounts = useMemo(() => {
    if (!kinds) return undefined;
    const m = new Map<number, number>();
    for (let i = 0; i < kinds.length; i++) m.set(kinds[i], (m.get(kinds[i]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(',');
  }, [kinds]);
  let lit = 0;
  if (hlLo != null && hlHi != null) for (let i = 0; i < values.length; i++) if (values[i] >= hlLo && values[i] < hlHi) lit++;

  const inkList = inks?.length ? inks : null;
  return (
    <div
      ref={boxRef}
      className={`dot-field${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}
      data-dots={values.length}
      data-width={layout ? layout.width : undefined}
      data-alpha={DOT_ALPHA}
      data-settled={settled ? 'true' : 'false'}
      data-lens={lensAt ? 'on' : 'off'}
      data-kinds={kindCounts}
      data-stack={stack ? 'on' : 'off'}
      data-highlight={hlLo != null ? lit : undefined}
      aria-hidden
    >
      <canvas ref={canvasRef} className="dot-field-ink" style={{ position: 'absolute', inset: 0, width: '100%', height }} />
      {/* The text colour, which a highlighted dot's ink is mixed toward. */}
      <span ref={textRef} style={{ color: 'var(--mantine-color-text)' }} hidden />
      {inkList
        ? inkList.map((c, k) => <span key={k} ref={(el) => { inkRefs.current[k] = el; }} className={`dot-field-ink-${k}`} style={{ color: c }} hidden />)
        : [
            <span key={0} ref={(el) => { inkRefs.current[0] = el; }} hidden />,
            <span key={1} ref={(el) => { inkRefs.current[1] = el; }} className="dot-field-accent" hidden />,
          ]}
    </div>
  );
});
