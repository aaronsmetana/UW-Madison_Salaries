import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Divider, Tooltip, ThemeIcon, Anchor, Card, Button, ActionIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconReportMoney, IconUsers, IconBuildingBank, IconBriefcase, IconReportAnalytics, IconListSearch, IconArrowBarToDown,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId, useHomeStats } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { ACTUAL_PAY, FTE_MULT } from '../lib/queries';
import { countBelow, countWithin, smoothBins, READOUT_RADIUS, type Bin } from '../lib/distribution';
import { usd, usdCompact, num } from '../lib/format';
// Same compact currency the peer-range quartile labels use, so the two charts read alike.
import { fmtK, assignLabelRows } from '../lib/chartStyle';
import { useCountUp, prefersReducedMotion } from '../lib/motion';
import { SearchBox } from '../components/SearchBox';
import { Eyebrow } from '../components/Eyebrow';
import { useDocTitle } from '../lib/useDocTitle';
import { ICON } from '../lib/ui';
import { Z } from '../lib/layers';
import { DotField, SPREAD_MS, useEntranceOnce, type DotFieldHandle } from '../components/chart/DotField';
import { FisheyeLens, LENS_D, type FisheyeLensHandle, type LensView } from '../components/chart/FisheyeLens';
import { peopleFromCounts } from '../lib/dotLayout';
import { STIR_STEP, stirPath } from '../lib/dotPhysics';
import { usePref } from '../lib/prefs';
import { SegmentedToggle } from '../components/SegmentedToggle';
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
      style={{ fontSize: 'var(--fs-stat)', lineHeight: 1.1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
    >
      {animated == null ? '—' : format(Math.round(animated))}
    </Text>
  );
  return (
    <Stack gap={8} align="center" style={{ flex: 1, minWidth: 0, paddingInline: 12 }}>
      {/* The icon leaves ~110px for the label, so a second line is allowed and its height reserved on
          every tile — otherwise a tile whose label wraps drops its value off the shared baseline. */}
      <Group gap={7} justify="center" align="center" wrap="nowrap" mih={30}>
        <ThemeIcon size={26} radius="md" variant="light" color={color}>
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
 *  label's own rendered line box (xxs at lh 1.2 ≈ 13px) or two "different" rows still touch, which
 *  looks like the collision the stagger exists to prevent. */
const LABEL_ROW_H = 16;
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
const PLOT_H = { phone: 275, wide: 375 };
const HEADROOM = { phone: 35, wide: 45 };
/** Where the median's line and the quartiles' begin below the plot's top: grown with it. */
const MARK_TOP = { strong: 5, plain: 33 };
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

function Distribution({
  bins, payCounts, p25, median, p75, cap, overflow, headcount, byCategory, controls,
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
}) {
  // A light kernel over the raw counts: enough to keep 250 points from reading as static, not enough
  // to sand off the round-number spikes at $35k / $40k / $50k, which are real people rather than
  // noise. See `KERNEL_SIGMA` for the measurements the width was chosen against.
  const curve = useMemo(() => smoothBins(bins), [bins]);
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
  const pileLabelRef = useRef<HTMLDivElement>(null);
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
  // Where a drag with the mouse button held last stirred the dots, while it is held.
  const stirRef = useRef<{ x: number; y: number } | null>(null);
  const H = phone ? PLOT_H.phone : PLOT_H.wide;
  const HEAD = phone ? HEADROOM.phone : HEADROOM.wide;

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
    const i = Math.min(curve.length - 2, Math.max(0, Math.floor((v - curveLo) / 1000)));
    const a = curve[i], b = curve[i + 1];
    const f = Math.min(1, Math.max(0, (v - a.bucket) / ((b.bucket - a.bucket) || 1)));
    const n = a.n + (b.n - a.n) * f;
    return (n / curveMax) * (H - HEAD - 2) + 2;
  }, [curve, curveLo, curveSpan, curveMax, H, HEAD]);
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
  }, [bins, p25, median, p75]);

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
  const hoveredBucket = hoverIdx != null ? curve[hoverIdx]?.bucket ?? null : null;
  const highlight = useMemo<[number, number] | null>(
    () => (hoveredBucket != null ? [hoveredBucket - READOUT_RADIUS, hoveredBucket + READOUT_RADIUS + BIN_DOLLARS] : null),
    [hoveredBucket],
  );

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
  const marks: { v: number; label: string; strong: boolean }[] = [
    ...(inRange(p25) ? [{ v: p25, label: 'p25', strong: false }] : []),
    ...(inRange(median) ? [{ v: median, label: 'median', strong: true }] : []),
    ...(inRange(p75) ? [{ v: p75, label: 'p75', strong: false }] : []),
  ];

  // The curve is a density, so its height is not a headcount and must never be shown as one. The
  // readout names the bucket under the pointer and counts the RAW bins around it, which is what makes
  // a mound legible: "this hump is 1,240 people, not a taller line".
  const hovered = hoverIdx != null ? curve[hoverIdx] : null;
  const hoverPct = hovered ? (X(hovered.bucket) / W) * 100 : 0;
  // The band covers the dollars the count covers: the $1k bins within ±$5k of the bucket, so from
  // $5k below it to the end of the bin $5k above. Clamped to the plotted range: near either end the
  // band would otherwise hang off the panel and claim to cover salaries the chart does not draw.
  const bandLo = hovered ? Math.max(lo, hovered.bucket - READOUT_RADIUS) : 0;
  const bandHi = hovered ? Math.min(hi, hovered.bucket + READOUT_RADIUS + BIN_DOLLARS) : 0;
  // Against the full headcount, not the binned total — the people above the $250k cap are still
  // people, and leaving them out would put the top of the drawn range at the 100th percentile.
  const share = hovered && headcount ? countBelow(bins, hovered.bucket) / headcount : null;
  // With one category shown alone, the readout is of its people: how many within ±$5k, and where
  // the pointer's pay falls among them (everyone in it, above the cap too).
  const soloCat = shownSolo != null && categories ? categories[shownSolo] : null;
  const soloBins = shownSolo != null ? categoryBins[shownSolo] : null;
  const readCount = hovered ? countWithin(soloBins ?? bins, hovered.bucket, READOUT_RADIUS) : 0;
  const readShare = hovered && soloCat && soloBins ? countBelow(soloBins, hovered.bucket) / soloCat.n : share;
  // Centred on the readout, then clamped to the plot's own edges. This replaces a pair of magic
  // thresholds (anchor left below 15%, right above 85%) that assumed a pill narrower than the one
  // the percentile made it: at 375px a 224px pill centred at 30% hung 2px off the panel, because
  // 30% is neither end. Clamping asks the question the thresholds were approximating.
  const pillLeft = plotW > 0 && pillW > 0
    ? Math.max(0, Math.min(plotW - pillW, (hoverPct / 100) * plotW - pillW / 2))
    : null;
  const onHover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const at = lo + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * span;
    let best = 0;
    for (let i = 1; i < curve.length; i++) {
      if (Math.abs(curve[i].bucket - at) < Math.abs(curve[best].bucket - at)) best = i;
    }
    setHoverPile(false);
    setHoverIdx(best);
    setLensAt(e.pointerType === 'mouse' ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
  };
  const onLeave = () => { setHoverIdx(null); setLensAt(null); lensPageRef.current = null; };
  // A mouse's press bursts the dots where it is, and a drag with the button held stirs them along its
  // path: a smaller burst every STIR_STEP px (lib/dotPhysics `stirPath`), through the move's coalesced
  // points, so a quick drag follows its true line and leaves no gaps. A finger's tap bursts too, shows
  // the readout there and ticks the phone — but a finger that moves is scrolling, and the browser takes
  // the gesture (no pointerup reaches here, or a pointercancel does).
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      const box = e.currentTarget.getBoundingClientRect();
      const at = { x: e.clientX - box.left, y: e.clientY - box.top };
      mainDotsRef.current?.burst(at.x, at.y);
      stirRef.current = at;
      return;
    }
    tapRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    onHover(e);
    // A touch contact reports its button held as it moves: only a mouse stirs.
    if (e.pointerType !== 'mouse' || !(e.buttons & 1)) { stirRef.current = null; return; }
    const box = e.currentTarget.getBoundingClientRect();
    const native = e.nativeEvent;
    const moves = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const pts = (moves.length ? moves : [native]).map((m) => ({ x: m.clientX - box.left, y: m.clientY - box.top }));
    let from = stirRef.current;
    // Held down from off the plot: the stir starts here.
    if (!from) { stirRef.current = pts[pts.length - 1]; return; }
    for (const p of pts) {
      for (const q of stirPath(from.x, from.y, p.x, p.y, STIR_STEP)) {
        mainDotsRef.current?.burst(q.x, q.y, true);
        from = q;
      }
    }
    stirRef.current = from;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') { stirRef.current = null; return; }
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap || tap.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10 || performance.now() - tap.t > 400) return;
    onHover(e);
    setTapped(true);
    const box = e.currentTarget.getBoundingClientRect();
    if (mainDotsRef.current?.burst(e.clientX - box.left, e.clientY - box.top)) navigator.vibrate?.(10);
  };
  // The browser took the gesture: no tap, no stir.
  const onCancel = () => { stirRef.current = null; tapRef.current = null; };
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
      path(curvePts);
      ctx.strokeStyle = tok('--mantine-color-accent-6');
      ctx.lineWidth = 1.75 * map(cx, H - dotHeight(Math.min(pw, Math.max(0, cx)), pw)).scale;
      ctx.lineJoin = 'round';
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

  return (
    // Not a link any more: the panel is for pointing at, and Divisions has its own link below it.
    <div
      className="hero-dist glass"
      style={{ '--pile-gap': `${hasPile ? PILE_GAP : 0}px`, '--pile-w': hasPile ? `max(${PILE_MIN_W}px, calc((100% - ${PILE_GAP}px) * ${(pileShare / (1 + pileShare)).toFixed(5)}))` : '0px' } as CSSProperties}
    >
      {(controls || motion) && (
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
          {controls}
        </div>
      )}
      <div className="hero-dist-row">
      <div
        ref={mainBoxRef} className="hero-dist-main" data-lens={lensAt ? 'on' : 'off'} style={{ position: 'relative' }}
        onPointerMove={onMove} onPointerLeave={(e) => { if (e.pointerType === 'mouse') { onLeave(); stirRef.current = null; } }}
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel}
      >
      {/* Every employee under the cap, one dot each, falling into place once a session. The fill the
          curve used to carry is these people; the line, the markers and the readout stay on top. */}
      <div style={{ position: 'absolute', inset: 0, height: H }}>
        <DotField
          ref={mainDotsRef}
          className="hero-dots" values={people} toX={dotX} heightAt={dotHeight} height={H}
          kinds={colour ? cats : null} inks={inkList} stack={colour}
          airKinds={colour ? null : cats} airInks={colour ? undefined : inks}
          entrance={entrance} highlight={highlight} glow
          solo={shownSolo} replay={replay}
          onFrame={lensAt ? redrawLens : undefined}
        />
      </div>
      <svg className="hero-dist-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden style={{ display: 'block' }}>
        <path d={line} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {marks.map((m) => (
          <line
            key={m.label}
            x1={X(m.v)} x2={X(m.v)} y1={m.strong ? MARK_TOP.strong : MARK_TOP.plain} y2={H}
            stroke={m.strong ? 'var(--mantine-color-accent-7)' : 'var(--mantine-color-gray-5)'}
            strokeWidth={m.strong ? 1.5 : 1}
            strokeDasharray={m.strong ? undefined : '2 3'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
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
              ? (lensAt.y - LENS_D / 2 - 30 >= 0 ? lensAt.y - LENS_D / 2 - 30 : lensAt.y + LENS_D / 2 + 6)
              : Y(hovered.n) < 26 ? Y(hovered.n) + 10 : Y(hovered.n) - 20,
            // Only before the first measurement lands; after that `pillLeft` is already exact.
            transform: pillLeft != null ? undefined : 'translateX(-50%)',
          }}
          ref={pillRef}
        >
          <span className="chart-value-pill">
            {fmtK(hovered.bucket)} · {num(readCount)} {soloCat ? soloCat.name : 'people'} ±{fmtK(READOUT_RADIUS)}
            {readShare != null && ` · ${ordinal(Math.min(99, Math.max(1, Math.round(readShare * 100))))} percentile${soloCat ? ` of ${soloCat.name}` : ''}`}
          </span>
        </div>
      )}
      {lensAt && <FisheyeLens ref={lensRef} at={lensAt} draw={drawLens} />}
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
            className="hero-dist-pile" style={{ position: 'relative', height: H }}
            onPointerMove={() => { setHoverIdx(null); setLensAt(null); setHoverPile(true); }}
            onPointerLeave={() => setHoverPile(false)}
          >
            <DotField
              ref={pileDotsRef}
              className="hero-dots-over" values={pile.values} toX={pileX} heightAt={pileHeight} height={H}
              kinds={colour ? pile.kinds : null} inks={inkList} stack={colour}
              entrance={entrance} delay={SPREAD_MS} highlight={pileHighlight} frameMark="pile-frame" glow
              solo={shownSolo} replay={replay}
              onFrame={lensAt ? redrawLens : undefined}
            />
            {hoverPile && headcount != null && (
              <div aria-hidden style={{ position: 'absolute', right: 0, top: H - pileH - 30, zIndex: Z.local, pointerEvents: 'none' }}>
                <span className="chart-value-pill" style={{ whiteSpace: 'nowrap' }}>
                  {soloCat
                    ? `${num(soloCat.over ?? 0)} ${soloCat.name} at ${fmtK(cap ?? hi)} or more`
                    : `${num(over)} people at ${fmtK(cap ?? hi)} or more · the top ${(Math.max(0.1, (over / headcount) * 100)).toFixed(1)}%`}
                </span>
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* Marker labels live in HTML, not SVG: `preserveAspectRatio="none"` would stretch SVG text
          horizontally by whatever factor the box is scaled by. */}
      <div
        ref={labelRowRef}
        style={{ position: 'relative', height: Math.max(1, ...labelRows.map((r) => r + 1)) * LABEL_ROW_H, marginTop: 2, width: PLOT_WIDTH }}
      >
        {marks.map((m, i) => (
          <Text
            key={m.label}
            ref={(el: HTMLDivElement | null) => { labelRefs.current[i] = el; }}
            size="xxs"
            lh={1.2}
            c={m.strong ? 'accent.7' : 'dimmed'}
            fw={m.strong ? 700 : 500}
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
        <Text
          ref={pileLabelRef}
          size="xs"
          c="dimmed"
          className="hero-dist-pile-label"
          style={{ position: 'absolute', right: 0, whiteSpace: 'nowrap' }}
        >
          {hasPile ? `${num(over)} at ${fmtK(cap ?? hi)}+` : cap != null ? `${fmtK(cap)}+` : `${fmtK(hi)}+`}
        </Text>
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
        {motion && <span className="hero-dist-hint"> · {canHover ? 'click the dots to scatter them, or drag through them' : 'tap the dots to scatter them'}</span>}
      </Text>
    </div>
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
        <ThemeIcon size={34} radius="md" variant="light" color="accent" mb="sm">
          {icon}
        </ThemeIcon>
        <Text fw={700} fz="md" style={{ letterSpacing: '-0.01em' }}>
          {title} <span className="showcase-arrow">→</span>
        </Text>
        <Text size="sm" c="dimmed" mt={4} style={{ lineHeight: 1.5 }}>{blurb}</Text>
        <Text size="xs" c="dimmed" mt="sm" fw={600}>{stat}</Text>
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
        {/* Capped at `--content-max`, matching the showcase tiles below, NOT at the `--content-prose`
            the headline and paragraph use. The narrow hero column is a reading measure, and a figure
            is not prose: at 880px the plot was a 4.9:1 box, and the two features the $1k buckets
            exist to resolve read better with the extra 320px than any amount of extra height gives
            them. The search field matches it: it is the page's primary action and the thing the
            headline tells you to use, so it reads as underweight at anything narrower than the
            figure it sits under. */}
        <Stack gap="lg" maw="var(--content-max)" mx="auto" w="100%" className="hero-rise">
          <div className="hero-dist-wrap">
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

          <SearchBox size="lg" autoFocus />

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
        <Stack gap="md" maw="var(--content-max)" mx="auto" w="100%" mt="xl">
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
