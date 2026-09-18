import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Divider, Tooltip, ThemeIcon, Anchor, Card, Button, ActionIcon, FocusTrap } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconReportMoney, IconUsers, IconBuildingBank, IconBriefcase, IconReportAnalytics, IconListSearch, IconArrowBarToDown,
  IconArrowsMaximize, IconArrowsMinimize,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId, useHomeStats } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { ACTUAL_PAY, FTE_MULT } from '../lib/queries';
import { binsFromCounts, countBelow, countWithin, smoothBins, CURVE_STEP, READOUT_RADIUS, type Bin } from '../lib/distribution';
import { usd, usdCompact, num } from '../lib/format';
// Same compact currency the peer-range quartile labels use, so the two charts read alike.
import { fmtK, assignLabelRows } from '../lib/chartStyle';
import { measureText, placeNearLabels } from '../lib/labelLayout';
import { useCountUp, prefersReducedMotion } from '../lib/motion';
import { SearchBox, type ShownPerson } from '../components/SearchBox';
import { Sparkline } from '../components/chart/Sparkline';
import { useReveal } from '../components/PersonReveal';
import { dotSpots, homePeopleSql, type DotSpot, type HomePerson } from '../lib/homePeople';
import { Eyebrow } from '../components/Eyebrow';
import { useDocTitle } from '../lib/useDocTitle';
import { ICON } from '../lib/ui';
import { Z } from '../lib/layers';
import { DotField, MOVE_MS, MOVE_STAGGER, SPREAD_MS, useEntranceOnce, type DotFieldHandle } from '../components/chart/DotField';
import { squeezeFactor, tailHeights } from '../lib/tail';
import { FisheyeLens, LENS_D, type FisheyeLensHandle, type LensView } from '../components/chart/FisheyeLens';
import { peopleFromCounts } from '../lib/dotLayout';
import { STIR_STEP, dragSpeed, stirPath, stirStrength, wakeTurn } from '../lib/dotPhysics';
import { usePref } from '../lib/prefs';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { areaGradDef } from '../components/chartDefs';
import type { HomeStats } from '../lib/manifest';
import { ordinal } from '../lib/stats';

interface KpiData { icon: ReactNode; label: string; value: number | null; format: (n: number) => string; color: string; hint?: string }

/**
 * One system-wide stat: centered icon+label over its value, which counts up from 0 as the data loads.
 *
 * These are the landing page's figures. They were sized at 22px when a 68px number sat above them and
 * they were explicitly supporting cast; with the headline back to being the site's name, they are the
 * data on the page and are sized to be read from across a desk (`--fs-stat`, 28-36px).
 */
