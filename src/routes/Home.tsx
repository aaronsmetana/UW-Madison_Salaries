import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Tooltip, Anchor, Button, ActionIcon, FocusTrap } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import {
  IconBuildingBank, IconBriefcase, IconReportAnalytics, IconListSearch, IconArrowBarToDown,
  IconArrowsMaximize, IconX,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId, useHomeStats, useSearchIndex, useRelease } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { ACTUAL_PAY, FTE_MULT } from '../lib/queries';
import { binsFromCounts, countBelow, countWithin, groupCounts, groupLine as groupLinePath, groupSigma, smoothBins, CURVE_STEP, READOUT_RADIUS, type Bin } from '../lib/distribution';
import { usd, usdCompact, num, vsCampus, fullName } from '../lib/format';
// Same compact currency the peer-range quartile labels use, so the two charts read alike.
import { fmtK, assignLabelRows } from '../lib/chartStyle';
import { measureText, placeNearLabels } from '../lib/labelLayout';
import { prefersReducedMotion } from '../lib/motion';
import { SearchBox, type FilterToken, type SearchPick, type ShownPerson } from '../components/SearchBox';
import { Sparkline } from '../components/chart/Sparkline';
import { useReveal } from '../components/PersonReveal';
import { dotSpots, emphasis, filterPeopleSql, homeNamesSql, homePeopleSql, spotPeople, topSchoolsForSql, topTitlesInSql, type DotSpot, type Emphasis, type HomeName, type HomePerson } from '../lib/homePeople';
import type { DivisionHit, TitleHit } from '../lib/search';
import { Eyebrow } from '../components/Eyebrow';
import { useDocTitle } from '../lib/useDocTitle';
import { Z } from '../lib/layers';
import { DotField, MOVE_MS, MOVE_STAGGER, SPREAD_MS, useEntranceOnce, type DotFieldHandle } from '../components/chart/DotField';
import { squeezeFactor, tailHeights } from '../lib/tail';
import { FisheyeLens, LENS_D, type FisheyeLensHandle, type LensView } from '../components/chart/FisheyeLens';
import { peopleFromCounts } from '../lib/dotLayout';
import { STIR_STEP, dragSpeed, stirPath, stirStrength, wakeTurn } from '../lib/dotPhysics';
import { usePref } from '../lib/prefs';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { areaGradDef } from '../components/chartDefs';
import type { HomeStats, SearchIndex } from '../lib/manifest';
import { ordinal } from '../lib/stats';

interface StatData { label: string; value: number | null; format: (n: number) => string; hint?: string }

/**
 * One system-wide figure on the line under the search: the number, then what it counts, read as a phrase.
 *
 * These were four headline tiles — an icon, an eyebrow and a number that counted up, at 51px on a wide
 * screen: a size away from the page's title, four times the graph's own labels, and growing with the
 * screen. They are the graph's supporting detail, so they are set as text, smaller than the search's own,
 * and hold still: a count-up is motion, and motion on the page's quietest line drew the eye to it first.
 */
