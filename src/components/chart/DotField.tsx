import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FAINT_SCALE, LIT_SIZES, layoutDots, litScale, packDots, settleLit } from '../../lib/dotLayout';
import {
  AIR_BEFORE_REST, BURST_SPRING, CLICK_CAP, RING_ECHOES, RIPPLE_PERIOD, RIPPLE_SPRING, TRAIL_ALPHA, TRAIL_MIN, TRAIL_MS, TRAIL_W, WAVE_MS,
  bloomAt, burstKick, burstSizes, ringAlpha, rippleKick, springPose, springRestAfter, stepFall, stepThrough, stirKick, stirSizes, stirTopUp, thrown, trailAt, wakeExtent,
  type Kick, type Pose,
} from '../../lib/dotPhysics';
import { dotTones, luminance, parseRgb, strongerInk, type DotLook } from '../../lib/inkMix';
import { bead, beadInk, halo, type Bead, type BeadInk } from '../../lib/dotSprites';
import { prefersReducedMotion } from '../../lib/motion';
import { bounceCap, fallAt, rainSchedule } from '../../lib/rain';

/** Played once per session: after that the dots are simply there. */
const SEEN_KEY = 'dotfield-entrance';
/**
 * The entrance as rainfall (lib/rain): a column fills from the floor up, each dot waiting for the one
 * beneath it, so the thin tails are done in a moment and the crowded middle keeps raining. `RAIN_GAP` is
 * the mean wait between one dot in a column and the next, and `RAIN_MS` caps the tallest column — the
 * whole thing lands inside RAIN_MS and the longest fall, about six seconds. Each drop falls under the
 * field's gravity from a little above the plot, and the timing is irregular but seeded by the play.
 *
 * It replaces a sweep across x: every column started at a time fixed by where it stood, so a column of
 * four and a column of four hundred took exactly as long as each other, which is the one thing about
 * this chart a picture of it should show.
 */
const RAIN_GAP = 120;
const RAIN_MS = 5300;
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
/** A dot's shading (lib/inkMix `dotTones`): depth steps from the ink out to the crest on a dark page, or the
 *  floor on a light one, then the crest's rim — each in a few hue variants, so a patch of one colour has a
 *  painter's variety rather than one flat tint. `TONES` is how many a kind has in all. */
const DEPTH_STEPS = 12;
const HUES = 3;
const TONES = (DEPTH_STEPS + 1) * HUES;
/** How far the shading goes: further on a dark page, where a crest can brighten a long way, than on a light
 *  one, where more would turn the floor muddy. The light page's rim is a richer ink, not a paler one. */
export const LOOK_DARK: DotLook = { steps: DEPTH_STEPS, reach: 0.5, hues: HUES, turn: 8, rimLift: 0.3, rimChroma: 1 };
export const LOOK_LIGHT: DotLook = { steps: DEPTH_STEPS, reach: 0.4, hues: HUES, turn: 8, rimLift: 0, rimChroma: 1.3 };
/** Any other field's shading: a quiet depth ramp, one hue, no rim. A sparse strip's dots nearly all crown
 *  their own one-pixel column, so a rim there lit almost every dot, and the person page's grey peers came
 *  to outshine the green ones they are the context for. */
export const LOOK_PLAIN: DotLook = { steps: DEPTH_STEPS, reach: 0.2, hues: HUES, turn: 0, rimLift: 0, rimChroma: 1 };
/** Which hue variant a dot wears: fixed per dot, spread evenly. */
const hueOf = (i: number) => (Math.imul(i + 7, 0x9e3779b1) >>> 16) % HUES;
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
/** The one mark the search list has picked out is drawn this much bigger again, so which of the marked
 *  people is being read is answered by the field itself rather than only by the list. */
const MARK_BIG = 2;
/** The named dot's ring: how far outside the dot it runs and how thick it is, CSS px. Wide enough of the
 *  dot to read as a ring round it rather than a bigger dot, thin enough not to cover its neighbours. */
const RING_GAP = 3;
const RING_W = 1.5;
/** How far a ring reaches from its dot's centre, so a repaint covers where one was. */
const ringExtent = (r: number) => r + RING_GAP + RING_W;
/** A marked dot's radius, CSS px, in a field whose dots are `r`; and how far from its centre it draws. */
export const markRadius = (r: number, big = false) => Math.max(MARK_MIN_R, r * MARK_SCALE) * (big ? MARK_BIG : 1);
const markExtent = (r: number, big = false) => markRadius(r, big) * Math.max(MARK_HALO, MARK_PULSE) + 2;

/** A field squeezed along x, or its dots moved to given places (the landing pile unrolling onto a long
 *  axis, and folding back): each takes MOVE_MS, and a move sets its dots off one after another, left to
 *  right along their laid-out places, over MOVE_STAGGER. */
export const MOVE_MS = 900;
/** How much of its ink a dimmed dot keeps (`dim`): enough that the field's shape still reads behind the
 *  dots a filter lights, little enough that they are what the eye finds. Drawn smaller too (lib/dotLayout
 *  `FAINT_SCALE`), so a faint dot lays down about a third of this of what it did. */
export const DIM_ALPHA = 0.3;
/** How many strips a change of `dim` is repainted in, one a frame (see its effect). */
export const DIM_STRIPS = 8;
export const MOVE_STAGGER = 500;
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

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

/** A field's beads at a scale of its own dots' size — a filter's faint dots, and its lit ones (lib/dotLayout
 *  `FAINT_SCALE`, `litScale`) — per kind, per tone, as its own sets are. */