function Kpi({ icon, label, value, format, color, hint }: KpiData) {
  const animated = useCountUp(value, 1000);
  const valueNode = (
    <Text
      fw={700}
      ta="center"
      className="home-kpi-value"
      style={{ fontSize: 'var(--fs-stat)', lineHeight: 1.1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
    >
      {animated == null ? '—' : format(Math.round(animated))}
    </Text>
  );
  return (
    <Stack gap={8} align="center" className="home-kpi" style={{ flex: 1, minWidth: 0, paddingInline: 12 }}>
      {/* The icon leaves ~110px for the label, so a second line is allowed and its height reserved on
          every tile — otherwise a tile whose label wraps drops its value off the shared baseline. */}
      <Group gap={7} justify="center" align="center" wrap="nowrap" mih={30}>
        <ThemeIcon size={26} radius="md" variant="light" color={color} className="home-kpi-icon">
          {icon}
        </ThemeIcon>
        <Eyebrow ta="center" lineClamp={2} style={{ lineHeight: 1.2 }}>{label}</Eyebrow>
      </Group>
      {hint ? <Tooltip label={hint} withArrow>{valueNode}</Tooltip> : valueNode}
    </Stack>
  );
}

/**
 * The system-wide pay distribution, drawn by hand off `home-stats.json` — deliberately not Recharts,
 * which is a 376KB chunk the landing page otherwise never loads.
 *
 * Replaces a 120x38 sparkline that was stretched to ~740px: at a 19:1 aspect the curve flattened into
 * a near-straight line, so the one chart on the landing page showed no shape at all. A taller box plus
 * quartile markers makes it read as a distribution rather than decoration. `preserveAspectRatio="none"`
 * with `vector-effect="non-scaling-stroke"` lets the geometry span any width while strokes stay 1px.
 */
/** Height of one marker-label row, in px — the stagger step when labels collide. Must exceed the
 *  label's own rendered line box (xs at lh 1.2 ≈ 15px) or two "different" rows still touch, which
 *  looks like the collision the stagger exists to prevent. */
const LABEL_ROW_H = 19;
/** Height of the salary axis row, in px — one `xs` line box. */
const AXIS_ROW_H = 18;
/** Pitch one axis label is given, in px. Not the label's own width (~48px) — the axis is a frame,
 *  not a ruler, so this is deliberately generous: at 72px the 848px plot fitted eleven labels, which
 *  is a densely-tick-marked chart rather than the simple one this is meant to be. */
const AXIS_LABEL_W = 120;
/** Candidate axis intervals, coarsest last. The first whose labels fit the plot wins. */
const TICK_STEPS = [10_000, 25_000, 50_000, 100_000, 250_000];
/** One histogram bin, in dollars: the readout counts whole bins. */
const BIN_DOLLARS = 1000;
/** The break between the plot and the pile of people above the cap, and the pile's least width. */
const PILE_GAP = 14;
const PILE_MIN_W = 10;
/** Every dot in the pile (its values run 0 to 1). */
const PILE_ALL: [number, number] = [0, 2];
/** The plot's height, and the clear band above the curve's peak, on a phone and wider. The band is
 *  where the readout rides over the peak and where a burst's dots have room to fly (DotField). At 180px the
 *  chart was a strip: its dots too small to tell apart and its peak flush with the panel's top; at 300 the
 *  dots still had too little room each, so it grew by a quarter. */
const PLOT_H = { phone: 275, wide: 375, most: 520 };
/** A wide plot grows taller with its width — this share of it, from PLOT_H.wide up to PLOT_H.most — so on a
 *  big screen the page-wide curve keeps its shape instead of flattening into a strip. */
const PLOT_ASPECT = 0.27;
const HEADROOM = { phone: 35, wide: 45 };
/** Every dot its own room (DotField `pack`): a crowded column of people who share a pay passes up to
 *  3px of its surplus to its neighbours — a few hundred dollars — so no streak is a solid bar. */
const PACK = { spill: 3 } as const;
/** How long the pile stays unrolled before it folds back by itself, ms. */
const TAIL_OPEN_MS = 8000;
/** A pay on the unrolled tail's axis: millions as millions. */
const fmtPay = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : fmtK(v));
/** How long a finger must rest on the plot to bring up the glass, ms, and how far above the finger the
 *  glass then sits, px, so the finger does not hide it. */
const HOLD_MS = 450;
const HOLD_LIFT = 28;
/** Where the median's line and the quartiles' begin below the plot's top: grown with it. */
const MARK_TOP = { strong: 5, plain: 33 };
/** Full page: the room kept round the panel, px, on a phone and wider; and how long it takes to grow
 *  from its place on the page to fill the window, and to shrink back, ms. */
const FULL_PAD = { phone: 8, wide: 16 };
const FULL_MS = 240;
/** The panel's corner, px, which the growing panel's clip keeps. */
const PANEL_RADIUS = 16;

/**
 * The keyframes that play a full-page panel from `from` (its box on the page) to `to` (the box it fills,
 * both viewport rects of the untransformed panel): moved to sit centred over `from` and clipped to its
 * size, then opened out — so it grows out of its place rather than fading in over it. Laid out once, at
 * the full size, and never scaled: a scale skews every `getBoundingClientRect` read inside it while it
 * plays, and the segmented control's indicator (and a field's width) measured the shrunken boxes and
 * kept them.
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

/**
 * What the panel's search row costs it, full page: the row (42px) and the margin under it (12). Mirrors
 * `--full-search-h` and the margin in app.css `.hero-dist-search`. The plot's height full page is worked
 * out from the panel as it stands on the page, which has no such row, so the row has to be subtracted by
 * hand — and it has to be right, because the panel's grow-out-of-its-place is aimed at the panel as that
 * reckoning leaves it. Out by the row, the panel starts half a row off its own place and lands with a
 * jump. The e2e's `it does not start over its place` is what holds these two to each other.
 */
const FULL_SEARCH_H = 42 + 12;

/** The plot's width: the panel's, less the break and the pile. */
const PLOT_WIDTH = 'calc(100% - var(--pile-gap) - var(--pile-w))';

type PayCounts = NonNullable<HomeStats['pay_counts']>;

/** Each staff category's ink (app.css, one per scheme, each a lone dot at 3:1 or better against the
 *  card). By name, so a category keeps its colour if the stacking order changes. */
const CATEGORY_INK: Record<string, string> = {
  'Academic Staff': 'var(--cat-academic)',
  'University Staff': 'var(--cat-university)',
  Faculty: 'var(--cat-faculty)',
  'Employees in Training': 'var(--cat-training)',
  Limited: 'var(--cat-limited)',
};
const categoryInk = (name: string) => CATEGORY_INK[name] ?? 'var(--cat-other)';

/** A found person's name over their dot: the label's line box and the least gap between two of them,
 *  px; where the first row sits below the top of the field; the padding around the measured name; the
 *  widest a label may be; and the size it is drawn at. */
const FOUND_LABEL = { h: 19, gap: 8, top: 2, pad: 16, maxW: 180, font: 12 } as const;
/** A person the search is showing who is on the graph: where their dot is. */
interface FoundPerson extends ShownPerson { spot: DotSpot }
/** The card about a found person's dot, CSS px wide. */
const FOUND_CARD_W = 240;

function Distribution({
  bins, payCounts, p25, median, p75, cap, overflow, headcount, byCategory, controls, found = [], activeKey = null, openRef,
  search, onFullChange,
}: {
  bins: Bin[];
  /** One count per $100 (home-stats.json); without it the dots are spread across each $1k bin. */
  payCounts?: PayCounts | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  cap: number | null;
  overflow: number | null;
  headcount: number | null;
  /** Colour the dots by staff category, each column stacked into bands. */
  byCategory: boolean;
  /** The panel's own controls (the grouping toggle), over its top-right corner, or above the plot on
   *  a phone. */
  controls?: ReactNode;
  /** The people the search is showing who are on the graph: their dots are marked. */
  found?: FoundPerson[];
  /** The person the search list has active: their name is shown over their dot. */
  activeKey?: string | null;
  /** Set to open a found person from their dot (the search's pick calls it); false if they are not shown. */
  openRef?: MutableRefObject<((key: string) => boolean) | null>;
  /** A search box for the panel itself, shown only full page — where the page's own box is off the
   *  screen behind the scrim, and a graph this size is the one worth searching against. */
  search?: ReactNode;
  /** Told when the panel goes full page and comes back, so the page can put its own search box away
   *  while the panel carries one. */
  onFullChange?: (full: boolean) => void;
}) {
  // A light kernel over the raw counts: enough to keep 250 points from reading as static, not enough
  // to sand off the round-number spikes at $35k / $40k / $50k, which are real people rather than
  // noise. See `KERNEL_SIGMA` for the measurements the width was chosen against.
  // Drawn from the artifact's counts per $100 rebuilt at `CURVE_STEP` — five times the resolution of
  // the $1k bins the readout counts — so the line is a curve rather than a 250-segment polyline.
  // Without those counts (an older snapshot, drawn through the SQL fallback) it is the bins as before.
  const curveBins = useMemo(
    () => (payCounts?.counts.length ? binsFromCounts(payCounts.lo100, payCounts.counts, CURVE_STEP) : bins),
    [payCounts, bins],
  );
  const curve = useMemo(() => smoothBins(curveBins), [curveBins]);
  /** Dollars between two of the curve's points. */
  const curveStep = curveBins.length > 1 ? curveBins[1].bucket - curveBins[0].bucket : BIN_DOLLARS;
  const labelRowRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [labelRows, setLabelRows] = useState<number[]>([0, 0, 0]);
  // Index into `curve` under the pointer, or null. The plot is `aria-hidden`: everything the readout
  // says is already stated without it — the quartile markers below the curve, and the caption's
  // headcount.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // The pile of people above the cap is under the pointer.
  const [hoverPile, setHoverPile] = useState(false);
  // Rendered width of the plot, in px. The axis needs it: how many salary labels fit is a question
  // about pixels, not about the dollar range, and answering it from the range alone put "$200k" and
  // "$250k+" flush against each other at 375px.
  const [plotW, setPlotW] = useState(0);
  // The pile's label under it ("574 at $250k+"), measured: it reaches left past the pile into the
  // plot's own axis, and a tick there is dropped rather than drawn into it.
  const pileLabelRef = useRef<HTMLElement | null>(null);
  const [pileLabelW, setPileLabelW] = useState(0);
  // Rendered width of the readout pill. It has to be measured rather than estimated: the text
  // carries four variable-length fields, and the pill is 65% of the panel's width on a phone, so
  // where it may sit is a question about pixels that changes as the reader moves the pointer.
  const pillRef = useRef<HTMLDivElement>(null);
  const [pillW, setPillW] = useState(0);
  // Where the pointer is, for a mouse: the magnifying glass sits there.
  const [lensAt, setLensAt] = useState<{ x: number; y: number } | null>(null);
  // The glass (FisheyeLens) and what it draws from: both fields' dots, and the boxes everything else
  // on the chart is placed in.
  const lensRef = useRef<FisheyeLensHandle>(null);
  const mainDotsRef = useRef<DotFieldHandle>(null);
  const pileDotsRef = useRef<DotFieldHandle>(null);
  const mainBoxRef = useRef<HTMLDivElement>(null);
  const pileBoxRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const redrawLens = useCallback(() => lensRef.current?.redraw(), []);
  const lensDrawRef = useRef<(ctx: CanvasRenderingContext2D, view: LensView) => void>(() => {});
  // What the glass reads from the page once per hover rather than every frame: the colours it draws
  // in, and each label under the plot with its place and type. Nothing moves them while pointing.
  const lensPageRef = useRef<{ tok: (name: string) => string; labels: { text: string; x: number; y: number; w: number; size: number; weight: string; family: string; color: string }[] } | null>(null);
  const drawLens = useCallback((ctx: CanvasRenderingContext2D, view: LensView) => lensDrawRef.current(ctx, view), []);
  // Once a session, for both fields together: the pile lands after the curve's last dots.
  const entrance = useEntranceOnce();
  const phone = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  // Where there is no hover, a finger taps; the hints say so.
  const canHover = useMediaQuery('(hover: hover)', true, { getInitialValueInEffect: false }) ?? true;
  const motion = !prefersReducedMotion();
  // The fall into place, on demand ("Drop again"), and the one staff category shown alone, if any.
  const [replay, setReplay] = useState(0);
  const [solo, setSolo] = useState<number | null>(null);
  // A readout a finger tapped stays until a tap elsewhere; a touch pointer "leaves" as it lifts.
  const [tapped, setTapped] = useState(false);
  const tapRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  // A drag with the mouse button held, while it is held: where it last stirred the dots, where the
  // pointer last was and when, how fast it is going, px/ms, and which way (a unit vector; 0, 0 before it
  // has moved).
  const stirRef = useRef<{ at: { x: number; y: number }; last: { x: number; y: number }; t: number; v: number; ux: number; uy: number } | null>(null);
  // A finger held still on the plot brings up the glass above it; `magnify` while it is up.
  const holdRef = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const [magnify, setMagnify] = useState(false);
  const magnifyRef = useRef(false);
  // Full page: the panel fills the window (a portal over the page and its header), and the plot grows
  // to the height it leaves — `fullH`, measured. The panel's box on the page, where it grows from and
  // shrinks back to, and its height, which the page keeps while it is away.
  const [full, setFull] = useState(false);
  const [fullH, setFullH] = useState(0);
  const [pageH, setPageH] = useState(0);
  const fullRef = useRef(false);
  fullRef.current = full;
  const fullChangeRef = useRef(onFullChange);
  fullChangeRef.current = onFullChange;
  useEffect(() => { fullChangeRef.current?.(full); }, [full]);
  const panelRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const growFromRef = useRef<DOMRect | null>(null);
  const closingRef = useRef(false);
  const refocusRef = useRef(false);
  const baseH = phone ? PLOT_H.phone : Math.round(Math.min(PLOT_H.most, Math.max(PLOT_H.wide, plotW * PLOT_ASPECT)));
  const H = full && fullH > 0 ? fullH : baseH;
  // The clear band above the peak keeps its share of the plot.
  const HEAD = Math.round(H * (phone ? HEADROOM.phone / PLOT_H.phone : HEADROOM.wide / PLOT_H.wide));

  // One dot per person, under the curve (DotField). Everyone the bins describe: the counts per $100
  // when the artifact carries them, otherwise each $1k bin's people spread across its thousand — and,
  // by category, each person's category, largest first.
  const categories = payCounts?.categories?.length ? payCounts.categories : null;
  const { people, cats } = useMemo(() => {
    if (payCounts?.counts.length) {
      const { pays, kinds } = peopleFromCounts(payCounts.lo100, payCounts.counts, categories);
      return { people: pays, cats: kinds };
    }
    const out: number[] = [];
    for (const b of bins) for (let i = 0; i < b.n; i++) out.push(b.bucket + ((i + 0.5) / b.n) * 1000);
    return { people: Float64Array.from(out), cats: null };
  }, [payCounts, categories, bins]);
  const colour = byCategory && !!cats && !!categories;
  const inks = useMemo(() => (categories ?? []).map((c) => categoryInk(c.name)), [categories]);
  // A category shown alone only means something in its colours; back to "Generic", everyone is back.
  useEffect(() => { if (!colour) setSolo(null); }, [colour]);
  const shownSolo = colour ? solo : null;
  // Each category's people in the readout's $1k bins, from its counts per $100: a soloed readout
  // counts its own people.
  const categoryBins = useMemo(() => (categories ?? []).map((c) => {
    const m = new Map<number, number>();
    c.counts.forEach((n, b) => {
      if (!n) return;
      const bucket = Math.floor(((payCounts?.lo100 ?? 0) + b) / 10) * 1000;
      m.set(bucket, (m.get(bucket) ?? 0) + n);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, n]) => ({ bucket, n }));
  }), [categories, payCounts]);
  // The people the search found: their dots marked (DotField `marks`), a card for the one pointed at or
  // tapped, their name over the one the search list has active, and a press on a mark that opens them
  // (components/PersonReveal) rather than bursting the dots.
  const reveal = useReveal();
  const foundMain = useMemo(() => found.filter((f) => f.spot.field === 'main'), [found]);
  const foundPile = useMemo(() => found.filter((f) => f.spot.field === 'pile'), [found]);
  const mainMarks = useMemo(() => foundMain.map((f) => f.spot.index), [foundMain]);
  const pileMarks = useMemo(() => foundPile.map((f) => f.spot.index), [foundPile]);
  const [card, setCard] = useState<{ key: string; pinned: boolean } | null>(null);
  const pressRef = useRef<{ key: string; x: number; y: number } | null>(null);
  useEffect(() => { if (card && !found.some((f) => f.person_key === card.key)) setCard(null); }, [found, card]);
  // The one the reader is on — the row the search list has active, or the dot whose card is up. Their
  // mark is drawn at twice the size (DotField `markBig`), so which of the green dots is "this one" is
  // answered on the graph rather than only in the list.
  const bigKey = activeKey ?? card?.key ?? null;
  const bigFound = bigKey ? found.find((f) => f.person_key === bigKey) ?? null : null;
  const bigMain = bigFound && bigFound.spot.field === 'main' ? bigFound.spot.index : null;
  const bigPile = bigFound && bigFound.spot.field === 'pile' ? bigFound.spot.index : null;
  const markHit = (field: 'main' | 'pile', e: ReactPointerEvent<HTMLDivElement>): FoundPerson | null => {
    const list = field === 'main' ? foundMain : foundPile;
    if (!list.length) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const i = (field === 'main' ? mainDotsRef : pileDotsRef).current?.markAt(e.clientX - box.left, e.clientY - box.top);
    return i == null ? null : list.find((f) => f.spot.index === i) ?? null;
  };
  const openFound = useCallback((f: FoundPerson) => {
    const at = (f.spot.field === 'main' ? mainDotsRef : pileDotsRef).current?.positionOf(f.spot.index);
    const box = (f.spot.field === 'main' ? mainBoxRef : pileBoxRef).current?.getBoundingClientRect();
    if (!reveal || !at || !box) return false;
    setCard(null);
    reveal({ person: { key: f.person_key, name: f.name, title: f.title, school: f.school, pay: f.pay }, from: { x: box.left + at.x, y: box.top + at.y, r: at.r } });
    return true;
  }, [reveal]);
  useEffect(() => {
    if (!openRef) return;
    openRef.current = (key) => { const f = found.find((p) => p.person_key === key); return !!f && openFound(f); };
    return () => { openRef.current = null; };
  }, [openRef, found, openFound]);
  // Whether the dots are on their way somewhere — the fall, a re-stack, the field laid out again for
  // full page — rather than at rest. A dot in flight has no place to hang a name on.
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const read = () => setMoving(panel.querySelector('.hero-dots')?.getAttribute('data-settled') === 'false');
    read();
    const obs = new MutationObserver(read);
    obs.observe(panel, { attributes: true, subtree: true, attributeFilter: ['data-settled'] });
    return () => obs.disconnect();
  }, [full]);
  // Where each found person's dot is, for the card and the name — read again once a fall or a re-stack
  // has put the dots in their places.
  const [foundAt, setFoundAt] = useState<Map<string, { x: number; y: number; r: number; field: 'main' | 'pile' }>>(() => new Map());
  useEffect(() => {
    if (!found.length) { setFoundAt(new Map()); return; }
    const read = () => {
      const m = new Map<string, { x: number; y: number; r: number; field: 'main' | 'pile' }>();
      for (const f of found) {
        const at = (f.spot.field === 'main' ? mainDotsRef : pileDotsRef).current?.positionOf(f.spot.index, true);
        if (at) m.set(f.person_key, { ...at, field: f.spot.field });
      }
      setFoundAt(m);
    };
    read();
    const soon = window.setTimeout(read, 500), later = window.setTimeout(read, 1300);
    return () => { window.clearTimeout(soon); window.clearTimeout(later); };
    // `moving` is in here so the positions are read again the moment the dots come to rest: the timers
    // alone cannot be relied on to catch it. Going full page lays the field out afresh and the dots
    // travel to their new places — the one on top of the deepest column furthest of all — so the last
    // timed read could take a dot still in flight, with nothing afterwards to correct it.
  }, [found, H, plotW, full, colour, shownSolo, bigMain, bigPile, moving]);

  // A tapped readout goes at a tap anywhere else.
  useEffect(() => {
    if (!tapped) return;
    const away = (e: PointerEvent) => {
      if (mainBoxRef.current?.contains(e.target as Node)) return;
      setTapped(false);
      setHoverIdx(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [tapped]);

  // The people at or above the cap: a pile past a break at the right, so every person is a dot. Its
  // place along x means only "above the cap"; stacked by category like the rest.
  const over = overflow ?? 0;
  const pile = useMemo(() => {
    const n = over;
    // Spread along the pile's width by a golden-ratio stride rather than in order, so each category's
    // people are across every column and stack into bands — in order, each took a strip of its own.
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = (i * 0.6180339887498949 + 0.5 / n) % 1;
    let kinds: Uint8Array | null = null;
    if (categories && categories.reduce((t, c) => t + (c.over ?? 0), 0) === n) {
      kinds = new Uint8Array(n);
      let k = 0;
      categories.forEach((c, ci) => { for (let i = 0; i < (c.over ?? 0); i++) kinds![k++] = ci; });
    }
    return { values, kinds };
  }, [over, categories]);

  const curveLo = curve[0]?.bucket ?? 0;
  const curveSpan = (curve[curve.length - 1]?.bucket ?? 1) - curveLo || 1;
  const curveMax = useMemo(() => Math.max(1, ...curve.map((b) => b.n)), [curve]);
  const dotX = useCallback((v: number, width: number) => ((v - curveLo) / curveSpan) * width, [curveLo, curveSpan]);
  // The curve's height above the baseline at a pixel, as the line draws it: the same interpolation
  // between the smoothed $1k points, in the same box, peaking `HEAD` below its top.
  const dotHeight = useCallback((x: number, width: number) => {
    if (curve.length < 2) return 0;
    const v = curveLo + (x / width) * curveSpan;
    const i = Math.min(curve.length - 2, Math.max(0, Math.floor((v - curveLo) / curveStep)));
    const a = curve[i], b = curve[i + 1];
    const f = Math.min(1, Math.max(0, (v - a.bucket) / ((b.bucket - a.bucket) || 1)));
    const n = a.n + (b.n - a.n) * f;
    return (n / curveMax) * (H - HEAD - 2) + 2;
  }, [curve, curveLo, curveSpan, curveStep, curveMax, H, HEAD]);
  // The pile is packed as densely as the field: its height is the curve's mean height, and its width
  // the plot's times the share of people it holds, so each dot has the same room as one under the curve.
  const pileH = useMemo(() => {
    if (curve.length < 2) return 0;
    let t = 0;
    for (const b of curve) t += (b.n / curveMax) * (H - HEAD - 2) + 2;
    return Math.round(t / curve.length);
  }, [curve, curveMax, H, HEAD]);
  const pileShare = people.length > 0 ? over / people.length : 0;
  const hasPile = over > 0 && pileH > 0;
  const pileX = useCallback((v: number, width: number) => v * width, []);
  const pileHeight = useCallback(() => pileH, [pileH]);

  // p25 and median sit close together on a right-skewed curve, so their labels overlap and render as
  // one unreadable run — the same failure PeerRangeBar hit. Reuse its pure row-assignment helper
  // against measured DOM geometry rather than guessing from percentages, and re-measure once the
  // webfont lands (a swap changes label widths after the first pass).
  useLayoutEffect(() => {
    const row = labelRowRef.current;
    if (!row) return;
    const measure = () => {
      // Whatever the glass read of the labels' places is stale now.
      lensPageRef.current = null;
      const els = labelRefs.current.filter((el): el is HTMLDivElement => !!el);
      if (!els.length) return;
      // `offsetLeft` IS the centre here: the label is positioned by `left: X%` and then visually
      // recentred with translateX(-50%), which does not move offsetLeft. Adding half the width would
      // shift every centre right by that much and quietly corrupt the collision math.
      const next = assignLabelRows(
        els.map((el) => el.offsetLeft),
        els.map((el) => el.offsetWidth),
      );
      setLabelRows((prev) => (prev.length === next.length && prev.every((r, i) => r === next[i]) ? prev : next));
      setPlotW(row.offsetWidth);
      setPileLabelW(pileLabelRef.current?.offsetWidth ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    labelRefs.current.forEach((el) => el && ro.observe(el));
    if (pileLabelRef.current) ro.observe(pileLabelRef.current);
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    // `full`: the panel is a new element each way (a portal), and its rows are measured afresh.
  }, [bins, p25, median, p75, full]);

  // Keyed on everything the pill's text is built from — the bucket under the pointer, and the two
  // inputs to the count and the percentile. That is the full set: a text that has not changed has
  // not changed width, and a dependency-less effect that calls setState is one typo away from a
  // render loop, which is exactly what react-hooks warns about.
  useLayoutEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    setPillW(el.offsetWidth);
  }, [hoverIdx, bins, headcount]);

  // The people the readout counts, drawn in a stronger ink: the highlight is exactly the pill's count
  // (the $1k bins within ±$5k of the bucket under the pointer).
  // Snapped to the $1k grid the raw bins are kept on: the line got finer, the count it reports did
  // not. Everything the readout says — the band, the count, the percentile, the pay it names — is
  // built from this, so the drawing and the number never describe different neighbourhoods.
  const hoveredBucket = hoverIdx != null && curve[hoverIdx]
    ? Math.round(curve[hoverIdx].bucket / BIN_DOLLARS) * BIN_DOLLARS
    : null;
  const highlight = useMemo<[number, number] | null>(
    () => (hoveredBucket != null ? [hoveredBucket - READOUT_RADIUS, hoveredBucket + READOUT_RADIUS + BIN_DOLLARS] : null),
    [hoveredBucket],
  );

  // The wash under the curve: the shared area gradient's id, unique on the page (and fit for a url(#…)).
  const washId = `wash${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // The curve's point nearest the median: where a keyboard's readout starts.
  const medianIdx = useMemo(() => {
    if (median == null || !curve.length) return 0;
    let best = 0;
    for (let i = 1; i < curve.length; i++) if (Math.abs(curve[i].bucket - median) < Math.abs(curve[best].bucket - median)) best = i;
    return best;
  }, [curve, median]);
  // While the glass is up under a finger, the finger moves the glass, not the page: a touchmove that
  // scrolls cannot be stopped from a pointer event, only from a touch listener that is not passive.
  const plotReady = bins.length >= 3;
  useEffect(() => {
    const el = mainBoxRef.current;
    if (!el) return;
    // Full page too: there is no page to scroll there, and a finger stirs the dots.
    const block = (e: TouchEvent) => { if (magnifyRef.current || fullRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [plotReady, full]);

  // Full page, open: the page under it does not scroll, and Escape closes it — unless something over it
  // has the keyboard (the command palette), or the readout took the key first (the slider's own Escape).
  const closeFull = () => {
    const el = panelRef.current, ph = placeholderRef.current;
    if (!fullRef.current || closingRef.current) return;
    refocusRef.current = true;
    if (!el || !ph || prefersReducedMotion()) { setFull(false); return; }
    closingRef.current = true;
    const to = el.getBoundingClientRect();
    const frames = flipFrames(ph.getBoundingClientRect(), to).reverse();
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
    // A first guess at the plot's height from the panel as it is, measured again once it is full — less
    // the search row, which the panel only carries full page and so is not in the height being read here.
    const pad = phone ? FULL_PAD.phone : FULL_PAD.wide;
    const furniture = el.offsetHeight - H + (search ? FULL_SEARCH_H : 0);
    setFullH(Math.max(baseH, Math.floor(window.innerHeight - 2 * pad - furniture)));
    setLensAt(null);
    setHoverIdx(null);
    setTapped(false);
    setFull(true);
  };
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    root.classList.add('hero-full-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = panelRef.current;
      const at = document.activeElement;
      if (el && at && at !== document.body && !el.contains(at)) return;
      closeFullRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => { root.classList.remove('hero-full-open'); document.removeEventListener('keydown', onKey); };
  }, [full]);
  // The plot's height full page: the window's, less the room round the panel and everything in the
  // panel that is not the plot — measured, since the legend wraps to the width — and again on a resize.
  useLayoutEffect(() => {
    if (!full) return;
    const measure = () => {
      const el = panelRef.current;
      if (!el) return;
      const pad = phone ? FULL_PAD.phone : FULL_PAD.wide;
      const next = Math.max(baseH, Math.floor(window.innerHeight - 2 * pad - (el.offsetHeight - H)));
      setFullH((h) => (Math.abs(h - next) < 2 ? h : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [full, H, phone, baseH]);
  // Growing out of its place as it opens; and focus back on the button that opened it once it closes.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (full) {
      const from = growFromRef.current;
      growFromRef.current = null;
      if (!el || !from || prefersReducedMotion()) return;
      el.animate(flipFrames(from, el.getBoundingClientRect()), { duration: FULL_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FULL_MS, easing: 'ease-out' });
    } else if (refocusRef.current) {
      refocusRef.current = false;
      toggleRef.current?.focus();
    }
  }, [full]);
  // A hold still waiting when the chart goes.
  useEffect(() => () => { if (holdRef.current) window.clearTimeout(holdRef.current.timer); }, []);

  // The long tail (lib/tail): the pile's people at their own pay — `over_pays`, in the pile's own order —
  // unrolled onto an axis run out to the top salary when the pile is clicked. The graph squeezes to its
  // share of that axis; the pile's dots fly out from where they sit to theirs; the axis and a caption say
  // where it ends; a click, Escape or a few seconds fold it back.
  const tailPays = useMemo(() => {
    if (!categories?.length || !categories.every((c) => Array.isArray(c.over_pays) && c.over_pays.length === (c.over ?? 0))) return null;
    const v = Float64Array.from(categories.flatMap((c) => c.over_pays ?? []));
    return v.length > 0 && v.length === over ? v : null;
  }, [categories, over]);
  const tailTop = useMemo(() => (tailPays ? tailPays.reduce((m, v) => Math.max(m, v), 0) : 0), [tailPays]);
  const [tail, setTail] = useState<{ phase: 'opening' | 'open' | 'closing'; from: Float32Array; key: number; rowW: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const tailDotsRef = useRef<DotFieldHandle>(null);
  // The top earner's dot once the tail is out, in the row's px: a lone dot at the far end is easy to miss.
  const [tailTopAt, setTailTopAt] = useState<{ x: number; y: number; r: number } | null>(null);
  const washGRef = useRef<SVGGElement>(null);
  const plotGRef = useRef<SVGGElement>(null);
  const tailX = useCallback((v: number, width: number) => ((v - curveLo) / Math.max(1, tailTop - curveLo)) * width, [curveLo, tailTop]);
  // A dot's room under the curve, px², so the tail's hill packs its dots as tightly as the graph's.
  const perDot = useMemo(() => {
    if (!(plotW > 0) || !people.length) return 0;
    let a = 0;
    for (let c = 0; c < plotW; c++) a += dotHeight(c + 0.5, plotW);
    return a / people.length;
  }, [plotW, dotHeight, people]);
  const tailHeight = useMemo(() => {
    let cache: { width: number; h: Float32Array } | null = null;
    return (x: number, width: number) => {
      if (!tailPays) return 0;
      if (!cache || cache.width !== width) {
        cache = { width, h: tailHeights(Float32Array.from(tailPays, (v) => tailX(v, width)), width, perDot, H - HEAD) };
      }
      return cache.h[Math.min(cache.h.length - 1, Math.max(0, Math.floor(x)))];
    };
  }, [tailPays, tailX, perDot, H, HEAD]);
  const closeTail = useCallback(() => {
    setTail((t) => (!t || t.phase === 'closing' ? t : prefersReducedMotion() ? null : { ...t, phase: 'closing', key: 3 }));
  }, []);
  // The unrolled field is drawn at the pile first; once it has been, its dots set off.
  const tailDrawn = useCallback(() => setTail((t) => (t && t.phase === 'opening' && t.key === 1 ? { ...t, key: 2 } : t)), []);
  const tailPhase = tail?.phase ?? null;
  const tailKey = tail?.key ?? null;
  useEffect(() => {
    if (tailPhase === 'opening' && tailKey === 2) {
      const id = window.setTimeout(() => setTail((t) => (t && t.phase === 'opening' ? { ...t, phase: 'open' } : t)), MOVE_MS + MOVE_STAGGER);
      return () => window.clearTimeout(id);
    }
    if (tailPhase === 'open') {
      const id = window.setTimeout(closeTail, TAIL_OPEN_MS);
      return () => window.clearTimeout(id);
    }
    if (tailPhase === 'closing') {
      const id = window.setTimeout(() => setTail(null), MOVE_MS + MOVE_STAGGER);
      return () => window.clearTimeout(id);
    }
  }, [tailPhase, tailKey, closeTail]);
  useEffect(() => {
    if (tailPhase !== 'open' || !tailPays) { setTailTopAt(null); return; }
    let top = 0;
    for (let k = 1; k < tailPays.length; k++) if (tailPays[k] >= tailPays[top]) top = k;
    setTailTopAt(tailDotsRef.current?.positionOf(top) ?? null);
  }, [tailPhase, tailPays]);
  // Escape folds it back — before anything else Escape does (full page's own, say).
  useEffect(() => {
    if (!tailPhase || tailPhase === 'closing') return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeTail(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [tailPhase, closeTail]);
  // A graph laid out again (a resize, full page) is not the one the tail unrolled from.
  useEffect(() => { setTail(null); }, [plotW, H, full, tailPays]);
  // How narrow the graph is drawn: the dots (DotField `squeeze`), and the curve, its wash and its guides,
  // eased the same way over the same time.
  const tailSqueeze = tail && tail.phase !== 'closing' ? squeezeFactor(curveLo, curveSpan, tailTop, plotW, tail.rowW) : 1;
  const squeezeAnim = useRef({ from: 1, to: 1, start: 0, raf: 0 });
  useEffect(() => {
    const st = squeezeAnim.current;
    const now = performance.now();
    const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
    const at = (t: number) => st.from + (st.to - st.from) * ease(Math.min(1, Math.max(0, (t - st.start) / MOVE_MS)));
    const set = (f: number) => {
      for (const g of [washGRef.current, plotGRef.current]) g?.setAttribute('transform', f === 1 ? '' : `scale(${f} 1)`);
    };
    st.from = at(now);
    st.to = tailSqueeze;
    st.start = now;
    cancelAnimationFrame(st.raf);
    if (prefersReducedMotion()) { set(tailSqueeze); return; }
    const step = (t: number) => {
      set(at(t));
      if (t - st.start < MOVE_MS) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(st.raf);
  }, [tailSqueeze]);
  // A name on every marked dot, not only the one the list has active. The labels are stacked into rows
  // across the top of the field so no two touch (`assignLabelRows`, which the quartile labels use), and
  // each is tied to its own dot by a leader that runs from the dot's green into the label's teal —
  // which dot a name belongs to is then answered by the picture, not by whichever is nearest. Nothing
  // while the pile is unrolled: the field is squeezed then, and these are its unsqueezed places.
  const foundLabels = useMemo(() => {
    if (tail || plotW <= 0 || !foundMain.length) return [];
    const spots = foundMain
      .map((f) => ({ f, at: foundAt.get(f.person_key) }))
      .filter((s): s is { f: FoundPerson; at: { x: number; y: number; r: number; field: 'main' | 'pile' } } => !!s.at && s.at.field === 'main')
      .sort((a, b) => a.at.x - b.at.x);
    if (!spots.length) return [];
    const placed = placeNearLabels(
      spots.map((s, i) => ({
        id: i,
        x: s.at.x,
        y: s.at.y,
        r: s.at.r,
        // The measured name plus its padding, with a little over for the weight it is drawn in —
        // `measureText` reads the page's font at its normal weight, and these are drawn heavier.
        width: Math.min(FOUND_LABEL.maxW, measureText(s.f.name, FOUND_LABEL.font) * 1.08 + FOUND_LABEL.pad),
        priority: s.f.person_key === activeKey ? 1 : 0,
      })),
      { left: 0, right: plotW, top: 2, bottom: H - 2 },
      // Seven levels is about 145px above the dot at most — a third of the plot — and the diagonals
      // stop sooner (`reach`). Past that a name stops reading as this dot's and starts reading as a
      // legend that happens to have a line attached.
      { height: FOUND_LABEL.h, levels: phone ? 4 : 7 },
    );
    return placed.map((l) => {
      const s = spots[l.id];
      // The leader leaves the dot's rim pointing at where the label hangs, and ends exactly where the
      // placing said it would — so the line a reader follows is the line the layout reasoned about.
      const end = l.anchor;
      const d = Math.hypot(end.x - s.at.x, end.y - s.at.y) || 1;
      const rim = s.at.r + 2;
      return {
        key: s.f.person_key,
        name: s.f.name,
        active: s.f.person_key === activeKey,
        cx: l.cx,
        w: l.box.right - l.box.left,
        top: l.box.top,
        from: { x: s.at.x + ((end.x - s.at.x) / d) * rim, y: s.at.y + ((end.y - s.at.y) / d) * rim },
        to: end,
      };
    });
  }, [tail, plotW, foundMain, foundAt, activeKey, phone, H]);

  if (bins.length < 3) return null;

  // 1000 wide, drawn `H` tall (PLOT_H). It was 120, and at the ~848px the panel gave it that was a 7:1
  // box — wide enough that the two features the $1k buckets exist to resolve (the shoulder near $57k
  // and the step near $130k) flattened back into the curve they were rescued from. Height is
  // amplitude, not padding: every slope is steeper for the same data.
  const W = 1000;
  const maxN = Math.max(...curve.map((b) => b.n), 1);
  const lo = curve[0].bucket;
  const hi = curve[curve.length - 1].bucket;
  const span = hi - lo || 1;
  const X = (v: number) => ((v - lo) / span) * W;
  const Y = (n: number) => H - (n / maxN) * (H - HEAD - 2) - 2;
  const pts = curve.map((b) => `${X(b.bucket).toFixed(1)},${Y(b.n).toFixed(1)}`);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ');
  // The area under the curve, down to the baseline: the wash behind the dots.
  const area = `${line} L${X(hi).toFixed(1)},${H} L${X(lo).toFixed(1)},${H} Z`;

  // Round salary steps for the axis, coarsened until the labels actually fit the rendered width.
  // `AXIS_LABEL_W` is the pitch one label needs to stay legible with a gap either side; before the
  // measurement fed into this, the phone got the desktop's six ticks and the last two collided.
  const fits = Math.max(3, Math.floor(plotW / AXIS_LABEL_W));
  const step = TICK_STEPS.find((s) => span / s <= fits) ?? TICK_STEPS[TICK_STEPS.length - 1];
  // The right edge belongs to the cap label ("$250k+"), which is right-aligned and wider than a
  // plain tick — so a tick that lands underneath it is dropped rather than drawn into it.
  // With a pile, its label reaches left past the pile into the plot's axis by `reachIn` px.
  const pileAside = hasPile ? PILE_GAP + Math.max(PILE_MIN_W, plotW * pileShare) : 0;
  const reachIn = hasPile ? Math.max(0, pileLabelW - pileAside) : 0;
  const rightGuard = 1 - (hasPile ? reachIn + AXIS_LABEL_W / 2 + 8 : AXIS_LABEL_W) / plotW;
  const ticks: number[] = [];
  // Nothing until the row has been measured. The alternative — guess a width, then correct it once
  // the measurement lands — paints one tick set and replaces it with another, and a screenshot taken
  // in between captures whichever it caught. That is exactly what happened: the same build rendered
  // six labels in one run and eleven in the next, and the committed baseline had frozen the guess.
  // `useLayoutEffect` sets `plotW` before the browser paints, so in practice this costs no frame.
  if (plotW > 0) {
    for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
      if (X(v) / W < rightGuard) ticks.push(v);
    }
  }

  // Only draw a marker that actually falls inside the plotted range.
  const inRange = (v: number | null): v is number => v != null && v >= lo && v <= hi;
  // Named in full where there is room for it: "p25" is a statistician's shorthand on a page written
  // for everyone else, and this is the one place the chart explains its own guides. The phone keeps
  // the shorthand — all three labels crowd at 375px, and a wrapped label is worse than a terse one.
  const marks: { v: number; label: string; strong: boolean }[] = [
    ...(inRange(p25) ? [{ v: p25, label: phone ? 'p25' : '25th percentile', strong: false }] : []),
    ...(inRange(median) ? [{ v: median, label: 'median', strong: true }] : []),
    ...(inRange(p75) ? [{ v: p75, label: phone ? 'p75' : '75th percentile', strong: false }] : []),
  ];

  // The curve is a density, so its height is not a headcount and must never be shown as one. The
  // readout names the bucket under the pointer and counts the RAW bins around it, which is what makes
  // a mound legible: "this hump is 1,240 people, not a taller line".
  const hovered = hoverIdx != null ? curve[hoverIdx] : null;
  const hoverPct = hovered ? (X(hovered.bucket) / W) * 100 : 0;
  // The band covers the dollars the count covers: the $1k bins within ±$5k of the bucket, so from
  // $5k below it to the end of the bin $5k above. Clamped to the plotted range: near either end the
  // band would otherwise hang off the panel and claim to cover salaries the chart does not draw.
  const bandLo = hoveredBucket != null ? Math.max(lo, hoveredBucket - READOUT_RADIUS) : 0;
  const bandHi = hoveredBucket != null ? Math.min(hi, hoveredBucket + READOUT_RADIUS + BIN_DOLLARS) : 0;
  // Against the full headcount, not the binned total — the people above the $250k cap are still
  // people, and leaving them out would put the top of the drawn range at the 100th percentile.
  const share = hoveredBucket != null && headcount ? countBelow(bins, hoveredBucket) / headcount : null;
  // With one category shown alone, the readout is of its people: how many within ±$5k, and where
  // the pointer's pay falls among them (everyone in it, above the cap too).
  const soloCat = shownSolo != null && categories ? categories[shownSolo] : null;
  const soloBins = shownSolo != null ? categoryBins[shownSolo] : null;
  const readCount = hoveredBucket != null ? countWithin(soloBins ?? bins, hoveredBucket, READOUT_RADIUS) : 0;
  const readShare = hoveredBucket != null && soloCat && soloBins ? countBelow(soloBins, hoveredBucket) / soloCat.n : share;
  // The readout as a screen reader hears it: the slider's value.
  const readoutText = hoveredBucket != null
    ? `${fmtK(hoveredBucket)}: ${num(readCount)} ${soloCat ? soloCat.name : 'people'} within ±${fmtK(READOUT_RADIUS)}${readShare != null ? `, ${ordinal(Math.min(99, Math.max(1, Math.round(readShare * 100))))} percentile${soloCat ? ` of ${soloCat.name}` : ''}` : ''}`
    : 'Move along the pay distribution with the arrow keys';
  // The glass sits on a mouse's pointer, or above a finger that holds it up.
  const lensLift = magnify ? -(LENS_D / 2 + HOLD_LIFT) : 0;
  const lensShownY = (lensAt?.y ?? 0) + lensLift;
  // Centred on the readout, then clamped to the plot's own edges. This replaces a pair of magic
  // thresholds (anchor left below 15%, right above 85%) that assumed a pill narrower than the one
  // the percentile made it: at 375px a 224px pill centred at 30% hung 2px off the panel, because
  // 30% is neither end. Clamping asks the question the thresholds were approximating.
  const pillLeft = plotW > 0 && pillW > 0
    ? Math.max(0, Math.min(plotW - pillW, (hoverPct / 100) * plotW - pillW / 2))
    : null;
  const onHover = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Unrolled, the graph is squeezed: nothing under the pointer reads as it would.
    if (tail) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    if (e.pointerType === 'mouse' && foundMain.length) {
      const f = markHit('main', e);
      if (f) {
        if (card?.key !== f.person_key) setCard({ key: f.person_key, pinned: false });
        setHoverIdx(null);
        setLensAt(null);
        return;
      }
      if (card && !card.pinned) setCard(null);
    }
    const at = lo + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * span;
    let best = 0;
    for (let i = 1; i < curve.length; i++) {
      if (Math.abs(curve[i].bucket - at) < Math.abs(curve[best].bucket - at)) best = i;
    }
    setHoverPile(false);
    setHoverIdx(best);
    setLensAt(e.pointerType === 'mouse' ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
  };
  const onLeave = () => { setHoverIdx(null); setLensAt(null); lensPageRef.current = null; setCard((c) => (c?.pinned ? c : null)); };
  // The curve's point nearest a plot x, CSS px.
  const nearestAt = (x: number, width: number) => {
    const at = lo + Math.min(1, Math.max(0, x / Math.max(1, width))) * span;
    let best = 0;
    for (let i = 1; i < curve.length; i++) if (Math.abs(curve[i].bucket - at) < Math.abs(curve[best].bucket - at)) best = i;
    return best;
  };
  const clearHold = () => { if (holdRef.current) { window.clearTimeout(holdRef.current.timer); holdRef.current = null; } };
  const endMagnify = (pin: boolean) => {
    if (!magnifyRef.current) return;
    magnifyRef.current = false;
    setMagnify(false);
    setLensAt(null);
    lensPageRef.current = null;
    if (pin) setTapped(true); else setHoverIdx(null);
  };

  // The readout by keyboard: the plot is a slider over pay. The arrows step $1k (with Shift, or PageUp
  // and PageDown, $10k), Home and End go to the ends, Enter or Space bursts the dots at the readout's
  // point, and Escape puts the readout away. A keyboard focus starts it at the median.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!curve.length || tail) return;
    const last = curve.length - 1;
    const at = hoverIdx ?? medianIdx;
    // In points, not in bins: a finer curve must not turn one arrow press into a $250 step.
    const per1k = Math.max(1, Math.round(BIN_DOLLARS / curveStep));
    const big = (e.shiftKey ? 10 : 1) * per1k;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = Math.min(last, at + big); break;
      case 'ArrowLeft': case 'ArrowDown': next = Math.max(0, at - big); break;
      case 'PageUp': next = Math.min(last, at + 10 * per1k); break;
      case 'PageDown': next = Math.max(0, at - 10 * per1k); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'Enter': case ' ': {
        e.preventDefault();
        const box = mainBoxRef.current?.getBoundingClientRect();
        if (!box) return;
        const x = (X(curve[at].bucket) / W) * box.width;
        mainDotsRef.current?.burst(x, H - dotHeight(x, box.width) / 2);
        return;
      }
      case 'Escape': setHoverIdx(null); return;
      default: return;
    }
    e.preventDefault();
    setHoverPile(false);
    setLensAt(null);
    setHoverIdx(next);
  };
  // A drag's stir along its path through `pts` (the move's coalesced points, in the plot's CSS px): a wake
  // behind the pointer (lib/dotPhysics `stirKick`), its tip where the pointer is at each point and on every
  // STIR_STEP px of a longer move between them (`stirPath`), so a quick drag leaves no gaps — each as hard
  // as the drag is fast (`stirStrength`), its speed measured over the whole move since the last, so the
  // faster the drag the further the dots part and spread. It opens back along the way the drag goes,
  // eased over a few px (`wakeTurn`).
  const stirAlong = (pts: { x: number; y: number }[]) => {
    const now = performance.now();
    const st = stirRef.current;
    const end = pts[pts.length - 1];
    // Held down from off the plot: the stir starts here.
    if (!st) { stirRef.current = { at: end, last: end, t: now, v: 0, ux: 0, uy: 0 }; return; }
    let dist = 0, px = st.last.x, py = st.last.y;
    for (const p of pts) { dist += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
    const v = dragSpeed(st.v, dist, now - st.t);
    const strength = stirStrength(v);
    let from = st.at;
    const way = { ux: st.ux, uy: st.uy };
    for (const p of pts) {
      if (p.x === from.x && p.y === from.y) continue;
      wakeTurn(way.ux, way.uy, p.x - from.x, p.y - from.y, way);
      const steps = stirPath(from.x, from.y, p.x, p.y, STIR_STEP);
      const last = steps[steps.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) steps.push(p);
      for (const q of steps) mainDotsRef.current?.burst(q.x, q.y, { strength, ux: way.ux, uy: way.uy });
      from = p;
    }
    stirRef.current = { at: from, last: end, t: now, v, ux: way.ux, uy: way.uy };
    if (mainBoxRef.current) mainBoxRef.current.dataset.stir = strength.toFixed(2);
  };
  // A mouse's press bursts the dots where it is, and a drag with the button held stirs them along its
  // path (`stirAlong`). A finger's tap bursts too, shows
  // the readout there and ticks the phone — but a finger that moves is scrolling, and the browser takes
  // the gesture (no pointerup reaches here, or a pointercancel does).
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A press anywhere on an unrolled graph folds it back.
    if (tail) { closeTail(); return; }
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      const found1 = markHit('main', e);
      if (found1) { pressRef.current = { key: found1.person_key, x: e.clientX, y: e.clientY }; stirRef.current = null; return; }
      const box = e.currentTarget.getBoundingClientRect();
      const at = { x: e.clientX - box.left, y: e.clientY - box.top };
      mainDotsRef.current?.burst(at.x, at.y);
      stirRef.current = { at, last: at, t: performance.now(), v: 0, ux: 0, uy: 0 };
      return;
    }
    tapRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    stirRef.current = null;
    // Held still, it brings up the glass above the finger, magnifying what is under its tip.
    clearHold();
    const box = e.currentTarget.getBoundingClientRect();
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    holdRef.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      timer: window.setTimeout(() => {
        holdRef.current = null;
        tapRef.current = null;
        magnifyRef.current = true;
        setMagnify(true);
        setHoverPile(false);
        setHoverIdx(nearestAt(at.x, box.width));
        setLensAt(at);
        navigator.vibrate?.(8);
      }, HOLD_MS),
    };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tail) return;
    // A press on a mark that moves off it is a drag, not an open.
    const press = pressRef.current;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) pressRef.current = null;
    if (e.pointerType !== 'mouse') {
      const box = e.currentTarget.getBoundingClientRect();
      if (magnifyRef.current) {
        // The glass follows the finger, and so does the readout; the page does not scroll (below).
        setHoverIdx(nearestAt(e.clientX - box.left, box.width));
        setLensAt({ x: e.clientX - box.left, y: e.clientY - box.top });
        return;
      }
      // A finger that moves before the hold is up is scrolling.
      const hold = holdRef.current;
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) clearHold();
    }
    onHover(e);
    // A touch contact reports its button held as it moves: on the page a finger that moves is scrolling,
    // and only a mouse stirs. Full page there is nothing to scroll, and a finger that has moved off its
    // hold stirs as a mouse does.
    const stirs = e.pointerType === 'mouse' ? !!(e.buttons & 1) && !pressRef.current : full && !!(e.buttons & 1) && !holdRef.current;
    if (!stirs) { stirRef.current = null; return; }
    const box = e.currentTarget.getBoundingClientRect();
    const native = e.nativeEvent;
    const moves = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    stirAlong((moves.length ? moves : [native]).map((m) => ({ x: m.clientX - box.left, y: m.clientY - box.top })));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    stirRef.current = null;
    if (tail) return;
    const press = pressRef.current;
    pressRef.current = null;
    if (e.pointerType === 'mouse') {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 6) {
        const f = found.find((p) => p.person_key === press.key);
        if (f) openFound(f);
      }
      return;
    }
    clearHold();
    // Lifted from the glass: it goes, the readout stays where it was, and nothing is thrown.
    if (magnifyRef.current) { endMagnify(true); tapRef.current = null; return; }
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap || tap.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10 || performance.now() - tap.t > 400) return;
    // A tap on a mark shows its card, with a way in; a tap anywhere else puts a card away and bursts.
    const tappedFound = markHit('main', e);
    if (tappedFound) { setCard({ key: tappedFound.person_key, pinned: true }); return; }
    if (card) setCard(null);
    onHover(e);
    setTapped(true);
    const box = e.currentTarget.getBoundingClientRect();
    if (mainDotsRef.current?.burst(e.clientX - box.left, e.clientY - box.top)) navigator.vibrate?.(10);
  };
  // The browser took the gesture: no tap, no stir, no glass.
  const onCancel = () => { stirRef.current = null; tapRef.current = null; clearHold(); endMagnify(false); };

  // Unroll the pile: each of its dots sets off from where it is drawn in the pile, in the row's own px.
  const openTail = () => {
    if (!tailPays || tail) return;
    const row = rowRef.current?.getBoundingClientRect();
    const pileBox = pileBoxRef.current?.getBoundingClientRect();
    if (!row || !pileBox) return;
    const from = new Float32Array(2 * tailPays.length);
    for (let k = 0; k < tailPays.length; k++) {
      const at = pileDotsRef.current?.positionOf(k);
      from[2 * k] = pileBox.left - row.left + (at ? at.x : pileBox.width / 2);
      from[2 * k + 1] = pileBox.top - row.top + (at ? at.y : H);
    }
    setHoverPile(false);
    setHoverIdx(null);
    setLensAt(null);
    setCard(null);
    setTail(prefersReducedMotion() ? { phase: 'open', from, key: 2, rowW: row.width } : { phase: 'opening', from, key: 1, rowW: row.width });
  };
  // The tail's axis: round pays out to the top salary, as many as fit, clear of the fold-back label.
  const tailTicks: number[] = [];
  if (tail && plotW > 0 && tailTop > lo) {
    const rowW = tail.rowW;
    const fitsTail = Math.max(3, Math.floor(rowW / (AXIS_LABEL_W * 1.3)));
    const tailStep = [250000, 500000, 1000000, 2000000].find((s) => (tailTop - lo) / s <= fitsTail) ?? 2000000;
    for (let v = Math.ceil(lo / tailStep) * tailStep; v <= tailTop; v += tailStep) {
      if (((v - lo) / (tailTop - lo)) * rowW < rowW - pileLabelW - AXIS_LABEL_W / 2) tailTicks.push(v);
    }
  }

  // The card about a found person's dot: who they are, their pay and its path, and how to open them — a
  // mouse clicks the dot; a finger, having tapped it, taps the button. Above the dot, or below it near the
  // top of the plot.
  const cardPerson = card ? found.find((f) => f.person_key === card.key) ?? null : null;
  const cardSpot = cardPerson ? foundAt.get(cardPerson.person_key) ?? null : null;
  const foundCard = (field: 'main' | 'pile') => {
    if (!card || !cardPerson || !cardSpot || cardSpot.field !== field) return null;
    const detail = [cardPerson.title, cardPerson.school].filter(Boolean).join(' · ');
    const above = cardSpot.y - cardSpot.r - 10 > 120;
    return (
      <div
        className="chart-tip hero-found-card"
        data-found-card={cardPerson.person_key}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', zIndex: Z.local, width: FOUND_CARD_W,
          pointerEvents: card.pinned ? 'auto' : 'none',
          ...(field === 'main'
            ? { left: Math.min(Math.max(0, cardSpot.x - FOUND_CARD_W / 2), Math.max(0, plotW - FOUND_CARD_W)) }
            : { right: 0 }),
          top: above ? cardSpot.y - cardSpot.r - 10 : cardSpot.y + cardSpot.r + 10,
          transform: above ? 'translateY(-100%)' : undefined,
        }}
      >
        <Text fw={700} size="sm" lh={1.25}>{cardPerson.name}</Text>
        {detail && <Text size="xs" c="dimmed" lineClamp={2}>{detail}</Text>}
        <Group gap={8} mt={4} wrap="nowrap" justify="space-between">
          {cardPerson.pay != null && <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(cardPerson.pay)}</Text>}
          <Sparkline points={cardPerson.series} breaks={cardPerson.breaks} />
        </Group>
        {card.pinned
          ? <Button size="compact-xs" mt={6} fullWidth onClick={() => openFound(cardPerson)}>Open {cardPerson.name}</Button>
          : <Text size="xxs" c="dimmed" mt={4}>Click the dot to open</Text>}
      </div>
    );
  };
  // The name over the dot of the person the search list has active (unless its card is up).
  const activeFound = activeKey && activeKey !== card?.key ? found.find((f) => f.person_key === activeKey) ?? null : null;
  const activeSpot = activeFound ? foundAt.get(activeFound.person_key) ?? null : null;
  const foundName = (field: 'main' | 'pile') => {
    if (!activeFound || !activeSpot || activeSpot.field !== field) return null;
    return (
      <div
        aria-hidden
        className="hero-found-name"
        style={{
          position: 'absolute', zIndex: Z.local, pointerEvents: 'none',
          ...(field === 'main' ? { left: Math.min(Math.max(activeSpot.x, 70), Math.max(70, plotW - 70)), transform: 'translate(-50%, -100%)' } : { right: 0, transform: 'translateY(-100%)' }),
          top: activeSpot.y - activeSpot.r - 8,
        }}
      >
        <span className="chart-value-pill" style={{ whiteSpace: 'nowrap' }}>{activeFound.name}</span>
      </div>
    );
  };

  const pileHighlight = hoverPile ? PILE_ALL : null;
  const inkList = colour ? inks : undefined;

  // What the glass shows: the picture outside it, magnified — the dots of both fields, then the
  // markers, the curve, the band and the readout's point as the page draws them, then the labels under
  // the plot, every point pushed through the fisheye (FisheyeLens). Coordinates are the plot's own.
  lensDrawRef.current = (ctx, { cx, cy, R, dpr, map }) => {
    const mainEl = mainBoxRef.current;
    if (!mainEl) return;
    const mainBox = mainEl.getBoundingClientRect();
    const pw = mainBox.width;
    mainDotsRef.current?.drawInto(ctx, { cx, cy, R, ox: 0, oy: 0, dpr, map });
    const pileBox = pileBoxRef.current?.getBoundingClientRect();
    if (pileBox) pileDotsRef.current?.drawInto(ctx, { cx, cy, R, ox: pileBox.left - mainBox.left, oy: pileBox.top - mainBox.top, dpr, map });
    if (!lensPageRef.current) {
      const css = getComputedStyle(mainEl);
      const cache = new Map<string, string>();
      const tokRead = (name: string) => { let v = cache.get(name); if (v == null) { v = css.getPropertyValue(name).trim(); cache.set(name, v); } return v; };
      const labels = [...labelRefs.current, ...(axisRef.current ? Array.from(axisRef.current.children) : [])]
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .map((el) => {
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            text: el.textContent ?? '', x: b.left + b.width / 2 - mainBox.left, y: b.top + b.height / 2 - mainBox.top, w: b.width,
            size: parseFloat(cs.fontSize), weight: cs.fontWeight, family: cs.fontFamily, color: cs.color,
          };
        });
      lensPageRef.current = { tok: tokRead, labels };
    }
    const { tok, labels } = lensPageRef.current;
    const px = (v: number) => (X(v) / W) * pw;
    const path = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const m = map(x, y); if (i) ctx.lineTo(m.x, m.y); else ctx.moveTo(m.x, m.y); });
    };
    ctx.save();
    ctx.scale(dpr, dpr);
    for (const m of marks) {
      const x = px(m.v);
      if (Math.abs(x - cx) > R) continue;
      const pts: [number, number][] = [];
      for (let y = m.strong ? MARK_TOP.strong : MARK_TOP.plain; y <= H; y += 2) pts.push([x, y]);
      path(pts);
      ctx.strokeStyle = tok(m.strong ? '--mantine-color-accent-7' : '--mantine-color-gray-5');
      ctx.lineWidth = m.strong ? 1.5 : 1;
      ctx.setLineDash(m.strong ? [] : [2, 3]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // The curve, a point a pixel, its stroke as thick as the glass makes it where the pointer is.
    const curvePts: [number, number][] = [];
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(pw, Math.ceil(cx + R)); x++) curvePts.push([x, H - dotHeight(x, pw)]);
    if (curvePts.length > 1) {
      const scale = map(cx, H - dotHeight(Math.min(pw, Math.max(0, cx)), pw)).scale;
      path(curvePts);
      ctx.strokeStyle = tok('--mantine-color-accent-6');
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Its glow under it, as the page draws it.
      ctx.globalAlpha = parseFloat(tok('--curve-glow')) || 0;
      ctx.lineWidth = 6 * scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.75 * scale;
      ctx.stroke();
    }
    if (hovered && bandRef.current) {
      const bs = getComputedStyle(bandRef.current);
      const x0 = px(bandLo), x1 = px(bandHi);
      const edge = (x: number) => { const pts: [number, number][] = []; for (let y = 0; y <= H; y += 3) pts.push([x, y]); return pts; };
      const rim: [number, number][] = [...edge(x0)];
      for (let x = x0; x <= x1; x += 3) rim.push([x, H]);
      rim.push(...edge(x1).reverse());
      for (let x = x1; x >= x0; x -= 3) rim.push([x, 0]);
      path(rim);
      ctx.closePath();
      // Half the page's tint: magnified four times, the band fills most of the glass, and at full
      // strength it veiled the dots the glass is for. Its edges keep their full ink.
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = bs.backgroundColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bs.borderLeftColor;
      ctx.lineWidth = 1;
      for (const x of [x0, x1]) { path(edge(x)); ctx.stroke(); }
      // The readout's point on the curve, at most twice its size: at four times it covered the beads.
      const m = map(px(hovered.bucket), Y(hovered.n));
      const k = Math.min(2, m.scale);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 5 * k, 0, Math.PI * 2);
      ctx.fillStyle = tok('--mantine-color-accent-7');
      ctx.fill();
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = tok('--mantine-color-body');
      ctx.stroke();
    }
    // The labels under the plot, each at its place, its type as large as the glass makes it there.
    for (const l of labels) {
      if (Math.hypot(l.x - cx, l.y - cy) > R + l.w / 2) continue;
      const m = map(l.x, l.y);
      ctx.font = `${l.weight} ${l.size * m.scale}px ${l.family}`;
      ctx.fillStyle = l.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, m.x, m.y);
    }
    // A faint ring at the centre: where the pointer is.
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(R, R, 4, 0, Math.PI * 2);
    ctx.strokeStyle = tok('--mantine-color-text');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  // Full page, or back: one button, over the panel's corner with the rest of its controls.
  const fullToggle = phone ? (
    <ActionIcon
      ref={toggleRef} variant="subtle" size="md" className="hero-dist-full-toggle"
      aria-label={full ? 'Exit full page' : 'Full page'} onClick={full ? closeFull : openFull} data-autofocus={full || undefined}
    >
      {full ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
    </ActionIcon>
  ) : (
    <Button
      ref={toggleRef} variant="subtle" size="compact-xs" className="hero-dist-full-toggle"
      leftSection={full ? <IconArrowsMinimize size={14} /> : <IconArrowsMaximize size={14} />}
      onClick={full ? closeFull : openFull} data-autofocus={full || undefined}
    >
      {full ? 'Exit full page' : 'Full page'}
    </Button>
  );

  const panel = (
    // Not a link any more: the panel is for pointing at, and Divisions has its own link below it.
    <div
      ref={panelRef}
      className={`hero-dist glass${full ? ' hero-dist-full' : ''}`}
      data-full={full ? 'on' : 'off'}
      data-tail={tail ? tail.phase : 'off'}
      role={full ? 'dialog' : undefined}
      aria-modal={full || undefined}
      aria-label={full ? 'Pay distribution, full page' : undefined}
      style={{ '--pile-gap': `${hasPile ? PILE_GAP : 0}px`, '--pile-w': hasPile ? `max(${PILE_MIN_W}px, calc((100% - ${PILE_GAP}px) * ${(pileShare / (1 + pileShare)).toFixed(5)}))` : '0px' } as CSSProperties}
    >
      {(
        <div className="hero-dist-controls">
          {/* The fall into place again; nothing to play under reduced motion. */}
          {motion && (phone ? (
            <ActionIcon variant="subtle" size="md" aria-label="Drop the dots again" className="hero-dist-drop" onClick={() => setReplay((r) => r + 1)}>
              <IconArrowBarToDown size={16} />
            </ActionIcon>
          ) : (
            <Button variant="subtle" size="compact-xs" leftSection={<IconArrowBarToDown size={14} />} className="hero-dist-drop" onClick={() => setReplay((r) => r + 1)}>
              Drop again
            </Button>
          ))}
          {fullToggle}
          {controls}
        </div>
      )}
      {/* Full page, the page's own search box is behind the scrim, so the panel carries one. It sits
          above the plot: its list drops downward over the graph, which is the thing being searched. */}
      {full && search && <div className="hero-dist-search">{search}</div>}
      <div ref={rowRef} className="hero-dist-row" style={{ position: 'relative' }}>
      <div
        ref={mainBoxRef} className="hero-dist-main" data-lens={lensAt ? 'on' : 'off'} style={{ position: 'relative' }}
        onPointerMove={onMove} onPointerLeave={(e) => { if (e.pointerType === 'mouse') { onLeave(); stirRef.current = null; } }}
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel}
        tabIndex={0} role="slider" aria-orientation="horizontal" aria-label="Pay distribution"
        aria-valuemin={curve[0]?.bucket} aria-valuemax={curve[curve.length - 1]?.bucket}
        aria-valuenow={(hovered ?? curve[medianIdx])?.bucket} aria-valuetext={readoutText}
        onKeyDown={onKey}
        onFocus={(e) => { if (hoverIdx == null && e.currentTarget.matches(':focus-visible')) { setHoverPile(false); setHoverIdx(medianIdx); } }}
        onBlur={() => { if (!tapped && !magnifyRef.current) setHoverIdx(null); }}
      >
      {/* Every employee under the cap, one dot each, falling into place once a session. The fill the
          curve used to carry is these people; the line, the markers and the readout stay on top. */}
      <div style={{ position: 'absolute', inset: 0, height: H }}>
        {/* A faint wash under the curve, beneath the dots, so its shape reads even in the thin tails. */}
        <svg className="hero-dist-wash" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden style={{ position: 'absolute', inset: 0, display: 'block' }}>
          <defs>{areaGradDef(washId, 'var(--mantine-color-accent-6)', 'var(--curve-wash)')}</defs>
          <g ref={washGRef}><path d={area} fill={`url(#${washId}-area-grad)`} /></g>
        </svg>
        <DotField
          ref={mainDotsRef}
          className="hero-dots" values={people} toX={dotX} heightAt={dotHeight} height={H}
          kinds={colour ? cats : null} inks={inkList} stack={colour}
          airKinds={colour ? null : cats} airInks={colour ? undefined : inks}
          entrance={entrance} highlight={highlight} glow pack={PACK}
          solo={shownSolo} replay={replay} marks={mainMarks} markBig={bigMain} squeeze={tailSqueeze}
          onFrame={lensAt ? redrawLens : undefined}
        />
      </div>
      <svg className="hero-dist-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden style={{ display: 'block' }}>
        <g ref={plotGRef}>
        {/* A soft glow under the curve's line, stronger on a dark page. */}
        <path className="hero-dist-curve-glow" d={line} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {marks.map((m) => (
          <line
            key={m.label}
            x1={X(m.v)} x2={X(m.v)} y1={m.strong ? MARK_TOP.strong : MARK_TOP.plain} y2={H}
            stroke={m.strong ? 'var(--mantine-color-accent-7)' : 'var(--guide-strong)'}
            strokeWidth={m.strong ? 1.5 : 1.25}
            strokeDasharray={m.strong ? undefined : '3 3'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        </g>
      </svg>
      {/* The ±$5k band, drawn as the readout's own footprint rather than a hairline.
          The pill has always reported a count within ±$5k while the mark under it was a 1px line,
          so the drawing and the number described different things — a reader lining the line up
          with the axis was reading a width the count never used. The band IS that width, which
          also makes the radius legible without reading the label: on a $250k axis it is 4% of the
          plot, and it visibly covers several spikes of the comb at once, which is the point.
          Glass rather than a flat tint, by the app's own rule — it floats over content (the curve),
          which is exactly the case backdrop-filter is for. */}
      {hovered && (
        <div
          ref={bandRef}
          aria-hidden
          className="hero-dist-band"
          style={{
            position: 'absolute', top: 0, height: H,
            left: `${(X(bandLo) / W) * 100}%`,
            width: `${((X(bandHi) - X(bandLo)) / W) * 100}%`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* The dot and the pill are HTML, not SVG, for the same reason the marker labels are:
          `preserveAspectRatio="none"` stretches the viewBox horizontally, which would turn a circle
          into an ellipse and the text into a smear. */}
      {hovered && (
        <div
          aria-hidden
          className="hero-dist-point"
          style={{
            position: 'absolute', left: `${hoverPct}%`, top: Y(hovered.n),
            transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%',
            background: 'var(--mantine-color-accent-7)',
            border: '2px solid var(--mantine-color-body)',
            pointerEvents: 'none',
          }}
        />
      )}
      {hovered && (
        <div
          aria-hidden
          style={{
            position: 'absolute', zIndex: Z.local, pointerEvents: 'none',
            left: pillLeft != null ? pillLeft : `${hoverPct}%`,
            // Tracks the dot rather than pinning to the top of the plot: pinned, it sat exactly on
            // the apex and hid the mound the reader is pointing at. It rides just above the curve,
            // and flips underneath where the curve is too tall to leave room — which is precisely
            // where the peaks are. With the magnifying glass up it clears the glass instead: above
            // it, or under it where the glass is near the top.
            top: lensAt
              ? (lensShownY - LENS_D / 2 - 30 >= 0 ? lensShownY - LENS_D / 2 - 30 : lensShownY + LENS_D / 2 + 6)
              : Y(hovered.n) < 26 ? Y(hovered.n) + 10 : Y(hovered.n) - 20,
            // Only before the first measurement lands; after that `pillLeft` is already exact.
            transform: pillLeft != null ? undefined : 'translateX(-50%)',
          }}
          ref={pillRef}
        >
          <span className="chart-value-pill">
            {fmtK(hoveredBucket ?? hovered.bucket)} · {num(readCount)} {soloCat ? soloCat.name : 'people'} ±{fmtK(READOUT_RADIUS)}
            {readShare != null && ` · ${ordinal(Math.min(99, Math.max(1, Math.round(readShare * 100))))} percentile${soloCat ? ` of ${soloCat.name}` : ''}`}
          </span>
        </div>
      )}
      {/* The leaders, under the labels: each runs from its dot's rim, in the mark's own green, into
          the teal of the name it carries — at an angle wherever the name had to be shouldered aside. */}
      {foundLabels.length > 0 && (
        <svg
          className="hero-found-leaders" width={Math.max(1, plotW)} height={H} aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, zIndex: Z.local, pointerEvents: 'none' }}
        >
          <defs>
            {foundLabels.map((l, i) => (
              <linearGradient
                key={l.key} id={`${washId}-lead${i}`} gradientUnits="userSpaceOnUse"
                x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y}
              >
                <stop offset="0%" stopColor="var(--found)" />
                <stop offset="100%" stopColor="var(--mantine-color-accent-7)" />
              </linearGradient>
            ))}
          </defs>
          {foundLabels.map((l, i) => (
            <line
              key={l.key}
              x1={l.from.x.toFixed(1)} y1={l.from.y.toFixed(1)} x2={l.to.x.toFixed(1)} y2={l.to.y.toFixed(1)}
              stroke={`url(#${washId}-lead${i})`} strokeWidth={l.active ? 2 : 1.25} strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      {foundLabels.map((l) => (
        <div
          key={l.key} aria-hidden className="hero-found-label" data-active={l.active ? 'on' : undefined}
          // Drawn at exactly the width it was placed at, not merely under it: the leader is aimed at
          // this box's own corner, and a pill that shrank to its text would leave the line in mid-air.
          style={{ position: 'absolute', left: l.cx, top: l.top, width: l.w, zIndex: Z.local, pointerEvents: 'none', transform: 'translateX(-50%)' }}
        >
          {l.name}
        </div>
      ))}
      {foundCard('main')}
      {lensAt && <FisheyeLens ref={lensRef} at={lensAt} offsetY={lensLift} draw={drawLens} />}
      </div>


      {/* The people at or above the cap: past a break, a pile packed as densely as the field. */}
      {hasPile && (
        <>
          <svg className="hero-dist-break" width={PILE_GAP} height={H} aria-hidden style={{ display: 'block', alignSelf: 'end' }}>
            <path
              d={`M1 ${H - 1} L${PILE_GAP * 0.3} ${H - 1} L${PILE_GAP * 0.42} ${H - 7} L${PILE_GAP * 0.58} ${H + 5} L${PILE_GAP * 0.7} ${H - 1} L${PILE_GAP - 1} ${H - 1}`}
              fill="none" stroke="var(--mantine-color-gray-5)" strokeWidth={1}
            />
          </svg>
          <div
            ref={pileBoxRef}
            className="hero-dist-pile" style={{ position: 'relative', height: H, cursor: tailPays ? 'pointer' : undefined }}
            data-tail={tail ? 'on' : undefined}
            onPointerMove={(e) => {
              if (tail) return;
              setHoverIdx(null);
              setLensAt(null);
              const f = e.pointerType === 'mouse' ? markHit('pile', e) : null;
              if (f) { if (card?.key !== f.person_key) setCard({ key: f.person_key, pinned: false }); setHoverPile(false); return; }
              if (card && !card.pinned) setCard(null);
              setHoverPile(true);
            }}
            onPointerLeave={() => { setHoverPile(false); setCard((c) => (c?.pinned ? c : null)); }}
            onPointerUp={(e) => {
              if (tail) { closeTail(); return; }
              const f = markHit('pile', e);
              // Anywhere else on the pile unrolls it.
              if (!f) { openTail(); return; }
              if (e.pointerType === 'mouse') openFound(f); else setCard({ key: f.person_key, pinned: true });
            }}
          >
            <DotField
              ref={pileDotsRef}
              className="hero-dots-over" values={pile.values} toX={pileX} heightAt={pileHeight} height={H}
              kinds={colour ? pile.kinds : null} inks={inkList} stack={colour}
              entrance={entrance} delay={SPREAD_MS} highlight={pileHighlight} frameMark="pile-frame" glow pack={PACK}
              solo={shownSolo} replay={replay} marks={pileMarks} markBig={bigPile}
              onFrame={lensAt ? redrawLens : undefined}
            />
            {hoverPile && headcount != null && (
              <div aria-hidden style={{ position: 'absolute', right: 0, top: H - pileH - 30, zIndex: Z.local, pointerEvents: 'none' }}>
                <span className="chart-value-pill" style={{ whiteSpace: 'nowrap' }}>
                  {soloCat
                    ? `${num(soloCat.over ?? 0)} ${soloCat.name} at ${fmtK(cap ?? hi)} or more`
                    : `${num(over)} people at ${fmtK(cap ?? hi)} or more · the top ${(Math.max(0.1, (over / headcount) * 100)).toFixed(1)}%${tailPays ? ` · ${canHover ? 'click' : 'tap'} to unroll` : ''}`}
                </span>
              </div>
            )}
            {foundCard('pile')}
            {foundName('pile')}
          </div>
        </>
      )}
      {/* The pile unrolled: its people at their own pay across the whole row, and where the axis ends. */}
      {tail && tailPays && (
        <div className="hero-dist-tail" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: H, pointerEvents: 'none' }}>
          {/* Where the graph ended: everything left of this line is the graph, squeezed. */}
          {cap != null && tailTop > cap && (
            <div className="hero-dist-tail-edge" aria-hidden style={{ left: `${((cap - lo) / (tailTop - lo)) * 100}%`, top: HEAD, height: H - HEAD }}>
              <span>the graph's edge</span>
            </div>
          )}
          <DotField
            ref={tailDotsRef}
            className="hero-dots-tail" values={tailPays} toX={tailX} heightAt={tailHeight} height={H}
            kinds={colour ? pile.kinds : null} inks={inkList} stack={colour} glow pack={PACK}
            solo={shownSolo} marks={pileMarks} markBig={bigPile} frameMark="tail-frame" onFrame={tailDrawn}
            moveTo={{ key: tail.key, pts: tail.key === 2 ? null : tail.from }}
          />
          {tailTopAt && (
            <div className="hero-dist-tail-top" aria-hidden style={{ left: tailTopAt.x, top: tailTopAt.y }}>
              <span className="hero-dist-tail-ring" style={{ width: Math.max(12, tailTopAt.r * 3), height: Math.max(12, tailTopAt.r * 3) }} />
              <span className="chart-value-pill hero-dist-tail-top-label">{usd(tailTop)} · the top salary</span>
            </div>
          )}
          <div className="chart-tip hero-dist-tail-note" aria-live="polite">
            <Text size="sm" fw={700}>The top salary, {usd(tailTop)}, is {Math.round(tailTop / (cap ?? hi))}× the {fmtK(cap ?? hi)} edge of the graph</Text>
            <Text size="xs" c="dimmed">{num(tailPays.length)} people at {fmtK(cap ?? hi)} or more, each at their own pay · {canHover ? 'click' : 'tap'} or press Esc to fold them back</Text>
            {/* How long this stays open, as a line along the bottom of the note that drains away. It is
                mounted when the wait starts and keyed on this opening, so it runs the wait rather than
                merely resembling it. Nothing under Reduce Motion (app.css): the note already says how
                to fold it back, and the graph folds itself either way. */}
            {tail.phase === 'open' && (
              <span
                key={tail.key} aria-hidden className="hero-dist-tail-timer"
                style={{ animationDuration: `${TAIL_OPEN_MS}ms` } as CSSProperties}
              />
            )}
          </div>
        </div>
      )}
      </div>

      <div className="visually-hidden" aria-live="polite">
        {found.length ? `${num(found.length)} ${found.length === 1 ? 'person' : 'people'} from the search marked on the graph` : ''}
      </div>

      {/* Marker labels live in HTML, not SVG: `preserveAspectRatio="none"` would stretch SVG text
          horizontally by whatever factor the box is scaled by. */}
      <div
        ref={labelRowRef}
        className="hero-dist-marker-labels"
        style={{ position: 'relative', height: Math.max(1, ...labelRows.map((r) => r + 1)) * LABEL_ROW_H, marginTop: 2, width: PLOT_WIDTH }}
      >
        {marks.map((m, i) => (
          <Text
            key={m.label}
            ref={(el: HTMLDivElement | null) => { labelRefs.current[i] = el; }}
            size="xs"
            lh={1.2}
            c={m.strong ? 'accent.7' : undefined}
            fw={m.strong ? 700 : 600}
            className={m.strong ? 'accent7-text' : undefined}
            style={{
              position: 'absolute',
              left: `${(X(m.v) / W) * 100}%`,
              top: (labelRows[i] ?? 0) * LABEL_ROW_H,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
            }}
          >
            {m.label} {fmtK(m.v)}
          </Text>
        ))}
      </div>

      {/* A salary axis, not two endpoints. Positioned by value like the marker labels above, so a
          tick sits exactly under the pay it names — `justify="space-between"` only ever happened to
          be right for the two extremes. Positions are shares of the plot's width, which stops short
          of the pile. */}
      <div ref={axisRef} className="hero-dist-axis" style={{ position: 'relative', height: AXIS_ROW_H, marginTop: 6 }}>
        {ticks.map((v) => (
          <Text
            key={v}
            size="xs"
            c="dimmed"
            className="hero-dist-tick"
            style={{
              position: 'absolute',
              left: `calc(${PLOT_WIDTH} * ${(X(v) / W).toFixed(5)})`,
              // The first tick sits on the left edge, so centring it would hang half the label off
              // the panel. Every other one centres on its value.
              transform: v === lo ? undefined : 'translateX(-50%)',
              whiteSpace: 'nowrap',
            }}
          >
            {fmtK(v)}
          </Text>
        ))}
        {tailTicks.map((v) => (
          <Text
            key={`tail-${v}`}
            size="xs"
            c="dimmed"
            className="hero-dist-tail-tick"
            style={{ position: 'absolute', left: `${((v - lo) / (tailTop - lo)) * 100}%`, transform: v === lo ? undefined : 'translateX(-50%)', whiteSpace: 'nowrap' }}
          >
            {fmtPay(v)}
          </Text>
        ))}
        {/* The pile's label is also how to unroll it — and fold it back — from the keyboard. */}
        {hasPile && tailPays ? (
          <button
            ref={(el) => { pileLabelRef.current = el; }}
            type="button"
            className="hero-dist-pile-label hero-dist-pile-toggle"
            aria-expanded={!!tail}
            onClick={() => (tail ? closeTail() : openTail())}
            style={{ position: 'absolute', right: 0, whiteSpace: 'nowrap' }}
          >
            {tail ? `${fmtPay(tailTop)} · fold back` : `${num(over)} at ${fmtK(cap ?? hi)}+`}
          </button>
        ) : (
          <Text
            ref={(el: HTMLDivElement | null) => { pileLabelRef.current = el; }}
            size="xs"
            c="dimmed"
            className="hero-dist-pile-label"
            style={{ position: 'absolute', right: 0, whiteSpace: 'nowrap' }}
          >
            {hasPile ? `${num(over)} at ${fmtK(cap ?? hi)}+` : cap != null ? `${fmtK(cap)}+` : `${fmtK(hi)}+`}
          </Text>
        )}
      </div>
      {colour && categories && (
        <div className="hero-dist-legend" data-solo={shownSolo ?? undefined}>
          <Text span size="xs" c="dimmed" className="hero-dist-legend-lead">
            By highest-paid appointment, from the baseline up · {canHover ? 'click' : 'tap'} one to see it alone:
          </Text>
          {/* Each a button: one category alone, its people falling to the floor in their own shape
              while the others fall through it; pressed again, everyone back. A hollow swatch marks a
              category that is away — never a faded label, which would fail its contrast. */}
          {categories.map((c, i) => (
            <button
              key={c.name} type="button" className="hero-dist-legend-item" data-category={c.name} data-n={c.n}
              aria-pressed={shownSolo === i}
              onClick={() => setSolo((s) => (s === i ? null : i))}
            >
              <span className="hero-dist-swatch" style={{ background: shownSolo == null || shownSolo === i ? inks[i] : 'transparent', borderColor: inks[i] }} aria-hidden />
              <Text span size="xs" fw={600}>{c.name}</Text>
              <Text span size="xs" c="dimmed">{num(c.n)}<span className="hero-dist-legend-median"> · median {fmtK(c.median)}</span></Text>
            </button>
          ))}
        </div>
      )}
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        Each dot is one person · actual pay{headcount != null ? ` across ${num(headcount)} employees` : ''}
        {/* Say where the people above the cap are rather than truncating the tail silently. */}
        {hasPile ? ` · ${num(over)} at ${fmtK(cap ?? hi)}+ in the pile` : overflow ? ` · ${num(overflow)} above ${fmtK(cap ?? 0)} not shown` : ''}
        {motion && <span className="hero-dist-hint"> · {canHover ? 'click the dots to scatter them, or drag through them' : full ? 'tap the dots to scatter them, or drag through them' : 'tap the dots to scatter them'}</span>}
      </Text>
    </div>
  );

  if (!full) return panel;
  // Full page: over everything, in a portal — the page's content sits in a stacking context under its
  // header, so no z-index from in here could lift it over the header — with the keyboard kept inside,
  // and the panel's height kept on the page so nothing under it moves.
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

/**
 * One "here is what this thing does" tile in the band below the fold. Each carries a live figure from
 * summary.json / home-stats.json rather than a static blurb, so the band can never drift out of date
 * with the data — and so the landing page still renders without booting DuckDB.
 */
function ShowcaseCard({ icon, title, blurb, stat, to }: {
  icon: ReactNode;
  title: string;
  blurb: string;
  stat: ReactNode;
  to: string;
}) {
  return (
    <Anchor component={Link} to={to} underline="never" c="inherit" style={{ display: 'block', height: '100%' }}>
      <Card className="card-hover showcase-card" padding="lg" style={{ height: '100%' }}>
        <ThemeIcon size={34} radius="md" variant="light" color="accent" mb="sm" className="showcase-icon">
          {icon}
        </ThemeIcon>
        <Text fw={700} fz="md" className="showcase-title" style={{ letterSpacing: '-0.01em' }}>
          {title} <span className="showcase-arrow">→</span>
        </Text>
        <Text size="sm" c="dimmed" mt={4} className="showcase-blurb" style={{ lineHeight: 1.5 }}>{blurb}</Text>
        <Text size="xs" c="dimmed" mt="sm" fw={600} className="showcase-stat">{stat}</Text>
      </Card>
    </Anchor>
  );
}

/** A quiet line that gently cross-fades through a few computed facts (static under reduced motion). */
function RotatingFact({ facts }: { facts: string[] }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (facts.length < 2 || prefersReducedMotion()) return;
    const id = setInterval(() => {
      setShow(false);
      // Held in a ref so unmounting mid-fade cancels the swap too — clearing only the interval
      // leaves this one pending and it sets state on a gone component.
      swapTimer.current = setTimeout(() => { setI((p) => (p + 1) % facts.length); setShow(true); }, 350);
    }, 6000);
    return () => {
      clearInterval(id);
      if (swapTimer.current) clearTimeout(swapTimer.current);
    };
  }, [facts.length]);
  if (!facts.length) return null;
  return (
    <Text size="xs" c="dimmed" ta="center" style={{ opacity: show ? 1 : 0, transition: 'opacity 350ms ease' }}>
      {facts[i % facts.length]}
    </Text>
  );
}

export default function Home() {
  useDocTitle(null);
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  // The precomputed artifact only covers the latest snapshot. It's usable once loaded, as long as
  // the page isn't pinned to some other (older) snapshot — in which case we fall back to live SQL.
  const { data: homeStats, isError: homeStatsFailed } = useHomeStats();
  const artifactUsable = !!homeStats && (snap == null || snap === homeStats.snapshot_id);
  // The people the search is showing, and its active row: their dots are marked on the graph, and picking
  // one opens them from their dot (components/PersonReveal).
  const navigate = useNavigate();
  const [shown, setShown] = useState<ShownPerson[]>([]);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const openRef = useRef<((key: string) => boolean) | null>(null);
  // The query lives here, not in either search box, because the graph's full page is a portal: going
  // full page remounts the panel and everything in it. One box is on the page and the other inside the
  // panel, never both, and each is handed the query the other was holding.
  const [query, setQuery] = useState('');
  const [graphFull, setGraphFull] = useState(false);
  // Only the box the page opens with takes the caret. The one that comes back when full page closes is
  // a box returning to a page the reader is already looking at, and full page hands focus to its own
  // exit button, which this would take straight back off it.
  const firstSearchRef = useRef(true);
  useEffect(() => { firstSearchRef.current = false; }, []);
  /** What both boxes share: the one query, the one list of found people, and the one way to open them. */
  const searchProps = {
    query,
    onQueryChange: setQuery,
    keepFoundOnUnmount: true,
    onPeopleShown: setShown,
    onActiveItem: setActiveItem,
    onPick: (h: { person_key: string; name: string }) => {
      if (!openRef.current?.(h.person_key)) navigate(`/person/${encodeURIComponent(h.person_key)}`);
    },
  };
  // Who each dot is (lib/homePeople): asked once the search has found someone, by when DuckDB is up.
  const peopleSnap = artifactUsable ? homeStats.snapshot_id : '';
  const { data: homePeople } = useSql<HomePerson>(['home-people', peopleSnap], homePeopleSql(peopleSnap), !!peopleSnap && shown.length > 0);
  const spots = useMemo(
    () => (homePeople && artifactUsable && homeStats.pay_counts && homeStats.bin_cap != null ? dotSpots(homePeople, homeStats.pay_counts, homeStats.bin_cap) : null),
    [homePeople, artifactUsable, homeStats],
  );
  const found = useMemo<FoundPerson[]>(
    () => (spots ? shown.flatMap((p) => { const spot = spots.get(p.person_key); return spot ? [{ ...p, spot }] : []; }) : []),
    [spots, shown],
  );
  // "Generic" (one ink, stored as 'all') or "By employment type" (the staff category) for the dots,
  // remembered per viewer, opening on the second. A new key: under the old one a visitor who had once
  // picked the one ink (then called "All") would never see the
  // new default. Offered only when the artifact carries the categories: the live-SQL fallback draws
  // the dots from the bins alone.
  const [colourBy, setColourBy] = usePref<'all' | 'category'>('home-dots-group', 'category');
  const canColour = artifactUsable && !!homeStats.pay_counts?.categories?.length;
  const needsSql = !!snap && (homeStatsFailed || (!!homeStats && !artifactUsable));

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    `SELECT sum(salary * ${FTE_MULT}) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    needsSql
  );
  const payroll = artifactUsable ? homeStats.payroll_total : (payrollRows?.[0]?.total ?? null);

  // Per person, on actual pay (`people` below) — the same population home-stats.json is built from.
  const people = `(SELECT person_key, sum(${ACTUAL_PAY}) FILTER (WHERE salary > 0) AS pay
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)`;
  const { data: dimRows } = useSql<{ schools: number; titles: number; lo: number | null; hi: number | null }>(
    ['home-dims', snap ?? ''],
    `SELECT count(DISTINCT school) schools, count(DISTINCT job_code) titles,
            (SELECT min(pay) FROM ${people} WHERE pay > 0) lo, (SELECT max(pay) FROM ${people} WHERE pay > 0) hi
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')}`,
    needsSql
  );
  const dims = useMemo(
    () =>
      artifactUsable
        ? { schools: homeStats.schools, titles: homeStats.titles, lo: homeStats.salary_lo, hi: homeStats.salary_hi }
        : dimRows?.[0],
    [artifactUsable, homeStats, dimRows]
  );

  // Distribution sparkline + rotating facts (lightweight aggregates over the latest snapshot).
  const { data: binRows } = useSql<{ bucket: number; n: number }>(
    ['home-bins', snap ?? ''],
    // $1k buckets, matching the precomputed artifact — and over ACTUAL_PAY, not the raw rate. The
    // build script fixed that mismatch on its side and left this one: the fallback was binning the
    // full-time rate while the median marker drawn on top of it came from FTE-adjusted pay, so a
    // visitor pinned to an older snapshot got a marker sitting off its own curve.
    // One point per PERSON, as in the artifact: the curve sits under a count of employees.
    `SELECT floor(pay / 1000) * 1000 AS bucket, count(*) AS n FROM ${people}
     WHERE pay > 0 AND pay < 250000 GROUP BY bucket ORDER BY bucket`,
    needsSql
  );
  const bins = artifactUsable ? homeStats.bins : (binRows ?? []);

  const { data: titleTopRows } = useSql<{ title: string; n: number }>(
    ['home-toptitle', snap ?? ''],
    `SELECT title, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND title IS NOT NULL GROUP BY title ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topTitle = artifactUsable ? homeStats.top_title : (titleTopRows?.[0] ?? null);
  const { data: divTopRows } = useSql<{ school: string; n: number }>(
    ['home-topdiv', snap ?? ''],
    `SELECT school, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL GROUP BY school ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topDivision = artifactUsable ? homeStats.top_division : (divTopRows?.[0] ?? null);
  // p90 (top-10% line) + median tenure, deduped per person.
  const { data: factStats } = useSql<{ p90: number | null; tenure: number | null }>(
    ['home-facts', snap ?? ''],
    `WITH p AS (
        SELECT person_key, sum(${ACTUAL_PAY}) FILTER (WHERE salary > 0) AS pay,
               any_value(date_of_hire) AS doh, any_value(snapshot_date) AS sd
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)
     SELECT quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90,
            median(date_diff('day', CAST(doh AS DATE), CAST(sd AS DATE)) / 365.25) FILTER (WHERE doh IS NOT NULL) tenure
     FROM p`,
    needsSql
  );
  const p90 = artifactUsable ? homeStats.p90 : (factStats?.[0]?.p90 ?? null);
  const tenure = artifactUsable ? homeStats.median_tenure_years : (factStats?.[0]?.tenure ?? null);
  const { data: byCat } = useSql<{ cat: string; med: number }>(
    ['home-bycat', snap ?? ''],
    // Each person once, at their total pay, in the category of their highest-paid appointment — the
    // rule home-stats.json uses (scripts/lib/home-stats.mjs), so the fact reads the same either way.
    `WITH r AS (SELECT person_key, employee_category cat, ${ACTUAL_PAY} rp FROM salaries
                WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0),
          p AS (SELECT person_key, sum(rp) pay, first(cat ORDER BY rp DESC, cat) cat FROM r GROUP BY person_key)
     SELECT cat, median(pay) FILTER (WHERE pay > 0) med, count(*) FILTER (WHERE pay > 0) n
     FROM p WHERE cat IS NOT NULL GROUP BY cat ORDER BY n DESC, cat LIMIT 3`,
    needsSql
  );
  const categoryMedians = artifactUsable
    ? homeStats.category_medians
    : (byCat ?? []).map((c) => ({ category: c.cat, median: c.med }));

  // All facts are computed at runtime from summary.json + home-stats.json (or live SQL), so they
  // auto-update on data import — no hardcoded values to maintain when the salary data refreshes.
  const facts = useMemo(() => {
    const f: string[] = [];
    const first = summary?.snapshots?.[0];
    const med0 = first?.median ?? null;
    const medNow = summary?.latest?.median ?? null;
    if (med0 != null && medNow != null && med0 > 0) {
      const up = Math.round(((medNow - med0) / med0) * 100);
      const yr = first?.date?.slice(0, 4);
      f.push(`Median pay rose from ${usd(med0)}${yr ? ` (${yr})` : ''} to ${usd(medNow)} — up ~${up}%`);
    }
    if (topTitle?.title) f.push(`Most common title: ${topTitle.title} (${num(topTitle.n)} people)`);
    if (topDivision?.school) f.push(`Largest division: ${topDivision.school} (${num(topDivision.n)} people)`);
    if (p90 != null) f.push(`The top 10% earn more than ${usd(p90)}`);
    if (dims?.lo != null && dims?.hi != null) f.push(`Pay ranges from ${usd(dims.lo)} to ${usd(dims.hi)}`);
    if (tenure != null) f.push(`Median tenure is ${tenure.toFixed(1)} years`);
    if (categoryMedians.length) f.push(`Median pay by group — ${categoryMedians.map((c) => `${c.category} ${usd(c.median)}`).join(' · ')}`);
    return f;
  }, [summary, topTitle, topDivision, p90, dims, tenure, categoryMedians]);

  const cleanLabel = (s?: string) => s?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? undefined;
  const firstSnap = cleanLabel(summary?.snapshots?.[0]?.label);
  const latestLabel = summary?.latest?.label;

  // Labels are kept to one word each so all five wrap identically (i.e. not at all): "MEDIAN SALARY"
  // and "UNIQUE TITLES" were the only two that broke to a second line, which left the row visibly
  // ragged even with the reserved label height. The precise figure stays in the hover for Payroll.
  // Median is no longer here — it is the page's headline (see the hero below), which is the whole point
  // of leading with the data. Four supporting figures remain.
  const kpis: KpiData[] = [
    { label: 'Employees', value: summary?.latest?.headcount ?? null, format: num, icon: <IconUsers size={ICON.control} />, color: 'accent' },
    { label: 'Payroll', value: payroll, format: usdCompact, hint: payroll != null ? usd(payroll) : undefined, icon: <IconReportMoney size={ICON.control} />, color: 'accent' },
    { label: 'Divisions', value: dims?.schools ?? null, format: num, icon: <IconBuildingBank size={ICON.control} />, color: 'accent' },
    { label: 'Titles', value: dims?.titles ?? null, format: num, icon: <IconBriefcase size={ICON.control} />, color: 'accent' },
  ];

  return (
    <Box style={{ paddingBlock: 'clamp(24px, 6vh, 64px)', position: 'relative' }}>
      <div className="hero-dotgrid" aria-hidden />
      <Stack gap="xl" w="100%" style={{ position: 'relative', zIndex: Z.content }}>
        {/* The page leads with the site's name. It briefly led with the median instead — a 68px
            "$75,763" — which put the most interesting fact in the largest type, but left a visitor
            landing cold with no statement of what the site is. The median has not gone anywhere: it
            is in the sentence below, and the curve beneath that is a picture of it. */}
        <Stack gap={6} align="center" className="hero-rise">
          <Eyebrow>
            {summary?.latest?.headcount != null ? `${num(summary.latest.headcount)} employees` : 'All employees'}
            {latestLabel ? ` · ${latestLabel}` : ''}
          </Eyebrow>
          <Title order={1} ta="center" fz="var(--fs-display)" lh={1.05}>
            <Text span inherit c="bright">UW–Madison </Text>
            <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
          </Title>
          <Text c="dimmed" ta="center" maw="var(--measure)">
            Search anyone by name to see their pay, how it changed, and how they compare to everyone
            with the same title.
            {/* "UW–Madison" is the title directly above; repeating it here pushed the figure onto a
                line of its own. */}
            {summary?.latest?.median != null && (
              <> The median salary is{' '}
                <Text span inherit fw={700} c="var(--mantine-color-text)">{usd(summary.latest.median)}</Text>.
              </>
            )}
          </Text>
        </Stack>

        {/* The distribution sits directly under the median that labels it, so the marker under the
            headline number is the same number. Then search — the action — then the supporting figures. */}
        {/* The page's full width, like the showcase band below — NOT the `--measure` the headline's
            paragraph keeps. The narrow hero column is a reading measure, and a figure is not prose:
            at 880px the plot was a 4.9:1 box, and capped at 1200px it left a third of a wide screen
            empty either side of a chart with more to show. The plot grows taller with its width
            (PLOT_ASPECT), and the search field matches the figure it sits under: it is the page's
            primary action, and reads as underweight at anything narrower. What sits under it scales
            with the band (app.css `.home-band`). */}
        <Stack gap="lg" w="100%" className="hero-rise home-band">
          <div className="hero-dist-wrap" data-people-mapped={spots ? spots.size : undefined}>
            <Distribution
              bins={bins}
              payCounts={artifactUsable ? homeStats.pay_counts ?? null : null}
              p25={artifactUsable ? homeStats.p25 : null}
              median={artifactUsable ? homeStats.p50 : (summary?.latest?.median ?? null)}
              p75={artifactUsable ? homeStats.p75 : null}
              cap={artifactUsable ? homeStats.bin_cap : null}
              overflow={artifactUsable ? homeStats.bins_overflow : null}
              headcount={summary?.latest?.headcount ?? null}
              byCategory={colourBy === 'category' && canColour}
              found={found}
              activeKey={activeItem?.startsWith('p:') ? activeItem.slice(2) : null}
              openRef={openRef}
              onFullChange={setGraphFull}
              search={<SearchBox {...searchProps} size="md" placeholder="Search a person on the graph…" />}
              controls={canColour ? (
                <div className="hero-dist-toggle">
                  <SegmentedToggle
                    options={[{ id: 'all', label: 'Generic' }, { id: 'category', label: 'By employment type' }]}
                    value={colourBy}
                    onChange={(v) => setColourBy(v === 'category' ? 'category' : 'all')}
                  />
                </div>
              ) : undefined}
            />
          </div>

          {/* Away while the graph is full page, which carries the same search itself. Its place is not
              held: the scrim over it is a blur of the page, not a picture of it. */}
          {!graphFull && (
            <SearchBox
              {...searchProps}
              size="lg"
              autoFocus={firstSearchRef.current}
              keepBelow={() => document.querySelector<HTMLElement>('.hero-dist-main')}
            />
          )}

          {/* Four supporting figures on a hairline rule — no card. The stats used to sit in a bordered
              Paper with a straddling "System-Wide" badge, which made them compete with the headline. */}
          <Anchor component={Link} to="/explore" underline="never" c="inherit" style={{ display: 'block' }}>
            <Box className="home-stats" pt="md" style={{ borderTop: '1px solid var(--hairline)' }}>
              <Group gap={0} wrap="nowrap" align="stretch" visibleFrom="xs">
                {kpis.map((k, i) => (
                  <Fragment key={k.label}>
                    {i > 0 && <Divider orientation="vertical" />}
                    <Kpi {...k} />
                  </Fragment>
                ))}
              </Group>
              <SimpleGrid cols={2} spacing="md" verticalSpacing="lg" hiddenFrom="xs">
                {kpis.map((k) => <Kpi key={k.label} {...k} />)}
              </SimpleGrid>
              <Text size="xs" c="accent.7" className="accent7-text" fw={600} ta="center" mt="md">
                Browse every school and title under Divisions <span className="browse-arrow">→</span>
              </Text>
            </Box>
          </Anchor>
        </Stack>

        {/* Below the fold. The hero column above stays narrow on purpose; this band is wider because
            its job is different — the page used to end here, ~450px above the fold on a laptop, with
            nothing indicating that Compare, Reports, Screening or the division pages existed at all.
            Everything here reads from the same two JSON artifacts the stats card uses, so the landing
            page still never touches DuckDB. */}
        <Stack gap="md" w="100%" mt="xl" className="home-band">
          <Group justify="center" gap={8}>
            <Eyebrow c="dimmed">Also in here</Eyebrow>
          </Group>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
            <ShowcaseCard
              to="/paycheck"
              icon={<IconBriefcase size={ICON.nav} />}
              title="Look up a title"
              blurb="See a title's full pay distribution, who holds it, and how it varies by school."
              stat={dims?.titles != null ? `${num(dims.titles)} titles` : '\u00a0'}
            />
            <ShowcaseCard
              to="/explore"
              icon={<IconBuildingBank size={ICON.nav} />}
              title="Compare divisions"
              blurb="Headcount, median pay and top earners side by side across every school."
              stat={dims?.schools != null ? `${num(dims.schools)} divisions` : '\u00a0'}
            />
            <ShowcaseCard
              to="/reports"
              icon={<IconReportAnalytics size={ICON.nav} />}
              title="Build an equity case"
              blurb="Run the UW salary guidelines for one person and print the brief for HR."
              stat="Parity · compression · market"
            />
            <ShowcaseCard
              to="/screening"
              icon={<IconListSearch size={ICON.nav} />}
              title="Screen a whole unit"
              blurb="Rank everyone in a school or department by how strong their case looks."
              stat={summary?.latest?.headcount != null ? `${num(summary.latest.headcount)} employees` : '\u00a0'}
            />
          </SimpleGrid>
        </Stack>

        {/* Footnotes. These used to sit between the stats and the showcase band, which pushed the band
            below the fold — they are the least urgent thing on the page and were occupying the most
            valuable space on it. */}
        <Stack gap="xs" maw="var(--content-prose)" mx="auto" w="100%">
          <RotatingFact facts={facts} />

          {summary?.snapshot_count != null && firstSnap && latestLabel && (
            <Text size="xs" c="dimmed" ta="center">
              <Anchor component={Link} to="/data" c="dimmed" underline="hover">
                Data based on {num(summary.snapshot_count)} snapshots ({firstSnap} – {latestLabel}) • Latest: {latestLabel}
              </Anchor>
            </Text>
          )}

          <Text size="xs" c="dimmed" ta="center" fs="italic" maw="var(--measure)" mx="auto">
            Figures are point-in-time snapshots; an employee's FTE (appointment %) and pay rate can change between
            snapshots, so actual pay earned may be higher or lower than the amounts shown.{' '}
            <Anchor component={Link} to="/data" c="dimmed" underline="always" fs="normal">How this data works →</Anchor>
          </Text>
        </Stack>
      </Stack>
    </Box>
  );
}
