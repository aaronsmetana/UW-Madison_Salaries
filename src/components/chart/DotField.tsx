import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutDots, packDots } from '../../lib/dotLayout';
import {
  AIR_BEFORE_REST, BURST_SPRING, CLICK_CAP, RING_ECHOES, RIPPLE_PERIOD, RIPPLE_SPRING, TRAIL_ALPHA, TRAIL_MIN, TRAIL_MS, TRAIL_W, WAVE_MS,
  bloomAt, burstKick, burstSizes, ringAlpha, rippleKick, springPose, springRestAfter, stepFall, stepThrough, stirKick, stirSizes, stirTopUp, thrown, trailAt, wakeExtent,
  type Kick, type Pose,
} from '../../lib/dotPhysics';
import { luminance, parseRgb, strongerInk, toneInks } from '../../lib/inkMix';
import { bead, beadInk, halo, type Bead, type BeadInk } from '../../lib/dotSprites';
import { prefersReducedMotion } from '../../lib/motion';

/** Played once per session: after that the dots are simply there. */
const SEEN_KEY = 'dotfield-entrance';
/** Each dot's fall, and how far across the plot the last one waits to start. */
const FALL_MS = 650;
export const SPREAD_MS = 550;
/** A change of stacking (All ↔ By employment type): each dot moves up or down its own column to its new slot. */
const RESTACK_MS = 420;
/** A dot drawn alone, and overlapping ones: each is laid down at this alpha, so where dots pile up
 *  the ink builds — the canvas is the accumulation buffer. A packed field whose dots stand apart has
 *  nothing to build: each is laid down in its full ink. */
const DOT_ALPHA = 0.85;
const PACKED_ALPHA = 1;
/** A highlighted dot's ink: its own, moved toward black (light page) or white (dark page) until it
 *  stands this far apart from it (lib/inkMix). */
export const STRONG_APART = 1.5;
/** Each ink's tones (lib/inkMix `toneInks`), and how many of them depth in the stack spans; the rest
 *  of the range is the per-dot jitter. */
const TONES = 8;
const DEPTH_TONES = 5;
/** A dot's state of motion: at rest; in flight (a soloed group's dot falling to its place, or raining
 *  back in and bouncing into it); leaving through the floor; gone (a group soloed away); or bursting —
 *  thrown aside by a click or a drag, or rocked by a ripple, on a spring home. */
const REST = 0, FLYING = 1, LEAVING = 2, GONE = 3, BURST = 4;
/** Which spring holds a bursting dot: a burst's, or a ripple's (lib/dotPhysics). */
const THROWN = 0, RIPPLED = 1;
const springOf = (kind: number) => (kind === RIPPLED ? RIPPLE_SPRING : BURST_SPRING);
/** A ring's strokes, CSS px wide and their share of its strength: a soft glowing band, then its core. */
const RING_STROKES: readonly (readonly [number, number])[] = [[6, 0.25], [1.5, 1]];
/** A wake's strokes, as a share of its width and of its strength: a soft band, then its core. */
const TRAIL_STROKES: readonly (readonly [number, number])[] = [[1, 0.35], [0.3, 1]];
/** Moves of one drag come this close together, ms; a wake point further from the last starts a new stroke. */
const TRAIL_GAP_MS = 80;
/** Scratch for the spring and the kicks: one frame's dots are worked one at a time. */
const pose: Pose = { ox: 0, oy: 0, vx: 0, vy: 0 };
const speed2 = { vx: 0, vy: 0 };
const kickAt: Kick = { vx: 0, vy: 0, delay: 0 };
/** How far above the top a dot raining back in may start, px: they arrive over about half a second. */
const RAIN_SPREAD = 160;

/** A marked dot (a search's result): this many times a dot's radius, and never under MARK_MIN_R px; its glow
 *  reaches MARK_HALO of that out. It grows in over MARK_GROW_MS as it arrives and sends out one ring over
 *  MARK_PULSE_MS, reaching MARK_PULSE times its radius. */
const MARK_SCALE = 5;
const MARK_MIN_R = 5.5;
const MARK_HALO = 4;
const MARK_GROW_MS = 320;
const MARK_PULSE_MS = 900;
const MARK_PULSE = 4;
/** A marked dot's radius, CSS px, in a field whose dots are `r`; and how far from its centre it draws. */
export const markRadius = (r: number) => Math.max(MARK_MIN_R, r * MARK_SCALE);
const markExtent = (r: number) => markRadius(r) * Math.max(MARK_HALO, MARK_PULSE) + 2;

/** A springy ease that overshoots a little and settles — the "bounce". */
const easeOutBack = (p: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

/**
 * A drag's wake into `ctx`: each stretch between two of its points, as strong and as wide as the older
 * end is (lib/dotPhysics `trailAt`), a soft band under a thin core, placed through `at` (canvas pixels,
 * and how much a glass magnifies there). Stretches of about the same strength go down as one path, so
 * where they meet the ink is not laid twice.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D, pts: readonly { x: number; y: number; t: number; s: number }[], now: number,
  at: (x: number, y: number) => { x: number; y: number; scale: number }, dpr: number,
) {
  const LEVELS = 6;
  const byLevel: { a: { x: number; y: number }; b: { x: number; y: number }; w: number }[][] = Array.from({ length: LEVELS }, () => []);
  const top: number[] = new Array(LEVELS).fill(0);
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    if (q.t - p.t > TRAIL_GAP_MS) continue;
    const tr = trailAt(now - p.t, p.s);
    if (!tr) continue;
    const lv = Math.min(LEVELS - 1, Math.floor((tr.alpha / TRAIL_ALPHA) * LEVELS));
    const a = at(p.x, p.y), b = at(q.x, q.y);
    byLevel[lv].push({ a, b, w: tr.w * Math.min(2, Math.max(a.scale, b.scale)) });
    top[lv] = Math.max(top[lv], tr.alpha);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let lv = 0; lv < LEVELS; lv++) {
    const segs = byLevel[lv];
    if (!segs.length) continue;
    const w = segs.reduce((m, g) => Math.max(m, g.w), 0);
    for (const [share, strength] of TRAIL_STROKES) {
      ctx.globalAlpha = top[lv] * strength;
      ctx.lineWidth = w * share * dpr;
      ctx.beginPath();
      for (const g of segs) { ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); }
      ctx.stroke();
    }
  }
}

/**
 * A marked dot into `ctx` at `cx, cy` (canvas pixels), `R` its full radius there, `age` ms since it was
 * marked: a soft glow in its ink, one ring going out as it arrives, and the dot itself, growing in with a
 * little overshoot, in its ink with a rim of the page's colour so it stands clear of the dots beneath.
 */
function drawMark(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, age: number, px: number,
  ink: { core: string; glow: string; clear: string; rim: string },
) {
  const grow = age >= MARK_GROW_MS ? 1 : easeOutBack(Math.max(0, age) / MARK_GROW_MS);
  const r = R * (0.35 + 0.65 * grow);
  const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * MARK_HALO);
  halo.addColorStop(0, ink.glow);
  halo.addColorStop(1, ink.clear);
  ctx.globalAlpha = 1;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * MARK_HALO, 0, Math.PI * 2);
  ctx.fill();
  if (age >= 0 && age < MARK_PULSE_MS) {
    const p = age / MARK_PULSE_MS;
    ctx.globalAlpha = 0.8 * (1 - p) ** 2;
    ctx.strokeStyle = ink.core;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 + (MARK_PULSE - 1) * p), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink.core;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(px, r * 0.22);
  ctx.strokeStyle = ink.rim;
  ctx.stroke();
}

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

