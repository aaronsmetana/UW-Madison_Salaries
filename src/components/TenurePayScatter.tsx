import { useId, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, Customized,
} from 'recharts';
import { AXIS_TICK, CHART_FONT, GRID, fmtK } from '../lib/chartStyle';
import { moneyTicks, niceStep } from '../lib/rangeScale';
import { Box, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { num, usd } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { tenureFit, onCurveBand, TENURE_MIN_PEERS } from '../lib/stats';
import { measureText, placeEndLabels } from '../lib/labelLayout';
import { nudgeApart, NUDGE_MAX } from '../lib/nudge';
import { sideOf, type PayWindow } from '../lib/payWindow';
import { TipSurface } from './chart/ChartTooltip';
import { CrosshairLayer } from './chart/CrosshairLayer';
import { HALO } from './chart/EndLabels';
import { ChartData } from './ChartData';
import {
  MARK_SELF, MARK_SELF_TEXT, MARK_PEER, MARK_PEER_SAME_SCHOOL, DOT_R, DOT_RIM, FIT_BAND, GUIDE_STRONG, LARGE_GROUP, peerDot,
  MarkerLegend, type PeerPoint,
} from './markers';

/** A peer plus the tenure this chart needs. Everything about *marking* them lives in PeerPoint, so the
 *  peer strip on the same page draws the same person the same way. */
export interface ScatterPoint extends PeerPoint {
  tenure: number;
}

/** The chart's height, px: 300 for a group; for a crowd (over LARGE_GROUP) taller, and taller again on a
 *  phone, whose plot is a quarter as wide — the room a dot is nudged into is the plot's area. */
const CHART_H = { group: 300, crowd: 420, crowdPhone: 480 } as const;
/** In a crowd, smaller dots — a peer and a same-school peer — so a hundred people near one pay can each
 *  be seen; nudged apart by up to NUDGE_MAX px (lib/nudge). */
const CROWD_R = { peer: 2, sameSchool: 2.5 } as const;
/** How close the pointer must come to a dot to name it, px. */
const HOVER_SNAP_PX = 14;
/** With a pay window: the band along the top (and bottom) where the people paid over (under) it sit at
 *  their tenure, px tall, and the gap between it and the plot's own range. */
const BAND_H = 16;
const BAND_GAP = 6;
/** The ring round the subject's dot, and the two names written on the plot: the subject's, as the strip
 *  above writes it, and the tenure line's. */
const RING_R = 9;
const SELF_FONT = CHART_FONT;
const FIT_FONT = CHART_FONT;
const FIT_TEXT = 'tenure-expected pay';

interface AxisMapEntry { scale: ((v: number) => number) & { domain?: () => number[]; range?: () => number[] } }
interface PlotOffset { top: number; left: number; width: number; height: number }

/** One dot as drawn: who, where it is drawn, how big, and which side of the pay window it is (0 inside). */
interface Placed { p: ScatterPoint; x: number; y: number; r: number; side: -1 | 0 | 1 }
interface PlacedMeta { crowded: number; maxShift: number; top: number; bottom: number; right: number }
interface Fit { intercept: number; slope: number }
type Pt = { x: number; y: number };

/** The part of segment a–b between the rows `top` and `bottom`, or null if none of it is: the tenure
 *  line as a zoomed window draws it. */
function clipToRows(a: Pt, b: Pt, top: number, bottom: number): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  if (b.y === a.y) {
    if (a.y < top || a.y > bottom) return null;
  } else {
    const ta = (top - a.y) / (b.y - a.y), tb = (bottom - a.y) / (b.y - a.y);
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (!(t0 < t1)) return null;
  }
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [at(t0), at(t1)];
}

/**
 * "On the tenure curve", drawn: the pays within 2% of what tenure predicts (`onCurveBand`, the rule the
 * callout's verdict is), as a faint wash along the line. The callout said "on the curve" of a dot that
 * sat visibly off the dashed line; a band shows how near counts as on it, and the subject's dot sits in
 * it exactly when the callout says so. Painted before the line and the dots; zoomed, it keeps to the
 * window's own rows, clear of the strips of people paid over and under it.
 */
