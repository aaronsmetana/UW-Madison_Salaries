import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon, Button, CloseButton, FocusTrap, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowBarToDown, IconArrowsMaximize, IconX } from '@tabler/icons-react';
import { COLS, READ_RADIUS, placePins, shareAt, strataFromCounts, within, type Strata, type StrataCounts } from '../../lib/strata';
import { StrataField, LENS_R, colTopY, layoutStrata, payX, useEntranceOnce, type Dim, type LensHit, type Spot, type StrataFieldHandle } from './StrataField';
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
 * a lens that magnifies where the pointer is, with a readout and the person under it; a filter that sinks
 * its own people to the floor inside the campus's unchanged skyline; and the page's full-page view of it.
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
  bins, payCounts, p25, median, p75, cap, overflow, headcount, snapshotLabel, found = [], activeKey = null, openRef,
  search, onFullChange, group = null, previewing = false, onClearGroup, onPeel, openFullRef, whoIs = null, onWantWho, searchOpenRef,
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
  /** What a filter picks out: its people sink to the floor and the rest fade. */
  group?: GraphGroup | null;
  /** The group is a row the reader is resting on in the search's list: lit where they stand, not moved. */
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
}) {
  const phone = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  const canHover = useMediaQuery('(hover: hover)', true, { getInitialValueInEffect: false }) ?? true;
  const motion = !prefersReducedMotion();
  // The drop plays once, as the page opens: going full page draws the field afresh, and it is simply there.
  const entrance = useEntranceOnce();
  const droppedRef = useRef(false);
  const reveal = useReveal();
  const [dpr] = useState(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

  const strata = useMemo(
    () => (payCounts?.counts.length ? strataFromCounts(payCounts) : null) ?? strataFromBins(bins, overflow ?? 0),
    [payCounts, bins, overflow],
  );
  const cats = useMemo(() => (payCounts?.categories?.length ? payCounts.categories : null), [payCounts]);
  const kindInks = useMemo(() => (strata?.names ?? []).map((n) => (n === 'Everyone' ? 'var(--mantine-color-accent-6)' : categoryInk(n))), [strata]);
  const total = headcount ?? (strata ? strata.col.length + strata.pileKind.length : 0);

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

  // A type picked out by its chip in the legend: its people at the floor, the rest faded.
  const [solo, setSolo] = useState<number | null>(null);
  const lit = group && !group.pending ? group : null;
  const dim = useMemo<Dim | null>(() => {
    if (!strata || (!lit && solo == null)) return null;
    const main = new Uint8Array(strata.col.length), pile = new Uint8Array(strata.pileKind.length);
    for (let i = 0; i < main.length; i++) main[i] = (lit ? lit.main[i] ?? 1 : 0) | (solo != null && strata.kind[i] !== solo ? 1 : 0);
    for (let j = 0; j < pile.length; j++) pile[j] = (lit ? lit.pile[j] ?? 1 : 0) | (solo != null && strata.pileKind[j] !== solo ? 1 : 0);
    return { main, pile };
  }, [strata, lit, solo]);
  const sink = !!dim && !(previewing && solo == null);
  const layout = useMemo(
    () => (strata && plotW > 0 ? layoutStrata(strata, { W: plotW, H, top: PIN_BAND + 4, dpr, phone }, dim, sink) : null),
    [strata, plotW, H, dpr, phone, dim, sink],
  );
  const fieldRef = useRef<StrataFieldHandle>(null);
  useEffect(() => { if (layout) droppedRef.current = true; }, [layout]);
  const [moving, setMoving] = useState(false);
  const [replay, setReplay] = useState(0);

  // What a filter lights: how many, their median, against campus — the group's own, a type's, or both.
  const filterStats = useMemo(() => {
    if (!strata || !dim) return null;
    if (solo != null && !lit) {
      const c = cats?.[solo];
      return { name: strata.names[solo], count: c ? (c as { n?: number }).n ?? 0 : 0, median: c ? (c as { median?: number }).median ?? null : null, ink: kindInks[solo] };
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
  const lensCol = lensAt && layout ? Math.max(0, Math.min(COLS - 1, Math.floor(lensAt.x / layout.colW))) : null;
  const inPile = !!lensAt && !!layout && layout.pileW > 0 && lensAt.x >= layout.pileLeft - 4;

  // The search's people: marked, named, and opened from their square.
  const foundMain = useMemo(() => found.filter((f) => f.spot.field === 'main'), [found]);
  const marks = useMemo(() => ({ main: foundMain.map((f) => f.spot.index), pile: found.filter((f) => f.spot.field === 'pile').map((f) => f.spot.index) }), [found, foundMain]);
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
    if (!layout || !foundMain.length) return [];
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
    if (!strata || !layout) return [];
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

  // The salary axis: round pays every $25k (coarser where they would crowd), short of the pile.
  const ticks = useMemo(() => {
    if (!layout) return [];
    const step = TICK_STEPS.find((s) => (s / 1000) * layout.colW >= AXIS_LABEL_W) ?? TICK_STEPS[TICK_STEPS.length - 1];
    // None under the pile's label, which runs left from the panel's right edge.
    const pileLabel = layout.pileW > 0 ? measureText(`${num(strata?.pileKind.length ?? 0)} at ${fmtK(cap ?? 250_000)}+`, 13) * 1.06 : 0;
    const out: number[] = [];
    for (let v = step; v < 250_000; v += step) {
      const x = payX(layout, v);
      if (x + measureText(fmtK(v), 13) * 0.53 + 10 <= plotW - pileLabel) out.push(v);
    }
    return out;
  }, [layout, strata, cap, plotW]);

  // The lens's readout: the pay under it, how many are paid within ±$5k, and where that stands.
  const readout = useMemo(() => {
    if (!strata || !layout || !lensAt) return null;
    if (inPile) {
      const over = strata.pileKind.length;
      return `${num(over)} at ${fmtK(cap ?? 250_000)} or more · the top ${Math.max(0.1, (over / Math.max(1, total)) * 100).toFixed(1)}%`;
    }
    const c = lensCol ?? 0;
    const near = within(strata.colCount, c, READ_RADIUS);
    let lit = 0;
    if (dim) for (let i = 0; i < strata.col.length; i++) if (!dim.main[i] && Math.abs(strata.col[i] - c) <= READ_RADIUS) lit++;
    const pct = Math.min(99, Math.max(1, Math.round(shareAt(strata.colCount, c, total) * 100)));
    return `${fmtK(c * 1000)} · ${num(near)} people within ±${fmtK(READ_RADIUS * 1000)} · ${ordinal(pct)} percentile${dim ? ` · ${num(lit)} in the filter` : ''}`;
  }, [strata, layout, lensAt, lensCol, inPile, dim, total, cap]);

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
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const at = local(e);
    if (e.pointerType === 'mouse') {
      if (pressRef.current && Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y) > 6) pressRef.current = null;
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
      if (press && pick && who) openAt(who, pick);
      return;
    }
    // A finger: lifted from a hold, the lens stays where it was; a tap puts it there.
    if (heldRef.current) { heldRef.current = false; setPinned(true); return; }
    if (holdRef.current) {
      clearHold();
      const at = local(e);
      const lifted = { x: at.x, y: Math.max(R, at.y - (R + HOLD_LIFT)) };
      setLensAt(lifted);
      setLensFrom(at);
      setPointer(lifted);
      setPinned(true);
    }
  };
  const onCancel = () => { clearHold(); heldRef.current = false; };
  const onLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || pinned) return;
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
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!layout) return;
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
        if (pick && who) openAt(who, pick);
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
        <div className="strata-toolbar-left">{chip}</div>
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
        style={{ position: 'relative', height: H, cursor: lensAt && canHover ? 'none' : undefined }}
        data-lens={lensAt ? 'on' : 'off'}
        data-who={whoIs == null ? 'off' : whoIs === 'loading' ? 'loading' : 'ready'}
        data-filter={group?.name ?? (solo != null ? strata.names[solo] : undefined)}
        data-group-count={filterStats?.count}
        data-group-median={filterStats?.median ?? undefined}
        data-sink={sink ? 'on' : 'off'}
        data-pick={pick ? `${pick.field}:${pick.index}` : undefined}
        data-pick-size={pick ? pick.s.toFixed(2) : undefined}
        data-lens-at={lensAt ? `${Math.round(lensAt.x)},${Math.round(lensAt.y)}` : undefined}
        data-pinned={pinned || undefined}
        data-squares={`${strata.col.length}:${strata.pileKind.length}`}
        onPointerMove={onMove} onPointerLeave={onLeave} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel}
        tabIndex={0} role="slider" aria-orientation="horizontal" aria-label="Pay distribution"
        aria-valuemin={0} aria-valuemax={COLS * 1000} aria-valuenow={(lensCol ?? Math.floor((median ?? 0) / 1000)) * 1000} aria-valuetext={readText}
        onKeyDown={onKey}
        onFocus={(e) => { if (!lensAt && e.currentTarget.matches(':focus-visible')) { const at = keyAt(Math.floor((median ?? 0) / 1000)); setLensAt(at); setPointer(at); } }}
        onBlur={() => { if (!pinned && !canHover) return; if (!pinned) { setLensAt(null); setPointer(null); } }}
      >
        {layout && (
          <>
            <StrataField
              ref={fieldRef} className="hero-dots strata-field" strata={strata} layout={layout} kindInks={kindInks}
              dim={dim} matchSearch={!!lit} marks={marks} big={big} entrance={entrance && !droppedRef.current} replay={replay}
              lensAt={lensAt} lensFrom={lensFrom} pointer={pointer} lensR={R} onPick={setPick} onMoving={setMoving}
            />
            <svg className="strata-guides" width={plotW} height={H} aria-hidden style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
              {pins.map((p) => (
                <line key={p.key} className={`strata-pin-line strata-pin-${p.key}`} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2}
                  style={p.ink ? ({ stroke: p.ink } as CSSProperties) : undefined} />
              ))}
              <line className="strata-baseline" x1={0} x2={W} y1={layout.base + 0.5} y2={layout.base + 0.5} />
              {layout.pileW > 0 && (
                <>
                  <line className="strata-baseline" x1={layout.pileLeft - 2} x2={plotW} y1={layout.base + 0.5} y2={layout.base + 0.5} />
                  <path className="strata-break" d={`M${W + 3} ${layout.base + 4} L${W + 7} ${layout.base - 4} M${W + 8} ${layout.base + 4} L${W + 12} ${layout.base - 4}`} />
                </>
              )}
            </svg>
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
                {pinned
                  ? <Button size="compact-xs" mt={6} fullWidth onClick={() => pick && openAt(who, pick)}>Open {who.name}</Button>
                  : <div className="strata-card-foot">{canHover ? 'Click to open' : 'Tap to open'}</div>}
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
            {p25 != null && p75 != null && (
              <span className="strata-iqr" style={{ left: payX(layout, p25), width: payX(layout, p75) - payX(layout, p25) }} />
            )}
            {median != null && <span className="strata-iqr-median" style={{ left: payX(layout, median) }} />}
          </div>
          <div className="hero-dist-axis strata-axis" style={{ position: 'relative', width: plotW }}>
            {ticks.map((v) => (
              <span key={v} className="hero-dist-tick" style={{ left: payX(layout, v) }}>{fmtK(v)}</span>
            ))}
            {layout.pileW > 0 && (
              <span className="hero-dist-pile-label">{num(strata.pileKind.length)} at {fmtK(cap ?? 250_000)}+</span>
            )}
          </div>
        </>
      )}

      {cats && (
        <div className="hero-dist-legend strata-legend" data-solo={solo ?? undefined}>
          <Text span size="xs" c="dimmed" className="hero-dist-legend-lead">
            Stacked by highest-paid appointment · {canHover ? 'click' : 'tap'} to isolate
          </Text>
          {cats.map((c, i) => {
            const meta = c as { name: string; n?: number; median?: number };
            return (
              <button key={c.name} type="button" className="hero-dist-legend-item strata-legend-item" data-category={c.name} data-n={meta.n}
                aria-pressed={solo === i} onClick={() => setSolo((s) => (s === i ? null : i))}>
                <span className="hero-dist-swatch" aria-hidden style={{ backgroundColor: kindInks[i] }} />
                <Text span size="xs" fw={600}>{c.name}</Text>
                <Text span size="xs" className="strata-legend-meta">
                  {num(meta.n ?? 0)}{meta.median != null && <span className="hero-dist-legend-median"> · median {fmtK(meta.median)}</span>}
                </Text>
              </button>
            );
          })}
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
