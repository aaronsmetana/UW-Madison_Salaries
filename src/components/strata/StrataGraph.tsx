import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon, Button, CloseButton, FocusTrap, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowBarToDown, IconArrowsMaximize, IconPlayerPauseFilled, IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { COLS, READ_RADIUS, arcHeight, placePins, shareAt, strataFromCounts, within, type Strata, type StrataCounts } from '../../lib/strata';
import { StrataField, LENS_R, colTopY, layoutStrata, payX, useEntranceOnce, type Dim, type Follow, type LensHit, type Spot, type Step, type StrataFieldHandle, type StrataLayout } from './StrataField';
import { bigMoves, snapStats, strataFromPeople, type Timeline, type TimelineStrata } from '../../lib/timeline';
import { medianOf } from '../../lib/homePeople';
import { measureText, placeNearLabels } from '../../lib/labelLayout';
import { prefersReducedMotion } from '../../lib/motion';
import { fmtK } from '../../lib/chartStyle';
import { num, usd, vsCampus } from '../../lib/format';
import { ordinal } from '../../lib/stats';
import { useReveal } from '../PersonReveal';
import type { ShownPerson } from '../SearchBox';
import type { Emphasis } from '../../lib/homePeople';
import { Z } from '../../lib/layers';
import { ICON } from '../../lib/ui';

/**
 * The landing graph (mockup 3a, "strata + lens"): everyone paid, one square each, in $1k columns stacked by
 * employment type (StrataField), under percentile pins and over a salary axis with the middle half marked;
 * a lens that magnifies where the pointer is, with a readout and the person under it; a filter that lights
 * its own people where they stand and fades the rest; the pile past the cap, which unrolls to show each of
 * its people at their own pay on an axis run out to the top salary; and the page's full-page view of it.
 */

/** Each staff category's ink (app.css, one per scheme). By name, so a type keeps its colour in any order. */
const CATEGORY_INK: Record<string, string> = {
  'Academic Staff': 'var(--cat-academic)',
  'University Staff': 'var(--cat-university)',
  Faculty: 'var(--cat-faculty)',
  'Employees in Training': 'var(--cat-training)',
  Limited: 'var(--cat-limited)',
};
export const categoryInk = (name: string) => CATEGORY_INK[name] ?? 'var(--cat-other)';

/** The plot's height on a phone, and wider: a wide plot grows with its width (PLOT_ASPECT) up to `most`. */
const PLOT_H = { phone: 300, wide: 400, most: 520 };
const PLOT_ASPECT = 0.3;
/** The pins' labels: three rows over the skyline, this tall each, and the room under them. */
const PIN_ROW = 17;
const PIN_ROWS = 3;
const PIN_BAND = PIN_ROWS * PIN_ROW + 6;
const PIN_FONT = 13;
/** An axis label's least pitch, CSS px. */
const AXIS_LABEL_W = 56;
const TICK_STEPS = [25_000, 50_000, 100_000];
/** Full page: the room kept round the panel, and how long it grows and shrinks. */
const FULL_PAD = { phone: 8, wide: 16 };
const FULL_MS = 240;
const PANEL_RADIUS = 16;
/** A held finger: how long before the lens comes up, and how far above the finger it then sits. */
const HOLD_MS = 450;
const HOLD_LIFT = 28;
/** The person card's width, CSS px. */
const CARD_W = 272;
const CARD_H = 150;
/** A search's people named on the graph: the label's line, its padding, its widest, its type size. */
const FOUND_LABEL = { h: 19, pad: 16, maxW: 180, font: 12 } as const;
/** Unrolled, the readout counts the people this far either side of the pay under the lens. */
const TAIL_READ = 25_000;
/** A pay on the unrolled tail's axis: millions as millions. */
const fmtTail = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : fmtK(v));

/** The timeline under the plot (lib/timeline): the snapshots, oldest first; everyone in each once asked for;
 *  and who each one is in a snapshot, by key, once its names are asked for. */
export interface GraphTimeline {
  snaps: readonly { id: string; label: string }[];
  data: Timeline | 'loading' | 'error' | null;
  onWant: () => void;
  names: { snap: number; who: ReadonlyMap<string, { name: string; title: string | null; school: string | null }> } | null;
  onWantNames: (snap: number) => void;
}
/** A snapshot's label without its note: "Nov 2021 (Pre-TTC)" is "Nov 2021" at the track's end. */
const bareLabel = (l: string) => l.replace(/\s*\(.*\)\s*$/, '');
/** Play waits this long between steps, and longer after starting over from the first. */
const PLAY_MS = 600;
const PLAY_RESTART_MS = 800;

/** Whose a square is, as the lens's card names them. */
export interface DotWho {
  key: string;
  name: string;
  title: string | null;
  school: string | null;
  pay: number | null;
  /** Their pay in the snapshot before: null if they were not in it, undefined where that is not known. */
  prev?: number | null;
  /** That snapshot's name ("Mar 2026"). */
  prevLabel?: string;
  /** 1 + how many are paid more, of `total`. */
  rank?: number;
  total?: number;
}
export type WhoIs = (field: 'main' | 'pile', index: number) => DotWho | null;
/** A person the search is showing who is on the graph: where their square is. */
export interface FoundPerson extends ShownPerson { spot: Spot }
/** The group a filter picks out: its name, and — once its people are in — which squares it lights. */
export type GraphGroup = { name: string; pending: true } | ({ name: string; pending: false } & Emphasis);

/**
 * The keyframes that grow a full-page panel out of its place on the page (`from`) into the box it fills
 * (`to`): moved over `from` and clipped to its size, then opened out — never scaled, which would skew every
 * measurement inside it while it played.
 */
