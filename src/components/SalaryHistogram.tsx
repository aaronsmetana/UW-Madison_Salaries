import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Rectangle, type RectangleProps,
} from 'recharts';
import { AXIS_TICK, GRID, fmtK, BAR_RADIUS, chartKeys, CHART_FONT, fmtCount } from '../lib/chartStyle';
import { Text } from '@mantine/core';
import { MARK_SELF, MARK_SELF_TEXT, GUIDE_SOFT, BAND_IQR } from './markers';
import { TipSurface } from './chart/ChartTooltip';
import { binSalaries, binsForSpread, MIN_FOR_HISTOGRAM } from '../lib/histogram';
import { num, pct } from '../lib/format';
import { chartAnim, useMounted, useEntrance } from '../lib/motion';
import { ChartData } from './ChartData';
import { Z } from '../lib/layers';
import { measureText, type Box } from '../lib/labelLayout';
import { pinClearance, medianPlace as placeMedian } from '../lib/histLabels';

/** What Recharts hands a bar's \`shape\`: the rectangle's own props, its datum and its index. */
type BarShape = { payload: { lo: number; hi: number; n: number; range: string }; index: number } & RectangleProps;

/** Below this cohort size, the histogram renders as segmented "brick" bars — a normal bar-chart
 *  silhouette where each bar is visibly built from horizontal bricks, 1 brick = 1 person — so small
 *  cohorts read as countable people without the plot dissolving into sparse floating dots. Larger
 *  cohorts (or a computed brick too thin to read) fall back to continuous bars automatically. */
const MAX_FOR_UNIT_MODE = 60;
const BRICK_GAP = 2;
/** Widest a `$147k` edge label gets at 11px, plus breathing room. Labels are thinned to this pitch
 *  rather than drawn at every bin edge: ten bins mean eleven labels, and on a phone all eleven adjacent
 *  pairs overlapped into one unreadable run of digits. */
const EDGE_LABEL_PITCH = 52;
/** Reserved band above the columns for the median guide's label in unit mode. Without it the label
 *  printed straight through the count sitting above the tallest bar — measured at 1440px, not just
 *  at phone width. */
const MEDIAN_LABEL_BAND = 16;
/** A count's line: chart text at line-height 1, and a pixel. */
const COUNT_H = 12;
/** A column at least this tall holds its count inside its top (P38), on the bricks, which cover the guides there:
 *  above the column, the count of 5 over $125–130k sat on the dashed p75 line. */
const COUNT_IN = 13;
/** The tallest stack always fills roughly this plot height — brick height scales to the cohort, so a
 *  3-person maximum and a 12-person maximum both look intentional rather than stubby or towering. */
const TARGET_PLOT_H = 200;

interface TipData { range: string; n: number; lo: number; hi: number }

/** Shared histogram tooltip content (both render modes): range, count + share of the cohort, and how
 *  much of the cohort earns below this range — reused as both a Recharts `content=` and a manual
 *  floating tooltip (unit mode has no Recharts chart to hang a `<Tooltip>` off of). */
function HistTipBody({ d, total, below }: { d: TipData; total: number; below: number }) {
  const share = total > 0 ? d.n / total : 0;
  const belowShare = total > 0 ? below / total : 0;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{d.range}</Text>
      <Text size="xs" c="dimmed">{num(d.n)} {d.n === 1 ? 'person' : 'people'} ({pct(share, 0)})</Text>
      {below > 0 && <Text size="xs" c="dimmed">{pct(belowShare, 0)} of the cohort earns below this range</Text>}
    </TipSurface>
  );
}

/**
 * An x-axis tick whose axis's ends stay inside the plot: the first label starts at the origin, clear of the y-axis's
 * "0" beside it (with bins fitted to the spread the axis no longer starts at $0, where the two had shared a corner),
 * and the last ends at the plot's edge.
 */