/** How many dots are not gone. */
const countVisible = (mode: Uint8Array) => { let n = 0; for (let i = 0; i < mode.length; i++) if (mode[i] !== GONE) n++; return n; };

/** A fixed, even-looking jitter of -1, 0 or +1 for dot i (a multiplicative hash, not a generator:
 *  the same dot keeps its tone through every re-layout). */
const jitter = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) % 3 - 1;

/** A point in the field (CSS px), where a magnifying glass draws it, and how much bigger it looks. */
export type LensMap = (x: number, y: number) => { x: number; y: number; scale: number };

/** What a magnifying glass needs from a field: its dots within `R` of `cx, cy` (the field's own CSS
 *  px, less `ox, oy`), drawn through `map` into `ctx` — scaled to the glass's pixels already. */
export interface DotFieldHandle {
  drawInto(ctx: CanvasRenderingContext2D, lens: { cx: number; cy: number; R: number; ox: number; oy: number; dpr: number; map: LensMap }): void;
  /** Bursts the dots round `x, y` (the field's CSS px) outward behind a shockwave, each to spring back
   *  to its place; with `stir`, a drag's burst, with no shockwave: as hard as its `strength` (0 slow to
   *  1 fast, lib/dotPhysics `stirStrength`), the drag going the unit way `ux, uy`, leaving a wake when
   *  fast. False when nothing shows: reduced motion, a hidden tab, or a stir with no dots in reach and no
   *  wake. */
  burst(x: number, y: number, stir?: Stir | null): boolean;
  /** Where dot `i` is now (the field's CSS px) and a marked dot's radius there; null for a dot not shown. */
  positionOf(i: number): { x: number; y: number; r: number } | null;
  /** The marked dot nearest `x, y` (the field's CSS px) close enough to be the one pointed at, or null. */
  markAt(x: number, y: number): number | null;
}