function FitBandLayer({
  xAxisMap, yAxisMap, offset, fit, xMax, zoom,
}: {
  xAxisMap?: Record<string, AxisMapEntry>;
  yAxisMap?: Record<string, AxisMapEntry>;
  offset?: PlotOffset;
  fit: Fit;
  xMax: number;
  zoom: PayWindow | null;
}) {
  const clipId = useId();
  const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined;
  const yScale = yAxisMap ? Object.values(yAxisMap)[0]?.scale : undefined;
  if (!xScale || !yScale || !offset) return null;
  const [lo0, hi0] = onCurveBand(fit.intercept);
  const [lo1, hi1] = onCurveBand(fit.intercept + fit.slope * xMax);
  const top = zoom ? yScale(zoom.hi) : offset.top;
  const bottom = zoom ? yScale(zoom.lo) : offset.top + offset.height;
  const pts = ([[0, hi0], [xMax, hi1], [xMax, lo1], [0, lo0]] as const).map(([x, y]) => `${xScale(x).toFixed(1)},${yScale(y).toFixed(1)}`).join(' ');
  return (
    <g className="tenure-fit-band" aria-hidden>
      <clipPath id={clipId}>
        <rect x={offset.left} y={top} width={offset.width} height={Math.max(0, bottom - top)} />
      </clipPath>
      <polygon points={pts} fill={FIT_BAND.fill} clipPath={`url(#${clipId})`} />
    </g>
  );
}

/**
 * The dots, drawn from the chart's own scales (Recharts hands every `Customized` child its axis maps and
 * plot box, as CrosshairLayer uses): placed where their values put them — or, outside the pay window, in
 * the band along the top or bottom at their tenure — then nudged apart (lib/nudge). Reports the placing
 * up to the chart, which names the dot under the pointer from it.
 */