function EdgeTick({ x, y, payload, index, visibleTicksCount }: {
  x?: number; y?: number; payload?: { value: number }; index?: number; visibleTicksCount?: number;
}) {
  if (x == null || y == null || !payload) return null;
  const anchor = index === 0 ? 'start' : index === (visibleTicksCount ?? 0) - 1 ? 'end' : 'middle';
  return (
    <text x={x} y={y} dy="0.71em" textAnchor={anchor} {...AXIS_TICK} className="recharts-cartesian-axis-tick-value">
      {fmtK(payload.value)}
    </text>
  );
}

/** A pay band to draw under the distribution: its floor, its ceiling (null where HR publishes none), and its line. */
export interface HistBand {
  min: number;
  max: number | null;
  label: string;
}

/**
 * A pay band under a histogram, on the histogram's own scale (T8), so its floor, quarters and ceiling line up with
 * the people above them. Clipped to the plot: an end beyond it is named at the edge with an arrow. `inset` is the
 * plot's offset inside the chart (the bars' y-axis), `at` the histogram's own value → fraction.
 */
function BandStrip({ band, at, lo, hi, inset, marker, plotW }: {
  band: HistBand;
  at: (v: number) => number;
  lo: number;
  hi: number;
  inset: { left: number; right: number };
  marker: number | null;
  plotW: number;
}) {
  const l = at(band.min);
  const r = band.max != null ? at(band.max) : 1;
  const quarters = band.max != null
    ? [0.25, 0.5, 0.75].map((f) => band.min + (band.max! - band.min) * f).filter((v) => v > lo && v < hi)
    : [];
  const minText = `${band.min < lo ? '← ' : ''}min ${fmtK(band.min)}`;
  const maxText = band.max == null ? 'no maximum →' : `max ${fmtK(band.max)}${band.max > hi ? ' →' : ''}`;
  // The two ends' words side by side where the band is too narrow on this scale to hold them apart.
  const w = Math.max(0, plotW - inset.left - inset.right);
  const together = w > 0 && (r - l) * w < measureText(minText, CHART_FONT) + measureText(maxText, CHART_FONT) + 12;
  const word = { position: 'absolute' as const, whiteSpace: 'nowrap' as const, fontSize: CHART_FONT, lineHeight: 1 };
  return (
    <div className="hist-band" style={{ marginLeft: inset.left, marginRight: inset.right, marginTop: 8 }}>
      <div style={{ position: 'relative', height: 12 }} aria-hidden>
        <div
          className="hist-band-fill"
          style={{ position: 'absolute', left: `${l * 100}%`, width: `${Math.max(0.5, (r - l) * 100)}%`, top: 0, bottom: 0, borderRadius: 6, background: 'var(--band-fill-strong)', boxShadow: 'inset 0 0 0 1px var(--hairline-strong)' }}
        />
        {quarters.map((v) => (
          <div key={v} className="hist-band-quarter" style={{ position: 'absolute', left: `${at(v) * 100}%`, top: 2, bottom: 2, width: 1, background: 'var(--guide-strong)' }} />
        ))}
        {marker != null && (
          <div
            className="hist-band-marker"
            style={{ position: 'absolute', left: `${at(marker) * 100}%`, top: '50%', width: 10, height: 10, borderRadius: '50%', background: MARK_SELF, boxShadow: '0 0 0 2px var(--mantine-color-body)', transform: 'translate(-50%, -50%)' }}
          />
        )}
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 3 }}>
        {together ? (
          <Text c="dimmed" className="hist-band-ends" style={{ ...word, left: `${((l + r) / 2) * 100}%`, transform: 'translateX(-50%)' }}>
            {minText} · {maxText}
          </Text>
        ) : (
          <>
            <Text c="dimmed" className="hist-band-min" style={{ ...word, left: `${l * 100}%` }}>{minText}</Text>
            <Text c="dimmed" className="hist-band-max" style={{ ...word, left: `${r * 100}%`, transform: 'translateX(-100%)' }}>{maxText}</Text>
          </>
        )}
      </div>
      <Text size="xs" c="dimmed" mt={4} className="hist-band-label">{band.label}</Text>
    </div>
  );
}

