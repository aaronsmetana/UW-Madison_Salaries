import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { AXIS_TICK, GRID, fmtK, BAR_RADIUS } from '../lib/chartStyle';
import { Text } from '@mantine/core';
import { barGradientDefs } from './chartDefs';
import { TipSurface } from './chart/ChartTooltip';
import { binSalaries, MIN_FOR_HISTOGRAM } from '../lib/histogram';
import { num, pct } from '../lib/format';
import { useMounted } from '../lib/motion';
import { ChartData } from './ChartData';

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
}: {
  values: number[];
  markerValue?: number | null;
  markerLabel?: string;
  minToShow?: number;
  tooFewText?: string;
  height?: number;
  domain?: [number, number];
  /** Optional: clicking a bar reports that bin's [lo, hi) salary range (e.g. to filter a people list). */
  onBinClick?: (range: { lo: number; hi: number }) => void;
}) {
  const uid = useId();
  const mounted = useMounted();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
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

  const bins = binSalaries(values, 10, domain);
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
    if (plotW <= 0) return edges;
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

  const gradientColors = { bar: 'var(--bar)', active: 'var(--bar-active)' };

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

    return (
      <>
        {/* `hist-plot` marks the plot area on both render paths. Its geometry comes from a measured
            container, so it lands a pixel or two differently between runs; the visual suite masks it
            (see e2e/visual.spec.ts) rather than widening every page's diff budget to absorb it. */}
        <div ref={plotRef} className="hist-plot" style={{ position: 'relative', height: containerH }}>
          {/* Faint IQR backdrop (p25→p75) — gives the empty plot background structure and ties this
              chart to the range strip above it. */}
          {p25v != null && p75v != null && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: `${at(p25v) * 100}%`,
                width: `${(at(p75v) - at(p25v)) * 100}%`,
                top: UNIT_TOP,
                bottom: X_AXIS_H,
                background: 'var(--mantine-color-accent-6)',
                opacity: 0.05,
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
                borderLeft: `1px dashed var(--mantine-color-gray-5)`,
                borderLeftWidth: g.isMedian ? 1.5 : 1,
                opacity: 0.7,
              }}
            >
              {g.isMedian && (
                <Text size="xs" c="dimmed" style={{ position: 'absolute', top: -2, left: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10 }}>
                  median
                </Text>
              )}
            </div>
          ))}

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
            return (
              <div
                key={i}
                onMouseEnter={b.n > 0 ? () => setActiveIdx(i) : undefined}
                onMouseLeave={b.n > 0 ? () => setActiveIdx(null) : undefined}
                onClick={onBinClick && b.n > 0 ? () => onBinClick({ lo: b.lo, hi: b.hi }) : undefined}
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
                      style={{
                        width: '68%',
                        height: brickH,
                        borderRadius: 2,
                        flexShrink: 0,
                        background: isMarkerBrick ? 'var(--bar-active)' : 'var(--bar)',
                        boxShadow: isMarkerBrick ? 'inset 0 0 0 1.5px var(--mantine-color-body), 0 1px 3px rgba(0,0,0,0.3)' : undefined,
                        opacity: mounted ? (dimmed && !isMarkerBrick ? 0.4 : 1) : 0,
                        transform: mounted ? 'scaleY(1)' : 'scaleY(0.3)',
                        transformOrigin: 'bottom',
                        transition: `opacity 220ms ease ${Math.min(brick, 20) * 6}ms, transform 220ms ease ${Math.min(brick, 20) * 6}ms`,
                      }}
                    />
                  );
                })}
                {/* Count above each bar — quiet, useful, and it fills the air over the stacks. The
                    subject's bar shows the pin instead (rendered separately, below). */}
                {b.n > 0 && !isMarkerCol && (
                  <Text
                    component="span"
                    c="dimmed"
                    style={{ fontSize: 10, lineHeight: 1, marginBottom: 3, opacity: mounted ? (dimmed ? 0.4 : 0.9) : 0, transition: 'opacity 220ms ease' }}
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
              style={{ position: 'absolute', left: `${at(e) * 100}%`, bottom: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 11 }}
            >
              {fmtK(e)}
            </Text>
          ))}

          {/* Marker pin + label above the TOP of the subject's column (mid-stack anchoring overlapped
              the bricks above it); the highlighted brick inside the stack carries the emphasis. */}
          {markerBin != null && markerRank >= 0 && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: `${(at(bins[markerBin].lo) + at(bins[markerBin].hi)) * 50}%`,
                bottom: X_AXIS_H + colH(bins[markerBin].n) + 8,
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
                  borderTop: '7px solid var(--bar-active)',
                }}
              />
              <Text component="span" style={{ whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1, color: 'var(--bar-active)', display: 'block', textAlign: 'center', paddingBottom: 2 }}>
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
                zIndex: 2,
              }}
            >
              <HistTipBody d={hoveredBin} total={total} below={cumBelow(hoveredBin.lo)} />
            </div>
          )}
        </div>
        {guides.length === 3 && <Text size="xs" c="dimmed" mt={4}>1 block = 1 person · Dashed guides: p25 · median · p75.</Text>}
        <ChartData caption="Salary distribution" columns={['Salary range', 'People']} rows={bins.map((b) => [b.range, b.n])} n={total} unit="people" />
      </>
    );
  }

  return (
    <>
      <div ref={plotRef} className="hist-plot" style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ left: 12, right: 12, top: PLOT_TOP }}>
            <defs>{barGradientDefs(uid, gradientColors)}</defs>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="x" domain={[lo, hi]} ticks={shownEdges} tickFormatter={fmtK} tick={AXIS_TICK} />
            <YAxis width={48} tick={AXIS_TICK} allowDecimals={false} />
            <Tooltip content={<BarsHistTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            {guides.map((g, i) => (
              <ReferenceLine
                key={`q-${i}`}
                x={g.value}
                stroke="var(--mantine-color-gray-5)"
                strokeDasharray="3 3"
                strokeWidth={g.isMedian ? 1.5 : 1}
                label={g.isMedian ? { value: 'median', position: 'top', fontSize: 10, fill: 'var(--mantine-color-dimmed)' } : undefined}
              />
            ))}
            <Bar
              dataKey="n"
              radius={BAR_RADIUS}
              onClick={onBinClick ? (d: { lo: number; hi: number }) => onBinClick({ lo: d.lo, hi: d.hi }) : undefined}
              onMouseEnter={(_, i) => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              cursor={onBinClick ? 'pointer' : undefined}
            >
              {data.map((_, i) => {
                const dimmed = activeIdx != null && activeIdx !== i;
                return (
                  <Cell
                    key={i}
                    fill={i === markerBin ? `url(#${uid}-bar-active)` : `url(#${uid}-bar-bar)`}
                    fillOpacity={dimmed ? 0.45 : 1}
                  />
                );
              })}
            </Bar>
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
              background: 'var(--bar-active)',
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
                borderTop: '8px solid var(--bar-active)',
              }}
            />
            <Text
              component="span"
              style={{
                position: 'absolute',
                top: -24,
                left: '50%',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontSize: 11,
                lineHeight: 1,
                color: 'var(--bar-active)',
              }}
            >
              {markerLabel}
            </Text>
          </div>
        )}
      </div>
      {guides.length === 3 && <Text size="xs" c="dimmed" mt={4}>Dashed guides: p25 · median · p75.</Text>}
      <ChartData caption="Salary distribution" columns={['Salary range', 'People']} rows={bins.map((b) => [b.range, b.n])} n={total} unit="people" />
    </>
  );
}