function StatItem({ label, value, format, hint }: StatData) {
  const figure = <span className="home-stat-value">{value == null ? '—' : format(value)}</span>;
  return (
    <span className="home-stat">
      {hint ? <Tooltip label={hint} withArrow>{figure}</Tooltip> : figure}
      <span className="home-stat-label">{label}</span>
    </span>
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
 * What the search bar costs the panel full page, px, which the panel on the page does not carry. Wide,
 * the controls float in the corner on the page and cost nothing, and full page they become a line in the
 * flow: the bar's own height (`--full-bar-h` in app.css) and the gap under it (`--full-bar-gap`). On a
 * phone the controls already stand in the flow, and the box and its strip each take a line of their own
 * above the buttons: the box (`--full-search-h`), the strip (`--full-strip-h`) and a row gap (6) after
 * each.
 *
 * Numbers, not measurements: the panel's full-page height is worked out from the panel as it stands on
 * the page, where none of this exists yet, and a font's metrics are not something to subtract. They also
 * have to be right — the grow-out-of-its-place is aimed at the panel this reckoning leaves, and out by a
 * line it starts half a line off its own place. `full page grows out of its place` holds them to it on a
 * desktop and a phone.
 */
const FULL_BAR = { wide: 42 + 8, phone: 42 + 6 + 32 + 6 };
/** How many people the full page's search lists (and marks) before "More people match": more than the
 *  page's own box, since its list has the whole window to drop into. */
const FULL_PAGE_PEOPLE = 8;

/** A dot's person, as the full page's magnifying glass names them. */
interface DotWho { key: string; name: string; title: string | null; school: string | null; pay: number | null }
/** Whose a dot is, by field and index; null for a dot with no one found for it. */
type WhoIs = (field: 'main' | 'pile', index: number) => DotWho | null;
/** How close to the glass's centre a dot is named from, past its own radius, CSS px: about a dot, so a
 *  gap between dots names no one. */
const WHO_REACH = 1.5;
/** How far off its dot a name is carried into the sky, CSS px, when there is no other dot to name: a
 *  hand that drifts off the end of a field keeps what it was reading. */
const WHO_STICK = 6;
/** How much nearer the next dot must be before it takes the name, CSS px, when there is one. A hand
 *  resting on a dot does not move a whole pixel, so this only has to outlast a tremor — measured against
 *  whoever is competing for the name rather than as a distance from the dot holding it, so that how long
 *  a name holds on follows how close together the dots are. Held by a fixed distance instead, a name in
 *  the packed middle stayed on while the pointer crossed several of its neighbours. */
const WHO_YIELD = 2;
/** The caption that names it: a fixed size, so it holds still while the pointer crosses dot after dot. */
const WHO_W = 264;
const WHO_H = 60;
/** Full page with a pointer, the glass is one hover away, so the names are fetched once the field has
 *  settled rather than on that first hover — long enough after opening that a filter put on straight
 *  away goes first (DuckDB runs one query at a time). */
const WHO_EARLY_MS = 1200;
/** The nudge that says a phone can hold a dot to see who it is: once a visit, and only while it has not
 *  been held yet. */
const HOLD_HINT_KEY = 'home-hold-hint';
const HOLD_HINT_MS = 6000;

/**
 * The caption that names a dot, wherever a dot is named: under the glass over the graph, beside the pile,
 * over the pile unrolled. One box of a fixed size, so crossing dot after dot never moves or resizes it,
 * and `data-who` says who it is naming for the guards.
 */
function WhoCaption({ who, at, className }: { who: DotWho | 'loading'; at: { left: number; top: number }; className?: string }) {
  return (
    <div
      className={`chart-tip hero-lens-who${className ? ` ${className}` : ''}`} aria-hidden
      data-who={who === 'loading' ? undefined : who.key}
      style={{ position: 'absolute', zIndex: Z.local, pointerEvents: 'none', left: at.left, top: at.top, width: WHO_W, height: WHO_H }}
    >
      {who === 'loading' ? (
        <div className="hero-lens-who-detail">Finding who’s who…</div>
      ) : (
        <>
          <div className="hero-lens-who-line">
            <span className="hero-lens-who-name">{who.name}</span>
            {who.pay != null && <span className="hero-lens-who-pay">{fmtK(who.pay)}</span>}
          </div>
          {/* A line each, so the school — what tells two people of one title apart — is not what is cut. */}
          {who.title && <div className="hero-lens-who-detail">{who.title}</div>}
          {who.school && <div className="hero-lens-who-detail">{who.school}</div>}
        </>
      )}
    </div>
  );
}

/** A filter the full page's bar holds: a title or a school, as the search's index gives them. */
type GraphFilterItem = { kind: 'title'; hit: TitleHit } | { kind: 'division'; hit: DivisionHit };
const filterKey = (f: GraphFilterItem) => (f.kind === 'title' ? `t:${f.hit.code}` : `d:${f.hit.school}`);
/** The group a filter picks out, as the graph draws it: its name, and — once its people are in — which
 *  dots it lights, how many they are, and their median and pays. */
type GraphGroup = { name: string; pending: true } | ({ name: string; pending: false } & Emphasis);

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
/** The group's label's type size, px (app.css `.hero-dist-group-flag`, Mantine's xs). */
const FLAG_FONT = 12;
/** A person the search is showing who is on the graph: where their dot is. */
interface FoundPerson extends ShownPerson { spot: DotSpot }
/** The card about a found person's dot, CSS px wide. */
const FOUND_CARD_W = 240;

function Distribution({
  bins, payCounts, p25, median, p75, cap, overflow, headcount, byCategory, controls, found = [], activeKey = null, openRef,
  search, onFullChange, group = null, onPeel, openFullRef, whoIs = null, onWantWho, searchOpenRef,
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
  /** What a filter on the full page's bar picks out: its dots stay lit and the rest dim, and its own
   *  curve and median are drawn over the field beside everyone's. */
  group?: GraphGroup | null;
  /** Asked first when Escape would close full page: true if it took a filter off instead. */
  onPeel?: () => boolean;
  /** Set to open full page from outside the panel: the landing search's "Show on graph". */
  openFullRef?: MutableRefObject<(() => void) | null>;
  /** Whose a dot is, for the magnifying glass to name full page: 'loading' until the page has looked them
   *  up, which it does when first asked (`onWantWho`, the first time the glass is up full page); null
   *  where it cannot. */
  whoIs?: WhoIs | 'loading' | null;
  onWantWho?: () => void;
  /** True while the full page's search has its list open over the graph: a press on the graph then only
   *  puts the list away — the reader was turning back to the graph, not reaching for its dots. */
  searchOpenRef?: MutableRefObject<boolean>;
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
  // The group's own curve: its pays counted on the campus grid, at the campus curve's step (lib/distribution
  // `groupCounts`), and smoothed as wide as a group its size needs (`groupSigma`): the campus kernel left a
  // thousand people zigzagging. Its $1k bins answer the readout's "how many of them within ±$5k" as `bins`
  // answers it for everyone.
  const lit = group && !group.pending ? group : null;
  const groupShape = useMemo(() => {
    if (!lit || !payCounts?.counts.length || cap == null) return null;
    const g = groupCounts(lit.pays, payCounts.lo100, payCounts.counts.length, cap);
    return {
      curve: smoothBins(binsFromCounts(payCounts.lo100, g.counts, CURVE_STEP), groupSigma(lit.pays, cap)),
      bins1k: binsFromCounts(payCounts.lo100, g.counts, BIN_DOLLARS),
    };
  }, [lit, payCounts, cap]);
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
  // Where a mouse is over the pile, and over the pile unrolled: what names the dot under it, full page.
  const [pileAt, setPileAt] = useState<{ x: number; y: number } | null>(null);
  const [tailAt, setTailAt] = useState<{ x: number; y: number } | null>(null);
  const tailHeld = tailAt != null;
  // A phone names a dot by holding a finger on it, and nothing on the page says so — a mouse finds the
  // glass by moving. Once a visit, full page, until the reader holds something.
  const [holdHint, setHoldHint] = useState(false);
  // Rendered width of the plot, in px. The axis needs it: how many salary labels fit is a question
  // about pixels, not about the dollar range, and answering it from the range alone put "$200k" and
  // "$250k+" flush against each other at 375px.
  const [plotW, setPlotW] = useState(0);
  // The group's label, at the top of the plot: the plot's headroom, which the curve's peak stops `HEAD` short
  // of, so it lies on no dot. The numbers are here rather than in the bar, where they would not fit, and
  // here is where the eye already is — at the line they describe. One line, always: a phone's headroom is
  // 48px, and a label that wrapped to three hung down over the peak. Where the whole of it will not fit
  // across the plot it drops the group's name, which the tokens just above already give.
  const groupFlagFull = group
    ? group.pending
      ? `${group.name} · …`
      : group.count === 0
        ? `No one on the graph is ${group.name}`
        : `${group.name} · ${num(group.count)} · median ${fmtK(group.median ?? 0)} · ${vsCampus(group.median, median)}`
    : null;
  const groupFlagShort = lit && lit.count > 0 ? `${num(lit.count)} · median ${fmtK(lit.median ?? 0)} · ${vsCampus(lit.median, median)}` : null;
  const groupFlagText = groupFlagFull && groupFlagShort && plotW > 0 && measureText(groupFlagFull, FLAG_FONT) * 1.08 + 18 > plotW
    ? groupFlagShort
    : groupFlagFull;
  const flagRef = useRef<HTMLDivElement>(null);
  const [flagBox, setFlagBox] = useState({ w: 0, h: 0 });
  // How far down the plot the label sits: at its top, unless the panel's controls are there. Full page the
  // controls are a line above the plot; on the page they lie over its top right, where a group paid well —
  // Professor's median is $223k — put its label on "Full page". It then drops below them.
  const controlsRef = useRef<HTMLDivElement>(null);
  const [flagTop, setFlagTop] = useState(2);
  // The names the search hangs on its dots start below the label, so none is laid over it.
  const flagRoom = groupFlagText ? flagTop + flagBox.h + 4 : 2;
  // The group's label, measured whenever it or the plot changes: its box places it and keeps the names off it.
  useLayoutEffect(() => {
    const el = flagRef.current;
    const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
    setFlagBox((b) => (b.w === w && b.h === h ? b : { w, h }));
  }, [groupFlagText, plotW]);
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
  // When a rain has landed — the first on a visit, or one asked for with "Drop again" — one soft band of
  // light crosses the mountain, once. Keyed so each rain gets its own; gone when it has crossed.
  const [sheen, setSheen] = useState(0);
  const [sheenOn, setSheenOn] = useState(false);
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
  const peelRef = useRef(onPeel);
  peelRef.current = onPeel;
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
  // Home opens full page itself when the landing search's "Show on graph" is pressed. Assigned every render,
  // as `openFull` is made every render.
  useEffect(() => {
    if (!openFullRef) return;
    openFullRef.current = () => openFull();
    return () => { openFullRef.current = null; };
  });
  const openFull = () => {
    const el = panelRef.current;
    if (!el || fullRef.current) return;
    growFromRef.current = el.getBoundingClientRect();
    setPageH(el.offsetHeight);
    // A first guess at the plot's height from the panel as it is, measured again once it is full — plus
    // the search bar, which the panel only carries full page.
    const pad = phone ? FULL_PAD.phone : FULL_PAD.wide;
    const furniture = el.offsetHeight - H + (search ? (phone ? FULL_BAR.phone : FULL_BAR.wide) : 0);
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
      // A filter comes off before full page closes: one layer at a time.
      if (peelRef.current?.()) { e.preventDefault(); return; }
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
  const groupGRef = useRef<SVGGElement>(null);
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
    // Not while a pointer is on it: the names are read there (`tailShow`), and a field that folded itself
    // back mid-name would take the name with it. Moving off starts the wait again from the top.
    if (tailPhase === 'open') {
      if (tailHeld) return;
      const id = window.setTimeout(closeTail, TAIL_OPEN_MS);
      return () => window.clearTimeout(id);
    }
    if (tailPhase === 'closing') {
      const id = window.setTimeout(() => setTail(null), MOVE_MS + MOVE_STAGGER);
      return () => window.clearTimeout(id);
    }
  }, [tailPhase, tailKey, tailHeld, closeTail]);
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
      for (const g of [washGRef.current, plotGRef.current, groupGRef.current]) g?.setAttribute('transform', f === 1 ? '' : `scale(${f} 1)`);
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
  // Where the names may be placed: the plot, less the group's label at its top — one box, read by the
  // placement and printed on the leaders, so a test sees the bound that was used rather than a copy of it.
  const namesBox = useMemo(() => ({ left: 0, right: plotW, top: flagRoom, bottom: H - 2 }), [plotW, flagRoom, H]);
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
      namesBox,
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
  }, [tail, plotW, foundMain, foundAt, activeKey, phone, namesBox]);

  // Full page without a pointer, a hold is the only way to a name and nothing on the page says so.
  useEffect(() => {
    if (!full || canHover) return;
    // Blocked site data throws rather than returning nothing, and a nudge is not worth a broken page:
    // there, it counts as seen.
    let seen = true;
    try { seen = sessionStorage.getItem(HOLD_HINT_KEY) === '1'; } catch { /* private mode */ }
    if (seen) return;
    try { sessionStorage.setItem(HOLD_HINT_KEY, '1'); } catch { /* private mode */ }
    setHoldHint(true);
    const t = window.setTimeout(() => setHoldHint(false), HOLD_HINT_MS);
    return () => window.clearTimeout(t);
  }, [full, canHover]);
  // Held: it has been found, and saying it again would be in the way of it.
  useEffect(() => { if (magnify) setHoldHint(false); }, [magnify]);

  // Full page, the glass names the dot at its centre — the pointer, or the fingertip under a held glass:
  // the nearest within about a dot of it, and with a filter on, only among the ones it lights. Who the
  // dots are is looked up once, and only by the full page.
  const glassUp = full && lensAt != null && !tail;
  const wantWhoRef = useRef(onWantWho);
  wantWhoRef.current = onWantWho;
  useEffect(() => { if (glassUp) wantWhoRef.current?.(); }, [glassUp]);
  // With a pointer, they are asked for as the page opens instead of on that first hover, so the first dot
  // under the glass is named outright (WHO_EARLY_MS) — late enough that a filter put on straight away
  // goes first, DuckDB running one query at a time. A phone waits for the hold: there, 22k rows would sit
  // in front of whatever the reader does next.
  useEffect(() => {
    if (!full || !canHover) return;
    const t = window.setTimeout(() => wantWhoRef.current?.(), WHO_EARLY_MS);
    return () => window.clearTimeout(t);
  }, [full, canHover]);
  // The dot a pointer names in a field: the nearest, except that the one already named is given a little
  // the better of it so the caption does not flicker, and dropped as soon as a filter stops lighting it.
  const nameDot = (handle: DotFieldHandle | null, at: { x: number; y: number } | null, held: MutableRefObject<number | null>, mask: Uint8Array | null) => {
    if (!handle || !at) { held.current = null; return null; }
    const next = handle.dotAt(at.x, at.y, WHO_REACH, { litOnly: !!mask }) ?? null;
    const keep = held.current;
    if (keep != null && keep !== next && (!mask || mask[keep] === 0)) {
      const p = handle.positionOf(keep);
      const away = p ? Math.hypot(p.x - at.x, p.y - at.y) : Infinity;
      const q = next == null ? null : handle.positionOf(next);
      // Nobody else under the pointer: carry the name off the dot for a moment (WHO_STICK). The dot's own
      // radius, not `positionOf`'s: that one is a mark's, and would carry a name four dots away.
      if (next == null) { if (away <= handle.dotR() + WHO_REACH + WHO_STICK) return keep; }
      // Somebody else under it: they take the name as soon as they are the nearer by WHO_YIELD. Whoever
      // the pointer is really on wins, however tightly the dots are packed.
      else if (q && away <= Math.hypot(q.x - at.x, q.y - at.y) + WHO_YIELD) return keep;
    }
    held.current = next;
    return next;
  };
  const lensHeldRef = useRef<number | null>(null);
  const lensDot = nameDot(whoIs ? mainDotsRef.current : null, glassUp ? lensAt : null, lensHeldRef, lit?.main ?? null);
  const lensWho = lensDot != null && typeof whoIs === 'function' ? whoIs('main', lensDot) : null;
  // The pile and the pile unrolled are named the same way, from the pointer over them. The glass is never
  // up over either — the pile clears it, and an unrolled graph is squeezed, so nothing under the glass
  // would read as it looks — so the dot being named is ringed in the field itself (DotField `ring`).
  const pileHeldRef = useRef<number | null>(null);
  const pileDot = nameDot(full && whoIs ? pileDotsRef.current : null, tail ? null : pileAt, pileHeldRef, lit?.pile ?? null);
  const pileWho = pileDot != null && typeof whoIs === 'function' ? whoIs('pile', pileDot) : null;
  const tailHeldRef = useRef<number | null>(null);
  const tailDot = nameDot(full && whoIs && tailPhase === 'open' ? tailDotsRef.current : null, tailAt, tailHeldRef, lit?.pile ?? null);
  // The unrolled field is the pile's own people in the pile's own order, so a dot there is a pile dot.
  const tailWho = tailDot != null && typeof whoIs === 'function' ? whoIs('pile', tailDot) : null;
  const tailWhoAt = tailWho ? tailDotsRef.current?.positionOf(tailDot!) ?? null : null;
  // What each of them puts up: the person, or "finding" while the names are still coming; nothing where
  // the pointer is in the gaps between dots, and nothing for a dot no one was found for.
  const showWho = (dot: number | null, who: DotWho | null): DotWho | 'loading' | null =>
    (dot == null ? null : who ?? (whoIs === 'loading' ? 'loading' : null));
  const pileShow = showWho(pileDot, pileWho);
  const tailShow = showWho(tailDot, tailWho);
  // For the glass's own drawing, which rings the dot it names.
  const lensWhoRef = useRef<number | null>(null);
  lensWhoRef.current = lensWho ? lensDot : null;
  // The names can arrive while the pointer is still: the glass rings the dot then, not on the next move.
  useEffect(() => { redrawLens(); }, [lensWho?.key, redrawLens]);
  // The press that put the search's list away (`dismissSearch`), so its release is not acted on either.
  const dismissedRef = useRef<number | null>(null);
  // Across, the label is where it is drawn; down, it is read at the plot's top, so a label already moved
  // does not decide its own move back.
  useLayoutEffect(() => {
    const f = flagRef.current, c = controlsRef.current, m = mainBoxRef.current;
    let top = 2;
    if (f && c && m) {
      const fr = f.getBoundingClientRect(), cr = c.getBoundingClientRect(), mr = m.getBoundingClientRect();
      const ft = mr.top + 2;
      if (fr.left < cr.right && fr.right > cr.left && ft < cr.bottom && ft + fr.height > cr.top) top = Math.ceil(cr.bottom - mr.top) + 4;
    }
    setFlagTop((t) => (t === top ? t : top));
  }, [groupFlagText, flagBox.w, flagBox.h, plotW, full]);

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
  // The wash's colour along the pay axis, by employment type: at each stretch of pay, the two most common
  // types above it, blended by their share — so the wash is a hint of the colours over it, not one teal.
  // In one ink (Generic) it stays the accent.
  const washStops = (() => {
    const cats = payCounts?.categories;
    if (!colour || !cats?.length || !payCounts) return null;
    const S = 24;
    const sums = Array.from({ length: S }, () => new Array<number>(cats.length).fill(0));
    for (let b = 0; b < payCounts.counts.length; b++) {
      const seg = Math.min(S - 1, Math.max(0, Math.floor((((payCounts.lo100 + b) * 100 - lo) / span) * S)));
      cats.forEach((c, k) => { sums[seg][k] += c.counts[b] ?? 0; });
    }
    return sums.map((row, seg) => {
      const [a, b] = row.map((n, k) => ({ n, k })).sort((p, q) => q.n - p.n);
      const offset = (seg + 0.5) / S;
      if (!a || a.n === 0) return { offset, color: 'var(--mantine-color-accent-6)' };
      if (!b || b.n === 0) return { offset, color: categoryInk(cats[a.k].name) };
      return { offset, color: `color-mix(in oklab, ${categoryInk(cats[a.k].name)} ${Math.round((a.n / (a.n + b.n)) * 100)}%, ${categoryInk(cats[b.k].name)})` };
    });
  })();
  // The group's curve in the same box and on the campus curve's scale: how many of them there are at each
  // pay, never more than everyone. Scaled to its own peak, it drew Professor's 1,275 people towering over
  // campus's 21,962. Left out for a group too small to rise off the floor (lib/distribution `groupLine`).
  const groupLine = groupShape ? groupLinePath(groupShape.curve, curve, { W, H, head: HEAD }) : null;
  // Its median, as a line down the plot — unless it is past the cap, where the plot ends and the pile
  // begins; the label then sits at the plot's right end, over the pile.
  const groupMedianX = lit && lit.count > 0 && lit.median != null && lit.median < hi ? X(lit.median) : null;
  const flagCenter = groupMedianX != null ? (groupMedianX / W) * plotW : lit && lit.count > 0 ? plotW : plotW / 2;
  const flagLeft = Math.max(0, Math.min(plotW - flagBox.w, flagCenter - flagBox.w / 2));

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
  // And with a filter on, how many of them are in the same window.
  const groupRead = hoveredBucket != null && groupShape ? countWithin(groupShape.bins1k, hoveredBucket, READOUT_RADIUS) : null;
  const readShare = hoveredBucket != null && soloCat && soloBins ? countBelow(soloBins, hoveredBucket) / soloCat.n : share;
  // The readout as a screen reader hears it: the slider's value.
  const readoutText = hoveredBucket != null
    ? `${fmtK(hoveredBucket)}: ${num(readCount)} ${soloCat ? soloCat.name : 'people'} within ±${fmtK(READOUT_RADIUS)}${readShare != null ? `, ${ordinal(Math.min(99, Math.max(1, Math.round(readShare * 100))))} percentile${soloCat ? ` of ${soloCat.name}` : ''}` : ''}${groupRead != null ? `, ${num(groupRead)} in the filter` : ''}`
    : 'Move along the pay distribution with the arrow keys';
  // The glass sits on a mouse's pointer, or above a finger that holds it up.
  const lensLift = magnify ? -(LENS_D / 2 + HOLD_LIFT) : 0;
  const lensShownY = (lensAt?.y ?? 0) + lensLift;
  // The caption beside the glass, clear of its readout: to its right, or its left near the plot's right
  // edge; where neither side has room (a phone), above the glass and its readout, or else below it.
  const whoPlace = (() => {
    if (!lensAt || lensDot == null || (!lensWho && whoIs !== 'loading')) return null;
    const R = LENS_D / 2;
    const cy = lensShownY;
    const side = Math.max(0, Math.min(H - WHO_H, cy - WHO_H / 2));
    if (lensAt.x + R + 8 + WHO_W <= plotW) return { left: lensAt.x + R + 8, top: side };
    if (lensAt.x - R - 8 - WHO_W >= 0) return { left: lensAt.x - R - 8 - WHO_W, top: side };
    const left = Math.max(0, Math.min(plotW - WHO_W, lensAt.x - WHO_W / 2));
    const pillAbove = cy - R - 30 >= 0;
    const over = (pillAbove ? cy - R - 30 : cy - R) - 6 - WHO_H;
    return { left, top: over >= 0 ? over : cy + R + (pillAbove ? 0 : 30) + 6 };
  })();
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
  // A press while the search's list is open over the graph only puts it away: the box is left, which shuts
  // the list, and nothing else that press would do — a burst, a tap's, the pile unrolling — is done.
  const dismissSearch = (e: ReactPointerEvent<HTMLElement>) => {
    if (!searchOpenRef?.current) return false;
    dismissedRef.current = e.pointerId;
    (document.activeElement as HTMLElement | null)?.blur();
    return true;
  };
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
    if (dismissSearch(e)) return;
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
    if (dismissedRef.current === e.pointerId) { dismissedRef.current = null; return; }
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
    // The dot the glass names, ringed where the glass puts it (the caption beside it says who); with none
    // named, a faint ring at the centre: where the pointer is.
    const named = lensWhoRef.current;
    const at = named != null ? mainDotsRef.current?.positionOf(named) : null;
    ctx.beginPath();
    if (at) {
      const m = map(at.x, at.y);
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
    } else {
      ctx.globalAlpha = 0.4;
      ctx.arc(R, R, 4, 0, Math.PI * 2);
      ctx.lineWidth = 1;
    }
    ctx.strokeStyle = tok('--mantine-color-text');
    ctx.stroke();
    ctx.restore();
  };

  // Full page, or back: one button, in the panel's top right corner, last on its line of controls — where a
  // way out is looked for. It is the one control there with a colour of its own: tinted on the page, so the
  // full page graph is found; filled full page, with its key beside it, so leaving it is never a search.
  // It was a quiet text button between "Drop again" and the colour switch, easy to miss either way.
  const fullToggle = phone ? (
    <ActionIcon
      ref={toggleRef} variant={full ? 'filled' : 'light'} color="accent" size="md"
      className={`hero-dist-full-toggle${full ? '' : ' accent-adaptive-text'}`}
      aria-label={full ? 'Exit full page' : 'Full page graph'} onClick={full ? closeFull : openFull} data-autofocus={full || undefined}
    >
      {full ? <IconX size={16} /> : <IconArrowsMaximize size={16} />}
    </ActionIcon>
  ) : (
    <Button
      ref={toggleRef} variant={full ? 'filled' : 'light'} color="accent" size="compact-sm"
      className={`hero-dist-full-toggle${full ? '' : ' accent-adaptive-text'}`}
      leftSection={full ? <IconX size={14} /> : <IconArrowsMaximize size={14} />}
      rightSection={full ? <span className="hero-dist-esc" aria-hidden>Esc</span> : undefined}
      onClick={full ? closeFull : openFull} data-autofocus={full || undefined}
    >
      {full ? 'Exit full page' : 'Full page graph'}
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
        <div className="hero-dist-controls" ref={controlsRef}>
          {/* Full page, the page's own search box is behind the scrim, so the panel carries one, leading the
              line of controls above the plot: the box, with starters beside it while nothing is typed, and
              its results in a list under it while it is in use. The list lies over the graph only then — it
              goes when the reader turns back to the graph, and a press that puts it away does nothing else
              (`searchOpenRef`) — and it never changes the plot's size. First in the DOM as on screen, so the
              focus order is the order the line is read in. */}
          {full && search && <div className="hero-dist-search">{search}</div>}
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
          {controls}
          {fullToggle}
        </div>
      )}
      <div ref={rowRef} className="hero-dist-row" style={{ position: 'relative' }}>
      <div
        ref={mainBoxRef} className="hero-dist-main" data-lens={lensAt ? 'on' : 'off'} data-who={whoIs == null ? 'off' : whoIs === 'loading' ? 'loading' : 'ready'} data-sheens={sheen} style={{ position: 'relative' }}
        data-filter={group?.name} data-group-count={lit?.count} data-group-median={lit?.median ?? undefined}
        data-group-points={groupShape?.curve.length}
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
          <defs>
            {areaGradDef(washId, 'var(--mantine-color-accent-6)', 'var(--curve-wash)')}
            {washStops && (
              <>
                <linearGradient id={`${washId}-hue`} className="hero-dist-wash-hue" x1="0" x2="1" y1="0" y2="0" data-from={lo} data-to={hi}>
                  {washStops.map((st) => <stop key={st.offset} offset={st.offset} style={{ stopColor: st.color }} />)}
                </linearGradient>
                {/* Its strength down the plot is the shared area profile, in white, as a mask over those colours. */}
                {areaGradDef(`${washId}-fade`, '#fff', 'var(--curve-wash)')}
                <mask id={`${washId}-fade-mask`}><rect x={0} y={0} width={W} height={H} fill={`url(#${washId}-fade-area-grad)`} /></mask>
              </>
            )}
            {/* The floor's shadow: a band along the baseline under the mountain, so it sits on the axis. */}
            <linearGradient id={`${washId}-floor`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={H - 18} y2={H}>
              <stop offset="0" style={{ stopColor: 'var(--floor-shadow)', stopOpacity: 0 }} />
              <stop offset="1" style={{ stopColor: 'var(--floor-shadow)', stopOpacity: 1 }} />
            </linearGradient>
          </defs>
          <g ref={washGRef}>
            <path d={area} fill={washStops ? `url(#${washId}-hue)` : `url(#${washId}-area-grad)`} mask={washStops ? `url(#${washId}-fade-mask)` : undefined} />
            <path className="hero-dist-floor" d={area} fill={`url(#${washId}-floor)`} />
          </g>
        </svg>
        <DotField
          ref={mainDotsRef}
          className="hero-dots" values={people} toX={dotX} heightAt={dotHeight} height={H}
          kinds={colour ? cats : null} inks={inkList} stack={colour}
          airKinds={colour ? null : cats} airInks={colour ? undefined : inks}
          entrance={entrance} highlight={highlight} glow rich pack={PACK}
          solo={shownSolo} replay={replay} marks={mainMarks} markBig={bigMain} squeeze={tailSqueeze}
          onRained={() => { setSheen((k) => k + 1); setSheenOn(true); }}
          dim={lit?.main ?? null}
          onFrame={lensAt ? redrawLens : undefined}
        />
      </div>
      <svg className="hero-dist-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden style={{ display: 'block' }}>
        <g ref={plotGRef}>
        {/* A soft glow under the curve's line, stronger on a dark page. */}
        {/* The line's glow is brightest at the peak and fades toward the tails. */}
        <defs>
          <linearGradient id={`${washId}-glow`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={HEAD} y2={H}>
            <stop offset="0" stopColor="var(--mantine-color-accent-6)" stopOpacity={1} />
            <stop offset="1" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <path className="hero-dist-curve-glow" d={line} fill="none" stroke={`url(#${washId}-glow)`} strokeWidth={6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
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
        {/* The finishing sheen, clipped to the area under the curve: it lights the dots, not the page. */}
        {sheenOn && (
          <g key={sheen} clipPath={`url(#${washId}-sheen-clip)`} aria-hidden>
            <defs>
              <clipPath id={`${washId}-sheen-clip`}><path d={area} /></clipPath>
              <linearGradient id={`${washId}-sheen`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity={0} />
                <stop offset="0.5" stopColor="#fff" stopOpacity={0.5} />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <rect className="hero-dist-sheen" x={-W * 0.3} y={0} width={W * 0.2} height={H} fill={`url(#${washId}-sheen)`}
              onAnimationEnd={() => setSheenOn(false)} />
          </g>
        )}
        </g>
      </svg>
      {/* The group's own shape and its median, dashed in the page's text ink: apart from the accent campus
          curve and from the green of the search's marks, on either scheme. Over the dots, in a layer of
          their own: drawn with the plot, under the field, the dashes only showed in the gaps between dots,
          and a large group's line broke up into the speckle it crossed. Each over a casing in the panel's
          own colour, a channel cut through the dots (app.css `.hero-dist-group-casing`). Under the glass,
          which comes later at the same layer. */}
      {(groupLine || groupMedianX != null) && (
        <svg
          className="hero-dist-group" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, zIndex: Z.content, pointerEvents: 'none' }}
        >
          <g ref={groupGRef}>
            {groupLine && (
              <>
                <path className="hero-dist-group-casing" d={groupLine} fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <path className="hero-dist-group-curve" d={groupLine} fill="none" stroke="var(--mantine-color-text)" strokeWidth={2.25}
                  strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </>
            )}
            {groupMedianX != null && (
              <>
                <line className="hero-dist-group-casing" x1={groupMedianX} x2={groupMedianX} y1={flagTop + flagBox.h + 2} y2={H} vectorEffect="non-scaling-stroke" />
                <line className="hero-dist-group-median" x1={groupMedianX} x2={groupMedianX} y1={flagTop + flagBox.h + 2} y2={H}
                  stroke="var(--mantine-color-text)" strokeWidth={1.75} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              </>
            )}
          </g>
        </svg>
      )}
      {groupFlagText && (
        <div
          ref={flagRef}
          className="hero-dist-group-flag"
          data-pending={group?.pending || undefined}
          style={{ position: 'absolute', top: flagTop, left: flagLeft, maxWidth: plotW }}
        >
          {groupFlagText}
        </div>
      )}
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
            {groupRead != null && ` · ${num(groupRead)} in the filter`}
          </span>
        </div>
      )}
      {/* The leaders, under the labels: each runs from its dot's rim, in the mark's own green, into
          the teal of the name it carries — at an angle wherever the name had to be shouldered aside. */}
      {foundLabels.length > 0 && (
        <svg
          className="hero-found-leaders" width={Math.max(1, plotW)} height={H} aria-hidden data-names-top={namesBox.top}
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
      {whoPlace && <WhoCaption who={lensWho ?? 'loading'} at={whoPlace} />}
      {holdHint && <div className="chart-tip hero-hold-hint" aria-hidden>Hold a dot to see who it is</div>}
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
              if (f) { if (card?.key !== f.person_key) setCard({ key: f.person_key, pinned: false }); setHoverPile(false); setPileAt(null); return; }
              if (card && !card.pinned) setCard(null);
              setHoverPile(true);
              // Full page, the dot under the pointer is named beside the pile. A finger is left out: on
              // the pile a tap unrolls it, and a hold is how the unrolled field is read.
              const box = e.currentTarget.getBoundingClientRect();
              setPileAt(full && e.pointerType === 'mouse' ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
            }}
            onPointerLeave={() => { setHoverPile(false); setPileAt(null); setCard((c) => (c?.pinned ? c : null)); }}
            onPointerDown={(e) => { dismissSearch(e); }}
            onPointerUp={(e) => {
              if (dismissedRef.current === e.pointerId) { dismissedRef.current = null; return; }
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
              entrance={entrance} delay={SPREAD_MS} highlight={pileHighlight} frameMark="pile-frame" glow rich pack={PACK}
              solo={shownSolo} replay={replay} marks={pileMarks} markBig={bigPile}
              dim={lit?.pile ?? null} ring={pileShow ? pileDot : null}
              onFrame={lensAt ? redrawLens : undefined}
            />
            {/* Not while a dot is named: the caption stands where this pill does, and the pile's own count
                is not what the reader is reading then. */}
            {hoverPile && headcount != null && !pileShow && (
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
            {/* Beside the pile, not in it: the pile is a column a few dots wide, and this is a card. It
                hangs off its left, over the sky above the curve's own tail. */}
            {pileShow && pileAt && (
              <WhoCaption who={pileShow} at={{ left: -(WHO_W + 8), top: Math.max(0, Math.min(H - WHO_H, pileAt.y - WHO_H / 2)) }} />
            )}
          </div>
        </>
      )}
      {/* The pile unrolled: its people at their own pay across the whole row, and where the axis ends. */}
      {tail && tailPays && (
        <div
          className="hero-dist-tail"
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: H, pointerEvents: tailPhase === 'open' ? 'auto' : 'none' }}
          // Open, it lies over both fields, so it takes the pointer itself: a mouse names the dot under
          // it, and a press folds the field back the way a press on either of them did.
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return;
            const box = e.currentTarget.getBoundingClientRect();
            setTailAt(full ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
          }}
          onPointerLeave={() => setTailAt(null)}
          onPointerDown={(e) => { dismissSearch(e); }}
          onPointerUp={(e) => {
            if (dismissedRef.current === e.pointerId) { dismissedRef.current = null; return; }
            closeTail();
          }}
        >
          {/* Where the graph ended: everything left of this line is the graph, squeezed. */}
          {cap != null && tailTop > cap && (
            <div className="hero-dist-tail-edge" aria-hidden style={{ left: `${((cap - lo) / (tailTop - lo)) * 100}%`, top: HEAD, height: H - HEAD }}>
              <span>the graph's edge</span>
            </div>
          )}
          <DotField
            ref={tailDotsRef}
            className="hero-dots-tail" values={tailPays} toX={tailX} heightAt={tailHeight} height={H}
            kinds={colour ? pile.kinds : null} inks={inkList} stack={colour} glow rich pack={PACK}
            solo={shownSolo} marks={pileMarks} markBig={bigPile} frameMark="tail-frame" onFrame={tailDrawn}
            ring={tailShow ? tailDot : null}
            moveTo={{ key: tail.key, pts: tail.key === 2 ? null : tail.from }}
            // The unrolled pile is the pile's own people in the pile's own order, so its mask is the pile's.
            dim={lit?.pile ?? null}
          />
          {tailTopAt && (
            <div className="hero-dist-tail-top" aria-hidden style={{ left: tailTopAt.x, top: tailTopAt.y }}>
              <span className="hero-dist-tail-ring" style={{ width: Math.max(12, tailTopAt.r * 3), height: Math.max(12, tailTopAt.r * 3) }} />
              <span className="chart-value-pill hero-dist-tail-top-label">{usd(tailTop)} · the top salary</span>
            </div>
          )}
          {/* By the dot it names: above it where there is room, below it at the top of the plot. The
              unrolled field is one row of dots, so a caption over it covers only sky. */}
          {tailShow && tailWhoAt && (
            <WhoCaption
              who={tailShow}
              at={{
                left: Math.max(0, Math.min(tail.rowW - WHO_W, tailWhoAt.x - WHO_W / 2)),
                top: tailWhoAt.y - tailWhoAt.r - 8 - WHO_H >= 0 ? tailWhoAt.y - tailWhoAt.r - 8 - WHO_H : tailWhoAt.y + tailWhoAt.r + 8,
              }}
            />
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
                key={`${tail.key}-${tailHeld}`} aria-hidden className="hero-dist-tail-timer"
                style={{ animationDuration: `${TAIL_OPEN_MS}ms`, animationPlayState: tailHeld ? 'paused' : 'running' } as CSSProperties}
              />
            )}
          </div>
        </div>
      )}
      </div>

      <div className="visually-hidden" aria-live="polite">
        {found.length ? `${num(found.length)} ${found.length === 1 ? 'person' : 'people'} from the search marked on the graph` : ''}
      </div>
      <div className="visually-hidden" aria-live="polite">
        {lit
          ? lit.count
            ? `${num(lit.count)} ${lit.count === 1 ? 'person' : 'people'} in ${lit.name}, median ${usd(lit.median)}, ${vsCampus(lit.median, median)}.`
            : `No one on the graph is ${lit.name}.`
          : ''}
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
              <span
                className="hero-dist-swatch" aria-hidden
                data-empty={shownSolo == null || shownSolo === i ? undefined : true}
                style={{ backgroundColor: shownSolo == null || shownSolo === i ? inks[i] : 'transparent', borderColor: inks[i] }}
              />
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
 * One of the other places in the site, in the row at the page's foot: an icon, a name and a line on what
 * it does. They were cards — a tile each, 264px tall on a wide screen with 23px titles — and took the
 * bottom third of the first screen from the graph they sit under. A way on, not a feature of this page,
 * so a plain link: no card, set no larger than the search. The live counts they carried are on the stat
 * line above.
 */