/** A drag's stir at one point of its path: how hard (0 to 1), and which way the drag goes (a unit vector). */
export interface Stir { strength: number; ux: number; uy: number }

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
 * The entrance's fall, a re-stack when `stack` changes, and a soloed group's leaving and return move
 * each dot up or down its own column, under the curve. A click or a drag (`burst`) throws the dots round
 * it aside, and a spring brings each back to its place exactly — so at rest a dot's x is its value,
 * always.
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
  /** A dense field: every dot its own room, in columns a dot-width apart on whole device pixels, a
   *  crowded column passing up to `spill` px of its surplus to its neighbours (lib/dotLayout
   *  `packDots`). Without it, one-pixel columns, each dot within half a pixel of its value. */
  pack?: { spill: number } | null;
  /** Play the fall into place now (see `useEntranceOnce`). */
  entrance?: boolean;
  /** How long the fall waits to start, ms — a second field lands after the first. */
  delay?: number;
  /** Each dot's kind while it is thrown, an index into `airInks`: a field in one ink shows who is
   *  there in a burst — each dot in the air wears its kind's colour, and turns back as it lands. */
  airKinds?: ArrayLike<number> | null;
  airInks?: readonly string[];
  /** Values in [lo, hi) draw in a stronger ink. Nothing else changes. */
  highlight?: readonly [number, number] | null;
  /** Show one kind alone: the others fall through the floor, and it falls to the floor in its own
   *  shape (stacked first). Null for all. Needs `stack`. */
  solo?: number | null;
  /** Dots to mark (indices into `values`): each drawn over the field several times its size, glowing in
   *  `--found`, growing in and sending out one ring as it arrives. */
  marks?: readonly number[] | null;
  /** Bump to play the fall into place again. */
  replay?: number;
  /** A faint halo round each dot on a dark page, so a dense field glows a little. */
  glow?: boolean;
  /** Called after every paint: a magnifying glass over the field redraws with it. */
  onFrame?: () => void;
  /** The name each animated frame is measured under (`performance.measure`), so a page's fields can
   *  be told apart; a burst's and a solo's frames are `flight-frame`. */
  frameMark?: string;
  className?: string;
}>(function DotField({
  values, kinds, inks, stack = false, toX, heightAt, height, r: rIn, pack = null, entrance = false, delay = 0,
  airKinds = null, airInks, highlight = null, solo = null, marks = null, replay = 0, glow = false, onFrame, frameMark = 'dot-frame', className,
}, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const airRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const textRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const rimRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(false);
  const [scheme, setScheme] = useState(0);
  // Device pixels per CSS pixel: a packed field sits on whole device pixels, so it is laid out again at a
  // new ratio.
  const [dpr, setDpr] = useState(() => (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

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

  // A theme change repaints in the new ink; a move to a screen of another pixel ratio repaints at it;
  // Reduce Motion switched on mid-burst lays the field again at rest, every dot home at once.
  useEffect(() => {
    const bump = () => setScheme((s) => s + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', bump);
    const rq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    rq?.addEventListener?.('change', bump);
    let dq: MediaQueryList | undefined;
    const watchDpr = () => {
      dq?.removeEventListener?.('change', onDpr);
      dq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dq?.addEventListener?.('change', onDpr);
    };
    function onDpr() { bump(); setDpr(window.devicePixelRatio || 1); watchDpr(); }
    watchDpr();
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', bump); rq?.removeEventListener?.('change', bump); dq?.removeEventListener?.('change', onDpr); };
  }, []);

  // Stacked by kind — the soloed kind first, so it takes each column's lowest slots.
  const stackKey = useMemo(() => {
    if (!stack || !kinds) return undefined;
    if (solo == null) return kinds;
    const k = new Uint8Array(kinds.length);
    for (let i = 0; i < kinds.length; i++) k[i] = kinds[i] === solo ? 0 : 1 + kinds[i];
    return k;
  }, [stack, kinds, solo]);
  const spill = pack ? pack.spill : null;

  const packDpr = pack ? dpr : 1;
  const layout = useMemo(() => {
    if (!(width > 0) || !values.length) return null;
    const n = values.length;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = toX(values[i], width);
    let r = rIn;
    let pts: Float32Array;
    let crowded = 0, maxShift = 0.5, separate = false;
    if (spill != null) {
      const packed = packDots({ xs, heightAt: (x) => heightAt(x, width), baseY: height, width, dpr: packDpr, spill, stack: stackKey });
      ({ pts, r, crowded, maxShift, separate } = packed);
    } else {
      if (r == null) {
        // Size the dots to the room: the area under the curve shared out, a dot taking a bit under
        // its share so neighbours stay apart where the screen can show it.
        let area = 0;
        for (let c = 0; c < width; c++) area += Math.max(0, heightAt(c + 0.5, width));
        r = Math.min(2, Math.max(0.5, 0.42 * Math.sqrt(area / n)));
      }
      pts = layoutDots({ xs, heightAt: (x) => heightAt(x, width), baseY: height, r, stack: stackKey });
    }
    // The dots in x order, for finding the ones in a strip of the canvas without visiting them all.
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => pts[2 * a] - pts[2 * b]);
    const sortedX = new Float32Array(n);
    for (let j = 0; j < n; j++) sortedX[j] = pts[2 * order[j]];
    // How high each dot sits in its stack (0 at the baseline, 1 under the curve), which shades it.
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = pts[2 * i + 1];
      const h = heightAt(Math.floor(pts[2 * i]) + 0.5, width);
      depth[i] = Math.min(1, Math.max(0, (height - r - y) / Math.max(1e-6, h - 2 * r)));
    }
    return { pts, r, order, sortedX, depth, width, crowded, maxShift, separate };
  }, [width, values, toX, heightAt, height, rIn, stackKey, spill, packDpr]);

  const alpha = layout?.separate ? PACKED_ALPHA : DOT_ALPHA;
  // Everything the animation loop and the painter read, kept current without re-running effects.
  const live = useRef({
    entranceStart: null as number | null,
    restackStart: null as number | null,
    restackFrom: null as Float32Array | null,
    /** Each dot's offset from its resting place, down (in flight or bursting) and across (bursting), its
     *  speed down in flight, and its state of motion. */
    off: null as Float32Array | null,
    offX: null as Float32Array | null,
    vel: null as Float32Array | null,
    mode: null as Uint8Array | null,
    /** A bursting dot's motion: when it last changed (a kick arriving), where it was and how fast it went
     *  then, which spring holds it, and when it will be home (lib/dotPhysics `springPose`) — and a kick on
     *  its way, the shockwave's front not there yet: when it arrives, its speed, its cap and its spring. */
    t0: null as Float64Array | null,
    sk: null as Uint8Array | null,
    pk: null as Uint8Array | null,
    bx: null as Float32Array | null,
    by: null as Float32Array | null,
    bvx: null as Float32Array | null,
    bvy: null as Float32Array | null,
    restAt: null as Float64Array | null,
    pendT: null as Float64Array | null,
    pkx: null as Float32Array | null,
    pky: null as Float32Array | null,
    pcap: null as Float32Array | null,
    /** The furthest across any dot is thrown, now and at the last frame: how far outside a strip a dot
     *  drawn into it may belong. */
    slack: 0,
    slackLast: 0,
    /** The shockwaves: where each click was, when, its burst's reach, and how far its rings run (the
     *  plot's furthest corner from it); and their ink. */
    rings: [] as { x: number; y: number; t: number; reach: number; far: number }[],
    /** A fast drag's wake: the points it stirred at, when, and how hard, oldest first. */
    trail: [] as { x: number; y: number; t: number; s: number }[],
    ringInk: '',
    /** The rings' ink at no alpha: where a bloom fades to, in its own hue. */
    ringClear: 'rgba(0, 0, 0, 0)',
    /** The x-range of the dots in flight or leaving, and how many. */
    flyLo: Infinity,
    flyHi: -Infinity,
    flying: 0,
    flewFull: false,
    /** What has been repainted in squares while dots moved, to be put back in beads once all is still. */
    dirtyLo: Infinity,
    dirtyHi: -Infinity,
    lastTick: 0,
    raf: 0,
    ink: [] as string[],
    strong: [] as string[],
    /** Per kind, per tone: the bead each dot is stamped with, plain and highlighted. */
    beads: [] as Bead[][],
    strongBeads: [] as Bead[][],
    /** Per kind, per tone, on a dark page with a glow: the halos, drawn as a layer beneath the beads. */
    halos: [] as Bead[][],
    strongHalos: [] as Bead[][],
    /** Per kind, per tone: the colour, for the magnifying glass's larger beads, and what a moving
     *  square lays down (lib/dotSprites `beadInk`). The same for the air's kinds. */
    tones: [] as string[][],
    strongTones: [] as string[][],
    fast: [] as BeadInk[][],
    strongFast: [] as BeadInk[][],
    airTones: [] as string[][],
    airStrongTones: [] as string[][],
    airFast: [] as BeadInk[][],
    airStrongFast: [] as BeadInk[][],
    /** Each dot's tone, and the dots of each (kind, tone), for the fast full-field paint. */
    tone: null as Uint8Array | null,
    groups: [] as Uint32Array[],
    dark: false,
    highlight: null as readonly [number, number] | null,
    /** The marked dots, each with when it was marked; their inks; the frame their arrival is drawn on. */
    marks: [] as { i: number; born: number }[],
    markInk: { core: '', glow: '', clear: '', rim: '' },
    markRaf: 0,
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const prevLayout = useRef<typeof layout>(null);
  const prevStack = useRef<typeof stackKey>(undefined);
  const prevSolo = useRef<number | null>(solo);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // The current y of dot i: at rest, falling in, re-stacking, plus its flight or burst — a thrown dot
  // kept between the canvas's top and the baseline, so one pressed to the floor slides along it.
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
    if (L.off) y += L.off[i];
    if (L.mode && L.mode[i] === BURST) y = Math.min(height - lay.r, Math.max(lay.r, y));
    return y;
  };
  const yOfRef = useRef(yOf);
  yOfRef.current = yOf;
  // Its x: its value, and aside while it bursts.
  const xOf = (i: number) => layout!.pts[2 * i] + (live.current.offX ? live.current.offX[i] : 0);
  const xOfRef = useRef(xOf);
  xOfRef.current = xOf;
  // Whether it is in the air: thrown by a burst (not rocked by a ripple), and not yet within AIR_EPS of
  // its place.
  const inAir = (i: number, now: number) => {
    const L = live.current;
    return !!L.mode && L.mode[i] === BURST && L.sk![i] === THROWN && now < L.restAt![i] - AIR_BEFORE_REST;
  };
  const inAirRef = useRef(inAir);
  inAirRef.current = inAir;

  /**
   * Paints the strip [x0, x1) of the field — or all of it — as it stands at `now`: as beads, or `fast`,
   * as squares in the same tones. A bead is a `drawImage`, about five times a square's cost, so 21,000
   * of them every frame held the fall and the re-stack at 16ms a frame; while the whole field moves it
   * is drawn in squares, which at this size and speed read the same, and in beads once it is still.
   * A strip repainted while its dots move (a burst, a stir) is squares too — two thousand beads a
   * frame took 14ms on a CI runner — and goes back to beads once everything is still. Each square lays
   * down what its bead would (lib/dotSprites `beadInk`), so a strip in motion weighs what it does at rest.
   */
  const paint = (now: number, x0 = -Infinity, x1 = Infinity, fast = false) => {
    const canvas = canvasRef.current;
    const lay = layout;
    const L = live.current;
    if (!canvas || !lay || !L.tone || !L.beads.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // A packed field was snapped to this screen's device pixels: drawn at exactly its ratio, each sprite
    // lands on whole pixels. (The canvas's own width over the plot's can be a hair off it — 2006 over
    // 1003.14 — and every sprite was then resampled.)
    const dpr = spill != null ? packDpr : canvas.width / Math.max(1, lay.width);
    const whole = !(x0 > -Infinity) && !(x1 < Infinity);
    const a = whole ? 0 : Math.max(0, Math.floor((x0 - 1) * dpr));
    const b = whole ? canvas.width : Math.min(canvas.width, Math.ceil((x1 + 1) * dpr));
    if (b <= a) return;
    ctx.save();
    if (!whole) { ctx.beginPath(); ctx.rect(a, 0, b - a, canvas.height); ctx.clip(); }
    ctx.clearRect(a, 0, b - a, canvas.height);
    ctx.globalAlpha = alpha;
    const { order, sortedX, r, pts } = lay;
    const reach = (glow && L.dark ? 2 : 1) * r + 1 + L.slack;
    const j0 = whole ? 0 : lowerBound(sortedX, a / dpr - reach);
    const j1 = whole ? order.length : lowerBound(sortedX, b / dpr + reach);
    const hl = L.highlight;
    const kindsN = L.beads.length;
    const tone = L.tone;
    const mode = L.mode;
    const offX = L.offX;
    if (fast) {
      // Squares, a fill at a time: one pass per (kind, tone), the highlighted dots after. The whole
      // field's groups are kept; a strip's dots — or a field with dots in the air, each under its air
      // kind — are sorted into theirs in one counting pass.
      const air = !!airKinds && L.airFast.length > 0 && L.flying > 0;
      const airN = air ? L.airFast.length : 0;
      let groups: ArrayLike<number>[] = L.groups;
      if (!whole || air) {
        const G = (kindsN + airN) * TONES;
        const groupOf = (i: number) => (air && inAir(i, now)
          ? kindsN + ((airKinds![i] || 0) % airN)
          : ((kinds ? kinds[i] : 0) || 0) % kindsN) * TONES + tone[i];
        const start = new Int32Array(G + 1);
        for (let j = j0; j < j1; j++) start[groupOf(order[j]) + 1]++;
        for (let g = 0; g < G; g++) start[g + 1] += start[g];
        const next = start.slice(0, G);
        const flat = new Uint32Array(Math.max(0, j1 - j0));
        for (let j = j0; j < j1; j++) { const i = order[j]; flat[next[groupOf(i)]++] = i; }
        groups = Array.from({ length: G }, (_, g) => flat.subarray(start[g], start[g + 1]));
      }
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        for (let g = 0; g < groups.length; g++) {
          const list = groups[g];
          if (!list.length) continue;
          const k = Math.floor(g / TONES);
          const ink = k < kindsN ? (strong ? L.strongFast : L.fast)[k][g % TONES] : (strong ? L.airStrongFast : L.airFast)[k - kindsN][g % TONES];
          const side = ink.side;
          ctx.fillStyle = ink.fill;
          for (let q = 0; q < list.length; q++) {
            const i = list[q];
            if (mode && mode[i] === GONE) continue;
            const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
            if (lit !== !!strong) continue;
            ctx.fillRect((pts[2 * i] + (offX ? offX[i] : 0)) * dpr - side / 2, yOf(i, now) * dpr - side / 2, side, side);
          }
        }
      }
    } else {
      // The glow first, as one layer beneath every bead: it lights the gaps and veils no neighbour.
      if (L.halos.length) {
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          if (mode && mode[i] === GONE) continue;
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          const hb = (lit ? L.strongHalos : L.halos)[((kinds ? kinds[i] : 0) || 0) % kindsN][tone[i]];
          ctx.drawImage(hb.img, (pts[2 * i] + (offX ? offX[i] : 0)) * dpr - hb.half, yOf(i, now) * dpr - hb.half);
        }
      }
      // The highlighted dots last, so they sit over their neighbours.
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        const set = strong ? L.strongBeads : L.beads;
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          if (mode && mode[i] === GONE) continue;
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          if (lit !== !!strong) continue;
          const bd = set[((kinds ? kinds[i] : 0) || 0) % kindsN][tone[i]];
          ctx.drawImage(bd.img, (pts[2 * i] + (offX ? offX[i] : 0)) * dpr - bd.half, yOf(i, now) * dpr - bd.half);
        }
      }
    }
    // The marked dots, over the rest.
    if (L.marks.length && L.markInk.core) {
      const ext = markExtent(r);
      for (const m of L.marks) {
        if (mode && mode[m.i] === GONE) continue;
        const x = pts[2 * m.i] + (offX ? offX[m.i] : 0);
        if (x + ext < a / dpr || x - ext > b / dpr) continue;
        drawMark(ctx, x * dpr, yOf(m.i, now) * dpr, markRadius(r) * dpr, now - m.born, dpr, L.markInk);
      }
    }
    // The shockwaves, over the dots: a bloom swelling at each click and fading as the dots burst out of
    // it, then the click's front and its echoes, a ripple's period behind, running out across the plot
    // and fading as they go (lib/dotPhysics `ringAlpha`) — each a soft glowing band under a thin core.
    if (L.rings.length && L.ringInk) {
      ctx.strokeStyle = L.ringInk;
      ctx.lineCap = 'round';
      for (const g of L.rings) {
        const bl = bloomAt(now - g.t, g.reach);
        if (bl) {
          const gr = ctx.createRadialGradient(g.x * dpr, g.y * dpr, 0, g.x * dpr, g.y * dpr, bl.rad * dpr);
          gr.addColorStop(0, L.ringInk);
          gr.addColorStop(1, L.ringClear);
          ctx.globalAlpha = bl.alpha;
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(g.x * dpr, g.y * dpr, bl.rad * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let k = 0; k < RING_ECHOES; k++) {
          const rad = ((now - g.t - k * RIPPLE_PERIOD) / WAVE_MS) * g.reach;
          const a = ringAlpha(rad, k, g.reach, g.far);
          if (a <= 0) continue;
          for (const [w, share] of RING_STROKES) {
            ctx.globalAlpha = a * share;
            ctx.lineWidth = w * dpr;
            ctx.beginPath();
            ctx.arc(g.x * dpr, g.y * dpr, rad * dpr, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }
    // A fast drag's wake, over the dots with the rings.
    if (L.trail.length && L.ringInk) {
      ctx.strokeStyle = L.ringInk;
      drawTrail(ctx, L.trail, now, (x, y) => ({ x: x * dpr, y: y * dpr, scale: 1 }), dpr);
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
      const { order, sortedX, r } = lay;
      // This field's own x of the glass's centre; everything within its radius (plus a dot, plus how far
      // a thrown dot may be from its place).
      const fx = cx - ox;
      const j0 = lowerBound(sortedX, fx - R - r - L.slack);
      const j1 = lowerBound(sortedX, fx + R + r + L.slack);
      const hl = L.highlight;
      const kindsN = L.tones.length;
      const air = !!airKinds && L.airTones.length > 0 && L.flying > 0;
      const airN = L.airTones.length;
      const kMax = Math.max(kindsN, airN, 1);
      // Beads by (air, strong, kind, tone, quarter-pixel radius), so a dot costs a lookup, not a key string.
      const beads = new Map<number, Bead>();
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let strong = 0; strong < 2; strong++) {
        if (strong && !hl) break;
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          if (L.mode && L.mode[i] === GONE) continue;
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          if (lit !== !!strong) continue;
          const sx = xOfRef.current(i) + ox;
          const sy = yOfRef.current(i, now) + oy;
          if ((sx - cx) ** 2 + (sy - cy) ** 2 > (R + r) ** 2) continue;
          const m = map(sx, sy);
          const up = air && inAirRef.current(i, now);
          const k = up ? (airKinds![i] || 0) % airN : ((kinds ? kinds[i] : 0) || 0) % kindsN;
          const tone = L.tone[i];
          // Toward the rim the glass barely magnifies, and a bead there is a dot's own size: a square
          // of its ink, at a fifth of a bead's cost — most of the glass's dots are out there.
          if (m.scale < 1.6) {
            const ink = (up ? (strong ? L.airStrongFast : L.airFast) : (strong ? L.strongFast : L.fast))[k][tone];
            const side = ink.side * m.scale;
            ctx.fillStyle = ink.fill;
            ctx.fillRect(m.x * dpr - side / 2, m.y * dpr - side / 2, side, side);
            continue;
          }
          // Beads come in quarter-pixel sizes, so a sweep of the glass reuses a handful of sprites.
          const q = Math.max(2, Math.round(r * m.scale * dpr * 4));
          const key = ((((up ? 2 : 0) + strong) * kMax + k) * TONES + tone) * 256 + q;
          let bd = beads.get(key);
          if (!bd) {
            const set = up ? (strong ? L.airStrongTones : L.airTones) : (strong ? L.strongTones : L.tones);
            bd = bead(set[k][tone], q / 4, glow && L.dark);
            beads.set(key, bd);
          }
          ctx.drawImage(bd.img, m.x * dpr - bd.half, m.y * dpr - bd.half);
        }
      }
      // The marked dots, through the glass: as much bigger as it makes them, up to two and a half times.
      if (L.marks.length && L.markInk.core) {
        const ext = markExtent(r);
        for (const mk of L.marks) {
          if (L.mode && L.mode[mk.i] === GONE) continue;
          const sx = xOfRef.current(mk.i) + ox;
          const sy = yOfRef.current(mk.i, now) + oy;
          if ((sx - cx) ** 2 + (sy - cy) ** 2 > (R + ext) ** 2) continue;
          const m = map(sx, sy);
          const scale = Math.min(2.5, m.scale);
          drawMark(ctx, m.x * dpr, m.y * dpr, markRadius(r) * scale * dpr, now - mk.born, dpr, L.markInk);
        }
      }
      // The shockwaves' rings, through the glass.
      if (L.rings.length && L.ringInk) {
        ctx.strokeStyle = L.ringInk;
        for (const g of L.rings) {
          const gx = g.x + ox, gy = g.y + oy;
          const d = Math.hypot(gx - cx, gy - cy);
          const bl = bloomAt(now - g.t, g.reach);
          if (bl && d < R + bl.rad) {
            // Where the glass shows the click, the bloom as large as the glass makes it there.
            const m = map(gx, gy);
            const rr = bl.rad * Math.min(2.5, m.scale);
            const gr = ctx.createRadialGradient(m.x * dpr, m.y * dpr, 0, m.x * dpr, m.y * dpr, rr * dpr);
            gr.addColorStop(0, L.ringInk);
            gr.addColorStop(1, L.ringClear);
            ctx.globalAlpha = bl.alpha;
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(m.x * dpr, m.y * dpr, rr * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
          for (let k = 0; k < RING_ECHOES; k++) {
            const rad = ((now - g.t - k * RIPPLE_PERIOD) / WAVE_MS) * g.reach;
            const al = ringAlpha(rad, k, g.reach, g.far);
            if (al <= 0 || d > R + rad || d < rad - R) continue;
            ctx.beginPath();
            let most = 1;
            for (let n = 0; n <= 96; n++) {
              const a = (n / 96) * Math.PI * 2;
              const m = map(gx + rad * Math.cos(a), gy + rad * Math.sin(a));
              if (n) ctx.lineTo(m.x * dpr, m.y * dpr); else ctx.moveTo(m.x * dpr, m.y * dpr);
              if (m.scale > most) most = m.scale;
            }
            ctx.lineCap = 'round';
            for (const [w, share] of RING_STROKES) {
              ctx.globalAlpha = al * share;
              ctx.lineWidth = w * dpr * Math.min(2, most);
              ctx.stroke();
            }
          }
        }
      }
      // The wake, through the glass.
      if (L.trail.length && L.ringInk) {
        ctx.strokeStyle = L.ringInk;
        const near = L.trail.filter((q) => Math.hypot(q.x + ox - cx, q.y + oy - cy) < R + TRAIL_W);
        drawTrail(ctx, near, now, (x, y) => { const m = map(x + ox, y + oy); return { x: m.x * dpr, y: m.y * dpr, scale: m.scale }; }, dpr);
      }
      ctx.restore();
    },
    burst(x, y, stir = null) {
      const lay = layout;
      const L = live.current;
      if (!lay || !L.mode || !L.t0 || !L.pendT || prefersReducedMotion() || document.hidden) return false;
      const now = performance.now();
      const size = burstSizes(height);
      const stirred = stir ? stirSizes(stir.strength, height) : null;
      const reach = stirred ? stirred.reach : size.reach;
      const speed = stirred ? stirred.speed : size.speed;
      const cap = stirred ? stirred.cap : CLICK_CAP * size.speed;
      const { order, sortedX, pts } = lay;
      // A click's ripple runs across the whole field; a stir's wake is all there is of it.
      const span = stir ? wakeExtent(reach) + L.slack : 0;
      const j0 = stir ? lowerBound(sortedX, x - span) : 0;
      const j1 = stir ? lowerBound(sortedX, x + span) : order.length;
      let any = false;
      for (let j = j0; j < j1; j++) {
        const i = order[j];
        const m = L.mode[i];
        // A dot leaving, gone, or still falling into its place after a solo is not thrown.
        if (m !== REST && m !== BURST) continue;
        const dx = xOfRef.current(i) - x, dy = yOfRef.current(i, now) - y;
        let kind = THROWN;
        let most = cap;
        if (stir ? !stirKick(dx, dy, i, reach, speed, stir.strength, stir.ux, stir.uy, kickAt) : !burstKick(dx, dy, i, reach, speed, WAVE_MS, kickAt)) {
          if (stir || !rippleKick(dx, dy, reach, size.ripple, WAVE_MS, kickAt)) continue;
          // A ripple never sends a dot faster than it sends it, or than it already goes.
          kind = RIPPLED;
          most = Math.hypot(kickAt.vx, kickAt.vy);
        } else if (stir && m === BURST) {
          // Already swinging: the stir only tops it up to its own swing (lib/dotPhysics `stirTopUp`).
          springPose(springOf(L.sk![i]), L.bx![i], L.by![i], L.bvx![i], L.bvy![i], now - L.t0[i], pose);
          if (!stirTopUp(pose.ox, pose.oy, pose.vx, pose.vy, kickAt)) continue;
        }
        if (m === REST) {
          L.mode[i] = BURST;
          L.t0[i] = now;
          L.bx![i] = 0; L.by![i] = 0; L.bvx![i] = 0; L.bvy![i] = 0;
          L.restAt![i] = now;
        }
        // A kick on its way when another comes: the earlier moment, the two added, a burst's spring over
        // a ripple's.
        const due = now + kickAt.delay;
        if (L.pendT[i] === Infinity) {
          L.pendT[i] = due; L.pkx![i] = kickAt.vx; L.pky![i] = kickAt.vy; L.pcap![i] = most; L.pk![i] = kind;
        } else {
          L.pendT[i] = Math.min(L.pendT[i], due);
          L.pkx![i] += kickAt.vx; L.pky![i] += kickAt.vy;
          L.pcap![i] = Math.max(L.pcap![i], most);
          L.pk![i] = Math.min(L.pk![i], kind);
        }
        const hx = pts[2 * i];
        if (hx < L.flyLo) L.flyLo = hx;
        if (hx > L.flyHi) L.flyHi = hx;
        any = true;
      }
      const wake = !!stir && stir.strength >= TRAIL_MIN;
      if (wake) L.trail.push({ x, y, t: now, s: stir!.strength });
      if (!stir) {
        const far = Math.max(Math.hypot(x, y), Math.hypot(lay.width - x, y), Math.hypot(x, height - y), Math.hypot(lay.width - x, height - y));
        L.rings.push({ x, y, t: now, reach, far });
      }
      else if (!any && !wake) return false;
      if (any) L.flying = Math.max(1, L.flying);
      if (boxRef.current) boxRef.current.dataset.flight = 'moving';
      kickRef.current();
      return true;
    },
    positionOf(i) {
      const lay = layout;
      const L = live.current;
      if (!lay || !(i >= 0 && i < values.length) || (L.mode && L.mode[i] === GONE)) return null;
      return { x: xOfRef.current(i), y: yOfRef.current(i, performance.now()), r: markRadius(lay.r) };
    },
    markAt(x, y) {
      const lay = layout;
      const L = live.current;
      if (!lay || !L.marks.length) return null;
      const now = performance.now();
      let best: number | null = null;
      let bestD = markRadius(lay.r) * 1.6 + 4;
      for (const m of L.marks) {
        if (L.mode && L.mode[m.i] === GONE) continue;
        const d = Math.hypot(xOfRef.current(m.i) - x, yOfRef.current(m.i, now) - y);
        if (d < bestD) { bestD = d; best = m.i; }
      }
      return best;
    },
  }), [layout, values, kinds, airKinds, glow, height, alpha]);

  // A kick whose shockwave has arrived: where the dot is on its spring at that moment, plus the kick
  // (capped: lib/dotPhysics `thrown`), starts its motion home again from there — on the kick's spring,
  // or a burst's if a burst still holds it.
  const rebase = (i: number) => {
    const L = live.current;
    const t = L.pendT![i];
    springPose(springOf(L.sk![i]), L.bx![i], L.by![i], L.bvx![i], L.bvy![i], t - L.t0![i], pose);
    thrown(pose.vx, pose.vy, L.pkx![i], L.pky![i], L.pcap![i], speed2);
    const kind = L.restAt![i] > t ? Math.min(L.sk![i], L.pk![i]) : L.pk![i];
    L.sk![i] = kind;
    L.bx![i] = pose.ox;
    L.by![i] = pose.oy;
    L.bvx![i] = speed2.vx;
    L.bvy![i] = speed2.vy;
    L.t0![i] = t;
    L.restAt![i] = t + springRestAfter(springOf(kind), pose.ox, pose.oy, speed2.vx, speed2.vy);
    L.pendT![i] = Infinity;
    L.pkx![i] = 0;
    L.pky![i] = 0;
    L.pcap![i] = 0;
  };

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
    const dt = Math.min(32, Math.max(1, now - (L.lastTick || now - 16)));
    // Flight — a soloed group's dots falling to their places, raining back in, or leaving through the
    // floor — and bursts, each dot on its spring home, where it is a function of time alone.
    let flightFrame = false;
    let sx0 = Infinity, sx1 = -Infinity;
    let slackNow = 0;
    if (L.flying > 0 && L.mode && L.off && L.vel && L.offX && L.t0 && L.pendT && L.restAt) {
      flightFrame = true;
      const was0 = L.flyLo, was1 = L.flyHi;
      let lo = Infinity, hi = -Infinity, count = 0;
      const j0 = lowerBound(lay.sortedX, L.flyLo);
      const j1 = lowerBound(lay.sortedX, L.flyHi + 1e-6);
      for (let j = j0; j < j1; j++) {
        const i = lay.order[j];
        const m = L.mode[i];
        if (m === FLYING) {
          const st = stepFall(L.off[i], L.vel[i], dt, lay.pts[2 * i + 1] - lay.r);
          L.off[i] = st.o;
          L.vel[i] = st.v;
          if (st.rest) { L.mode[i] = REST; continue; }
        } else if (m === LEAVING) {
          const st = stepThrough(L.off[i], L.vel[i], dt);
          L.off[i] = st.o;
          L.vel[i] = st.v;
          if (lay.pts[2 * i + 1] + st.o - lay.r > height) { L.mode[i] = GONE; L.off[i] = 0; L.vel[i] = 0; continue; }
        } else if (m === BURST) {
          if (L.pendT[i] <= now) rebase(i);
          if (L.restAt[i] <= now) {
            // Home: at rest, or waiting at its place for the front on its way.
            L.off[i] = 0;
            L.offX[i] = 0;
            if (L.pendT[i] === Infinity) { L.mode[i] = REST; continue; }
          } else {
            springPose(springOf(L.sk![i]), L.bx![i], L.by![i], L.bvx![i], L.bvy![i], now - L.t0[i], pose);
            L.offX[i] = pose.ox;
            L.off[i] = pose.oy;
            if (Math.abs(pose.ox) > slackNow) slackNow = Math.abs(pose.ox);
          }
        } else continue;
        count++;
        const x = lay.pts[2 * i];
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      L.flying = count;
      L.flyLo = lo;
      L.flyHi = hi;
      // Across a third of the field or more (a group leaving, or raining in, or a long drag), the whole
      // field is repainted, in squares while it moves; otherwise where the dots were and are.
      if (was1 - was0 > lay.width / 3) { full = true; L.flewFull = true; }
      else { sx0 = Math.min(was0, lo); sx1 = Math.max(was1, hi); }
      if (count > 0) moving = true;
      else if (L.flewFull) { full = true; L.flewFull = false; }
    }
    // A strip is repainted as far out as a dot drawn into it can be from its place, this frame or last.
    L.slack = Math.max(L.slackLast, slackNow);
    // The shockwaves: each one's strip, as far as its front has run, repainted until its last echo is off
    // the plot, and once more to erase it.
    if (L.rings.length) {
      flightFrame = true;
      for (const g of L.rings) {
        const e = Math.min(g.far, Math.max(((now - g.t) / WAVE_MS) * g.reach, bloomAt(now - g.t, g.reach)?.rad ?? 0)) + 8;
        if (g.x - e < sx0) sx0 = g.x - e;
        if (g.x + e > sx1) sx1 = g.x + e;
      }
      L.rings = L.rings.filter((g) => ((now - g.t - (RING_ECHOES - 1) * RIPPLE_PERIOD) / WAVE_MS) * g.reach < g.far);
      if (L.rings.length) moving = true;
    }
    // A wake: where its points are, repainted until the last has faded, and once more to erase it.
    if (L.trail.length) {
      flightFrame = true;
      for (const q of L.trail) {
        if (q.x - TRAIL_W < sx0) sx0 = q.x - TRAIL_W;
        if (q.x + TRAIL_W > sx1) sx1 = q.x + TRAIL_W;
      }
      L.trail = L.trail.filter((q) => now - q.t < TRAIL_MS);
      if (L.trail.length) moving = true;
    }
    if (!full && sx1 >= sx0) {
      const pad = lay.r + 1 + L.slack;
      paintRef.current(now, sx0 - pad, sx1 + pad, true);
      L.dirtyLo = Math.min(L.dirtyLo, sx0 - pad);
      L.dirtyHi = Math.max(L.dirtyHi, sx1 + pad);
    }
    // Everything thrown is home, and every ring has faded.
    if (flightFrame && L.flying === 0 && !L.rings.length && !L.trail.length) {
      if (L.entranceStart == null && L.restackStart == null) setSettled(true);
      if (boxRef.current && L.mode) {
        boxRef.current.dataset.flight = 'idle';
        boxRef.current.dataset.visible = String(countVisible(L.mode));
      }
    }
    L.lastTick = now;
    // In squares while the whole field is moving; the frame that ends the move paints it in beads.
    if (full) paintRef.current(now, -Infinity, Infinity, moving);
    L.slackLast = slackNow;
    if (full || flightFrame) {
      const name = flightFrame ? 'flight-frame' : frameMark;
      try { performance.measure(name, { start: t0, end: performance.now() }); } catch { /* diagnostic only */ }
    }
    // Everything still: what went into squares while it moved goes back into beads, once.
    if (!moving && L.dirtyHi >= L.dirtyLo) {
      if (!full) paintRef.current(now, L.dirtyLo, L.dirtyHi, false);
      L.dirtyLo = Infinity;
      L.dirtyHi = -Infinity;
    }
    if (moving) L.raf = requestAnimationFrame(tickRef.current);
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const kick = () => { const L = live.current; if (!L.raf) L.raf = requestAnimationFrame(tickRef.current); };
  const kickRef = useRef(kick);
  kickRef.current = kick;

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
    // The beads, and on a dark page with a glow their halos, drawn beneath them all.
    const glowing = glow && L.dark;
    L.beads = L.tones.map((ts) => ts.map((c) => bead(c, rd, false)));
    L.strongBeads = L.strongTones.map((ts) => ts.map((c) => bead(c, rd, false)));
    L.halos = glowing ? L.tones.map((ts) => ts.map((c) => halo(c, rd))) : [];
    L.strongHalos = glowing ? L.strongTones.map((ts) => ts.map((c) => halo(c, rd))) : [];
    // What a moving square lays down: its bead's ink and, beneath it, its halo's.
    const inkOf = (c: string) => beadInk(bead(c, rd, false), glowing ? halo(c, rd) : null);
    L.fast = L.tones.map((ts) => ts.map(inkOf));
    L.strongFast = L.strongTones.map((ts) => ts.map(inkOf));
    // The air's kinds: their tones, plain and highlighted, and what each lays down as a square.
    const airInk = (airInks ?? []).map((c, k) => { const el = airRefs.current[k]; return el ? getComputedStyle(el).color : c; });
    L.airTones = airInk.map((c) => toneInks(c, text, TONES));
    L.airStrongTones = airInk.map((c) => toneInks(strongerInk(c, text, STRONG_APART), text, TONES));
    L.airFast = L.airTones.map((ts) => ts.map(inkOf));
    L.airStrongFast = L.airStrongTones.map((ts) => ts.map(inkOf));
    L.ringInk = ringRef.current ? getComputedStyle(ringRef.current).color : '';
    const markCore = markRef.current ? getComputedStyle(markRef.current).color : '';
    const markRgb = parseRgb(markCore);
    L.markInk = markRgb
      ? { core: markCore, glow: `rgba(${markRgb[0]}, ${markRgb[1]}, ${markRgb[2]}, ${L.dark ? 0.8 : 0.65})`, clear: `rgba(${markRgb[0]}, ${markRgb[1]}, ${markRgb[2]}, 0)`, rim: rimRef.current ? getComputedStyle(rimRef.current).color : 'rgb(255, 255, 255)' }
      : { core: '', glow: '', clear: '', rim: '' };
    const ringRgb = parseRgb(L.ringInk);
    L.ringClear = ringRgb ? `rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0)` : 'rgba(0, 0, 0, 0)';
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
      // Every tone of every ink, each ink's separated by '|', and each bead's own mean colour, what a
      // lone bead looks like from a step back: what the contrast guards read.
      boxRef.current.dataset.tones = L.tones.map((ts) => ts.join(';')).join('|');
      boxRef.current.dataset.beadInks = L.fast.map((ts) => ts.map((f) => f.fill).join(';')).join('|');
    }
    const motionOk = !prefersReducedMotion() && !document.hidden;
    const prev = prevLayout.current;
    const sameField = !!prev && prev !== lay && prev.width === lay.width && prev.pts.length === lay.pts.length;
    const restacked = sameField && prevStack.current !== stackKey;
    const soloMoved = prevSolo.current !== solo;
    // Each dot's motion belongs to one layout, and a new one starts it at rest — but for a group
    // soloed away, which stays gone.
    const oldOff = L.off;
    const oldMode = L.mode;
    const off = new Float32Array(n);
    const vel = new Float32Array(n);
    const mode = new Uint8Array(n);
    const shown = (i: number) => solo == null || !kinds || kinds[i] === solo;
    for (let i = 0; i < n; i++) if (!shown(i)) mode[i] = GONE;
    L.off = off;
    L.vel = vel;
    L.mode = mode;
    L.offX = new Float32Array(n);
    L.t0 = new Float64Array(n);
    L.sk = new Uint8Array(n);
    L.pk = new Uint8Array(n);
    L.bx = new Float32Array(n);
    L.by = new Float32Array(n);
    L.bvx = new Float32Array(n);
    L.bvy = new Float32Array(n);
    L.restAt = new Float64Array(n);
    L.pendT = new Float64Array(n).fill(Infinity);
    L.pkx = new Float32Array(n);
    L.pky = new Float32Array(n);
    L.pcap = new Float32Array(n);
    L.slack = 0;
    L.slackLast = 0;
    L.rings = [];
    L.trail = [];
    L.flying = 0;
    L.flyLo = Infinity;
    L.flyHi = -Infinity;
    L.flewFull = false;
    L.dirtyLo = Infinity;
    L.dirtyHi = -Infinity;
    prevLayout.current = lay;
    prevStack.current = stackKey;
    prevSolo.current = solo;
    const now = performance.now();
    if (sameField && soloMoved && motionOk && oldMode) {
      // A group soloed, or brought back, by gravity. A dot that stays and whose place is lower falls
      // to it; one whose place is higher eases up to it; one going falls through the floor; one coming
      // back rains in from above the top, some higher than others, and bounces into its place.
      const from = new Float32Array(n);
      let easing = false;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const newY = lay.pts[2 * i + 1];
        const oldY = prev.pts[2 * i + 1] + (oldOff ? oldOff[i] : 0);
        const was = oldMode[i] !== GONE && oldMode[i] !== LEAVING;
        from[i] = newY;
        if (was && shown(i)) {
          if (oldY <= newY) { mode[i] = FLYING; off[i] = oldY - newY; } else { from[i] = oldY; easing = true; }
        } else if (was) {
          mode[i] = LEAVING;
          off[i] = oldY - newY;
        } else if (shown(i)) {
          mode[i] = FLYING;
          off[i] = -(newY + lay.r + ((Math.imul(i + 3, 2654435761) >>> 0) % RAIN_SPREAD));
        }
        if (mode[i] === FLYING || mode[i] === LEAVING) count++;
      }
      L.flying = count;
      // Every dot, including those a jitter put half a pixel left of the plot's edge.
      L.flyLo = -Infinity;
      L.flyHi = Infinity;
      if (easing) { L.restackFrom = from; L.restackStart = now; }
      if (boxRef.current) boxRef.current.dataset.flight = count ? 'moving' : 'idle';
      setSettled(false);
      paint(now, -Infinity, Infinity, true);
      kick();
    } else if (restacked && motionOk) {
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
    if (boxRef.current && L.flying === 0) {
      boxRef.current.dataset.flight = 'idle';
      boxRef.current.dataset.visible = String(countVisible(mode));
    }
    return () => { if (L.raf) { cancelAnimationFrame(L.raf); L.raf = 0; } };
    // `scheme` is read through getComputedStyle, which is why a theme change must re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, height, entrance, kinds, inks, airInks, scheme, glow, solo]);

  // Drop again: the fall into place, played on demand.
  const replayRef = useRef(replay);
  useEffect(() => {
    if (replay === replayRef.current) return;
    replayRef.current = replay;
    const L = live.current;
    if (!layout || prefersReducedMotion() || document.hidden) return;
    L.entranceStart = performance.now();
    setSettled(false);
    paintRef.current(L.entranceStart, -Infinity, Infinity, true);
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, layout]);

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
    // While dots move, in squares like the strips round it — a bead strip there flickered against
    // them — and back in beads with the rest once all is still.
    const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0;
    paintRef.current(performance.now(), x0, x1, busy);
    if (busy) { L.dirtyLo = Math.min(L.dirtyLo, x0); L.dirtyHi = Math.max(L.dirtyHi, x1); }
  }, [hlLo, hlHi, layout, toX]);

  // The marks: repaint where one went or came, and draw each arrival (its growth and its ring) in the
  // strip round it until it is done.
  const markKey = marks ? marks.join(',') : '';
  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    const still = prefersReducedMotion();
    const was = new Map(L.marks.map((m) => [m.i, m]));
    const next = (markKey ? markKey.split(',').map(Number) : []).filter((i) => i >= 0 && i < values.length);
    L.marks = next.map((i) => was.get(i) ?? { i, born: still ? -Infinity : now });
    const lay = layoutRef.current;
    if (!lay) return;
    const ext = markExtent(lay.r);
    const strip = (i: number, t: number) => {
      const x = xOfRef.current(i);
      const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0 || L.entranceStart != null || L.restackStart != null;
      paintRef.current(t, x - ext, x + ext, busy);
      if (busy) { L.dirtyLo = Math.min(L.dirtyLo, x - ext); L.dirtyHi = Math.max(L.dirtyHi, x + ext); }
    };
    const kept = new Set(next);
    for (const [i] of was) if (!kept.has(i)) strip(i, now);
    for (const m of L.marks) if (!was.has(m.i)) strip(m.i, now);
    if (L.markRaf || !L.marks.some((m) => now - m.born < MARK_PULSE_MS)) return;
    const step = (t: number) => {
      L.markRaf = 0;
      let more = false;
      for (const m of L.marks) {
        if (t - m.born > MARK_PULSE_MS + 32) continue;
        more = true;
        strip(m.i, t);
      }
      if (more) L.markRaf = requestAnimationFrame(step);
    };
    L.markRaf = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markKey, layout]);
  useEffect(() => () => { const L = live.current; if (L.markRaf) { cancelAnimationFrame(L.markRaf); L.markRaf = 0; } }, []);

  // What the guards read: how many dots of each kind, and how many the highlight covers.
  const kindCounts = useMemo(() => {
    if (!kinds) return undefined;
    const m = new Map<number, number>();
    for (let i = 0; i < kinds.length; i++) m.set(kinds[i], (m.get(kinds[i]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(',');
  }, [kinds]);
  // Only the dots shown: while a group is soloed, the highlight is of its people.
  let lit = 0;
  if (hlLo != null && hlHi != null) {
    for (let i = 0; i < values.length; i++) {
      if (values[i] >= hlLo && values[i] < hlHi && (solo == null || !kinds || kinds[i] === solo)) lit++;
    }
  }

  const inkList = inks?.length ? inks : null;
  return (
    <div
      ref={boxRef}
      className={`dot-field${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}
      data-dots={values.length}
      data-width={layout ? layout.width : undefined}
      data-r={layout ? layout.r.toFixed(3) : undefined}
      data-crowded={layout && pack ? layout.crowded : undefined}
      data-max-shift={layout && pack ? layout.maxShift.toFixed(2) : undefined}
      data-alpha={alpha}
      data-settled={settled ? 'true' : 'false'}
      data-kinds={kindCounts}
      data-stack={stack ? 'on' : 'off'}
      data-highlight={hlLo != null ? lit : undefined}
      data-solo={solo ?? 'none'}
      data-marks={marks?.length ? marks.map((i) => (layout && i >= 0 && i < values.length ? `${i}:${layout.pts[2 * i].toFixed(1)}:${layout.pts[2 * i + 1].toFixed(1)}` : `${i}`)).join(' ') : undefined}
      aria-hidden
    >
      <canvas ref={canvasRef} className="dot-field-ink" style={{ position: 'absolute', inset: 0, width: '100%', height }} />
      {/* The text colour, which a highlighted dot's ink is mixed toward. */}
      <span ref={textRef} style={{ color: 'var(--mantine-color-text)' }} hidden />
      {/* The shockwave's ring, in the curve's accent. */}
      <span ref={ringRef} style={{ color: 'var(--mantine-color-accent-6)' }} hidden />
      {/* A marked dot's ink, and the page's colour its rim is drawn in. */}
      <span ref={markRef} style={{ color: 'var(--found)' }} hidden />
      <span ref={rimRef} style={{ color: 'var(--mantine-color-body)' }} hidden />
      {airInks?.map((c, k) => <span key={`air-${k}`} ref={(el) => { airRefs.current[k] = el; }} style={{ color: c }} hidden />)}
      {inkList
        ? inkList.map((c, k) => <span key={k} ref={(el) => { inkRefs.current[k] = el; }} className={`dot-field-ink-${k}`} style={{ color: c }} hidden />)
        : [
            <span key={0} ref={(el) => { inkRefs.current[0] = el; }} hidden />,
            <span key={1} ref={(el) => { inkRefs.current[1] = el; }} className="dot-field-accent" hidden />,
          ]}
    </div>
  );
});
