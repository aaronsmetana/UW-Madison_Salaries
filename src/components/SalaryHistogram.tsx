import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Text } from '@mantine/core';
import { binSalaries, MIN_FOR_HISTOGRAM } from '../lib/histogram';
import { num } from '../lib/format';
import { ChartData } from './ChartData';

interface TipProps {
  active?: boolean;
  payload?: { payload: { range: string; n: number } }[];
}

function HistTip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: 'var(--mantine-color-body)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        padding: '6px 10px',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{d.range}</div>
      <div style={{ fontSize: 12 }}>{num(d.n)} {d.n === 1 ? 'person' : 'people'}</div>
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
}: {
  values: number[];
  markerValue?: number | null;
  markerLabel?: string;
  minToShow?: number;
  tooFewText?: string;
  height?: number;
}) {
  const bins = binSalaries(values);
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
  // Plot bars on a real value (number) axis with ticks at the bin EDGES, so the axis reads as a true
  // salary scale: each bar is centered in its bin and the edge ticks line up with the bar edges.
  const data = bins.map((b) => ({ x: (b.lo + b.hi) / 2, label: b.label, range: b.range, n: b.n }));
  const edges = [...bins.map((b) => b.lo), hi];
  const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

  // Quartiles from the raw values → faint reference guides for market context.
  const sorted = [...values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const quantile = (p: number): number | null => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p;
    const a = Math.floor(i), c = Math.ceil(i);
    return sorted[a] + (sorted[c] - sorted[a]) * (i - a);
  };
  const guides = [quantile(0.25), quantile(0.5), quantile(0.75)].filter((x): x is number => x != null);

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
  // Recharts plot insets for this chart: left margin (12) + YAxis width (48); right margin (12);
  // top margin (matches PLOT_TOP — headroom for the marker pin + label above the bars); default
  // XAxis height (30) at the bottom.
  const PLOT_LEFT = 60;
  const PLOT_RIGHT = 12;
  const PLOT_TOP = 30;
  const X_AXIS_H = 30;

  return (
    <>
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ left: 12, right: 12, top: PLOT_TOP }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" dataKey="x" domain={[lo, hi]} ticks={edges} tickFormatter={fmtK} tick={{ fontSize: 11 }} />
            <YAxis width={48} tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<HistTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            {guides.map((gx, i) => (
              <ReferenceLine key={`q-${i}`} x={gx} stroke="var(--mantine-color-gray-5)" strokeDasharray="3 3" strokeWidth={1} />
            ))}
            <Bar dataKey="n">
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === markerBin ? 'var(--bar-active)' : 'var(--bar)'}
                />
              ))}
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
      <ChartData caption="Salary distribution" columns={['Salary range', 'People']} rows={bins.map((b) => [b.range, b.n])} />
    </>
  );
}