function ShowcaseLink({ icon, title, blurb, to }: {
  icon: ReactNode;
  title: string;
  blurb: string;
  to: string;
}) {
  return (
    <Anchor component={Link} to={to} underline="never" c="inherit" className="showcase-link">
      <span className="showcase-icon" aria-hidden>{icon}</span>
      <span className="showcase-text">
        <span className="showcase-title">{title} <span className="showcase-arrow" aria-hidden>→</span></span>
        <span className="showcase-blurb">{blurb}</span>
      </span>
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
  // Whether the reader put the search on that row (a pointer, an arrow), not the list opening on it.
  const [activeChosen, setActiveChosen] = useState(false);
  const openRef = useRef<((key: string) => boolean) | null>(null);
  // The query lives here, not in either search box, because the graph's full page is a portal: going
  // full page remounts the panel and everything in it. One box is on the page and the other inside the
  // panel, never both, and each is handed the query the other was holding.
  //
  // And in the address (`?q=`), so a search can be kept or sent, and Back from a person opened out of it
  // comes back to it: the box holding it, its marks on the graph, its list shut until the box is turned to
  // (the box's `handed` rule). Written as the reader types but without adding to the history, and kept when
  // a pick empties the box — that pick is what Back comes back from.
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  // Arrived holding a query: the box is not given the caret, which would open its list and move the page.
  const arrivedWithQuery = useRef(urlQuery.trim().length >= 2);
  const writtenRef = useRef(urlQuery);
  const keepUrlRef = useRef(false);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  useEffect(() => {
    const want = query.trim().length >= 2 ? query.trim() : '';
    if (!want && keepUrlRef.current) return;
    if (want) keepUrlRef.current = false;
    if (want === writtenRef.current) return;
    const t = window.setTimeout(() => {
      writtenRef.current = want;
      setParamsRef.current((p) => {
        const n = new URLSearchParams(p);
        if (want) n.set('q', want); else n.delete('q');
        return n;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);
  // The address changed by itself — a link to this page, Back or Forward within it — and the box follows.
  useEffect(() => {
    if (urlQuery === writtenRef.current) return;
    writtenRef.current = urlQuery;
    keepUrlRef.current = false;
    setQuery(urlQuery);
  }, [urlQuery]);
  const [graphFull, setGraphFull] = useState(false);
  // What the full page's bar is filtering the graph to: at most one title and one school, in the order they
  // were put on (Escape and Backspace take the last one off first). Full page only — the landing graph has
  // no bar to show them in, and they go when full page does.
  const [filters, setFilters] = useState<GraphFilterItem[]>([]);
  useEffect(() => { if (!graphFull) setFilters([]); }, [graphFull]);
  const putFilter = useCallback((f: GraphFilterItem) => setFilters((fs) => [...fs.filter((g) => g.kind !== f.kind), f]), []);
  const takeFilter = useCallback((key: string) => setFilters((fs) => fs.filter((g) => filterKey(g) !== key)), []);
  // Only the box the page opens with takes the caret. The one that comes back when full page closes is
  // a box returning to a page the reader is already looking at, and full page hands focus to its own
  // exit button, which this would take straight back off it.
  const firstSearchRef = useRef(true);
  // A phone by the plot's own measure (Distribution's `phone`): there the page's search is above the graph.
  const phone = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  useEffect(() => { firstSearchRef.current = false; }, []);
  /** What both boxes share: the one query, the one list of found people, and the one way to open them. */
  const searchProps = {
    query,
    onQueryChange: setQuery,
    keepFoundOnUnmount: true,
    onPeopleShown: setShown,
    onActiveItem: (key: string | null, chosen: boolean) => { setActiveItem(key); setActiveChosen(chosen); },
    onPick: (h: { person_key: string; name: string }) => {
      keepUrlRef.current = true;
      if (!openRef.current?.(h.person_key)) navigate(`/person/${encodeURIComponent(h.person_key)}`);
    },
  };
  // Who each dot is (lib/homePeople): asked once the search has found someone, a filter is on, or the
  // magnifying glass is first up full page — by when DuckDB is up.
  const peopleSnap = artifactUsable ? homeStats.snapshot_id : '';
  const [wantWho, setWantWho] = useState(false);
  // A title or division row on the page's list — the suggestions, or a result — shown on the graph above it
  // while the reader is on it: its dots lit and the rest faded, as a filter shows it full page. Only a row
  // the reader chose, and one they rest on (150ms), so opening the list lights nothing and a pointer
  // passing over the rows does not repaint the field for each; gone as soon as they leave it.
  const listRow = !graphFull && activeItem != null && /^[td]:/.test(activeItem) ? activeItem : null;
  const previewWanted = listRow && activeChosen ? listRow : null;
  const [previewSettled] = useDebouncedValue(previewWanted, 150);
  const preview = previewWanted != null && previewSettled === previewWanted ? previewWanted : null;
  // The dots are named once, before the first row is chosen: a list of titles and divisions is open.
  const { data: homePeople } = useSql<HomePerson>(['home-people', peopleSnap], homePeopleSql(peopleSnap), !!peopleSnap && (shown.length > 0 || filters.length > 0 || wantWho || listRow != null));
  // And their names, for the glass to name a dot with: only once it has been up full page.
  const { data: homeNames } = useSql<HomeName>(['home-names', peopleSnap], homeNamesSql(peopleSnap), !!peopleSnap && wantWho);
  const spots = useMemo(
    () => (homePeople && artifactUsable && homeStats.pay_counts && homeStats.bin_cap != null ? dotSpots(homePeople, homeStats.pay_counts, homeStats.bin_cap) : null),
    [homePeople, artifactUsable, homeStats],
  );
  // Whose a dot is, for the glass: 'loading' until both lookups are in, null where the dots cannot be
  // named at all (a snapshot whose counts carry no categories, so `dotSpots` has nothing to go on).
  const whoIs = useMemo((): WhoIs | 'loading' | null => {
    if (!wantWho) return null;
    if (!homePeople || !homeNames) return 'loading';
    if (!spots) return null;
    const at = spotPeople(spots);
    const names = new Map(homeNames.map((n) => [n.person_key, n]));
    const pays = new Map(homePeople.map((p) => [p.person_key, p.pay]));
    return (field, index) => {
      const key = at[field][index];
      const n = key ? names.get(key) : undefined;
      return key && n ? { key, name: fullName(n.fn, n.ln), title: n.title, school: n.school, pay: pays.get(key) ?? null } : null;
    };
  }, [wantWho, homePeople, homeNames, spots]);
  // The filter's people, at their dots' pay, and what that lights: one query per filter (cached by its key),
  // mapped onto the dots through the same `spots` the search's marks use.
  const title = filters.find((f): f is { kind: 'title'; hit: TitleHit } => f.kind === 'title')?.hit;
  const school = filters.find((f): f is { kind: 'division'; hit: DivisionHit } => f.kind === 'division')?.hit;
  const { data: filterRows } = useSql<{ person_key: string; pay: number }>(
    ['graph-filter', peopleSnap, title?.code ?? '', school?.school ?? ''],
    filters.length && peopleSnap ? filterPeopleSql(peopleSnap, { jobCode: title?.code, school: school?.school }) : '',
    !!peopleSnap && filters.length > 0,
  );
  // The previewed row's people: the filter's own query, so showing it full page next reuses the answer.
  const pvCode = preview?.startsWith('t:') ? preview.slice(2) : null;
  const pvSchool = preview?.startsWith('d:') ? preview.slice(2) : null;
  const { data: previewRows } = useSql<{ person_key: string; pay: number }>(
    ['graph-filter', peopleSnap, pvCode ?? '', pvSchool ?? ''],
    preview && peopleSnap ? filterPeopleSql(peopleSnap, { jobCode: pvCode ?? undefined, school: pvSchool ?? undefined }) : '',
    !!peopleSnap && preview != null,
  );
  // A title's name alone can be two titles — "Research Associate" is PD012 and PD012N — so where the index
  // has another under the same name, the filter names its code too; picked, it must still say which it was.
  const { data: searchIndex } = useSearchIndex(graphFull || !!title || listRow != null);
  const nameOfTitle = useCallback((code: string, name: string | null) => {
    const t = name ?? (searchIndex?.titles ?? []).find(([c]) => c === code)?.[1] ?? code;
    const shared = (searchIndex?.titles ?? []).filter(([, n]) => n === t).length > 1;
    return shared ? `${t} (${code})` : t;
  }, [searchIndex]);
  const titleName = title ? nameOfTitle(title.code, title.title) : null;
  // A group's lit dots, from its people: not yet known while the query is out or the dots are not yet
  // named — the field is then left as it is until the answer is in, rather than dimmed to nothing and lit
  // a moment later.
  const groupOf = useCallback((name: string, rows: { person_key: string; pay: number }[] | undefined): GraphGroup | null => {
    if (!artifactUsable || !homeStats.pay_counts) return null;
    if (!rows || !spots) return { name, pending: true };
    const pc = homeStats.pay_counts;
    const sizes = {
      main: pc.counts.reduce((t, n) => t + n, 0),
      pile: (pc.categories ?? []).reduce((t, c) => t + c.over, 0),
    };
    return { name, pending: false, ...emphasis(spots, rows.map((r) => ({ person_key: r.person_key, pay: Number(r.pay) })), sizes) };
  }, [artifactUsable, homeStats, spots]);
  const filterGroup = useMemo<GraphGroup | null>(() => {
    if (!filters.length) return null;
    return groupOf(titleName && school ? `${titleName} in ${school.school}` : (titleName ?? school?.school ?? ''), filterRows);
  }, [filters.length, titleName, school, filterRows, groupOf]);
  const previewGroup = useMemo<GraphGroup | null>(() => {
    if (!preview) return null;
    return groupOf(pvCode ? nameOfTitle(pvCode, null) : (pvSchool ?? ''), previewRows);
  }, [preview, pvCode, pvSchool, previewRows, nameOfTitle, groupOf]);
  // On the page, a row the reader is on in the search's list; full page, its filters.
  const group = !graphFull && previewGroup ? previewGroup : filterGroup;
  // What the full page's bar offers with nothing typed. Nothing on: the index's largest schools and titles,
  // turn about, so a narrow strip still shows both kinds. A school on: its largest titles; a title on: the
  // schools that employ most of it — each a small query of the filter's own rows, asked once the filter's
  // own answer is in (DuckDB answers one query at a time). Both on: nothing left to add.
  const { data: topTitles } = useSql<{ code: string }>(
    ['graph-top-titles', peopleSnap, school?.school ?? ''],
    school && !title && peopleSnap ? topTitlesInSql(peopleSnap, school.school) : '',
    !!peopleSnap && !!school && !title && !!filterRows,
  );
  const { data: topSchools } = useSql<{ school: string }>(
    ['graph-top-schools', peopleSnap, title?.code ?? ''],
    title && !school && peopleSnap ? topSchoolsForSql(peopleSnap, title.code) : '',
    !!peopleSnap && !!title && !school && !!filterRows,
  );
  const starters = useMemo<SearchPick[]>(() => {
    if (!searchIndex || (title && school)) return [];
    const asTitle = ([code, name, n, med]: SearchIndex['titles'][number]): SearchPick =>
      ({ kind: 'title', hit: { code, title: name ?? code, n, med } });
    const asSchool = ([name, n, med]: [string, number, number | null]): SearchPick => ({ kind: 'division', hit: { school: name, n, med } });
    if (!title && !school) {
      const schools = [...searchIndex.divisions].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(asSchool);
      const titles = [...searchIndex.titles].filter((r) => r[1]).sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(asTitle);
      return schools.flatMap((s, i) => (titles[i] ? [s, titles[i]] : [s]));
    }
    if (school) {
      const byCode = new Map(searchIndex.titles.map((r) => [r[0], r]));
      return (topTitles ?? []).flatMap((r) => { const row = byCode.get(r.code); return row ? [asTitle(row)] : []; });
    }
    const bySchool = new Map(searchIndex.divisions.map((r) => [r[0], r]));
    return (topSchools ?? []).flatMap((r) => { const row = bySchool.get(r.school); return row ? [asSchool(row)] : []; });
  }, [searchIndex, title, school, topTitles, topSchools]);
  const openFullRef = useRef<(() => void) | null>(null);
  // Whether the full page's search has its list open over the graph (SearchBox `onListOpen`).
  const searchOpenRef = useRef(false);
  const tokens = useMemo<FilterToken[]>(() => filters.map((f) => ({
    key: filterKey(f),
    kind: f.kind,
    label: f.kind === 'title' ? (titleName ?? f.hit.title) : f.hit.school,
  })), [filters, titleName]);
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
  const release = useRelease();

  // The figures on the line under the search, each a number and what it counts. Median is not among them:
  // it is in the lead under the title, and the graph is a picture of it. The exact payroll is on hover.
  const stats: StatData[] = [
    { label: 'employees', value: summary?.latest?.headcount ?? null, format: num },
    { label: 'payroll', value: payroll, format: usdCompact, hint: payroll != null ? usd(payroll) : undefined },
    { label: 'divisions', value: dims?.schools ?? null, format: num },
    { label: 'titles', value: dims?.titles ?? null, format: num },
  ];

  // The page's own search. Under the graph its list drops below the plot, never over it (`keepBelow`). On a
  // phone it is above the graph instead, where it is in sight at load — under the graph it started below the
  // first screen — and there its list lies over the plot, so it is the full page's on a phone: open only
  // while the box is in use, stopping halfway down the plot so the marks landing as the reader types stay in
  // sight, and put away by a press on the graph (`searchOpenRef`) rather than that press scattering the dots.
  const midPlot = () => {
    const plot = document.querySelector('.hero-dist-main')?.getBoundingClientRect();
    return plot ? plot.top + plot.height / 2 : null;
  };
  const pageSearch = !graphFull && (
    <SearchBox
      {...searchProps}
      size="lg"
      autoFocus={firstSearchRef.current && !arrivedWithQuery.current}
      keepBelow={phone ? undefined : () => document.querySelector<HTMLElement>('.hero-dist-main')}
      whileFocused={phone}
      listLimit={phone ? midPlot : undefined}
      onListOpen={phone ? (open) => { searchOpenRef.current = open; } : undefined}
      // Focused and empty, it suggests where to start: the full page's starters, with no filter on.
      starters={starters}
      // The way in to the full page's filters from the page's own search: a title or school shown
      // on the graph rather than opened. The box empties itself, so no list is left behind.
      onShowOnGraph={(pick) => { putFilter(pick); openFullRef.current?.(); }}
    />
  );

  // Two weights. The graph and the search are the page: the only things on it with a surface and a border,
  // and together in the first screen. Everything else is text on the page, no larger than the search's own
  // and the same size on any screen — the figures, the ways on, the notes. The title block used to be
  // centred at up to 56px over a two-line paragraph, ~200px repeating the masthead's name before the graph,
  // and with the figures and tiles scaled up to match it the search began below the first screen at 1440×900.
  return (
    <Box className="home" style={{ position: 'relative' }}>
      <div className="hero-dotgrid" aria-hidden />
      <Stack gap="xl" w="100%" style={{ position: 'relative', zIndex: Z.content }}>
        {/* The page's width, not a reading measure: a figure is not prose, and the plot grows taller with
            its width (PLOT_ASPECT). The header is set on the same left edge as the panel under it. */}
        <Stack gap="sm" w="100%" className="hero-rise">
          <div className="home-head">
            <div className="home-head-main">
              <Title order={1} fz="var(--fs-display)" lh={1.15} className="home-title">
                <Text span inherit c="bright">UW–Madison </Text>
                <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
              </Title>
              <Text size="sm" c="dimmed" className="home-lead">
                Search anyone by name to see their pay, how it changed, and how they compare to everyone
                with the same title.
                {summary?.latest?.median != null && (
                  <> The median salary is{' '}
                    <Text span inherit fw={700} c="var(--mantine-color-text)">{usd(summary.latest.median)}</Text>.
                  </>
                )}
              </Text>
            </div>
            {/* When, not how many — the headcount is the first figure on the line under the search — and
                what came with it: new data, and the salary ranges when they came out with it. One link to
                the Data page's account of both, set small; it stays until the next release is the new one. */}
            {release && (
              <Anchor
                component={Link}
                to="/data#whats-new"
                className="home-news"
                underline="never"
                aria-label={`New: ${release.month} data${release.rangesUpdated ? ', and updated salary ranges' : ''}. What's new`}
              >
                <span className="home-news-tag" aria-hidden>New</span>
                <span className="home-news-text" aria-hidden>
                  {release.month} data{release.rangesUpdated ? <> <span className="home-news-sep">·</span> Salary ranges updated</> : null}
                </span>
                <span className="home-news-arrow" aria-hidden>→</span>
              </Anchor>
            )}
          </div>

          {phone && pageSearch}
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
              search={(
                <SearchBox
                  {...searchProps}
                  size="md"
                  results="bar"
                  peopleInGroup={FULL_PAGE_PEOPLE}
                  onListOpen={(open) => { searchOpenRef.current = open; }}
                  // On a phone the list is as wide as the graph: it stops halfway down the plot, so the rest
                  // stays in sight — the marks landing as the reader types — and a tap there puts it away.
                  listLimit={() => {
                    if (!window.matchMedia('(max-width: 30em)').matches) return null;
                    const plot = document.querySelector('.hero-dist-full .hero-dist-main')?.getBoundingClientRect();
                    return plot ? plot.top + plot.height / 2 : null;
                  }}
                  placeholder="Search a person, title or school…"
                  tokens={tokens}
                  onRemoveToken={takeFilter}
                  onPickTitle={(hit) => putFilter({ kind: 'title', hit })}
                  onPickDivision={(hit) => putFilter({ kind: 'division', hit })}
                  starters={starters}
                />
              )}
              openFullRef={openFullRef}
              whoIs={whoIs}
              onWantWho={() => setWantWho(true)}
              searchOpenRef={searchOpenRef}
              group={group}
              onPeel={() => {
                if (!filters.length) return false;
                takeFilter(filterKey(filters[filters.length - 1]));
                return true;
              }}
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
          {!phone && pageSearch}

          <div className="home-stats">
            <div className="home-stat-row">
              {stats.map((s) => <StatItem key={s.label} {...s} />)}
            </div>
            <Anchor component={Link} to="/explore" underline="never" className="home-stats-browse accent7-text" c="accent.7">
              Browse every school and title under Divisions <span className="browse-arrow" aria-hidden>→</span>
            </Anchor>
          </div>
        </Stack>

        {/* The rest of the site, below the fold: the page used to end with nothing to say that Compare,
            Reports, Screening or the division pages existed. Links, not features of this page. */}
        <nav className="home-more" aria-labelledby="home-more-title">
          <div id="home-more-title" className="home-more-title"><Eyebrow span>Also in here</Eyebrow></div>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="lg" verticalSpacing="md">
            <ShowcaseLink
              to="/paycheck"
              icon={<IconBriefcase size={18} stroke={1.8} />}
              title="Look up a title"
              blurb="See a title's full pay distribution, who holds it, and how it varies by school."
            />
            <ShowcaseLink
              to="/explore"
              icon={<IconBuildingBank size={18} stroke={1.8} />}
              title="Compare divisions"
              blurb="Headcount, median pay and top earners side by side across every school."
            />
            <ShowcaseLink
              to="/reports"
              icon={<IconReportAnalytics size={18} stroke={1.8} />}
              title="Build an equity case"
              blurb="Run the UW salary guidelines for one person and print the brief for HR."
            />
            <ShowcaseLink
              to="/screening"
              icon={<IconListSearch size={18} stroke={1.8} />}
              title="Screen a whole unit"
              blurb="Rank everyone in a school or department by how strong their case looks."
            />
          </SimpleGrid>
        </nav>

        {/* Footnotes: the least urgent thing on the page, at its end. */}
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