/**
 * Salary distribution histogram with dynamic, data-scaled bins. Optionally marks
 * where one value (e.g. a person's salary) lands. Renders a short prompt instead
 * of a chart when there are too few records to be meaningful.
 */
export function SalaryHistogram({
  values,
  markerValue,
  markerLabel = 'this person',
  minToShow = MIN_FOR_HISTOGRAM,
  tooFewText,
  height = 240,
  domain,
  onBinClick,
  measure = 'Pay',
  band = null,
}: {
  values: number[];
  /** What the values are, for the chart's name and its table: the measure in force (G2). */
  measure?: string;
  markerValue?: number | null;
  markerLabel?: string;
  minToShow?: number;
  tooFewText?: string;
  height?: number;
  domain?: [number, number];
  /** Optional: clicking a bar reports that bin's [lo, hi) salary range (e.g. to filter a people list). */
  onBinClick?: (range: { lo: number; hi: number }) => void;
  /** A pay band to draw under the people, on their scale (T8). */
  band?: HistBand | null;
}) {
  // Drawn at their final state at once where no entrance plays (a tab switch, Reduce Motion: G8).
  const entrance = useEntrance();
  const mounted = useMounted() || !entrance;
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  /** A bar that filters is a button (G21): reached by Tab, pressed with Enter or Space, lit while focused as it
   *  is while pointed at, and named for what pressing it shows. It was a pointer-only target with its use in
   *  a caption. */
  // `dim`: whether focus also dims the other bars, as a pointer does. Not on Recharts' bars: the redraw that
  // dimming sets off replaces the focused bar's element, and focus goes with it.
  const binControl = (b: { lo: number; hi: number; n: number; range: string }, i: number, dim = true) => ({
    role: 'button' as const,
    tabIndex: 0,
    className: 'hist-pick',
    'aria-label': `Show the ${num(b.n)} ${b.n === 1 ? 'person' : 'people'} paid ${b.range}`,
    onKeyDown: (e: KeyboardEvent<Element>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onBinClick?.({ lo: b.lo, hi: b.hi });
    },
    ...(dim ? { onFocus: () => setActiveIdx(i), onBlur: () => setActiveIdx(null) } : {}),
  });
  // Both render paths wrap in `.hist-plot`, so one measurement serves both. Only the axis labels need
  // it, and only to decide how many of them there is room for.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(0);
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setPlotW((prev) => {
      const next = el.getBoundingClientRect().width;
      return Math.abs(next - prev) < 0.5 ? prev : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // As many bins as the middle half's spread calls for (T7): ten across the whole range put half of a title in one bar.
  const bins = binSalaries(values, binsForSpread(values), domain);
  if (values.length < minToShow || bins.length < 2) {
    return (
      <Text size="sm" c="dimmed">
        {tooFewText ??
          `Only ${num(values.length)} ${values.length === 1 ? 'person' : 'people'} here — too few to chart a meaningful salary distribution.`}
      </Text>
    );
  }

  const lo = bins[0].lo;
  const hi = bins[bins.length - 1].hi;
  const at = (x: number) => (hi > lo ? Math.max(0, Math.min(1, (x - lo) / (hi - lo))) : 0);
  // Plot bars on a real value (number) axis with ticks at the bin EDGES, so the axis reads as a true
  // salary scale: each bar is centered in its bin and the edge ticks line up with the bar edges.
  const data = bins.map((b) => ({ x: (b.lo + b.hi) / 2, label: b.label, range: b.range, n: b.n, lo: b.lo, hi: b.hi }));
  const edges = [...bins.map((b) => b.lo), hi];
  // Keep the first and last — they are the range — and as many evenly-spaced interior edges as fit.
  const shownEdges = (() => {
    // Until the plot is measured, only the two ends: every edge at once overlapped on a phone for the
    // frames before the width came in, and a screenshot or a loaded test run could catch them.
    if (plotW <= 0) return edges.length > 2 ? [edges[0], edges[edges.length - 1]] : edges;
    const room = Math.max(2, Math.floor(plotW / EDGE_LABEL_PITCH));
    if (edges.length <= room) return edges;
    const step = Math.ceil((edges.length - 1) / (room - 1));
    const keep = edges.filter((_, i) => i % step === 0);
    if (keep[keep.length - 1] !== edges[edges.length - 1]) keep.push(edges[edges.length - 1]);
    return keep;
  })();
  const total = bins.reduce((s, b) => s + b.n, 0);
  const cumBelow = (binLo: number) => bins.reduce((s, b) => s + (b.hi <= binLo ? b.n : 0), 0);

  // Quartiles from the raw values → faint reference guides for market context. Only the median gets
  // an in-chart text label — labeling all three collides whenever the IQR is narrow (common for a
  // single title's distribution); the caption below spells out all three.
  const sorted = [...values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const quantile = (p: number): number | null => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p;
    const a = Math.floor(i), c = Math.ceil(i);
    return sorted[a] + (sorted[c] - sorted[a]) * (i - a);
  };
  const med = quantile(0.5);
  const guides = [quantile(0.25), med, quantile(0.75)]
    .filter((x): x is number => x != null)
    .map((v) => ({ value: v, isMedian: v === med }));

  // Index of the bin the marked value falls in (last bin inclusive, matching binSalaries) → recolor it.
  let markerBin: number | null = null;
  if (markerValue != null && Number.isFinite(markerValue) && hi > lo) {
    const v = Math.max(lo, Math.min(hi, markerValue));
    const idx = bins.findIndex((b) => v < b.hi);
    markerBin = idx === -1 ? bins.length - 1 : idx;
  }
  // Marker position: pure-linear on the value axis (lo → left edge, hi → right edge). Because ticks
  // sit at bin edges, this lands the pin at the exact salary (e.g. $75k midway between $74k and $76k).
  const markerFraction = markerValue != null && Number.isFinite(markerValue) && hi > lo
    ? (Math.max(lo, Math.min(hi, markerValue)) - lo) / (hi - lo)
    : null;

  // Recharts plot insets for the bars-mode chart: left margin (12) + YAxis width (48); right margin
  // (12); top margin (headroom for the marker pin + label above the bars, plus the median guide's
  // in-chart text label when there's room to show one); default XAxis height (30).
  const PLOT_LEFT = 60;
  const PLOT_RIGHT = 12;
  const PLOT_TOP = guides.length ? 42 : 30;
  const X_AXIS_H = 30;

  // Unit mode auto-selects for small cohorts (real countable people); falls back to bars if the
  // computed brick would be too thin to read (an extreme concentration into one bin).
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const brickH = Math.min(16, Math.floor(TARGET_PLOT_H / maxN) - BRICK_GAP);
  const stackH = maxN * (brickH + BRICK_GAP) - BRICK_GAP;
  const unitMode = values.length <= MAX_FOR_UNIT_MODE && bins.length >= 2 && brickH >= 5;

  // Bars keep --bar: they are counts, not people, so they are not the peer dot in another shape.
  // The highlighted bin is a different thing — it is the subject, and the subject is marked the
  // same way in every chart in the app.

  // Closes over `total`/`cumBelow` (bin-derived, not props) — must be a nested component rather than
  // a module-level one, and passed to Recharts as an element (`content={<BarsHistTip />}`) rather than
  // a function reference, matching how Recharts expects a tooltip content component.
  function BarsHistTip({ active, payload }: { active?: boolean; payload?: { payload: TipData }[] }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return <HistTipBody d={d} total={total} below={cumBelow(d.lo)} />;
  }

  if (unitMode) {
    // The counts above each stack live in the band the median label used to share.
    const UNIT_TOP = PLOT_TOP + (guides.length ? MEDIAN_LABEL_BAND : 0);
    const containerH = UNIT_TOP + stackH + X_AXIS_H;
    const colH = (n: number) => (n > 0 ? n * (brickH + BRICK_GAP) - BRICK_GAP : 0);
    // Which brick (0-based, from the bottom) represents the marked value within its own bin — computed
    // from the actual values sharing that bin, so the highlighted brick sits at roughly the right rank.
    let markerRank = -1;
    if (markerBin != null && markerValue != null) {
      const b = bins[markerBin];
      const isLast = markerBin === bins.length - 1;
      const colVals = sorted.filter((v) => v >= b.lo && (isLast ? v <= b.hi : v < b.hi));
      markerRank = Math.min(colVals.filter((v) => v < markerValue).length, Math.max(0, b.n - 1));
    }
    const hoveredBin = activeIdx != null ? bins[activeIdx] : null;
    const p25v = guides.length === 3 ? guides[0].value : null;
    const p75v = guides.length === 3 ? guides[2].value : null;

    // Every column's count, the subject's too (P38): it went without one, the pin standing in its place. Inside the
    // top of a column tall enough to hold it, unless the top brick is the subject's own; above it otherwise.
    const countIn = (i: number) => colH(bins[i].n) >= COUNT_IN && !(i === markerBin && markerRank === bins[i].n - 1);
    /** How high a column reaches, its count included where that sits above it. */
    const reach = (i: number) => colH(bins[i].n) + (bins[i].n > 0 && !countIn(i) ? COUNT_H + 3 : 0);
    // The subject's pin clears every column its label spans, and their counts (P38): it stood over its own column
    // alone, so a taller neighbour's bricks or count ran into "this person". A stem joins it to its column.
    const pinW = measureText(markerLabel, CHART_FONT) + 4;
    const pinX = markerBin != null ? ((at(bins[markerBin].lo) + at(bins[markerBin].hi)) / 2) * plotW : 0;
    const pinOwn = markerBin != null ? reach(markerBin) : 0;
    const pinBase = markerBin == null || plotW <= 0
      ? pinOwn
      : pinClearance(bins.map((b, i) => ({ left: at(b.lo) * plotW, right: at(b.hi) * plotW, reach: reach(i) })), pinOwn, pinX, pinW);
    // The pin's label, as a box from the plot's top left: it sits 8px over `pinBase`, 13px tall with its padding.
    const pinBox: Box | null = markerBin != null && markerRank >= 0 && plotW > 0
      ? { left: pinX - pinW / 2, right: pinX + pinW / 2, top: containerH - X_AXIS_H - pinBase - 8 - 13, bottom: containerH - X_AXIS_H - pinBase - 8 }
      : null;
    // "median" over its line, unless the pin's label is there: then beside the line, away from the pin, or a row up.
    const medianPlace = med == null
      ? 'over'
      : placeMedian({ x: at(med) * plotW, width: measureText('median', CHART_FONT), top: UNIT_TOP - MEDIAN_LABEL_BAND - 14 - 2, height: COUNT_H }, pinBox, plotW);

    return (
      <>
        {/* `hist-plot` marks the plot area on both render paths. Its geometry comes from a measured
            container, so it lands a pixel or two differently between runs; the visual suite masks it
            (see e2e/visual.spec.ts) rather than widening every page's diff budget to absorb it. */}
        <div ref={plotRef} className="hist-plot" style={{ position: 'relative', height: containerH }}>
          {/* The middle 50% (p25→p75), drawn as on every chart (BAND_IQR); its two edges are the p25 and
              p75 guides below. */}
          {p25v != null && p75v != null && (
            <div
              aria-hidden
              className="band-iqr"
              style={{
                position: 'absolute',
                left: `${at(p25v) * 100}%`,
                width: `${(at(p75v) - at(p25v)) * 100}%`,
                top: UNIT_TOP,
                bottom: X_AXIS_H,
                background: BAND_IQR.fill,
                pointerEvents: 'none',
              }}
            />
          )}

          {guides.map((g, i) => (
            <div
              key={`g-${i}`}
              aria-hidden
              style={{
                position: 'absolute',
                left: `${at(g.value) * 100}%`,
                top: UNIT_TOP - (g.isMedian ? MEDIAN_LABEL_BAND + 14 : 0),
                bottom: X_AXIS_H,
                width: 0,
                // p25 and p75 are the band's edges, so they carry its edge colour (>=3:1); the median
                // stays the quiet guide it is on every other chart.
                borderLeft: `${g.isMedian ? 1.5 : BAND_IQR.edgeWidth}px dashed ${g.isMedian ? GUIDE_SOFT.stroke : BAND_IQR.edge}`,
                opacity: g.isMedian ? 0.7 : 1,
              }}
            />
          ))}
          {/* The median's word, beside its line rather than inside it: the line is drawn at 0.7, and the word with it
              read at 3.5:1, which went unmeasured while it sat on the line. */}
          {med != null && guides.some((g) => g.isMedian) && (
            <Text
              size="xs"
              c="dimmed"
              aria-hidden
              className="hist-median-label"
              data-place={medianPlace}
              style={{
                position: 'absolute',
                left: `calc(${at(med) * 100}% + ${medianPlace === 'left' ? -4 : medianPlace === 'right' ? 4 : 0}px)`,
                top: UNIT_TOP - MEDIAN_LABEL_BAND - 14 - (medianPlace === 'up' ? 16 : 2),
                transform: medianPlace === 'left' ? 'translateX(-100%)' : medianPlace === 'right' ? 'none' : 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontSize: CHART_FONT,
                lineHeight: 1,
              }}
            >
              median
            </Text>
          )}

          {/* Baseline the bars sit on (columns floating in space read as unfinished). */}
          <div
            aria-hidden
            style={{ position: 'absolute', left: 0, right: 0, bottom: X_AXIS_H, height: 1, background: 'var(--mantine-color-default-border)' }}
          />

          {bins.map((b, i) => {
            const left = at(b.lo) * 100;
            const width = (at(b.hi) - at(b.lo)) * 100;
            const isMarkerCol = i === markerBin;
            const dimmed = activeIdx != null && activeIdx !== i;
            const pick = onBinClick && b.n > 0;
            return (
              <div
                key={i}
                onMouseEnter={b.n > 0 ? () => setActiveIdx(i) : undefined}
                onMouseLeave={b.n > 0 ? () => setActiveIdx(null) : undefined}
                onClick={pick ? () => onBinClick({ lo: b.lo, hi: b.hi }) : undefined}
                {...(pick ? binControl(b, i) : {})}
                className={pick ? 'hist-col hist-pick' : 'hist-col'}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  width: `${width}%`,
                  top: UNIT_TOP,
                  bottom: X_AXIS_H,
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  alignItems: 'center',
                  gap: BRICK_GAP,
                  cursor: onBinClick && b.n > 0 ? 'pointer' : undefined,
                }}
              >
                {/* Bricks fill ~68% of the bin's width — the stack keeps a normal bar silhouette. */}
                {Array.from({ length: b.n }).map((_, brick) => {
                  const isMarkerBrick = isMarkerCol && brick === markerRank;
                  return (
                    <div
                      key={brick}
                      className="hist-brick"
                      style={{
                        width: '68%',
                        height: brickH,
                        borderRadius: 2,
                        flexShrink: 0,
                        background: isMarkerBrick ? MARK_SELF : 'var(--bar)',
                        boxShadow: isMarkerBrick ? 'inset 0 0 0 1.5px var(--mantine-color-body), 0 1px 3px rgba(0,0,0,0.3)' : undefined,
                        opacity: mounted ? (dimmed && !isMarkerBrick ? 0.4 : 1) : 0,
                        transform: mounted ? 'scaleY(1)' : 'scaleY(0.3)',
                        transformOrigin: 'bottom',
                        transition: `opacity var(--dur-base) var(--ease) ${Math.min(brick, 20) * 6}ms, transform var(--dur-base) var(--ease) ${Math.min(brick, 20) * 6}ms`,
                      }}
                    />
                  );
                })}
                {/* The column's count (P38): inside its top on the bricks' own colour, so a gap between bricks never
                    cuts a digit; above a short column on the card's, so a guide behind it breaks around the number. */}
                {b.n > 0 && (
                  <Text
                    component="span"
                    className="hist-count"
                    data-place={countIn(i) ? 'in' : 'above'}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: countIn(i) ? colH(b.n) - COUNT_H : colH(b.n) + 3,
                      transform: 'translateX(-50%)',
                      padding: '0 2px',
                      borderRadius: 2,
                      fontSize: CHART_FONT,
                      lineHeight: 1,
                      color: countIn(i) ? 'var(--bar-ink)' : 'var(--mantine-color-dimmed)',
                      background: countIn(i) ? 'var(--bar)' : 'var(--mantine-color-body)',
                      opacity: mounted ? (dimmed ? 0.4 : 1) : 0,
                      transition: 'opacity var(--dur-base) var(--ease)',
                      pointerEvents: 'none',
                    }}
                  >
                    {b.n}
                  </Text>
                )}
              </div>
            );
          })}

          {/* Bin-edge $ labels along the bottom — counting bricks IS the y-axis, so there's no y-axis to draw. */}
          {shownEdges.map((e, i) => (
            <Text
              key={i}
              size="xs"
              c="dimmed"
              // The ends inside the plot: centred on its edge, the first label was cut to "00k".
              style={{ position: 'absolute', left: `${at(e) * 100}%`, bottom: 0, transform: `translateX(${i === 0 ? '0%' : i === shownEdges.length - 1 ? '-100%' : '-50%'})`, whiteSpace: 'nowrap', fontSize: CHART_FONT }}
            >
              {fmtK(e)}
            </Text>
          ))}

          {/* Marker pin + label over the subject's column, clear of every column its label spans (`pinBase`); the
              highlighted brick inside the stack carries the emphasis. Where it stands over a taller neighbour, a stem
              runs down to its own column. */}
          {markerBin != null && markerRank >= 0 && pinBase > pinOwn && (
            <div
              aria-hidden
              className="hist-pin-stem"
              style={{
                position: 'absolute',
                left: `${(at(bins[markerBin].lo) + at(bins[markerBin].hi)) * 50}%`,
                bottom: X_AXIS_H + pinOwn + 2,
                height: pinBase - pinOwn + 1,
                width: 1.5,
                marginLeft: -0.75,
                background: MARK_SELF,
                pointerEvents: 'none',
              }}
            />
          )}
          {markerBin != null && markerRank >= 0 && (
            <div
              aria-hidden
              className="hist-pin"
              style={{
                position: 'absolute',
                left: `${(at(bins[markerBin].lo) + at(bins[markerBin].hi)) * 50}%`,
                bottom: X_AXIS_H + pinBase + 8,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  bottom: -7,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderTop: `7px solid ${MARK_SELF}`,
                }}
              />
              <Text component="span" className="accent7-text hist-pin-label" style={{ whiteSpace: 'nowrap', fontSize: CHART_FONT, lineHeight: 1, color: MARK_SELF_TEXT, display: 'block', textAlign: 'center', paddingBottom: 2 }}>
                {markerLabel}
              </Text>
            </div>
          )}

          {/* Hover readout for the column under the cursor (clears the count label above the stack). */}
          {hoveredBin && (
            <div
              style={{
                position: 'absolute',
                left: `${(at(hoveredBin.lo) + at(hoveredBin.hi)) * 50}%`,
                bottom: X_AXIS_H + Math.max(colH(hoveredBin.n), brickH) + 24,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: Z.local,
              }}
            >
              <HistTipBody d={hoveredBin} total={total} below={cumBelow(hoveredBin.lo)} />
            </div>
          )}
        </div>
        {band && <BandStrip band={band} at={at} lo={lo} hi={hi} inset={{ left: 0, right: 0 }} marker={markerValue ?? null} plotW={plotW} />}
        <ChartData caption={`${measure} distribution`} columns={[`${measure} range`, 'People']} rows={bins.map((b) => [b.range, b.n])} n={total} unit="people"
          about={guides.length === 3 ? '1 block = 1 person · Dashed guides: p25 · median · p75.' : '1 block = 1 person.'} />
      </>
    );
  }

  return (
    <>
      <div ref={plotRef} className="hist-plot" style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart {...chartKeys(`${measure} distribution`)} data={data} margin={{ left: 12, right: 12, top: PLOT_TOP }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="x" domain={[lo, hi]} ticks={shownEdges} tick={<EdgeTick />} />
            <YAxis width={48} tick={AXIS_TICK} allowDecimals={false} tickFormatter={fmtCount} />
            <Tooltip content={<BarsHistTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Bar
              {...chartAnim(!entrance)}
              dataKey="n"
              radius={BAR_RADIUS}
              onClick={onBinClick ? (d: { lo: number; hi: number }) => onBinClick({ lo: d.lo, hi: d.hi }) : undefined}
              onMouseEnter={(_, i) => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              cursor={onBinClick ? 'pointer' : undefined}
              shape={onBinClick ? (raw: unknown) => {
                const props = raw as BarShape;
                return props.payload.n > 0
                  ? <g {...binControl(props.payload, props.index, false)}><Rectangle {...props} /></g>
                  : <Rectangle {...props} />;
              } : undefined}
            >
              {data.map((_, i) => {
                const dimmed = activeIdx != null && activeIdx !== i;
                return (
                  <Cell
                    key={i}
                    fill={i === markerBin ? MARK_SELF : 'var(--bar)'}
                    fillOpacity={dimmed ? 0.45 : 1}
                  />
                );
              })}
            </Bar>
            {/* After the bars, so it paints over them (Recharts draws in child order), and only the median: drawn
                first, the p25 and median guides went under the tallest bar, and the one dashed line left in sight,
                p75's, sat beside the label "median". */}
            {med != null && (
              <ReferenceLine
                x={med}
                stroke={GUIDE_SOFT.stroke}
                strokeDasharray={GUIDE_SOFT.dasharray}
                strokeWidth={1.5}
                className="hist-median"
                label={{ value: 'median', position: 'top', fontSize: CHART_FONT, fill: 'var(--mantine-color-dimmed)' }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        {markerFraction != null && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: PLOT_TOP,
              bottom: X_AXIS_H,
              left: `calc(${PLOT_LEFT}px + ${markerFraction} * (100% - ${PLOT_LEFT + PLOT_RIGHT}px))`,
              width: 2,
              marginLeft: -1,
              background: MARK_SELF,
              // White casing so the line stays legible over a colored (highlighted) bar.
              boxShadow: '0 0 0 1.5px var(--mantine-color-body)',
              pointerEvents: 'none',
            }}
          >
            {/* Always-visible pin: a downward caret sitting above the tallest bar, tip on the line. */}
            <span
              style={{
                position: 'absolute',
                top: -8,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: `8px solid ${MARK_SELF}`,
              }}
            />
            <Text
              component="span"
              className="accent7-text"
              style={{
                position: 'absolute',
                top: -24,
                left: '50%',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontSize: CHART_FONT,
                lineHeight: 1,
                color: MARK_SELF_TEXT,
              }}
            >
              {markerLabel}
            </Text>
          </div>
        )}
      </div>
      {band && <BandStrip band={band} at={at} lo={lo} hi={hi} inset={{ left: PLOT_LEFT, right: PLOT_RIGHT }} marker={markerValue ?? null} plotW={plotW} />}
      <ChartData caption={`${measure} distribution`} columns={[`${measure} range`, 'People']} rows={bins.map((b) => [b.range, b.n])} n={total} unit="people"
        about={guides.length === 3 ? 'Dashed guides: p25 · median · p75.' : undefined} />
    </>
  );
}