interface SizedBeads { beads: Bead[][]; strongBeads: Bead[][]; halos: Bead[][]; strongHalos: Bead[][] }

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
  /** Where dot `i` is — or, `atRest`, where it is going: its place in the layout rather than the point
   *  it has reached on the way there. A name hung on a dot in flight points at empty graph until the
   *  dot catches up, and if it is read once and not read again, it never does. */
  positionOf(i: number, atRest?: boolean): { x: number; y: number; r: number } | null;
  /** The marked dot nearest `x, y` (the field's CSS px) close enough to be the one pointed at, or null. */
  markAt(x: number, y: number): number | null;
  /** Any dot nearest `x, y` (the field's CSS px), where it is now, and no further off than its own radius
   *  plus `reach`; null in the gaps between dots and in the sky. With `litOnly`, a dot a filter dims is
   *  passed over: it is the context, not who the filter is about. */
  dotAt(x: number, y: number, reach: number, o?: { litOnly?: boolean }): number | null;
  /** A dot's own radius, CSS px, as the field lays it out: what a reader sees as the dot with no filter on
   *  (under one, `dotAt` measures from each dot as drawn, lit ones bigger and the rest smaller). Not
   *  `positionOf`'s radius, which is a marked dot's — five times this — so that a label can clear it. */
  dotR(): number;
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
  /** One per dot: 1 draws that dot faint, at `DIM_ALPHA` of its ink and without its glow; 0 as it is.
   *  The people a filter is not about stay in the picture as its context, and the ones it is about stand
   *  out of it. Only a repaint — nothing moves or is laid out again. */
  dim?: Uint8Array | null;
  /** With `dim`, the dots it lights take the lowest places in each column, the rest stacked above them: the
   *  group settles into a shape of its own inside everyone's, on the same scale. Each dot moves only up or
   *  down its own column. */
  sink?: boolean;
  /** Show one kind alone: the others fall through the floor, and it falls to the floor in its own
   *  shape (stacked first). Null for all. Needs `stack`. */
  solo?: number | null;
  /** Dots to mark (indices into `values`): each drawn over the field several times its size, glowing in
   *  `--found`, growing in and sending out one ring as it arrives. */
  marks?: readonly number[] | null;
  /** The one marked dot to draw at `MARK_BIG` times a mark's size (the person the search list has
   *  active). An index into `values`, or null for none. */
  markBig?: number | null;
  /** The one dot to ring: thinly, in the page's text colour, just outside the dot. It says which dot of a
   *  packed field a caption beside it is naming — what the magnifying glass draws inside itself, for the
   *  fields it is never up over. An index into `values`, or null for none. */
  ring?: number | null;
  /** Draw the field this many times as wide along x, from its left edge (1: as laid out); a change eases
   *  over MOVE_MS. Nothing is laid out again: squeezed, the field is its own picture, narrowed. */
  squeeze?: number;
  /** Draw each dot at `pts` (x, y pairs, this field's CSS px) rather than in its place. A new `key` moves
   *  them there from wherever they are drawn — or, with `pts` null, back to their places. A field mounted
   *  with it starts there. */
  moveTo?: { key: number; pts: Float32Array | null } | null;
  /** Bump to play the fall into place again. */
  replay?: number;
  /** Told when a rain has finished — every drop landed and settled — and only then: not after a burst, a
   *  stir, a filter or a re-stack, and never under Reduce Motion, where there is no rain. */
  onRained?: () => void;
  /** A faint halo round each dot on a dark page, so a dense field glows a little. */
  glow?: boolean;
  /** The landing graph's full shading: a deep depth ramp, a rim on each column's crest and a few hue
   *  variants (`LOOK_DARK`, `LOOK_LIGHT`). Without it, `LOOK_PLAIN`. */
  rich?: boolean;
  /** Called after every paint: a magnifying glass over the field redraws with it. */
  onFrame?: () => void;
  /** The name each animated frame is measured under (`performance.measure`), so a page's fields can
   *  be told apart; a burst's and a solo's frames are `flight-frame`. */
  frameMark?: string;
  className?: string;
}>(function DotField({
  values, kinds, inks, stack = false, toX, heightAt, height, r: rIn, pack = null, entrance = false, delay = 0,
  airKinds = null, airInks, highlight = null, dim = null, sink = false, solo = null, marks = null, markBig = null, ring = null, squeeze = 1, moveTo = null, replay = 0, onRained, glow = false, rich = false, onFrame, frameMark = 'dot-frame', className,
}, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The glow beneath the field on a dark page: a copy of the dots at rest, which CSS blurs (app.css
  // `.dot-field-bloom`) — one layer under the field, repainted with it, never in a frame of its own.
  const bloomRef = useRef<HTMLCanvasElement>(null);
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
  // Settled by a filter: its lit dots at the floor of their columns (a packed field only, whose columns are
  // the dots at one x). What a change of stacking is, as the re-stack's easing sees it: the key or the mask.
  const sunk = sink && pack && dim && dim.length === values.length ? dim : null;
  const stacking = useMemo(() => ({ stackKey, sunk }), [stackKey, sunk]);
  // How many are drawn faint — only when the mask is one this field draws with: a mask of any other length
  // is ignored by the paint, and a test must not read one as applied.
  const dimmed = useMemo(() => (dim && dim.length === values.length ? dim.reduce((t, v) => t + v, 0) : null), [dim, values.length]);
  // How much bigger its lit dots are drawn: by how small a part of the field they are.
  const litGrowth = dimmed != null ? litScale(1 - dimmed / Math.max(1, values.length)) : 1;
  const spill = pack ? pack.spill : null;

  const packDpr = pack ? dpr : 1;
  // Where each dot goes: packed or laid out, and the dots in x order, for finding the ones in a strip of the
  // canvas without visiting them all. A filter's settling moves none of them across, so it keeps these.
  const placed = useMemo(() => {
    if (!(width > 0) || !values.length) return null;
    const n = values.length;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = toX(values[i], width);
    let r = rIn;
    let pts: Float32Array;
    let crowded = 0, maxShift = 0.5, separate = false;
    if (spill != null) {
      const t0 = performance.now();
      const packed = packDots({ xs, heightAt: (x) => heightAt(x, width), baseY: height, width, dpr: packDpr, spill, stack: stackKey });
      try { performance.measure('dot-layout', { start: t0 }); } catch { /* diagnostic only */ }
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
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => pts[2 * a] - pts[2 * b]);
    const sortedX = new Float32Array(n);
    for (let j = 0; j < n; j++) sortedX[j] = pts[2 * order[j]];
    return { pts, r, order, sortedX, crowded, maxShift, separate };
  }, [width, values, toX, heightAt, height, rIn, stackKey, spill, packDpr]);

  // Each dot's height, as placed or settled by a filter, and what that shades and sets raining. Timed with
  // the packing, as `dot-layout`: a filter's settling is all of this, and must fit a frame.
  const layout = useMemo(() => {
    if (!placed) return null;
    const t0 = performance.now();
    const n = values.length;
    const { order, sortedX, r, crowded, maxShift, separate } = placed;
    // A kind soloed stays first, settled within itself (lib/dotLayout `settleLit`).
    const first = sunk && solo != null && kinds ? Uint8Array.from(kinds as ArrayLike<number>, (k) => (k === solo ? 0 : 1)) : null;
    const pts = sunk ? settleLit(placed.pts, sunk, order, first) : placed.pts;
    // How high each dot sits in its stack (0 at the baseline, 1 under the curve), which shades it.
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = pts[2 * i + 1];
      const h = heightAt(Math.floor(pts[2 * i]) + 0.5, width);
      depth[i] = Math.min(1, Math.max(0, (height - r - y) / Math.max(1e-6, h - 2 * r)));
    }
    // Each dot's place up its own column, counted from the floor, and which column: the rain's order
    // (lib/rain `rainSchedule`). Columns are read off the laid-out x (`order` already has them in x
    // order), and within one, the lowest dot is the first to land — the pile builds upward, as a pile does.
    const rank = new Float32Array(n);
    const column = new Int32Array(n);
    const crest = new Uint8Array(n);
    let columns = 0;
    let deepest = 0;
    for (let j = 0; j < n; ) {
      let k = j;
      // One column is one pixel of the picture, not one exact x: a packed column spills its crowd a
      // few pixels either way (lib/dotLayout), so grouping by an exact x would cut the pile into
      // slivers and the whole field would rain in at the same moment.
      const at = Math.floor(pts[2 * order[j]]);
      while (k < n && Math.floor(pts[2 * order[k]]) === at) k++;
      const col = Array.from(order.subarray(j, k)).sort((a, b) => pts[2 * b + 1] - pts[2 * a + 1]);
      col.forEach((i, up) => { rank[i] = up; column[i] = columns; });
      if (col.length) crest[col[col.length - 1]] = 1;
      // A settled group is a mountain of its own: its dots shade from the floor to its own top, which
      // takes the crest's rim. Shaded by the column's height, they would all be the column's darkest foot.
      if (sunk) {
        let top = -1;
        for (const i of col) if (!sunk[i] && (top < 0 || pts[2 * i + 1] < pts[2 * top + 1])) top = i;
        if (top >= 0) {
          const span = height - r - pts[2 * top + 1];
          for (const i of col) if (!sunk[i]) depth[i] = span > 1e-6 ? Math.min(1, Math.max(0, (height - r - pts[2 * i + 1]) / span)) : 1;
          crest[top] = 1;
        }
      }
      deepest = Math.max(deepest, col.length - 1);
      columns++;
      j = k;
    }
    // Every column rains at the same mean rate, so a taller column plainly takes longer — until the
    // tallest would run past RAIN_MS, which sets the rate for the whole field instead.
    const rainGap = Math.min(RAIN_GAP, RAIN_MS / Math.max(1, deepest));
    try { performance.measure('dot-layout', { start: t0 }); } catch { /* diagnostic only */ }
    return { pts, r, order, sortedX, depth, width, crowded, maxShift, separate, rank, column, crest, rainGap };
  }, [placed, sunk, solo, kinds, values.length, heightAt, width, height]);

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
    /** The beads' radius, device px; the sets at a filter's sizes, and what they were made for (the radius
     *  and the inks); and how much bigger the filter's lit dots are drawn. */
    rd: 0,
    sized: new Map<string, SizedBeads>(),
    sizedFor: '',
    litScale: 1,
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
    /** `dim`, as the paint reads it. */
    dim: null as Uint8Array | null,
    /** The marked dots, each with when it was marked and whether it is the big one; their inks; the
     *  frame their arrival is drawn on. */
    marks: [] as { i: number; born: number; big: boolean }[],
    markInk: { core: '', glow: '', clear: '', rim: '' },
    markRaf: 0,
    /** The dot a caption beside the field is naming, ringed in the page's own text colour. */
    ring: null as number | null,
    textInk: '',
    /** The squeeze: from, to, and when it started easing (null once there). */
    sqFrom: 1,
    sqTo: 1,
    sqStart: null as number | null,
    /** A move: where each dot set off from, where it goes (null: its place), and when; or where the dots
     *  are held once there (null: their places); and the key of the last move asked for. */
    mvFrom: null as Float32Array | null,
    mvTo: null as Float32Array | null,
    mvStart: null as number | null,
    mvHold: null as Float32Array | null,
    mvKey: null as number | null,
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Where each dot is laid out, x then y (CSS px), for a test to read: a function on the field's box rather
  // than an attribute, which would carry 44,000 numbers into the page's markup. Read-only, like `data-lit`.
  useEffect(() => {
    const el = boxRef.current as (HTMLDivElement & { dotPlaces?: () => number[] | null }) | null;
    if (el) el.dotPlaces = () => (layoutRef.current ? Array.from(layoutRef.current.pts) : null);
  }, []);
  // The rain for this play: when each drop leaves and from how high, seeded by the play — the first is
  // always the same, and each "Drop again" is a new one (lib/rain).
  const rainPlan = useMemo(
    () => (layout ? rainSchedule(layout.rank, layout.column, layout.pts.filter((_, k) => k % 2 === 1), layout.r, { gap: layout.rainGap, span: RAIN_MS, seed: replay }) : null),
    [layout, replay],
  );
  const rainRef = useRef(rainPlan);
  rainRef.current = rainPlan;
  const rainedRef = useRef(onRained);
  rainedRef.current = onRained;
  const prevLayout = useRef<typeof layout>(null);
  const prevStack = useRef<typeof stacking | null>(null);
  const prevSolo = useRef<number | null>(solo);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // How wide the field is drawn now, as a share of its laid-out width; whether any dot is drawn away from
  // its laid-out place (then a strip of the field cannot be found from where the dots are laid out); and
  // how far along its way a moving dot is — setting off in turn along its laid-out x.
  const squeezeAt = (now: number) => {
    const L = live.current;
    return L.sqStart == null ? L.sqTo : L.sqFrom + (L.sqTo - L.sqFrom) * easeInOut(clamp01((now - L.sqStart) / MOVE_MS));
  };
  const displaced = () => {
    const L = live.current;
    return L.sqTo !== 1 || L.sqStart != null || L.mvStart != null || L.mvHold != null;
  };
  const moveShare = (i: number, now: number) => {
    const L = live.current;
    const lay = layout!;
    return easeInOut(clamp01((now - (L.mvStart ?? now) - (lay.pts[2 * i] / Math.max(1, lay.width)) * MOVE_STAGGER) / MOVE_MS));
  };

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
    const plan = rainRef.current;
    if (L.entranceStart != null && plan) {
      // Falling under gravity from a little above the plot, then one small settle (lib/rain `fallAt`).
      y = fallAt(now - L.entranceStart - delay - plan.start[i], -lay.r - plan.lift[i], y, bounceCap(lay.r));
    }
    if (L.mvStart != null && L.mvFrom) {
      const to = L.mvTo ? L.mvTo[2 * i + 1] : lay.pts[2 * i + 1];
      y = L.mvFrom[2 * i + 1] + (to - L.mvFrom[2 * i + 1]) * moveShare(i, now);
    } else if (L.mvHold) y = L.mvHold[2 * i + 1];
    if (L.off) y += L.off[i];
    if (L.mode && L.mode[i] === BURST) y = Math.min(height - lay.r, Math.max(lay.r, y));
    return y;
  };
  const yOfRef = useRef(yOf);
  yOfRef.current = yOf;
  // Its x: its value — squeezed, or moved — and aside while it bursts.
  const xOf = (i: number, now: number = performance.now()) => {
    const L = live.current;
    const lay = layout!;
    let x = lay.pts[2 * i];
    if (L.mvStart != null && L.mvFrom) {
      const to = L.mvTo ? L.mvTo[2 * i] : x;
      x = L.mvFrom[2 * i] + (to - L.mvFrom[2 * i]) * moveShare(i, now);
    } else if (L.mvHold) x = L.mvHold[2 * i];
    else if (L.sqTo !== 1 || L.sqStart != null) x *= squeezeAt(now);
    return x + (L.offX ? L.offX[i] : 0);
  };
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

  // The beads at `scale` of the field's own size, a kind at a time: made ahead in idle moments (see the ink
  // effect), and whatever is still missing when a filter first paints. Made at once, they held that repaint
  // 26ms at CI's pace. Not in the effect that reads the inks, which also sets every dot at rest and paints the
  // field whole: a filter's hover would have stopped a burst and undone the strips.
  const sizedStep = (scale: number): boolean => {
    const L = live.current;
    const key = scale.toFixed(2);
    let set = L.sized.get(key);
    if (!set) { set = { beads: [], strongBeads: [], halos: [], strongHalos: [] }; L.sized.set(key, set); }
    const k = set.beads.length;
    if (k >= L.tones.length) return true;
    // Never under half a device pixel across the radius, where a dot is lost.
    const rd = Math.max(0.5, L.rd * scale);
    set.beads.push(L.tones[k].map((c) => bead(c, rd, false)));
    set.strongBeads.push(L.strongTones[k].map((c) => bead(c, rd, false)));
    // A faint dot is drawn without its glow, so it has no halo to make.
    if (L.halos.length && scale > 1) {
      set.halos.push(L.tones[k].map((c) => halo(c, rd)));
      set.strongHalos.push(L.strongTones[k].map((c) => halo(c, rd)));
    }
    return set.beads.length >= L.tones.length;
  };
  const sizedBeads = (scale: number): SizedBeads => {
    const L = live.current;
    if (scale === 1) return L;
    while (!sizedStep(scale)) { /* the kinds still missing */ }
    return L.sized.get(scale.toFixed(2))!;
  };
  // How far a dot can be drawn from its centre: the field's radius, or a filter's lit dots' when bigger. A
  // strip is repainted this far out, so no bigger dot at its edge is left half in the old ink.
  const drawnR = (r: number) => r * (live.current.dim ? Math.max(1, live.current.litScale) : 1);

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
    const whole = (!(x0 > -Infinity) && !(x1 < Infinity)) || displaced();
    const a = whole ? 0 : Math.max(0, Math.floor((x0 - 1) * dpr));
    const b = whole ? canvas.width : Math.min(canvas.width, Math.ceil((x1 + 1) * dpr));
    if (b <= a) return;
    ctx.save();
    if (!whole) { ctx.beginPath(); ctx.rect(a, 0, b - a, canvas.height); ctx.clip(); }
    ctx.clearRect(a, 0, b - a, canvas.height);
    ctx.globalAlpha = alpha;
    const { order, sortedX, r } = lay;
    // A dimmed field: its faint dots in a pass of their own under the rest, so the ones a filter is about
    // are drawn over their neighbours as well as in full ink — and bigger, the faint ones smaller.
    const dm = L.dim && L.dim.length === values.length ? L.dim : null;
    const faint = (i: number) => !!dm && dm[i] === 1;
    const faintS = dm ? FAINT_SCALE : 1;
    const litS = dm ? L.litScale : 1;
    const reach = (glow && L.dark ? 2 : 1) * r * Math.max(1, litS) + 1 + L.slack;
    const j0 = whole ? 0 : lowerBound(sortedX, a / dpr - reach);
    const j1 = whole ? order.length : lowerBound(sortedX, b / dpr + reach);
    const hl = L.highlight;
    const kindsN = L.beads.length;
    const tone = L.tone;
    const mode = L.mode;
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
      for (let pass = dm ? 0 : 1; pass < 2; pass++) {
        ctx.globalAlpha = pass ? alpha : alpha * DIM_ALPHA;
        // A square lays down its bead's ink over its bead's area: at another size, the same ink, as much wider.
        const sc = pass ? litS : faintS;
        for (let strong = 0; strong < 2; strong++) {
          if (strong && !hl) break;
          for (let g = 0; g < groups.length; g++) {
            const list = groups[g];
            if (!list.length) continue;
            const k = Math.floor(g / TONES);
            const ink = k < kindsN ? (strong ? L.strongFast : L.fast)[k][g % TONES] : (strong ? L.airStrongFast : L.airFast)[k - kindsN][g % TONES];
            const side = ink.side * sc;
            ctx.fillStyle = ink.fill;
            for (let q = 0; q < list.length; q++) {
              const i = list[q];
              if (mode && mode[i] === GONE) continue;
              if (faint(i) === !!pass) continue;
              const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
              if (lit !== !!strong) continue;
              ctx.fillRect(xOf(i, now) * dpr - side / 2, yOf(i, now) * dpr - side / 2, side, side);
            }
          }
        }
      }
    } else {
      // The glow first, as one layer beneath every bead: it lights the gaps and veils no neighbour.
      if (L.halos.length) {
        const hs = sizedBeads(litS);
        for (let j = j0; j < j1; j++) {
          const i = order[j];
          if (mode && mode[i] === GONE) continue;
          if (faint(i)) continue;
          const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
          const hb = (lit ? hs.strongHalos : hs.halos)[((kinds ? kinds[i] : 0) || 0) % kindsN][tone[i]];
          ctx.drawImage(hb.img, xOf(i, now) * dpr - hb.half, yOf(i, now) * dpr - hb.half);
        }
      }
      // The highlighted dots last, so they sit over their neighbours — and the faint ones first of all.
      for (let pass = dm ? 0 : 1; pass < 2; pass++) {
        ctx.globalAlpha = pass ? alpha : alpha * DIM_ALPHA;
        const sz = sizedBeads(pass ? litS : faintS);
        for (let strong = 0; strong < 2; strong++) {
          if (strong && !hl) break;
          const set = strong ? sz.strongBeads : sz.beads;
          for (let j = j0; j < j1; j++) {
            const i = order[j];
            if (mode && mode[i] === GONE) continue;
            if (faint(i) === !!pass) continue;
            const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
            if (lit !== !!strong) continue;
            const bd = set[((kinds ? kinds[i] : 0) || 0) % kindsN][tone[i]];
            ctx.drawImage(bd.img, xOf(i, now) * dpr - bd.half, yOf(i, now) * dpr - bd.half);
          }
        }
      }
    }
    ctx.globalAlpha = alpha;
    // The marked dots, over the rest.
    if (L.marks.length && L.markInk.core) {
      for (const m of L.marks) {
        if (mode && mode[m.i] === GONE) continue;
        const ext = markExtent(r, m.big);
        const x = xOf(m.i, now);
        if (x + ext < a / dpr || x - ext > b / dpr) continue;
        drawMark(ctx, x * dpr, yOf(m.i, now) * dpr, markRadius(r, m.big) * dpr, now - m.born, dpr, L.markInk);
      }
    }
    // The named dot's ring, over the rest: which dot of the field a caption beside it is naming. Thin and
    // in the page's text colour, the ring the magnifying glass draws inside itself, for the fields it is
    // never up over — the pile, and the pile unrolled.
    if (L.ring != null && L.ring < values.length && L.textInk && (!mode || mode[L.ring] !== GONE)) {
      const x = xOf(L.ring, now);
      const ext = ringExtent(r);
      if (x + ext >= a / dpr && x - ext <= b / dpr) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = L.textInk;
        ctx.lineWidth = RING_W * dpr;
        ctx.beginPath();
        ctx.arc(x * dpr, yOf(L.ring, now) * dpr, (r + RING_GAP) * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = alpha;
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
    // The glow's copy of what was just painted: at rest only. A moving field is painted as squares every
    // frame, and its glow is faded out until it comes to rest (app.css), so nothing is copied then.
    const bloom = bloomRef.current;
    if (!fast && bloom && glow && L.dark) {
      const bctx = bloom.getContext('2d');
      if (bctx) {
        bctx.clearRect(a, 0, b - a, canvas.height);
        bctx.drawImage(canvas, a, 0, b - a, canvas.height, a, 0, b - a, canvas.height);
      }
    }
    onFrameRef.current?.();
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  // The whole field repainted in beads, nothing moved, in strips a frame each: a filter's dimming, and the
  // end of a re-stack. Strips of equal dots, not equal width: the field crowds between $40k and $80k, and
  // equal widths cost 1ms at the edges and 22ms in the middle; cut at the dots' own x quantiles, each is an
  // eighth of the work. Each strip is measured, as the animated frames are, so a test can hold it to a
  // frame's budget. A new sweep cancels the last. Dots set moving under one leave the rest of the field to
  // go back into beads with theirs, once all is still; `done` is told either way.
  const sweepRaf = useRef(0);
  const sweep = (done?: () => void) => {
    const L = live.current;
    const lay = layoutRef.current;
    cancelAnimationFrame(sweepRaf.current);
    if (!lay) { done?.(); return; }
    const { sortedX } = lay;
    const cut = (k: number) => sortedX[Math.min(sortedX.length - 1, Math.floor((k * sortedX.length) / DIM_STRIPS))];
    let k = 0;
    const step = () => {
      sweepRaf.current = 0;
      if (layoutRef.current !== lay) { done?.(); return; }
      if (L.flying > 0 || L.rings.length > 0 || L.trail.length > 0 || L.restackStart != null || L.entranceStart != null) {
        L.dirtyLo = -Infinity;
        L.dirtyHi = Infinity;
        done?.();
        return;
      }
      const t0 = performance.now();
      paintRef.current(t0, k === 0 ? -Infinity : cut(k), k === DIM_STRIPS - 1 ? Infinity : cut(k + 1), false);
      performance.measure('dim-paint', { start: t0 });
      if (++k < DIM_STRIPS) sweepRaf.current = requestAnimationFrame(step);
      else done?.();
    };
    sweepRaf.current = requestAnimationFrame(step);
  };
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  useEffect(() => () => cancelAnimationFrame(sweepRaf.current), []);

  useImperativeHandle(ref, () => ({
    drawInto(ctx, { cx, cy, R, ox, oy, dpr, map }) {
      const lay = layout;
      const L = live.current;
      if (!lay || !L.tone || !L.tones.length) return;
      const now = performance.now();
      const { order, sortedX, r } = lay;
      // Through the glass as on the field: a dimmed dot faint and smaller, and under the ones a filter
      // lights, drawn bigger.
      const dm = L.dim && L.dim.length === values.length ? L.dim : null;
      const faintS = dm ? FAINT_SCALE : 1;
      const litS = dm ? L.litScale : 1;
      const rMax = r * Math.max(1, litS);
      // This field's own x of the glass's centre; everything within its radius (plus a dot, plus how far
      // a thrown dot may be from its place).
      const fx = cx - ox;
      const all = displaced();
      const j0 = all ? 0 : lowerBound(sortedX, fx - R - rMax - L.slack);
      const j1 = all ? order.length : lowerBound(sortedX, fx + R + rMax + L.slack);
      const hl = L.highlight;
      const kindsN = L.tones.length;
      const air = !!airKinds && L.airTones.length > 0 && L.flying > 0;
      const airN = L.airTones.length;
      const kMax = Math.max(kindsN, airN, 1);
      // Beads by (air, strong, kind, tone, quarter-pixel radius), so a dot costs a lookup, not a key string.
      const beads = new Map<number, Bead>();
      ctx.save();
      for (let pass = dm ? 0 : 1; pass < 2; pass++) {
        ctx.globalAlpha = pass ? alpha : alpha * DIM_ALPHA;
        const sc = pass ? litS : faintS;
        for (let strong = 0; strong < 2; strong++) {
          if (strong && !hl) break;
          for (let j = j0; j < j1; j++) {
            const i = order[j];
            if (L.mode && L.mode[i] === GONE) continue;
            if ((!!dm && dm[i] === 1) === !!pass) continue;
            const lit = !!hl && values[i] >= hl[0] && values[i] < hl[1];
            if (lit !== !!strong) continue;
            const sx = xOfRef.current(i, now) + ox;
            const sy = yOfRef.current(i, now) + oy;
            if ((sx - cx) ** 2 + (sy - cy) ** 2 > (R + rMax) ** 2) continue;
            const m = map(sx, sy);
            const up = air && inAirRef.current(i, now);
            const k = up ? (airKinds![i] || 0) % airN : ((kinds ? kinds[i] : 0) || 0) % kindsN;
            const tone = L.tone[i];
            // Toward the rim the glass barely magnifies, and a bead there is a dot's own size: a square
            // of its ink, at a fifth of a bead's cost — most of the glass's dots are out there.
            if (m.scale < 1.6) {
              const ink = (up ? (strong ? L.airStrongFast : L.airFast) : (strong ? L.strongFast : L.fast))[k][tone];
              const side = ink.side * m.scale * sc;
              ctx.fillStyle = ink.fill;
              ctx.fillRect(m.x * dpr - side / 2, m.y * dpr - side / 2, side, side);
              continue;
            }
            // Beads come in quarter-pixel sizes, so a sweep of the glass reuses a handful of sprites.
            const q = Math.max(2, Math.round(r * sc * m.scale * dpr * 4));
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
      }
      ctx.globalAlpha = alpha;
      // The marked dots, through the glass: as much bigger as it makes them, up to two and a half times.
      if (L.marks.length && L.markInk.core) {
        for (const mk of L.marks) {
          if (L.mode && L.mode[mk.i] === GONE) continue;
          const ext = markExtent(r, mk.big);
          const sx = xOfRef.current(mk.i, now) + ox;
          const sy = yOfRef.current(mk.i, now) + oy;
          if ((sx - cx) ** 2 + (sy - cy) ** 2 > (R + ext) ** 2) continue;
          const m = map(sx, sy);
          const scale = Math.min(2.5, m.scale);
          drawMark(ctx, m.x * dpr, m.y * dpr, markRadius(r, mk.big) * scale * dpr, now - mk.born, dpr, L.markInk);
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
    positionOf(i, atRest) {
      const lay = layout;
      const L = live.current;
      if (!lay || !(i >= 0 && i < values.length) || (L.mode && L.mode[i] === GONE)) return null;
      const now = performance.now();
      const big = L.marks.some((m) => m.i === i && m.big);
      const r = markRadius(lay.r, big);
      if (atRest) return { x: lay.pts[2 * i], y: lay.pts[2 * i + 1], r };
      return { x: xOfRef.current(i, now), y: yOfRef.current(i, now), r };
    },
    markAt(x, y) {
      const lay = layout;
      const L = live.current;
      if (!lay || !L.marks.length) return null;
      const now = performance.now();
      let best: number | null = null;
      // Nearest first, so the big mark does not swallow a neighbour it merely overlaps: each mark is
      // only a candidate within its own reach.
      let bestD = Infinity;
      for (const m of L.marks) {
        if (L.mode && L.mode[m.i] === GONE) continue;
        const reach = markRadius(lay.r, m.big) * 1.6 + 4;
        const d = Math.hypot(xOfRef.current(m.i, now) - x, yOfRef.current(m.i, now) - y);
        if (d < reach && d < bestD) { bestD = d; best = m.i; }
      }
      return best;
    },
    dotR() {
      return layout?.r ?? 0;
    },
    dotAt(x, y, reach, o) {
      const lay = layout;
      const L = live.current;
      if (!lay) return null;
      const now = performance.now();
      const { order, sortedX, r } = lay;
      // Each dot as big as it is drawn: under a filter, its lit dots bigger and the rest smaller.
      const mask = L.dim && L.dim.length === values.length ? L.dim : null;
      const litR = mask ? r * L.litScale : r;
      const faintR = mask ? r * FAINT_SCALE : r;
      const rMax = Math.max(litR, faintR);
      // By the laid-out x, widened by how far a thrown dot may be from its place, as the glass reads them.
      const all = displaced();
      const j0 = all ? 0 : lowerBound(sortedX, x - reach - rMax - L.slack);
      const j1 = all ? order.length : lowerBound(sortedX, x + reach + rMax + L.slack);
      const dm = o?.litOnly ? mask : null;
      let best: number | null = null;
      let bestD = Infinity;
      for (let j = j0; j < j1; j++) {
        const i = order[j];
        if (L.mode && L.mode[i] === GONE) continue;
        if (dm && dm[i] === 1) continue;
        const d = (xOfRef.current(i, now) - x) ** 2 + (yOfRef.current(i, now) - y) ** 2;
        if (d <= ((mask && mask[i] === 1 ? faintR : litR) + reach) ** 2 && d <= bestD) { bestD = d; best = i; }
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
    let restacked = false;
    if (L.entranceStart != null) {
      if (now - L.entranceStart >= delay + (rainRef.current?.end ?? 0)) { L.entranceStart = null; setSettled(true); rainedRef.current?.(); }
      else moving = true;
      full = true;
    }
    if (L.restackStart != null) {
      if (now - L.restackStart >= RESTACK_MS) { L.restackStart = null; L.restackFrom = null; restacked = true; }
      else moving = true;
      full = true;
    }
    // A squeeze easing, or dots moving to their new places: the whole field, until they are there.
    if (L.sqStart != null || L.mvStart != null) {
      if (L.sqStart != null && now - L.sqStart >= MOVE_MS) L.sqStart = null;
      if (L.mvStart != null && now - L.mvStart >= MOVE_MS + MOVE_STAGGER) { L.mvHold = L.mvTo; L.mvStart = null; L.mvFrom = null; L.mvTo = null; }
      if (L.sqStart != null || L.mvStart != null) moving = true;
      else if (boxRef.current) boxRef.current.dataset.move = 'still';
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
      const pad = drawnR(lay.r) + 1 + L.slack;
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
    // In squares while the whole field is moving; the frame that ends the move paints it in beads — but for
    // the end of a re-stack with nothing else going, which is squares at rest and then beads a strip a frame
    // (`sweep`): the whole field in beads at once held that frame 55ms at CI's pace. Settled once in beads.
    const toBeads = restacked && !moving && L.entranceStart == null && L.sqStart == null && L.mvStart == null && L.flying === 0;
    if (full) paintRef.current(now, -Infinity, Infinity, moving || toBeads);
    if (toBeads) sweepRef.current(() => setSettled(true));
    else if (restacked) setSettled(true);
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
    // The mask this layout was made with, before anything is painted: a filter that settles its dots lays
    // the field out again, and the dim effect, which runs after this one, would leave its first frame in the
    // mask before.
    L.dim = dim;
    L.litScale = litGrowth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(lay.width * dpr);
    canvas.height = Math.round(height * dpr);
    if (bloomRef.current) { bloomRef.current.width = canvas.width; bloomRef.current.height = canvas.height; }
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
    L.textInk = text;
    // The page's own colour, which a hue variant must keep its contrast against.
    const card = rimRef.current ? getComputedStyle(rimRef.current).color : (L.dark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
    const look: DotLook = !rich ? LOOK_PLAIN : L.dark ? LOOK_DARK : LOOK_LIGHT;
    const shade = (c: string) => dotTones(c, text, card, look);
    L.tones = L.ink.map(shade);
    L.strongTones = L.strong.map(shade);
    const rd = lay.r * dpr;
    L.rd = rd;
    // A filter's sizes are kept while the beads they scale are the same: a new layout of the same field (a
    // filter settling its dots, a re-stack) needs none made again.
    const sizedFor = `${rd}|${L.ink.join('|')}|${L.dark}|${glow}|${rich}`;
    if (sizedFor !== L.sizedFor) { L.sized.clear(); L.sizedFor = sizedFor; }
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
    L.airTones = airInk.map(shade);
    L.airStrongTones = airInk.map((c) => shade(strongerInk(c, text, STRONG_APART)));
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
    // Each dot's tone: its depth in the stack — deeper toward the bottom on a light page, brighter toward
    // the top on a dark one — give or take a step; the rim if it crowns its column; and its hue variant.
    const n = values.length;
    const tone = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const lit = L.dark ? lay.depth[i] : 1 - lay.depth[i];
      const step = rich && lay.crest[i] ? DEPTH_STEPS : Math.min(DEPTH_STEPS - 1, Math.max(0, Math.round(lit * (DEPTH_STEPS - 1)) + jitter(i)));
      tone[i] = step * HUES + hueOf(i);
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
    const restacked = sameField && prevStack.current !== stacking;
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
    prevStack.current = stacking;
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
      // From where each dot is drawn now to its slot in the new stacking, up or down its own column — a
      // dot still swinging from a burst sets off from its swing, not from its old place.
      const from = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) from[i] = prev.pts[2 * i + 1] + (oldOff ? oldOff[i] : 0);
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
    // The sizes a filter draws its dots in, made ahead a kind at a time in idle moments, so its first
    // repaint need not stop to make them.
    const ahead: number[] = [FAINT_SCALE, ...LIT_SIZES];
    const idle = typeof window.requestIdleCallback === 'function';
    let job = 0;
    const work = (dl?: IdleDeadline) => {
      job = 0;
      do { if (sizedStep(ahead[0])) ahead.shift(); } while (ahead.length && dl && dl.timeRemaining() > 4);
      if (ahead.length) job = idle ? window.requestIdleCallback(work) : window.setTimeout(work, 50);
    };
    job = idle ? window.requestIdleCallback(work) : window.setTimeout(work, 50);
    return () => {
      if (L.raf) { cancelAnimationFrame(L.raf); L.raf = 0; }
      if (job) { if (idle) window.cancelIdleCallback(job); else window.clearTimeout(job); }
    };
    // `scheme` is read through getComputedStyle, which is why a theme change must re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, height, entrance, kinds, inks, airInks, scheme, glow, rich, solo]);

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
    const x0 = Math.min(a?.[0] ?? Infinity, b?.[0] ?? Infinity) - drawnR(lay.r) - 1;
    const x1 = Math.max(a?.[1] ?? -Infinity, b?.[1] ?? -Infinity) + drawnR(lay.r) + 1;
    // While dots move, in squares like the strips round it — a bead strip there flickered against
    // them — and back in beads with the rest once all is still.
    const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0;
    paintRef.current(performance.now(), x0, x1, busy);
    if (busy) { L.dirtyLo = Math.min(L.dirtyLo, x0); L.dirtyHi = Math.max(L.dirtyHi, x1); }
  }, [hlLo, hlHi, layout, toX]);


  // The dimming: the whole field repainted, nothing moved — in strips, a frame each. A field of 22k beads
  // takes about 55ms to repaint whole at CI's pace, three frames and more held up at once; `DIM_STRIPS`
  // strips each fit a frame, and read as the dimming passing across the field in about a tenth of a second.
  // Whole and at once where strips would not help: dots in the air are being repainted every frame anyway,
  // a field drawn away from its places (the pile unrolled, a squeeze) is only ever repainted whole, and
  // under Reduce Motion a sweep is motion.
  const dimWas = useRef<Uint8Array | null>(null);
  const dimLayout = useRef<typeof layout>(null);
  useEffect(() => {
    const L = live.current;
    L.dim = dim;
    L.litScale = litGrowth;
    const lay = layout;
    // Only a change in which dots are faint repaints here. A new layout is painted by the field itself, the
    // mask set first (the layout effect) — a filter that settles its dots lays the field out again — and the
    // same mask again, rebuilt with the same people in, changes nothing. Sweeping on those too repainted the
    // whole field twice over on the way into full page, mask or none.
    const fresh = dimLayout.current !== lay;
    dimLayout.current = lay;
    const was = dimWas.current;
    dimWas.current = dim;
    if (was === dim || (!!was && !!dim && was.length === dim.length && was.every((v, i) => v === dim[i]))) return;
    if (fresh || !lay || L.entranceStart != null || L.restackStart != null) return;
    const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0;
    if (busy || displaced() || prefersReducedMotion() || document.hidden) {
      cancelAnimationFrame(sweepRaf.current);
      const t0 = performance.now();
      paintRef.current(t0, -Infinity, Infinity, busy);
      performance.measure('dim-paint', { start: t0 });
      return;
    }
    sweep();
    return () => cancelAnimationFrame(sweepRaf.current);
    // `displaced` and `sweep` read the live state, not props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim, layout, litGrowth]);
  // Which dots are lit, as a fingerprint a test can rebuild from its own list: how many, and the sum and the
  // sum of squares of their indices — exact in a double for any field this size.
  const litPrint = useMemo(() => {
    if (!dim || dim.length !== values.length) return null;
    let n = 0, sum = 0, sq = 0;
    for (let i = 0; i < dim.length; i++) if (!dim[i]) { n++; sum += i; sq += i * i; }
    return `${n}:${sum}:${sq}`;
  }, [dim, values.length]);

  // The squeeze: from however wide the field is drawn now to the new width.
  useEffect(() => {
    const L = live.current;
    if (squeeze === L.sqTo && L.sqStart == null) return;
    const now = performance.now();
    L.sqFrom = squeezeAt(now);
    L.sqTo = squeeze;
    if (!layoutRef.current) return;
    if (prefersReducedMotion() || document.hidden) {
      L.sqStart = null;
      paintRef.current(now);
      return;
    }
    L.sqStart = now;
    if (boxRef.current) boxRef.current.dataset.move = 'moving';
    kickRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squeeze]);

  // A move: the first places given are simply where the dots start; each new key sends them from where they
  // are drawn to the places given, or home.
  const moveKey = moveTo?.key ?? null;
  const movePts = moveTo?.pts ?? null;
  useEffect(() => {
    const L = live.current;
    if (moveKey === L.mvKey) return;
    const first = L.mvKey == null;
    L.mvKey = moveKey;
    const lay = layoutRef.current;
    const now = performance.now();
    if (!lay || first || moveKey == null || prefersReducedMotion() || document.hidden) {
      L.mvStart = null;
      L.mvFrom = null;
      L.mvTo = null;
      L.mvHold = moveKey == null ? null : movePts;
      if (lay) paintRef.current(now);
      if (boxRef.current) boxRef.current.dataset.move = 'still';
      return;
    }
    const n = values.length;
    const from = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      from[2 * i] = xOfRef.current(i, now) - (L.offX ? L.offX[i] : 0);
      from[2 * i + 1] = yOfRef.current(i, now) - (L.off ? L.off[i] : 0);
    }
    L.mvFrom = from;
    L.mvTo = movePts;
    L.mvStart = now;
    L.mvHold = null;
    if (boxRef.current) boxRef.current.dataset.move = 'moving';
    kickRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, layout]);

  // The marks: repaint where one went or came, and draw each arrival (its growth and its ring) in the
  // strip round it until it is done.
  const markKey = marks ? marks.join(',') : '';
  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    const still = prefersReducedMotion();
    const was = new Map(L.marks.map((m) => [m.i, m]));
    const next = (markKey ? markKey.split(',').map(Number) : []).filter((i) => i >= 0 && i < values.length);
    // A mark that was already there keeps when it arrived — it should not pulse again because another
    // one grew — but it takes its size from the list as it is now: the big one moves with the picking.
    const wasBig = L.marks.find((m) => m.big)?.i ?? null;
    L.marks = next.map((i) => ({ ...(was.get(i) ?? { i, born: still ? -Infinity : now }), big: i === markBig }));
    const lay = layoutRef.current;
    if (!lay) return;
    // The widest a mark reaches, so growing or shrinking one repaints the whole strip it covered.
    const ext = markExtent(lay.r, true);
    const strip = (i: number, t: number) => {
      const x = xOfRef.current(i);
      const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0 || L.entranceStart != null || L.restackStart != null;
      paintRef.current(t, x - ext, x + ext, busy);
      if (busy) { L.dirtyLo = Math.min(L.dirtyLo, x - ext); L.dirtyHi = Math.max(L.dirtyHi, x + ext); }
    };
    const kept = new Set(next);
    for (const [i] of was) if (!kept.has(i)) strip(i, now);
    for (const m of L.marks) if (!was.has(m.i)) strip(m.i, now);
    // The two that changed size where they stand: the one that was big, and the one that is now.
    for (const i of [wasBig, markBig]) if (i != null && kept.has(i) && was.has(i)) strip(i, now);
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
  }, [markKey, markBig, layout]);
  useEffect(() => () => { const L = live.current; if (L.markRaf) { cancelAnimationFrame(L.markRaf); L.markRaf = 0; } }, []);

  // The ring goes from dot to dot with the pointer: the dot it has left and the dot it is on are both
  // repainted, or the one it left keeps its ring until something else repaints that strip.
  useEffect(() => {
    const L = live.current;
    const next = ring != null && ring >= 0 && ring < values.length ? ring : null;
    const was = L.ring;
    if (was === next) return;
    L.ring = next;
    const lay = layoutRef.current;
    if (!lay) return;
    const ext = ringExtent(lay.r) + 1;
    const now = performance.now();
    const busy = L.flying > 0 || L.rings.length > 0 || L.trail.length > 0 || L.entranceStart != null || L.restackStart != null;
    for (const i of [was, next]) {
      if (i == null) continue;
      const x = xOfRef.current(i);
      paintRef.current(now, x - ext, x + ext, busy);
      if (busy) { L.dirtyLo = Math.min(L.dirtyLo, x - ext); L.dirtyHi = Math.max(L.dirtyHi, x + ext); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, values.length, layout]);

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
      data-glow={glow || undefined}
      data-look={rich ? 'rich' : 'plain'}
      data-kinds={kindCounts}
      data-stack={stack ? 'on' : 'off'}
      data-highlight={hlLo != null ? lit : undefined}
      data-dimmed={dimmed ?? undefined}
      data-lit={litPrint ?? undefined}
      data-solo={solo ?? 'none'}
      data-marks={marks?.length ? marks.map((i) => (layout && i >= 0 && i < values.length ? `${i}:${layout.pts[2 * i].toFixed(1)}:${layout.pts[2 * i + 1].toFixed(1)}` : `${i}`)).join(' ') : undefined}
      data-mark-big={markBig != null && marks?.includes(markBig) ? markBig : undefined}
      data-mark-r={layout && marks?.length ? markRadius(layout.r).toFixed(2) : undefined}
      aria-hidden
    >
      <canvas ref={canvasRef} className="dot-field-ink" style={{ position: 'absolute', inset: 0, width: '100%', height }} />
      {/* After the ink in the page, so the ink stays the field's first canvas, and drawn beneath it (app.css). */}
      {glow && <canvas ref={bloomRef} className="dot-field-bloom" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height }} />}
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