function flipFrames(from: DOMRect, to: DOMRect): Keyframe[] {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const cx = Math.max(0, (to.width - from.width) / 2);
  const cy = Math.max(0, (to.height - from.height) / 2);
  return [
    { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(${cy}px ${cx}px ${cy}px ${cx}px round ${PANEL_RADIUS}px)` },
    { transform: 'none', clipPath: `inset(0px 0px 0px 0px round ${PANEL_RADIUS}px)` },
  ];
}

const NO_FOUND: FoundPerson[] = [];
const NO_SNAPS: GraphTimeline['snaps'] = [];

/** Everyone from the $1k bins alone (an older snapshot, drawn through live SQL): one kind, no pile types. */
function strataFromBins(bins: readonly { bucket: number; n: number }[], overflow: number): Strata | null {
  if (!bins.length) return null;
  const lo100 = Math.floor(bins[0].bucket / 100);
  const counts: number[] = [];
  for (const b of bins) {
    const at = Math.floor(b.bucket / 100) - lo100;
    while (counts.length < at) counts.push(0);
    counts.push(b.n);
  }
  const pc: StrataCounts = { lo100, counts, categories: [{ name: 'Everyone', over: overflow, counts }] };
  return strataFromCounts(pc);
}

export function StrataGraph({
  bins, payCounts, p25: p25Base, median: medianBase, p75: p75Base, cap, overflow, headcount: headcountBase, snapshotLabel: labelBase,
  found: foundBase = NO_FOUND, activeKey = null, openRef, search, onFullChange, group = null, previewing = false, onClearGroup, onPeel,
  openFullRef, whoIs: whoIsBase = null, onWantWho, searchOpenRef, timeline = null,
}: {
  bins: readonly { bucket: number; n: number }[];
  payCounts?: StrataCounts | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  cap: number | null;
  overflow: number | null;
  headcount: number | null;
  snapshotLabel?: string | null;
  /** The people the search is showing who are on the graph: their squares are marked. */
  found?: FoundPerson[];
  /** The person the search list is on: their name is shown over their square. */
  activeKey?: string | null;
  /** Set to open a found person from their square (the search's pick calls it); false if not shown. */
  openRef?: MutableRefObject<((key: string) => boolean) | null>;
  /** The full page's own search box. */
  search?: ReactNode;
  onFullChange?: (full: boolean) => void;
  /** What a filter picks out: its people are lit where they stand and the rest fade. */
  group?: GraphGroup | null;
  /** The group is a row the reader is resting on in the search's list: shown, but not yet a filter to take off. */
  previewing?: boolean;
  /** Takes the group off (the toolbar chip's ×); absent where the group cannot be taken off here. */
  onClearGroup?: () => void;
  /** Asked first when Escape would close full page: true if it took a filter off instead. */
  onPeel?: () => boolean;
  openFullRef?: MutableRefObject<(() => void) | null>;
  /** Whose a square is: 'loading' until the page has looked them up, which it does when first asked. */
  whoIs?: WhoIs | 'loading' | null;
  onWantWho?: () => void;
  /** True while the full page's search has its list open over the graph: a press then only puts it away. */
  searchOpenRef?: MutableRefObject<boolean>;
  timeline?: GraphTimeline | null;
}) {
  const phone = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  const canHover = useMediaQuery('(hover: hover)', true, { getInitialValueInEffect: false }) ?? true;
  const motion = !prefersReducedMotion();
  // The drop plays once, as the page opens: going full page draws the field afresh, and it is simply there.
  const entrance = useEntranceOnce();
  const droppedRef = useRef(false);
  const reveal = useReveal();
  const [dpr] = useState(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

  const baseStrata = useMemo(
    () => (payCounts?.counts.length ? strataFromCounts(payCounts) : null) ?? strataFromBins(bins, overflow ?? 0),
    [payCounts, bins, overflow],
  );

  // ── The timeline (lib/timeline) ──
  // The snapshot shown, by its place in `snaps`: null for the latest as the page opens, drawn from the counts.
  // Once the timeline is asked for, every snapshot — the latest too — is drawn from its people, so a step can
  // carry each person from one to the next.
  const snaps = timeline?.snaps ?? NO_SNAPS;
  const lastSnap = snaps.length - 1;
  const tl = timeline && typeof timeline.data === 'object' ? timeline.data : null;
  const [at, setAt] = useState<number | null>(null);
  // Where the last step set off from, for its big movers (neighbours only).
  const [stepFrom, setStepFrom] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Paused part way through playing: Play then reads "Resume".
  const [paused, setPaused] = useState(false);
  // A snapshot asked for before the timeline was in, or before the field had been drawn from people.
  const [goal, setGoal] = useState<{ to: number; play: boolean } | null>(null);
  const restartRef = useRef(false);
  const cacheRef = useRef<{ tl: Timeline | null; by: Map<number, TimelineStrata> }>({ tl: null, by: new Map() });
  const tStrata = useMemo(() => {
    if (!tl || at == null) return null;
    if (cacheRef.current.tl !== tl) cacheRef.current = { tl, by: new Map() };
    let st = cacheRef.current.by.get(at);
    if (!st) cacheRef.current.by.set(at, (st = strataFromPeople(tl.at[at], tl.names, cap ?? 250_000)));
    return st;
  }, [tl, at, cap]);
  const strata: Strata | null = tStrata ?? baseStrata;
  const stats = useMemo(() => (tl && at != null ? snapStats(tl.at[at], tl.names.length, cap ?? 250_000) : null), [tl, at, cap]);
  const p25 = stats ? stats.p25 : p25Base;
  const median = stats ? stats.median : medianBase;
  const p75 = stats ? stats.p75 : p75Base;
  const headcount = stats ? stats.headcount : headcountBase;
  const snapshotLabel = at != null ? snaps[at]?.label ?? labelBase : labelBase;
  // The legend's types, each with its people and median: the counts' for the latest, the snapshot's own after.
  // `kind` is the type's place in the field's names, which the legend isolates by.
  const cats = useMemo(() => {
    if (stats && tl) return tl.names.map((name, kind) => ({ name, kind, n: stats.byKind[kind].n, median: stats.byKind[kind].median })).filter((c) => c.n > 0);
    return payCounts?.categories?.length
      ? payCounts.categories.map((c, kind) => ({ name: c.name, kind, n: (c as { n?: number }).n ?? 0, median: (c as { median?: number }).median ?? null }))
      : null;
  }, [stats, tl, payCounts]);
  const kindInks = useMemo(() => (strata?.names ?? []).map((n) => (n === 'Everyone' ? 'var(--mantine-color-accent-6)' : categoryInk(n))), [strata]);
  const total = headcount ?? (strata ? strata.col.length + strata.pileKind.length : 0);
  // Each person's square in the snapshot shown: by their number, 1 + index under the cap, −1 − index in the pile.
  const keyId = useMemo(() => (tl ? new Map(tl.keys.map((k, i) => [k, i])) : null), [tl]);
  const whereOf = useMemo(() => {
    if (!tStrata || !tl) return null;
    const w = new Int32Array(tl.keys.length);
    tStrata.mainId.forEach((id, i) => { w[id] = i + 1; });
    tStrata.pileId.forEach((id, j) => { w[id] = -(j + 1); });
    return w;
  }, [tStrata, tl]);
  const spotOfKey = useCallback((key: string): Spot | null => {
    const id = keyId?.get(key);
    if (id == null || !whereOf) return null;
    const v = whereOf[id];
    return v > 0 ? { field: 'main', index: v - 1 } : v < 0 ? { field: 'pile', index: -v - 1 } : null;
  }, [keyId, whereOf]);
  // The search's people, where they are in the snapshot shown (and not marked in one they were not in).
  const found = useMemo(
    () => (tStrata ? foundBase.flatMap((f) => { const sp = spotOfKey(f.person_key); return sp ? [{ ...f, spot: sp }] : []; }) : foundBase),
    [tStrata, foundBase, spotOfKey],
  );

  // ── Following a person (3a §9) ──
  // A click on someone's square follows them: by their key, so they are found in any snapshot — and in the
  // latest drawn from the counts, which carry no names, by the square clicked.
  const [follow, setFollow] = useState<{ key: string; name: string; title: string | null; spot: Spot; pay: number | null } | null>(null);
  const followId = follow && keyId ? keyId.get(follow.key) ?? null : null;
  const followSpot = useMemo<Spot | null>(() => (follow ? (tStrata ? spotOfKey(follow.key) : follow.spot) : null), [follow, tStrata, spotOfKey]);
  const toggleFollow = (who: DotWho, spot: Spot) =>
    setFollow((f) => (f?.key === who.key ? null : { key: who.key, name: who.name, title: who.title, spot, pay: who.pay }));

  // The plot's width, measured; its height grows with it.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(0);
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setPlotW((w) => (Math.abs(w - el.clientWidth) < 0.5 ? w : el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [full, setFull] = useState(false);
  const [fullH, setFullH] = useState(0);
  const [pageH, setPageH] = useState(0);
  const baseH = phone ? PLOT_H.phone : Math.round(Math.min(PLOT_H.most, Math.max(PLOT_H.wide, plotW * PLOT_ASPECT)));
  const H = full && fullH > 0 ? fullH : baseH;

  // A type picked out by its chip in the legend: its people lit, the rest faded.
  const [solo, setSolo] = useState<number | null>(null);
  const litBase = group && !group.pending ? group : null;
  // A group is its people: in another snapshot, they are lit wherever they stand then (and not at all in one
  // they were not in), and counted and their median taken there.
  const lit = useMemo(() => {
    if (!litBase || !tStrata || !tl || !keyId) return litBase;
    const ids = new Uint8Array(tl.keys.length);
    for (const k of litBase.keys) { const id = keyId.get(k); if (id != null) ids[id] = 1; }
    const main = new Uint8Array(tStrata.col.length), pile = new Uint8Array(tStrata.pileKind.length);
    const pays: number[] = [];
    tStrata.mainId.forEach((id, i) => { main[i] = ids[id] ? 0 : 1; if (ids[id]) pays.push(tStrata.mainPay[i]); });
    tStrata.pileId.forEach((id, j) => { pile[j] = ids[id] ? 0 : 1; if (ids[id]) pays.push(tStrata.pilePay![j]); });
    pays.sort((a, b) => a - b);
    return { ...litBase, main, pile, count: pays.length, median: medianOf(pays), pays };
  }, [litBase, tStrata, tl, keyId]);
  const dim = useMemo<Dim | null>(() => {
    if (!strata || (!lit && solo == null)) return null;
    const main = new Uint8Array(strata.col.length), pile = new Uint8Array(strata.pileKind.length);
    for (let i = 0; i < main.length; i++) main[i] = (lit ? lit.main[i] ?? 1 : 0) | (solo != null && strata.kind[i] !== solo ? 1 : 0);
    for (let j = 0; j < pile.length; j++) pile[j] = (lit ? lit.pile[j] ?? 1 : 0) | (solo != null && strata.pileKind[j] !== solo ? 1 : 0);
    return { main, pile };
  }, [strata, lit, solo]);
  // The pile unrolled: its people at their own pay, the graph squeezed to its share of an axis to the top salary.
  const canUnroll = !!strata?.pilePay;
  const [unrolled, setUnrolled] = useState(false);
  useEffect(() => { if (!canUnroll) setUnrolled(false); }, [canUnroll]);
  const layout = useMemo(
    () => (strata && plotW > 0 ? layoutStrata(strata, { W: plotW, H, top: PIN_BAND + 4, dpr, phone }, unrolled && canUnroll) : null),
    [strata, plotW, H, dpr, phone, unrolled, canUnroll],
  );
  const tail = layout?.tail ?? null;

  // A step's big movers (lib/timeline `bigMoves`), between neighbouring snapshots only: by person, +1 or −1.
  const moves = useMemo(
    () => (tl && at != null && stepFrom != null && Math.abs(at - stepFrom) === 1 ? bigMoves(tl.at[stepFrom], tl.at[at], tl.keys.length) : null),
    [tl, at, stepFrom],
  );
  const movers = useMemo(() => { if (!moves) return null; let k = 0; for (const v of moves) if (v) k++; return k; }, [moves]);
  // Drawn on top in the up and down inks, and left so once the step is done, until the next.
  const hues = useMemo(() => (moves && tStrata
    ? { main: Int8Array.from(tStrata.mainId, (id) => moves[id]), pile: Int8Array.from(tStrata.pileId, (id) => moves[id]) }
    : null), [moves, tStrata]);
  // The step onto this layout: each person from their place in the one shown before (a joiner from above the
  // plot), the big movers arcing, who left lifting out. Only between two snapshots drawn from people; anything
  // else — the first time from the counts, a resize — is a layout of the same people, or simply there.
  const shownRef = useRef<{ layout: StrataLayout; strata: Strata } | null>(null);
  const step = useMemo<Step | null>(() => {
    const was = shownRef.current;
    if (!layout || !was || !tl || !tStrata || was.strata === tStrata || !('mainId' in was.strata)) return null;
    const A = was.strata as TimelineStrata, L0 = was.layout, B = tStrata, L1 = layout;
    const N = tl.keys.length;
    const ox = new Float64Array(N).fill(NaN), oy = new Float64Array(N);
    A.mainId.forEach((id, i) => { ox[id] = L0.mx[i]; oy[id] = L0.my[i]; });
    A.pileId.forEach((id, j) => { ox[id] = L0.px[j]; oy[id] = L0.py[j]; });
    const stays = new Uint8Array(N);
    let seed = 0x5bd1e995 ^ (at ?? 0);
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const place = (ids: Int32Array, X: Float64Array) => {
      const fx = new Float64Array(ids.length), fy = new Float64Array(ids.length), arc = new Float32Array(ids.length);
      ids.forEach((id, i) => {
        stays[id] = 1;
        if (Number.isNaN(ox[id])) { fx[i] = X[i]; fy[i] = -14 - rand() * 60; return; }
        fx[i] = ox[id];
        fy[i] = oy[id];
        // A big mover arcs, and the person followed always does.
        if (moves?.[id] || id === followId) arc[i] = arcHeight(X[i] - ox[id]);
      });
      return { fx, fy, arc };
    };
    const mm = place(B.mainId, L1.mx), pp = place(B.pileId, L1.px);
    const gx: number[] = [], gy: number[] = [], gk: number[] = [];
    A.mainId.forEach((id, i) => { if (!stays[id]) { gx.push(L0.mx[i]); gy.push(L0.my[i]); gk.push(A.kind[i]); } });
    A.pileId.forEach((id, j) => { if (!stays[id]) { gx.push(L0.px[j]); gy.push(L0.py[j]); gk.push(A.pileKind[j]); } });
    return {
      to: L1,
      from: { mx: mm.fx, my: mm.fy, px: pp.fx, py: pp.fy },
      arc: moves || followId != null ? { main: mm.arc, pile: pp.arc } : null,
      ghosts: { x: Float64Array.from(gx), y: Float64Array.from(gy), kind: Uint8Array.from(gk) },
    };
    // `shownRef` is the layout drawn before this one: read, not a dependency.
  }, [layout, tl, tStrata, moves, at, followId]);
  useEffect(() => { if (layout && strata) shownRef.current = { layout, strata }; }, [layout, strata]);
  // Go to a snapshot. The first time, the field is first drawn from the latest's people where it stands (no
  // one moves: the same people in the same columns), and the step taken from there.
  const goTo = useCallback((to: number, play = false) => {
    if (!timeline || to < 0 || to > lastSnap) return;
    if (!tl) { timeline.onWant(); setGoal({ to, play }); return; }
    if (at == null) { setAt(lastSnap); setGoal({ to, play }); return; }
    setStepFrom(at);
    setAt(to);
    if (play) setPlaying(true);
  }, [timeline, tl, at, lastSnap]);
  // The timeline in, or the field drawn from the latest's people: on to the snapshot asked for.
  useEffect(() => {
    if (!goal || !tl) return;
    if (at == null) { setAt(lastSnap); return; }
    if (shownRef.current?.strata !== tStrata) return;
    setGoal(null);
    if (goal.to !== at) { setStepFrom(at); setAt(goal.to); }
    if (goal.play) setPlaying(true);
  }, [goal, tl, at, lastSnap, tStrata, layout]);
  // Play: a step every PLAY_MS (longer after starting over from the first), to the latest, then stop.
  useEffect(() => {
    if (!playing || at == null || goal) return;
    if (at >= lastSnap) { setPlaying(false); return; }
    const wait = restartRef.current ? PLAY_RESTART_MS : PLAY_MS;
    const t = window.setTimeout(() => { restartRef.current = false; setStepFrom(at); setAt(at + 1); }, wait);
    return () => window.clearTimeout(t);
  }, [playing, at, goal, lastSnap]);
  const onPlay = () => {
    if (playing) { setPlaying(false); setPaused(true); return; }
    setPaused(false);
    // At the latest (or not yet started), from the first again.
    if (at == null || at >= lastSnap) { restartRef.current = true; goTo(0, true); return; }
    setPlaying(true);
  };
  // What the field draws for them: their square in the snapshot shown, their pay there, and — carried by a
  // step from a neighbouring snapshot — their pay there, which the label counts from and gives the change since.
  const followProp = useMemo<Follow | null>(() => {
    if (!follow || !followSpot) return null;
    const pay = tStrata ? (followSpot.field === 'main' ? tStrata.mainPay[followSpot.index] : tStrata.pilePay![followSpot.index]) : follow.pay;
    let from: number | null = null;
    if (tl && at != null && stepFrom != null && Math.abs(stepFrom - at) === 1 && followId != null) {
      const p = tl.at[stepFrom];
      for (let r = 0; r < p.id.length; r++) if (p.id[r] === followId) { from = p.pay[r]; break; }
    }
    return { ...followSpot, name: follow.name, pay, from };
  }, [follow, followSpot, tStrata, tl, at, stepFrom, followId]);
  const fieldRef = useRef<StrataFieldHandle>(null);
  useEffect(() => { if (layout) droppedRef.current = true; }, [layout]);
  const [moving, setMoving] = useState(false);
  const [replay, setReplay] = useState(0);

  // What a filter lights: how many, their median, against campus — the group's own, a type's, or both.
  const filterStats = useMemo(() => {
    if (!strata || !dim) return null;
    if (solo != null && !lit) {
      const c = cats?.find((x) => x.kind === solo);
      return { name: strata.names[solo], count: c?.n ?? 0, median: c?.median ?? null, ink: kindInks[solo] };
    }
    if (lit && solo == null) return { name: group!.name, count: lit.count, median: lit.median, ink: 'var(--strata-match)' };
    // Both: those lit by each, at their column's pay.
    const pays: number[] = [];
    for (let i = 0; i < dim.main.length; i++) if (!dim.main[i]) pays.push(strata.col[i] * 1000 + 500);
    let over = 0;
    for (let j = 0; j < dim.pile.length; j++) if (!dim.pile[j]) over++;
    pays.sort((a, b) => a - b);
    const all = pays.length + over;
    const mid = all ? (all % 2 ? (all - 1) / 2 : all / 2) : -1;
    const med = mid < 0 ? null : mid < pays.length ? pays[mid] : cap;
    return { name: `${group!.name} · ${strata.names[solo!]}`, count: all, median: med, ink: 'var(--strata-match)' };
  }, [strata, dim, solo, lit, group, cats, kindInks, cap]);

  // Whose a square is: the page's names for the latest drawn from the counts; in a snapshot drawn from people,
  // that snapshot's names, its pay, the pay in the snapshot before, and the rank among its people.
  const wantNames = timeline?.onWantNames;
  const prevPay = useMemo(() => {
    if (!tl || at == null || at === 0) return null;
    const p = tl.at[at - 1], out = new Float64Array(tl.keys.length);
    for (let r = 0; r < p.id.length; r++) out[p.id[r]] = p.pay[r];
    return out;
  }, [tl, at]);
  const desc = useMemo(() => (tl && at != null ? Float64Array.from(tl.at[at].pay).sort().reverse() : null), [tl, at]);
  const namesHere = timeline?.names && at != null && timeline.names.snap === at ? timeline.names.who : null;
  const whoIs: WhoIs | 'loading' | null = useMemo(() => {
    if (!tStrata || !tl || at == null || whoIsBase == null) return whoIsBase;
    if (!namesHere || !desc) return 'loading';
    const above = (v: number) => { let lo = 0, hi = desc.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (desc[mid] > v) lo = mid + 1; else hi = mid; } return lo; };
    return (field, index) => {
      const id = field === 'main' ? tStrata.mainId[index] : tStrata.pileId[index];
      const key = id != null ? tl.keys[id] : undefined;
      const n = key ? namesHere.get(key) : undefined;
      if (!key || !n) return null;
      const pay = field === 'main' ? tStrata.mainPay[index] : tStrata.pilePay![index];
      return {
        key, name: n.name, title: n.title, school: n.school, pay,
        prev: prevPay ? (prevPay[id] > 0 ? prevPay[id] : null) : undefined, prevLabel: at > 0 ? snaps[at - 1].label : undefined,
        rank: above(pay) + 1, total: desc.length,
      };
    };
  }, [tStrata, tl, at, whoIsBase, namesHere, desc, prevPay, snaps]);
  useEffect(() => { if (at != null && whoIsBase != null) wantNames?.(at); }, [at, whoIsBase, wantNames]);

  // The lens: where it is wanted, the pointer (which picks the square), whether a finger left it pinned.
  const [lensAt, setLensAt] = useState<{ x: number; y: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  // Under a finger the lens is drawn above it, magnifying what is under its tip.
  const [lensFrom, setLensFrom] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [pick, setPick] = useState<LensHit | null>(null);
  const holdRef = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const heldRef = useRef(false);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const dismissedRef = useRef<number | null>(null);
  const R = phone ? LENS_R.phone : LENS_R.wide;
  // The names are asked for the first time the lens is up.
  const wantWhoRef = useRef(onWantWho);
  wantWhoRef.current = onWantWho;
  useEffect(() => { if (lensAt) wantWhoRef.current?.(); }, [lensAt]);
  const lensCol = lensAt && layout && !tail ? Math.max(0, Math.min(COLS - 1, Math.floor(lensAt.x / layout.colW))) : null;
  // The pile is a button: over it, no lens but a word on what a click does; unrolled, the squeezed graph is the
  // way to fold it back. Where the pointer is over either, for that word.
  const [overPile, setOverPile] = useState(false);
  const [overFold, setOverFold] = useState<{ x: number; y: number } | null>(null);
  const pileTop = useMemo(() => {
    if (!layout || layout.tail || !layout.pileW) return null;
    let t = layout.base;
    for (let j = 0; j < layout.py.length; j++) t = Math.min(t, layout.py[j]);
    return t;
  }, [layout]);
  const onPile = (at: { x: number; y: number }) => canUnroll && pileTop != null && !!layout && at.x >= layout.pileLeft - 6 && at.y >= pileTop - 12;
  const onSqueezed = (at: { x: number; y: number }) => !!tail && at.x < tail.capX + 3;
  // The tail's people by pay, for the keyboard to walk.
  const tailOrder = useMemo(() => {
    const pays = strata?.pilePay;
    if (!pays) return [];
    return Array.from(pays.keys()).sort((a, b) => pays[a] - pays[b] || a - b);
  }, [strata]);
  const tailRankRef = useRef<number | null>(null);

  // The search's people: marked, named, and opened from their square.
  const foundMain = useMemo(() => found.filter((f) => f.spot.field === 'main'), [found]);
  // Unrolled, the squeezed graph's people are a sliver: only the tail's are marked.
  const marks = useMemo(() => ({ main: tail ? [] : foundMain.map((f) => f.spot.index), pile: found.filter((f) => f.spot.field === 'pile').map((f) => f.spot.index) }), [found, foundMain, tail]);
  const bigFound = activeKey ? found.find((f) => f.person_key === activeKey) ?? null : null;
  const big = bigFound ? bigFound.spot : null;
  const layoutRef = useRef<typeof layout>(null);
  layoutRef.current = layout;
  const openAt = useCallback((person: { key: string; name: string; title: string | null; school: string | null; pay: number | null }, spot: Spot) => {
    const L = layoutRef.current;
    const X = L && (spot.field === 'main' ? L.mx : L.px), Y = L && (spot.field === 'main' ? L.my : L.py);
    const at = L && X && Y && spot.index < X.length ? { x: X[spot.index] + L.grid.sq / 2, y: Y[spot.index] + L.grid.sq / 2, s: L.grid.sq } : null;
    const box = plotRef.current?.getBoundingClientRect();
    if (!reveal || !at || !box) return false;
    reveal({ person, from: { x: box.left + at.x, y: box.top + at.y, r: Math.max(4, at.s) } });
    return true;
  }, [reveal]);
  useEffect(() => {
    if (!openRef) return;
    openRef.current = (key) => {
      const f = found.find((p) => p.person_key === key);
      return !!f && openAt({ key: f.person_key, name: f.name, title: f.title, school: f.school, pay: f.pay }, f.spot);
    };
    return () => { openRef.current = null; };
  }, [openRef, found, openAt]);

  // Where each found person's square is, once the squares are at rest: from the layout itself, which the
  // field is drawn from (a field just mounted, going full page, has no handle yet to ask).
  const foundAt = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    if (!layout || moving) return out;
    for (const f of found) {
      const X = f.spot.field === 'main' ? layout.mx : layout.px, Y = f.spot.field === 'main' ? layout.my : layout.py;
      if (f.spot.index < X.length) out.set(f.person_key, { x: X[f.spot.index] + layout.grid.sq / 2, y: Y[f.spot.index] + layout.grid.sq / 2 });
    }
    return out;
    // `moving` holds the names back until the squares have arrived.
  }, [found, layout, moving]);
  const foundLabels = useMemo(() => {
    if (!layout || layout.tail || !foundMain.length) return [];
    const spots = foundMain.map((f) => ({ f, at: foundAt.get(f.person_key) })).filter((s): s is { f: FoundPerson; at: { x: number; y: number } } => !!s.at).sort((a, b) => a.at.x - b.at.x);
    if (!spots.length) return [];
    const placed = placeNearLabels(
      spots.map((s, i) => ({
        id: i, x: s.at.x, y: s.at.y, r: 6,
        width: Math.ceil(Math.min(FOUND_LABEL.maxW, measureText(s.f.name, FOUND_LABEL.font) * 1.08 + FOUND_LABEL.pad)),
        priority: s.f.person_key === activeKey ? 1 : 0,
      })),
      { left: 0, right: layout.mainW, top: PIN_BAND, bottom: layout.base - 2 },
      { height: FOUND_LABEL.h, levels: phone ? 4 : 7 },
    );
    return placed.map((l) => {
      const s = spots[l.id];
      const left = Math.round(l.box.left), top = Math.round(l.box.top), w = Math.round(l.box.right - l.box.left);
      const end = { x: l.anchor.x + left - l.box.left, y: l.anchor.y + top - l.box.top };
      const d = Math.hypot(end.x - s.at.x, end.y - s.at.y) || 1;
      return { key: s.f.person_key, name: s.f.name, active: s.f.person_key === activeKey, cx: left + w / 2, w, top, from: { x: s.at.x + ((end.x - s.at.x) / d) * 7, y: s.at.y + ((end.y - s.at.y) / d) * 7 }, to: end };
    });
  }, [layout, foundMain, foundAt, activeKey, phone]);

  // The percentile pins over the skyline, each a line up from its column to a label placed clear of the others.
  const pins = useMemo(() => {
    if (!strata || !layout || layout.tail) return [];
    const list: { key: string; v: number; text: string; strong?: boolean; filter?: boolean; ink?: string }[] = [];
    if (median != null) list.push({ key: 'median', v: median, text: `Median ${usd(median)}`, strong: true });
    // Named in full where there is room: "P25" is a statistician's shorthand on a page written for everyone
    // else. A phone keeps it — three crowd at 375px, and a wrapped label is worse than a terse one.
    if (p25 != null) list.push({ key: 'p25', v: p25, text: `${phone ? 'P25' : '25th percentile'} ${fmtK(p25)}` });
    if (p75 != null) list.push({ key: 'p75', v: p75, text: `${phone ? 'P75' : '75th percentile'} ${fmtK(p75)}` });
    if (filterStats?.median != null && filterStats.count > 0 && (cap == null || filterStats.median < cap)) {
      list.push({ key: 'filter', v: filterStats.median, text: `${filterStats.name} median ${fmtK(filterStats.median)}`, filter: true, ink: filterStats.ink });
    }
    const boxes = list.map((p) => ({ x: payX(layout, p.v), w: Math.ceil(measureText(p.text, PIN_FONT) * (p.strong ? 1.1 : 1.06)) }));
    const rows = placePins(boxes, layout.mainW, PIN_ROWS);
    return list.map((p, i) => {
      const x = boxes[i].x;
      const top = rows[i].row * PIN_ROW + 2;
      const colTop = colTopY(strata, layout, Math.floor(p.v / 1000));
      return { ...p, x, left: rows[i].left, top, w: boxes[i].w, y1: top + PIN_ROW - 2, y2: Math.max(top + PIN_ROW, colTop - 4) };
    });
  }, [strata, layout, median, p25, p75, filterStats, cap, phone]);

  // The pile's label at the axis's right end, which is also the way to unroll it and fold it back.
  const over = strata?.pileKind.length ?? 0;
  const pileLabel = tail ? `${fmtTail(tail.top)} · fold back` : `${num(over)} at ${fmtK(cap ?? 250_000)}+`;
  // A pay's place on the axis: on the plot, or unrolled, on the axis run out to the top salary.
  const xOf = useCallback((v: number) => (layout?.tail ? v * layout.tail.scale : layout ? payX(layout, v) : 0), [layout]);
  // The salary axis: round pays every $25k (coarser where they would crowd), short of the pile; unrolled, round
  // pays out to the top salary, as many as fit.
  const ticks = useMemo(() => {
    if (!layout) return [];
    const room = layout.pileW > 0 || layout.tail ? measureText(pileLabel, 13) * 1.06 : 0;
    const out: number[] = [];
    const fits = (v: number) => xOf(v) + measureText(fmtTail(v), 13) * 0.53 + 10 <= plotW - room;
    if (layout.tail) {
      const step = [250_000, 500_000, 1_000_000, 2_000_000].find((s) => s * layout.tail!.scale >= AXIS_LABEL_W * 1.3) ?? 2_000_000;
      for (let v = step; v <= layout.tail.top; v += step) if (fits(v)) out.push(v);
      return out;
    }
    const step = TICK_STEPS.find((s) => (s / 1000) * layout.colW >= AXIS_LABEL_W) ?? TICK_STEPS[TICK_STEPS.length - 1];
    for (let v = step; v < 250_000; v += step) if (fits(v)) out.push(v);
    return out;
  }, [layout, plotW, pileLabel, xOf]);

  // The lens's readout: the pay under it, how many are paid within ±$5k, and where that stands. Unrolled, the
  // pay under it on the long axis, how many of the tail are within ±$25k, and what share of everyone is paid that
  // or more.
  const topShare = (n: number) => { const p = (n / Math.max(1, total)) * 100; return p >= 0.1 ? `${p.toFixed(1)}%` : 'under 0.1%'; };
  const pileWord = `${num(over)} at ${fmtK(cap ?? 250_000)} or more · the top ${topShare(over)} · ${canHover ? 'click' : 'tap'} to see each at their own pay`;
  const readout = useMemo(() => {
    if (!strata || !layout || !lensAt) return null;
    if (layout.tail && strata.pilePay) {
      const pay = Math.max(0, (lensFrom ?? lensAt).x / layout.tail.scale);
      let near = 0, above = 0;
      for (const v of strata.pilePay) { if (Math.abs(v - pay) <= TAIL_READ) near++; if (v >= pay) above++; }
      return `${fmtTail(pay)} · ${num(near)} ${near === 1 ? 'person' : 'people'} within ±${fmtK(TAIL_READ)} · ${above ? `${topShare(above)} of everyone is paid this or more` : 'no one is paid more'}`;
    }
    const c = lensCol ?? 0;
    const near = within(strata.colCount, c, READ_RADIUS);
    let lit = 0;
    if (dim) for (let i = 0; i < strata.col.length; i++) if (!dim.main[i] && Math.abs(strata.col[i] - c) <= READ_RADIUS) lit++;
    const pct = Math.min(99, Math.max(1, Math.round(shareAt(strata.colCount, c, total) * 100)));
    return `${fmtK(c * 1000)} · ${num(near)} people within ±${fmtK(READ_RADIUS * 1000)} · ${ordinal(pct)} percentile${dim ? ` · ${num(lit)} in the filter` : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strata, layout, lensAt, lensFrom, lensCol, dim, total]);

  // Who the square under the lens is: from the names, once they are in — and for one of the search's people,
  // from the search itself, so a mark names and opens its person before the names have loaded.
  const foundPick = pick ? found.find((f) => f.spot.field === pick.field && f.spot.index === pick.index) ?? null : null;
  const who: DotWho | null = (pick && typeof whoIs === 'function' ? whoIs(pick.field, pick.index) : null)
    ?? (foundPick ? { key: foundPick.person_key, name: foundPick.name, title: foundPick.title, school: foundPick.school, pay: foundPick.pay } : null);

  // ── Pointer, finger and keyboard ──
  const local = (e: { clientX: number; clientY: number }) => {
    const b = plotRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const clearHold = () => { if (holdRef.current) { window.clearTimeout(holdRef.current.timer); holdRef.current = null; } };
  const dismissSearch = (e: ReactPointerEvent<HTMLElement>) => {
    if (!searchOpenRef?.current) return false;
    dismissedRef.current = e.pointerId;
    (document.activeElement as HTMLElement | null)?.blur();
    return true;
  };
  const putAway = () => { setLensAt(null); setPointer(null); setLensFrom(null); };
  // Unroll the pile, or fold it back: whatever the lens showed is put away while everyone moves.
  const unroll = () => {
    if (!canUnroll) return;
    setUnrolled(true);
    setOverPile(false);
    setPinned(false);
    putAway();
    tailRankRef.current = null;
  };
  const fold = () => {
    setUnrolled(false);
    setOverFold(null);
    setPinned(false);
    putAway();
  };
  const foldRef = useRef(fold);
  foldRef.current = fold;
  // Escape folds it back — before anything else Escape does (full page's own, say).
  useEffect(() => {
    if (!unrolled) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      foldRef.current();
    };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [unrolled]);
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const at = local(e);
    if (e.pointerType === 'mouse') {
      if (pressRef.current && Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y) > 6) pressRef.current = null;
      const pile = onPile(at), squeezed = onSqueezed(at);
      setOverPile(pile);
      setOverFold(squeezed ? at : null);
      if (pile || squeezed) { putAway(); return; }
      setLensAt(at);
      setLensFrom(null);
      setPointer(at);
      return;
    }
    if (heldRef.current) {
      const lifted = { x: at.x, y: at.y - (R + HOLD_LIFT) };
      setLensAt(lifted);
      setLensFrom(at);
      setPointer(lifted);
      return;
    }
    const hold = holdRef.current;
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) clearHold();
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dismissSearch(e)) return;
    if (e.pointerType === 'mouse') { if (e.button === 0) pressRef.current = { x: e.clientX, y: e.clientY }; return; }
    clearHold();
    const at = local(e);
    holdRef.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      timer: window.setTimeout(() => {
        holdRef.current = null;
        heldRef.current = true;
        const lifted = { x: at.x, y: at.y - (R + HOLD_LIFT) };
        setLensAt(lifted);
        setLensFrom(at);
        setPointer(lifted);
        setPinned(false);
        navigator.vibrate?.(8);
      }, HOLD_MS),
    };
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dismissedRef.current === e.pointerId) { dismissedRef.current = null; return; }
    if (e.pointerType === 'mouse') {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press) return;
      const at = local(e);
      // A click on the pile unrolls it; unrolled, a click on someone opens them, and anywhere else folds it back.
      if (onPile(at)) { unroll(); return; }
      if (pick) { if (who) toggleFollow(who, pick); return; }
      if (tail) fold();
      return;
    }
    // A finger: lifted from a hold, the lens stays where it was; a tap puts it there — or, on the pile, unrolls
    // it, and on the squeezed graph folds it back.
    if (heldRef.current) { heldRef.current = false; setPinned(true); return; }
    if (holdRef.current) {
      clearHold();
      const at = local(e);
      if (onPile(at)) { unroll(); return; }
      if (onSqueezed(at)) { fold(); return; }
      const lifted = { x: at.x, y: Math.max(R, at.y - (R + HOLD_LIFT)) };
      setLensAt(lifted);
      setLensFrom(at);
      setPointer(lifted);
      setPinned(true);
    }
  };
  const onCancel = () => { clearHold(); heldRef.current = false; };
  const onLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    setOverPile(false);
    setOverFold(null);
    if (pinned) return;
    setLensAt(null);
    setPointer(null);
  };
  // While a held lens follows the finger, the finger moves the lens, not the page.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (heldRef.current || fullRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [layout]);
  // A pinned lens goes at a tap anywhere off the plot.
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (plotRef.current?.contains(t) || cardRef.current?.contains(t)) return;
      setPinned(false);
      setLensAt(null);
      setPointer(null);
      setLensFrom(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [pinned]);
  // The keyboard: the plot is a slider over pay. The arrows move the lens a column ($1k; with Shift $10k),
  // Home and End go to the ends, Enter opens the person at its centre, and Escape puts it away.
  const keyAt = (c: number) => {
    if (!strata || !layout) return null;
    const x = Math.min(layout.mainW - 1, (c + 0.5) * layout.colW);
    const top = colTopY(strata, layout, c);
    const y = Math.max(PIN_BAND + R / 2, Math.min(layout.base - 4, (top + layout.base) / 2));
    return { x, y };
  };
  // Unrolled, the arrows walk the tail's people by pay (with Shift ten at a time): the lens over each in turn,
  // lifted clear of the floor and showing what is round them.
  const keyTail = (r: number) => {
    if (!layout || !tailOrder.length) return;
    const k = Math.max(0, Math.min(tailOrder.length - 1, r));
    tailRankRef.current = k;
    const j = tailOrder[k];
    const sq = { x: layout.px[j] + layout.grid.sqW / 2, y: layout.py[j] + layout.grid.sq / 2 };
    const lifted = { x: sq.x, y: Math.max(PIN_BAND + R / 2, Math.min(sq.y, layout.base - R - 6)) };
    setLensAt(lifted);
    setLensFrom(lifted.y === sq.y ? null : sq);
    setPointer(lifted);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!layout) return;
    if (layout.tail) {
      const r = tailRankRef.current ?? 0;
      const step = e.shiftKey ? 10 : 1;
      const last = tailOrder.length - 1;
      const to: Record<string, number> = { ArrowRight: r + step, ArrowUp: r + step, ArrowLeft: r - step, ArrowDown: r - step, PageUp: r + 10, PageDown: r - 10, Home: 0, End: last };
      if (e.key in to) { e.preventDefault(); keyTail(to[e.key]); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (pick && who) toggleFollow(who, pick); }
      return;
    }
    const c = lensCol ?? Math.floor((median ?? 0) / 1000);
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = Math.min(COLS - 1, c + step); break;
      case 'ArrowLeft': case 'ArrowDown': next = Math.max(0, c - step); break;
      case 'PageUp': next = Math.min(COLS - 1, c + 10); break;
      case 'PageDown': next = Math.max(0, c - 10); break;
      case 'Home': next = 0; break;
      case 'End': next = COLS - 1; break;
      case 'Enter': case ' ':
        e.preventDefault();
        if (pick && who) toggleFollow(who, pick);
        return;
      // Put away, and on to the page's own Escape (full page: a filter off, then full page closed).
      case 'Escape':
        if (lensAt) { setLensAt(null); setPointer(null); }
        return;
      default: return;
    }
    e.preventDefault();
    const at = keyAt(next);
    setLensAt(at);
    setLensFrom(null);
    setPointer(at);
  };

  // ── Full page ──
  const panelRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const growFromRef = useRef<DOMRect | null>(null);
  const closingRef = useRef(false);
  const refocusRef = useRef(false);
  const fullRef = useRef(false);
  fullRef.current = full;
  const fullChangeRef = useRef(onFullChange);
  fullChangeRef.current = onFullChange;
  const peelRef = useRef(onPeel);
  peelRef.current = onPeel;
  useEffect(() => { fullChangeRef.current?.(full); }, [full]);
  const closeFull = () => {
    const el = panelRef.current, ph = placeholderRef.current;
    if (!fullRef.current || closingRef.current) return;
    refocusRef.current = true;
    if (!el || !ph || prefersReducedMotion()) { setFull(false); return; }
    closingRef.current = true;
    const frames = flipFrames(ph.getBoundingClientRect(), el.getBoundingClientRect()).reverse();
    const anim = el.animate(frames, { duration: FULL_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    scrimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FULL_MS, fill: 'forwards' });
    el.dataset.full = 'closing';
    const done = () => { closingRef.current = false; setFull(false); };
    anim.onfinish = done;
    anim.oncancel = done;
  };
  const closeFullRef = useRef(closeFull);
  closeFullRef.current = closeFull;
  const openFull = () => {
    const el = panelRef.current;
    if (!el || fullRef.current) return;
    growFromRef.current = el.getBoundingClientRect();
    setPageH(el.offsetHeight);
    const pad = phone ? FULL_PAD.phone : FULL_PAD.wide;
    setFullH(Math.max(baseH, Math.floor(window.innerHeight - 2 * pad - (el.offsetHeight - H))));
    setLensAt(null);
    setPointer(null);
    setPinned(false);
    fitTries.current = 0;
    setFull(true);
  };
  useEffect(() => {
    if (!openFullRef) return;
    openFullRef.current = () => openFull();
    return () => { openFullRef.current = null; };
  });
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    root.classList.add('hero-full-open');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = panelRef.current, at = document.activeElement;
      if (el && at && at !== document.body && !el.contains(at)) return;
      // A filter comes off before full page closes: one layer at a time.
      if (peelRef.current?.()) { e.preventDefault(); return; }
      closeFullRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { root.classList.remove('hero-full-open'); document.removeEventListener('keydown', onKeyDown); };
  }, [full]);
  // The plot's height full page: the window's, less the room round the panel and everything in it that is not
  // the plot — measured, since the toolbar carries the search there and the legend wraps — and again on a
  // resize. Opening, the panel grows out of its place only once that height has settled: the first guess
  // (from the panel on the page) is re-measured before the first paint, and a grow aimed at the guess
  // started off its place.
  const fullHRef = useRef(fullH);
  fullHRef.current = fullH;
  // A few tries an opening (or a resize): a height that changes what it is measured against — a scrollbar
  // that comes and goes, a legend that wraps differently at the width it leaves — would otherwise measure
  // again on every render, and the panel never holds still.
  const fitTries = useRef(0);
  const fitFull = useCallback(() => {
    const el = panelRef.current;
    if (!el || fitTries.current >= 3) return true;
    const pad = phone ? FULL_PAD.phone : FULL_PAD.wide;
    const next = Math.max(baseH, Math.floor(window.innerHeight - 2 * pad - (el.offsetHeight - H)));
    if (Math.abs(fullHRef.current - next) < 2) return true;
    fitTries.current++;
    setFullH(next);
    return false;
  }, [phone, baseH, H]);
  useLayoutEffect(() => {
    if (!full) return;
    const el = panelRef.current;
    if (!fitFull() || !el) return;
    const from = growFromRef.current;
    if (!from) return;
    growFromRef.current = null;
    if (prefersReducedMotion()) return;
    el.animate(flipFrames(from, el.getBoundingClientRect()), { duration: FULL_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FULL_MS, easing: 'ease-out' });
  });
  useEffect(() => {
    if (!full) return;
    const onResize = () => { fitTries.current = 0; fitFull(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [full, fitFull]);
  useLayoutEffect(() => {
    if (!full && refocusRef.current) {
      refocusRef.current = false;
      toggleRef.current?.focus();
    }
  }, [full]);
  useEffect(() => () => clearHold(), []);

  if (!strata) return null;

  const fullToggle = phone ? (
    <ActionIcon ref={toggleRef} variant={full ? 'filled' : 'light'} color="accent" size="md"
      className={`hero-dist-full-toggle${full ? '' : ' accent-adaptive-text'}`}
      aria-label={full ? 'Exit full page' : 'Full page graph'} onClick={full ? closeFull : openFull} data-autofocus={full || undefined}>
      {full ? <IconX size={ICON.control} /> : <IconArrowsMaximize size={ICON.control} />}
    </ActionIcon>
  ) : (
    <Button ref={toggleRef} variant={full ? 'filled' : 'light'} color="accent" size="compact-sm"
      className={`hero-dist-full-toggle${full ? '' : ' accent-adaptive-text'}`}
      leftSection={full ? <IconX size={ICON.compact} /> : <IconArrowsMaximize size={ICON.compact} />}
      rightSection={full ? <span className="hero-dist-esc" aria-hidden>Esc</span> : undefined}
      onClick={full ? closeFull : openFull} data-autofocus={full || undefined}>
      {full ? 'Exit full page' : 'Full page graph'}
    </Button>
  );
  const clearFilter = solo != null && !lit ? () => setSolo(null) : onClearGroup;
  const chip = group ? (
    <div className="strata-chip" data-pending={group.pending || undefined}>
      <span>
        {group.pending
          ? `${group.name} · …`
          : filterStats && filterStats.count > 0
            ? `${filterStats.name} · ${num(filterStats.count)} ${filterStats.count === 1 ? 'person' : 'people'} · median ${fmtK(filterStats.median ?? 0)} · ${vsCampus(filterStats.median, median)}`
            : `No one on the graph is ${group.name}`}
      </span>
      {clearFilter && !previewing && <CloseButton size="sm" aria-label={`Clear ${group.name}`} onClick={clearFilter} />}
    </div>
  ) : filterStats ? (
    <div className="strata-chip">
      <span>{`${filterStats.name} · ${num(filterStats.count)} people · median ${fmtK(filterStats.median ?? 0)} · ${vsCampus(filterStats.median, median)}`}</span>
      <CloseButton size="sm" aria-label={`Clear ${filterStats.name}`} onClick={() => setSolo(null)} />
    </div>
  ) : (
    <Text size="sm" c="dimmed" className="strata-count">{num(total)} people{snapshotLabel ? ` · ${snapshotLabel}` : ''}</Text>
  );

  const W = layout?.mainW ?? plotW;
  // The readout's width, so it can be kept inside the plot: its words at the pill's size, and its padding.
  const readoutW = readout ? Math.ceil(measureText(readout, 12) * 1.08 + 20) : 0;
  const lensY = lensAt?.y ?? 0;
  const pillTop = lensAt ? (lensY - R - 34 >= 0 ? lensY - R - 34 : lensY + R + 8) : 0;
  const cardSide = lensAt && lensAt.x + R + 12 + CARD_W <= plotW ? 'right' : 'left';
  const cardLeft = lensAt ? (cardSide === 'right' ? lensAt.x + R + 12 : Math.max(0, lensAt.x - R - 12 - CARD_W)) : 0;
  // Level with the square under the pointer, and clear of the readout where the two would cross.
  const pillLeft = lensAt ? Math.max(0, Math.min(plotW - readoutW, lensAt.x - readoutW / 2)) : 0;
  const crossesPill = lensAt && cardLeft < pillLeft + readoutW && pillLeft < cardLeft + CARD_W;
  const cardTop = pick
    ? Math.max(crossesPill && pillTop < lensY ? pillTop + 32 : 0, Math.min(H - CARD_H, pick.y - CARD_H / 2))
    : 0;
  const readText = readout ?? 'Move along the pay distribution with the arrow keys';
  const change = who && who.pay != null && who.prev !== undefined
    ? who.prev == null ? { text: 'New this snapshot', up: true } : who.prev > 0 ? (() => {
      const pct = ((who.pay! - who.prev!) / who.prev!) * 100;
      return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% since ${who.prevLabel ?? 'last'}`, up: pct >= 0 };
    })() : null
    : null;
  const pickKind = pick ? (pick.field === 'main' ? strata.kind[pick.index] : strata.pileKind[pick.index]) : null;
  // The followed person's chip: who, and — where the snapshot shown has no such person — that they are not on
  // the payroll then; a way to open them, and to stop.
  const followTitle = follow ? (namesHere?.get(follow.key)?.title ?? follow.title) : null;
  const followChip = follow ? (
    <div className="strata-follow-chip" data-absent={!followSpot || undefined}>
      <span>Following {follow.name}{followTitle ? ` · ${followTitle}` : ''}{followSpot ? '' : ' · not on payroll this snapshot'}</span>
      {followSpot && followProp && (
        <button type="button" className="strata-follow-open"
          onClick={() => openAt({ key: follow.key, name: follow.name, title: followTitle, school: null, pay: followProp.pay }, followSpot)}>
          Open
        </button>
      )}
      <CloseButton size="sm" aria-label={`Stop following ${follow.name}`} onClick={() => setFollow(null)} />
    </div>
  ) : null;

  const panel = (
    <div
      ref={panelRef}
      className={`hero-dist strata glass${full ? ' hero-dist-full' : ''}`}
      data-full={full ? 'on' : 'off'}
      role={full ? 'dialog' : undefined}
      aria-modal={full || undefined}
      aria-label={full ? 'Pay distribution, full page' : undefined}
    >
      <div className="hero-dist-controls strata-toolbar">
        {full && search && <div className="hero-dist-search">{search}</div>}
        <div className="strata-toolbar-left">{chip}{followChip}</div>
        <div className="strata-toolbar-right">
          {motion && (phone ? (
            <ActionIcon variant="default" size="md" aria-label="Drop the squares again" className="hero-dist-drop" onClick={() => setReplay((r) => r + 1)}>
              <IconArrowBarToDown size={ICON.control} />
            </ActionIcon>
          ) : (
            <Button variant="default" size="compact-sm" leftSection={<IconArrowBarToDown size={ICON.compact} />} className="hero-dist-drop" onClick={() => setReplay((r) => r + 1)}>
              Drop again
            </Button>
          ))}
          {fullToggle}
        </div>
      </div>

      <div
        ref={plotRef}
        className="hero-dist-main strata-plot"
        style={{ position: 'relative', height: H, cursor: lensAt && canHover ? 'none' : overPile || overFold ? 'pointer' : undefined }}
        data-lens={lensAt ? 'on' : 'off'}
        data-who={whoIs == null ? 'off' : whoIs === 'loading' ? 'loading' : 'ready'}
        data-filter={group?.name ?? (solo != null ? strata.names[solo] : undefined)}
        data-group-count={filterStats?.count}
        data-group-median={filterStats?.median ?? undefined}
        data-tail={tail ? 'on' : 'off'}
        data-over-pile={overPile || undefined}
        data-pick={pick ? `${pick.field}:${pick.index}` : undefined}
        data-pick-size={pick ? pick.s.toFixed(2) : undefined}
        data-lens-at={lensAt ? `${Math.round(lensAt.x)},${Math.round(lensAt.y)}` : undefined}
        data-pinned={pinned || undefined}
        data-follow={follow ? follow.key : undefined}
        data-squares={`${strata.col.length}:${strata.pileKind.length}`}
        onPointerMove={onMove} onPointerLeave={onLeave} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel}
        tabIndex={0} role="slider" aria-orientation="horizontal" aria-label="Pay distribution"
        aria-valuemin={0} aria-valuemax={tail ? tail.top : COLS * 1000}
        aria-valuenow={tail ? Math.round(((lensFrom ?? lensAt)?.x ?? 0) / tail.scale) : (lensCol ?? Math.floor((median ?? 0) / 1000)) * 1000} aria-valuetext={readText}
        onKeyDown={onKey}
        onFocus={(e) => {
          if (lensAt || !e.currentTarget.matches(':focus-visible')) return;
          if (tail) { keyTail(tailRankRef.current ?? 0); return; }
          const at = keyAt(Math.floor((median ?? 0) / 1000));
          setLensAt(at);
          setPointer(at);
        }}
        onBlur={() => { if (!pinned && !canHover) return; if (!pinned) { setLensAt(null); setPointer(null); } }}
      >
        {layout && (
          <>
            <StrataField
              ref={fieldRef} className="hero-dots strata-field" strata={strata} layout={layout} kindInks={kindInks}
              dim={dim} matchSearch={!!lit} marks={marks} big={big} entrance={entrance && !droppedRef.current} replay={replay}
              lensAt={lensAt} lensFrom={lensFrom} pointer={pointer} lensR={R} onPick={setPick} onMoving={setMoving} hues={hues} step={step}
              follow={followProp}
            />
            <svg className="strata-guides" width={plotW} height={H} aria-hidden style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
              {pins.map((p) => (
                <line key={p.key} className={`strata-pin-line strata-pin-${p.key}`} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2}
                  style={p.ink ? ({ stroke: p.ink } as CSSProperties) : undefined} />
              ))}
              <line className="strata-baseline" x1={0} x2={tail ? plotW : W} y1={layout.base + 0.5} y2={layout.base + 0.5} />
              {layout.pileW > 0 && (
                <>
                  <line className="strata-baseline" x1={layout.pileLeft - 2} x2={plotW} y1={layout.base + 0.5} y2={layout.base + 0.5} />
                  <path className="strata-break" d={`M${W + 3} ${layout.base + 4} L${W + 7} ${layout.base - 4} M${W + 8} ${layout.base + 4} L${W + 12} ${layout.base - 4}`} />
                </>
              )}
              {/* The pile under the pointer: outlined, as what a click there unrolls. */}
              {overPile && pileTop != null && (
                <rect className="strata-pile-ring" x={layout.pileLeft - 3.5} y={pileTop - 3.5} width={plotW - layout.pileLeft + 3} height={layout.base - pileTop + 3} rx={3} />
              )}
              {/* Unrolled: where the graph used to end, and the top salary ringed at the far end — a lone square there is easy to miss. */}
              {tail && (
                <>
                  <line className="strata-tail-edge" x1={tail.capX + 0.5} x2={tail.capX + 0.5} y1={Math.max(PIN_BAND, layout.peakY - 6)} y2={layout.base} />
                  <circle className="strata-tail-top" cx={layout.px[tail.topIndex] + layout.grid.sqW / 2} cy={layout.py[tail.topIndex] + layout.grid.sq / 2} r={6} />
                </>
              )}
            </svg>
            {tail && (
              <div className="strata-tail-edge-label" style={{ left: tail.capX + 6, top: Math.max(PIN_BAND, layout.peakY - 6) }}>{fmtK(cap ?? 250_000)}{phone ? '' : ", the graph's edge"}</div>
            )}
            {pins.map((p) => (
              <div key={p.key} className={`strata-pin strata-pin-label-${p.key}`} data-strong={p.strong || undefined} data-filter={p.filter || undefined}
                style={{ left: p.left, top: p.top, width: p.w, ...(p.ink ? { color: p.ink } : {}) }}>
                {p.text}
              </div>
            ))}
          </>
        )}
        {foundLabels.length > 0 && (
          <svg className="hero-found-leaders" width={Math.max(1, plotW)} height={H} aria-hidden style={{ position: 'absolute', left: 0, top: 0, zIndex: Z.local, pointerEvents: 'none' }}>
            {foundLabels.map((l) => (
              <line key={l.key} x1={l.from.x.toFixed(1)} y1={l.from.y.toFixed(1)} x2={l.to.x.toFixed(1)} y2={l.to.y.toFixed(1)}
                stroke="var(--mantine-color-text)" strokeWidth={l.active ? 1.5 : 1} strokeLinecap="round" />
            ))}
          </svg>
        )}
        {foundLabels.map((l) => (
          <div key={l.key} aria-hidden className="hero-found-label" data-active={l.active ? 'on' : undefined}
            style={{ position: 'absolute', left: l.cx, top: l.top, width: l.w, zIndex: Z.local, pointerEvents: 'none', transform: 'translateX(-50%)' }}>
            {l.name}
          </div>
        ))}
        {lensAt && readout && !moving && (
          <div aria-hidden className="strata-readout" style={{ left: pillLeft, top: pillTop }}>
            <span className="chart-tip-pill">{readout}</span>
          </div>
        )}
        {overPile && layout && pileTop != null && !moving && (
          <div aria-hidden className="strata-readout strata-pile-word" style={{ right: 0, top: Math.max(0, pileTop - 34) }}>
            <span className="chart-tip-pill">{pileWord}</span>
          </div>
        )}
        {overFold && !moving && (
          <div aria-hidden className="strata-readout strata-fold-word" style={{ left: overFold.x + 14, top: Math.max(0, overFold.y - 34) }}>
            <span className="chart-tip-pill">{canHover ? 'Click' : 'Tap'} to fold them back into a pile</span>
          </div>
        )}
        {tail && !moving && (
          <div className="strata-tail-note" aria-live="polite">
            <Text size={phone ? 'xs' : 'sm'} fw={700}>The top salary, {usd(tail.top)}, is {Math.round(tail.top / (cap ?? 250_000))}× the {fmtK(cap ?? 250_000)} edge of the graph</Text>
            {/* A phone keeps the one line: the label under the axis says how to fold them back. */}
            {!phone && (
              <Text size="xs" c="dimmed">{num(over)} people at {fmtK(cap ?? 250_000)} or more, each at their own pay · {canHover ? 'click' : 'tap'} the graph or press Esc to fold them back</Text>
            )}
          </div>
        )}
        {lensAt && pick && !moving && (
          <div
            ref={cardRef}
            className="strata-card" data-who={who?.key}
            style={{ left: cardLeft, top: cardTop, width: CARD_W, pointerEvents: pinned ? 'auto' : 'none' }}
            onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
          >
            {who ? (
              <>
                <div className="strata-card-name">{who.name}</div>
                {who.title && <div className="strata-card-title">{who.title}</div>}
                <div className="strata-card-pay">
                  <span>{who.pay != null ? usd(who.pay) : '—'}</span>
                  {change && <span className="strata-card-change" data-up={change.up || undefined}>{change.text}</span>}
                </div>
                <div className="strata-card-meta">
                  {pickKind != null && <span className="strata-swatch" style={{ background: kindInks[pickKind] }} />}
                  <span>{pickKind != null ? strata.names[pickKind] : ''}</span>
                </div>
                {who.rank != null && who.total != null && (
                  <div className="strata-card-rank">
                    {ordinal(Math.min(99, Math.max(1, Math.round((1 - (who.rank - 0.5) / who.total) * 100))))} percentile · #{num(who.rank)} of {num(who.total)}
                  </div>
                )}
                {pinned ? (
                  <div className="strata-card-actions">
                    <Button size="compact-xs" variant={follow?.key === who.key ? 'default' : 'filled'} onClick={() => pick && toggleFollow(who, pick)}>
                      {follow?.key === who.key ? 'Stop following' : 'Follow'}
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => pick && openAt(who, pick)}>Open</Button>
                  </div>
                ) : (
                  <div className="strata-card-foot">{follow?.key === who.key ? 'Click to stop following' : 'Click to follow through time'}</div>
                )}
              </>
            ) : (
              <div className="strata-card-title">{whoIs === 'loading' || whoIs == null ? 'Finding who this is…' : 'No one found for this square'}</div>
            )}
          </div>
        )}
      </div>

      {layout && (
        <>
          <div className="strata-ruler" aria-hidden style={{ width: plotW }}>
            {!tail && p25 != null && p75 != null && (
              <span className="strata-iqr" style={{ left: payX(layout, p25), width: payX(layout, p75) - payX(layout, p25) }} />
            )}
            {!tail && median != null && <span className="strata-iqr-median" style={{ left: payX(layout, median) }} />}
          </div>
          <div className="hero-dist-axis strata-axis" style={{ position: 'relative', width: plotW }}>
            {ticks.map((v) => (
              <span key={v} className="hero-dist-tick" style={{ left: xOf(v) }}>{fmtTail(v)}</span>
            ))}
            {(layout.pileW > 0 || tail) && (canUnroll ? (
              <button type="button" className="hero-dist-pile-label strata-pile-toggle" aria-expanded={!!tail} onClick={tail ? fold : unroll}
                aria-label={tail
                  ? `Fold the ${num(over)} people at ${fmtK(cap ?? 250_000)} or more back into a pile`
                  : `${num(over)} people at ${fmtK(cap ?? 250_000)} or more: show each at their own pay`}>
                {pileLabel}
              </button>
            ) : (
              <span className="hero-dist-pile-label">{pileLabel}</span>
            ))}
          </div>
        </>
      )}

      {timeline && snaps.length > 1 && (
        <div className="strata-timeline" data-timeline={tl ? 'ready' : timeline.data === 'loading' ? 'loading' : timeline.data === 'error' ? 'error' : 'off'}
          data-snap={at != null ? snaps[at].id : snaps[lastSnap].id} data-playing={playing || undefined}
          data-step={step ? `${step.from.my.reduce((n, y, i) => n + (y < 0 && step.to.my[i] >= 0 ? 1 : 0), 0) + step.from.py.reduce((n, y) => n + (y < 0 ? 1 : 0), 0)}:${step.ghosts?.x.length ?? 0}` : undefined}
          data-movers={movers ?? undefined}>
          <Button size="compact-sm" radius="xl" color="accent" className="strata-play"
            leftSection={playing ? <IconPlayerPauseFilled size={ICON.compact} /> : <IconPlayerPlayFilled size={ICON.compact} />}
            loading={!!goal && !tl && timeline.data === 'loading'} onClick={onPlay}>
            {playing ? 'Pause' : at != null && at < lastSnap ? (paused ? 'Resume' : 'Play from here') : `Play ${bareLabel(snaps[0].label).slice(-4)} → ${bareLabel(snaps[lastSnap].label).slice(-4)}`}
          </Button>
          <div className="strata-track">
            <span className="strata-track-end">{bareLabel(snaps[0].label)}</span>
            <div className="strata-track-dots" role="radiogroup" aria-label="Snapshot"
              onKeyDown={(e) => {
                const now = at ?? lastSnap;
                const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? lastSnap : null;
                if (to == null || to < 0 || to > lastSnap) return;
                e.preventDefault();
                setPlaying(false);
                setPaused(false);
                goTo(to);
                (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
              }}>
              {snaps.map((sn, i) => {
                const here = (at ?? lastSnap) === i;
                return (
                  <button key={sn.id} type="button" role="radio" aria-checked={here} aria-label={sn.label} tabIndex={here ? 0 : -1}
                    className="strata-track-dot" data-state={here ? 'now' : i < (at ?? lastSnap) ? 'past' : 'next'}
                    onClick={() => { setPlaying(false); setPaused(false); goTo(i); }} />
                );
              })}
            </div>
            <span className="strata-track-end">{bareLabel(snaps[lastSnap].label)}</span>
          </div>
          {/* The snapshot, its people and median are the toolbar's count and the median's pin; said here only to a
              screen reader, as the step lands (not at every step of Play). */}
          <div className="visually-hidden strata-timeline-said" aria-live={playing ? 'off' : 'polite'}>
            {snapshotLabel} · {num(total)} people{median != null ? ` · median ${usd(median)}` : ''}
          </div>
          <div className="strata-timeline-readout">
            {movers != null && (
              <div className="strata-movers">
                {num(movers)} {movers === 1 ? 'person' : 'people'} changed pay by 8%+ this step · <span data-up>green up</span>, <span data-down>red down</span>
              </div>
            )}
          </div>
        </div>
      )}

      {cats && (
        <div className="hero-dist-legend strata-legend" data-solo={solo ?? undefined}>
          <Text span size="xs" c="dimmed" className="hero-dist-legend-lead">
            Stacked by highest-paid appointment · {canHover ? 'click' : 'tap'} to isolate
          </Text>
          {cats.map((c) => (
            <button key={c.name} type="button" className="hero-dist-legend-item strata-legend-item" data-category={c.name} data-n={c.n}
              aria-pressed={solo === c.kind} onClick={() => setSolo((s) => (s === c.kind ? null : c.kind))}>
              <span className="hero-dist-swatch" aria-hidden style={{ backgroundColor: kindInks[c.kind] }} />
              <Text span size="xs" fw={600}>{c.name}</Text>
              <Text span size="xs" className="strata-legend-meta">
                {num(c.n)}{c.median != null && <span className="hero-dist-legend-median"> · median {fmtK(c.median)}</span>}
              </Text>
            </button>
          ))}
        </div>
      )}

      <div className="visually-hidden" aria-live="polite">
        {found.length ? `${num(found.length)} ${found.length === 1 ? 'person' : 'people'} from the search marked on the graph` : ''}
      </div>
      <div className="visually-hidden" aria-live="polite">
        {filterStats
          ? filterStats.count
            ? `${num(filterStats.count)} ${filterStats.count === 1 ? 'person' : 'people'} in ${filterStats.name}, median ${usd(filterStats.median)}, ${vsCampus(filterStats.median, median)}.`
            : `No one on the graph is ${filterStats.name}.`
          : ''}
      </div>
    </div>
  );

  if (!full) return panel;
  return (
    <>
      <div ref={placeholderRef} className="hero-dist-placeholder" style={{ height: pageH }} aria-hidden />
      {createPortal(
        <div className="hero-full">
          <div ref={scrimRef} className="hero-full-scrim" aria-hidden onClick={closeFull} />
          <FocusTrap active>
            <div className="hero-full-frame">{panel}</div>
          </FocusTrap>
        </div>,
        document.body,
      )}
    </>
  );
}