function DotsLayer({
  xAxisMap, yAxisMap, offset, points, zoom, crowd, hover, onPlaced, fit, xMax, selfText,
}: {
  xAxisMap?: Record<string, AxisMapEntry>;
  yAxisMap?: Record<string, AxisMapEntry>;
  offset?: PlotOffset;
  points: ScatterPoint[];
  zoom: PayWindow | null;
  crowd: boolean;
  hover: ScatterPoint | null;
  onPlaced: (placed: Placed[], meta: PlacedMeta) => void;
  fit: Fit | null;
  xMax: number;
  /** What to write beside the subject's dot: "Aaron · $116,491". */
  selfText: string | null;
}) {
  const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined;
  const yScale = yAxisMap ? Object.values(yAxisMap)[0]?.scale : undefined;
  // Recharts hands over new scale and box objects on every render (a hover is one), so the placing is
  // kept by what they map, not by identity: nudging a thousand dots on every pointer move is not free.
  const geometry = xScale && yScale && offset
    ? [...(xScale.domain?.() ?? []), ...(xScale.range?.() ?? []), ...(yScale.domain?.() ?? []), ...(yScale.range?.() ?? []), offset.top, offset.left, offset.width, offset.height].join()
    : '';
  const layout = useMemo(() => {
    if (!xScale || !yScale || !offset) return null;
    const top = offset.top, bottom = offset.top + offset.height;
    const bandY = (side: -1 | 1) => (side > 0 ? top + BAND_H / 2 : bottom - BAND_H / 2);
    // Same-school peers placed before the others, so where there is not room for both they keep theirs;
    // the subject holds its place whatever is under it.
    const order = [...points].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(b.sameSchool) - Number(a.sameSchool));
    const placed: Placed[] = order.map((p) => {
      const side = sideOf(zoom, p.pay);
      const r = p.isSelf ? DOT_R.self : crowd ? (p.sameSchool ? CROWD_R.sameSchool : CROWD_R.peer) : peerDot(p.sameSchool, points.length).r;
      return { p, x: xScale(p.tenure), y: side ? bandY(side) : yScale(p.pay), r, side };
    });
    const r = crowd ? CROWD_R.peer : DOT_R.peer;
    const inPlot = placed.filter((d) => !d.side);
    const nudge = (list: Placed[], bounds?: { x0: number; y0: number; x1: number; y1: number }) => {
      const out = nudgeApart(list.map((d) => ({ x: d.x, y: d.y, r: d.r, fixed: d.p.isSelf })), r, NUDGE_MAX, 0.8, bounds);
      list.forEach((d, i) => { d.x = out.xs[i]; d.y = out.ys[i]; });
      return out;
    };
    const x0 = offset.left, x1 = offset.left + offset.width;
    // Inside the plot: a dot nudged left of the pay axis read as a mark on the axis.
    const main = nudge(inPlot, { x0: x0 + r, x1: x1 - r, y0: top, y1: bottom });
    for (const side of [1, -1] as const) {
      const band = placed.filter((d) => d.side === side);
      if (band.length) nudge(band, { x0, x1, y0: bandY(side) - BAND_H / 2 + r, y1: bandY(side) + BAND_H / 2 - r });
    }
    return { placed, crowded: main.crowded, maxShift: main.maxShift, top, bottom, right: x1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `geometry` stands for the scales and the box
  }, [geometry, points, zoom, crowd]);

  /**
   * The two names written on the plot, placed as a line chart's end labels are (`placeEndLabels`): the
   * tenure line's at its right end, then the subject's beside their dot — neither across the line, and
   * the subject's never with the line between it and the dot. They replace two legend entries, and the
   * subject's replaces an endlessly pulsing ring as the way to find them.
   */
  const labels = useMemo(() => {
    if (!layout || !xScale || !yScale || !offset) return [];
    const full = { left: offset.left, right: offset.left + offset.width, top: offset.top, bottom: offset.top + offset.height };
    // Zoomed, the window's own rows: the strips along the top and bottom hold other people.
    const win = zoom ? { ...full, top: yScale(zoom.hi), bottom: yScale(zoom.lo) } : full;
    const seg = fit
      ? clipToRows({ x: xScale(0), y: yScale(fit.intercept) }, { x: xScale(xMax), y: yScale(fit.intercept + fit.slope * xMax) }, win.top, win.bottom)
      : null;
    const lines = seg ? [seg] : [];
    const out: { id: 'fit' | 'self'; x: number; y: number; anchor: 'start' | 'end'; box: { left: number; right: number; top: number; bottom: number } }[] = [];
    if (seg) {
      // Weight 500 draws a little wider than the canvas measures at 400.
      out.push(...placeEndLabels([{ id: 'fit', x: seg[1].x, y: seg[1].y, width: measureText(FIT_TEXT, FIT_FONT) * 1.03, line: seg }], lines, win, win.top)
        .map((l) => ({ ...l, id: 'fit' as const })));
    }
    const self = layout.placed.find((d) => d.p.isSelf);
    if (self && selfText) {
      // Clear of the ring above and below; a subject in a strip past the window may use the whole plot.
      const bounds = self.side ? full : win;
      out.push(...placeEndLabels(
        [{ id: 'self', x: self.x, y: self.y, width: measureText(selfText, SELF_FONT) * 1.08 }],
        lines, bounds, bounds.top,
        { avoid: out.map((l) => l.box), ascent: 11, descent: 3, above: RING_R + 5, below: RING_R + 16 },
      ).map((l) => ({ ...l, id: 'self' as const })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `geometry` stands for the scales and the box
  }, [layout, geometry, fit, xMax, zoom, selfText]);

  if (!layout || !offset || !yScale) return null;
  onPlaced(layout.placed, layout);
  const { placed } = layout;
  const hovered = hover ? placed.find((d) => d.p === hover) : undefined;
  const above = placed.filter((d) => d.side > 0).length;
  const below = placed.filter((d) => d.side < 0).length;

  return (
    <g className="tenure-dots" data-crowded={layout.crowded} data-max-shift={layout.maxShift.toFixed(1)}>
      {zoom && (above > 0 || below > 0) && (
        <g className="tenure-bands" aria-hidden>
          {([[1, above], [-1, below]] as const).filter(([, n]) => n > 0).map(([side, n]) => {
            const edge = side > 0 ? yScale(zoom.hi) : yScale(zoom.lo);
            // A break between the band and the pay axis: the band's pays are not on its scale.
            const breakY = side > 0 ? (layout.top + BAND_H + edge) / 2 : (layout.bottom - BAND_H + edge) / 2;
            const labelY = side > 0 ? layout.top + BAND_H / 2 : layout.bottom - BAND_H / 2;
            return (
              <g key={side} className="tenure-band" data-side={side} data-n={n}>
                <line x1={offset.left} x2={offset.left + offset.width} y1={breakY} y2={breakY} stroke="var(--mantine-color-gray-5)" strokeWidth={1} strokeDasharray="1 4" />
                <text x={offset.left + offset.width - 2} y={labelY} dy="0.35em" textAnchor="end" fontSize={CHART_FONT} fill="var(--mantine-color-dimmed)" className="tenure-band-label">
                  {num(n)} {side > 0 ? 'over' : 'under'} {fmtK(side > 0 ? zoom.hi : zoom.lo)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {placed.filter((d) => !d.p.isSelf).reverse().map((d) => {
        const dot = peerDot(d.p.sameSchool, points.length);
        return (
          <circle
            key={d.p.personKey || `${d.x},${d.y}`}
            className="chart-dot"
            data-mark={d.p.sameSchool ? 'same-school' : 'peer'}
            data-side={d.side || undefined}
            cx={d.x}
            cy={d.y}
            r={d === hovered ? d.r + 2 : d.r}
            fill={d.p.sameSchool ? MARK_PEER_SAME_SCHOOL : MARK_PEER}
            fillOpacity={dot.fillOpacity}
            // A crowd's 2px dots would be mostly rim.
            {...(crowd ? {} : DOT_RIM)}
          />
        );
      })}
      {placed.filter((d) => d.p.isSelf).map((d) => (
        // The subject: a still ring round the accent dot, and their name beside it. The ring used to
        // pulse without end, motion no one asked for that pulled the eye back to the corner of a chart
        // the reader had already found the person in.
        <g key="self" className="tenure-self">
          <circle cx={d.x} cy={d.y} r={RING_R} fill="none" stroke={MARK_SELF} strokeWidth={2} opacity={0.45} />
          <circle cx={d.x} cy={d.y} r={DOT_R.self} fill={MARK_SELF} stroke="var(--mantine-color-body)" strokeWidth={1.5} />
        </g>
      ))}
      {labels.map((l) => (
        <text
          key={l.id}
          // `accent7-text` swaps the subject's name to --text-accent on a dark card, as the strip's does;
          // the fill follows it through currentColor.
          className={l.id === 'self' ? 'tenure-self-label accent7-text' : 'tenure-fit-label'}
          x={l.x}
          y={l.y}
          textAnchor={l.anchor}
          fontSize={l.id === 'self' ? SELF_FONT : FIT_FONT}
          fontWeight={l.id === 'self' ? 700 : 500}
          fill={l.id === 'self' ? 'currentColor' : 'var(--mantine-color-dimmed)'}
          style={l.id === 'self' ? { color: MARK_SELF_TEXT } : undefined}
          pointerEvents="none"
          {...HALO}
        >
          {l.id === 'self' ? selfText : FIT_TEXT}
        </text>
      ))}
      {hovered && hovered.side !== 0 && (
        <circle cx={hovered.x} cy={hovered.y} r={hovered.r + 5} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={2} pointerEvents="none" />
      )}
    </g>
  );
}

/**
 * Pay-vs-tenure scatter for everyone with the same title (the caller filters to the active cohort).
 * The subject is the accent dot, named beside it; same-school peers are green, others gray. A dashed
 * least-squares line shows the pay tenure alone predicts, named at its end, inside a faint band of the
 * pays within 2% of it; a callout reads whether the subject sits above, below or on that curve — on it
 * exactly when their dot is inside the band.
 *
 * With the title's pay window (lib/payWindow) the pay axis spans it, as the strip above does, and the
 * people paid over or under it sit in a band along the top or bottom at their tenure. In a crowd the dots
 * are smaller and nudged apart (lib/nudge), so a hundred people on one salary read as a hundred people.
 * Pointing names the nearest person, with a crosshair to their values; a click opens them.
 */
export function TenurePayScatter({
  points,
  self,
  titleLabel,
  zoom = null,
  label = 'This person',
  legend = true,
}: {
  points: ScatterPoint[];
  self: { tenure: number; pay: number } | null;
  titleLabel: string;
  zoom?: PayWindow | null;
  /** Names the subject's mark, as the strip does: "Aaron · $116,491". */
  label?: string;
  /** The key to the dots' colours. The person page leaves it to the strip directly above, whose key is
   *  the same; the printed brief, where this chart stands alone, keeps it. */
  legend?: boolean;
}) {
  const nav = useNavigate();
  const reduceMotion = prefersReducedMotion();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const placedRef = useMemo(() => ({ current: [] as Placed[], meta: { crowded: 0, maxShift: 0, top: 0, bottom: 0, right: 0 } as PlacedMeta }), []);
  // One fit for the line, the callout and the comparison brief (tenureFit): peers only — never the
  // person it is judging — and no fit at all below TENURE_MIN_PEERS.
  const peerPts = points.filter((p) => !p.isSelf).map((p) => ({ x: p.tenure, y: p.pay }));
  const fit = self ? tenureFit(peerPts, { x: self.tenure, y: self.pay }) : null;
  const reg = fit ? { intercept: fit.intercept, slope: fit.slope } : null;
  const tMax = Math.max(10, ...points.map((p) => p.tenure), self?.tenure ?? 0);
  // To the next five years, not ten: a longest tenure of 31.5 years drew an axis to 40.
  const xMax = Math.ceil(tMax / 5) * 5;
  const xStep = xMax <= 20 ? 5 : 10;
  const xTicks: number[] = [];
  for (let t = 0; t <= xMax; t += xStep) xTicks.push(t);
  const above = zoom ? points.filter((p) => p.pay > zoom.hi).length : 0;
  const below = zoom ? points.filter((p) => p.pay < zoom.lo).length : 0;
  // The pay axis: the window's ends, on round steps inside it; or round steps across the points and the
  // fitted line's ends (lib/rangeScale).
  let yTicks: number[];
  let yDomain: [number, number] | ['auto', 'auto'];
  if (zoom) {
    const step = niceStep((zoom.hi - zoom.lo) / 5);
    yTicks = [];
    for (let v = Math.ceil(zoom.lo / step) * step; v <= zoom.hi + 1e-6; v += step) yTicks.push(v);
    yDomain = [zoom.lo, zoom.hi];
  } else {
    // The band round the line's ends, not just the line's: its wash must fit inside the axis.
    const band = reg ? [...onCurveBand(reg.intercept), ...onCurveBand(reg.intercept + reg.slope * xMax)] : [];
    const pays = [...points.map((p) => p.pay), ...(self ? [self.pay] : []), ...band].filter((v) => Number.isFinite(v));
    yTicks = pays.length ? moneyTicks(Math.max(0, Math.min(...pays)), Math.max(...pays)) : [];
    yDomain = yTicks.length ? [yTicks[0], yTicks[yTicks.length - 1]] : ['auto', 'auto'];
  }
  const crowd = points.length > LARGE_GROUP;
  const phone = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  const chartH = crowd ? (phone ? CHART_H.crowdPhone : CHART_H.crowd) : CHART_H.group;
  const others = points.filter((p) => !p.isSelf && !p.sameSchool);
  const schoolPts = points.filter((p) => !p.isSelf && p.sameSchool);

  // The dot nearest the pointer, within reach — from where the dots are drawn, not where their values
  // are: a nudged dot is named where it is seen.
  const pick = (x: number, y: number): Placed | null => {
    let best: Placed | null = null;
    let bestD = HOVER_SNAP_PX;
    for (const d of placedRef.current) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  };
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const d = pick(e.clientX - box.left, e.clientY - box.top);
    setHover(d ? d.p : null);
    setTip(d ? { x: d.x, y: d.y } : null);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const d = pick(e.clientX - box.left, e.clientY - box.top);
    if (d && !d.p.isSelf && d.p.personKey) nav(`/person/${encodeURIComponent(d.p.personKey)}`);
  };
  const hoverSide = hover ? sideOf(zoom, hover.pay) : 0;

  return (
    <div>
      {fit && self && (
        <Box mb="md" className="tenure-callout" data-verdict={fit.verdict}>
          <Text size="sm">
            <b>{fit.verdict === 'on' ? 'On the tenure curve.' : fit.verdict === 'above' ? 'Above the tenure curve.' : 'Below the tenure curve.'}</b>{' '}
            At {self.tenure.toFixed(1)} yrs, {titleLabel} typically pays <b>{usd(fit.expected)}</b>.{' '}
            {fit.verdict === 'on'
              ? <>This person is within 2% of that (<b>{usd(Math.abs(fit.gap))} {fit.gap >= 0 ? 'more' : 'less'}</b>).</>
              : <>This person earns <b>{usd(Math.abs(fit.gap))} {fit.gap >= 0 ? 'more' : 'less'}</b> than tenure alone predicts.</>}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Tenure explains about {Math.round(fit.r2 * 100)}% of pay differences for this title. Allowing for tenure,
            this person is paid more than {fit.adjustedPercentile}% of the {fit.n} others.
          </Text>
        </Box>
      )}
      {!fit && self && peerPts.length < TENURE_MIN_PEERS && (
        <Text size="xs" c="dimmed" mb="md">
          Too few others with this title have a recorded hire date to fit a tenure trend ({peerPts.length}; at least {TENURE_MIN_PEERS} are needed).
        </Text>
      )}

      {/* role="img" on the wrapper + aria-hidden on the chart itself: one accessible summary for the whole
          plot rather than hundreds of unlabeled marks. The pointer is read on the wrapper, which names
          the nearest dot. */}
      <div role="img" aria-label={`Scatter plot of pay versus tenure for ${titleLabel}, tenure in years on the x-axis and pay in dollars on the y-axis.`}>
      <div
        aria-hidden="true"
        className="tenure-plot"
        data-window={zoom ? `${zoom.lo}-${zoom.hi}` : undefined}
        style={{ position: 'relative', cursor: hover && !hover.isSelf ? 'pointer' : undefined }}
        onMouseMove={onMove}
        onMouseLeave={() => { setHover(null); setTip(null); }}
        onClick={onClick}
      >
      <ResponsiveContainer width="100%" height={chartH}>
        <ScatterChart margin={{ left: 12, right: 16, top: 10, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            type="number"
            dataKey="tenure"
            name="Tenure"
            domain={[0, xMax]}
            ticks={xTicks}
            tick={AXIS_TICK}
            tickFormatter={(v) => `${v}y`}
          />
          <YAxis
            type="number"
            dataKey="pay"
            name="Pay"
            width={56}
            tick={AXIS_TICK}
            tickFormatter={fmtK}
            ticks={yTicks.length ? yTicks : undefined}
            domain={yDomain}
            allowDataOverflow={!!zoom}
            // Room at either end for the bands of people paid over and under the window.
            padding={{ top: above ? BAND_H + BAND_GAP * 2 : 10, bottom: below ? BAND_H + BAND_GAP * 2 : 10 }}
          />
          {reg && <Customized component={FitBandLayer} fit={reg} xMax={xMax} zoom={zoom} />}
          {reg && (
            <ReferenceLine
              className="tenure-fit"
              stroke={GUIDE_STRONG.stroke}
              strokeDasharray={GUIDE_STRONG.dasharray}
              strokeWidth={GUIDE_STRONG.width}
              // Zoomed, the line is cut at the window's edges rather than stretching the axis back out.
              ifOverflow={zoom ? 'hidden' : 'extendDomain'}
              segment={[{ x: 0, y: reg.intercept }, { x: xMax, y: reg.intercept + reg.slope * xMax }]}
            />
          )}
          {/* No marks of its own: the axes' domains are set, and the dots are drawn below from the scales. */}
          <Scatter data={[]} isAnimationActive={false} />
          <Customized
            component={DotsLayer}
            points={points}
            zoom={zoom}
            crowd={crowd}
            hover={hover}
            onPlaced={(placed: Placed[], meta: PlacedMeta) => { placedRef.current = placed; placedRef.meta = meta; }}
            fit={reg}
            xMax={xMax}
            selfText={self ? `${label} · ${usd(self.pay)}` : null}
          />
          {hover && hoverSide === 0 && (
            <Customized
              component={CrosshairLayer}
              pointX={hover.tenure}
              pointY={hover.pay}
              xPillLabel={`${hover.tenure.toFixed(1)}y`}
              yPillLabel={usd(hover.pay)}
              emphasize={!hover.isSelf}
              instant={reduceMotion}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      {hover && tip && (
        <div className="tenure-tip" style={{ position: 'absolute', left: tip.x + 12, top: tip.y - 12, pointerEvents: 'none', transform: tip.x > placedRef.meta.right - 180 ? 'translate(calc(-100% - 24px), -100%)' : 'translateY(-100%)' }}>
          <TipSurface>
            <Text size="xs" fw={600}>{hover.name}{hover.isSelf ? ' (this person)' : ''}</Text>
            <Text size="xs" c="dimmed">{hover.tenure.toFixed(1)} yrs · {usd(hover.pay)}</Text>
          </TipSurface>
        </div>
      )}
      </div>
      </div>

      {/* No "This person" and no dashed swatch: the subject and the line are named on the plot. */}
      {legend && (
        <MarkerLegend
          items={[
            ...(schoolPts.length ? [{ color: MARK_PEER_SAME_SCHOOL, round: true, label: 'Same school' }] : []),
            ...(others.length ? [{ color: MARK_PEER, round: true, label: 'Others' }] : []),
          ]}
        />
      )}
      {zoom && (above || below) ? (
        <Text size="xs" c="dimmed" mt={4} ta="center" className="tenure-note">
          {`Pay axis ${fmtK(zoom.lo)}–${fmtK(zoom.hi)}, where 90% of people with this title are paid; ${[
            above ? `the ${num(above)} paid more sit along the top` : '',
            below ? `the ${num(below)} paid less along the bottom` : '',
          ].filter(Boolean).join(' and ')}, at their tenure.`}
        </Text>
      ) : null}

      {/* This was the only chart in the app with no source line, no CSV and no data table — including
          as an exhibit inside the printed report brief, where a figure with no numbers behind it is
          exactly the thing a reader is entitled to check. Tenure is rounded here because a point on a
          scatter is not a 15-decimal measurement; the CSV keeps the raw value. */}
      <ChartData
        caption={`Pay vs. tenure — ${titleLabel}`}
        columns={['Name', 'Tenure (yrs)', 'Pay']}
        rows={[...points]
          .sort((a, b) => b.pay - a.pay)
          .map((p) => [p.isSelf ? `${p.name} (this person)` : p.name, Number(p.tenure.toFixed(1)), p.pay])}
        n={points.length}
        unit="people"
        about={
          <>
            Each dot is one person with this title, at their tenure and pay.
            {reg && <> The dashed line is the pay tenure alone predicts, fitted to everyone else; the shaded band round it is within 2% of that — what the note above calls &ldquo;on the tenure curve&rdquo;.</>}
            {crowd && <> Dots are nudged up to {NUDGE_MAX}px apart, so most people on the same pay each show.</>}
          </>
        }
      />
    </div>
  );
}
