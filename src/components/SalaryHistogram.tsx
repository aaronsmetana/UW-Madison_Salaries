import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
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

  const data = bins.map((b) => ({ label: b.label, range: b.range, n: b.n }));
  // Place the marker on the bins' continuous scale so it lands at the exact salary — e.g. a value
  // 84% of the way through the $110k–$115k bin sits 84% across that bar, not snapped to its center.
  // Rendered as a CSS overlay (not a Recharts ReferenceLine on a second numeric axis, which silently
  // anchors a data-less number axis at 0 and misplaces the marker). The bins are uniform width, so a
  // value maps linearly across the plot rect: bin edges align to the bar bands.
  const lo = bins[0].lo;
  const hi = bins[bins.length - 1].hi;
  const markerFraction = markerValue != null && Number.isFinite(markerValue) && hi > lo
    ? (Math.max(lo, Math.min(hi, markerValue)) - lo) / (hi - lo)
    : null;
  // Index of the bin the marked value falls in (last bin is inclusive, matching binSalaries), so we
  // can recolor that one bar. null when there's no marker → every bar keeps the default fill.
  let markerBin: number | null = null;
  if (markerValue != null && Number.isFinite(markerValue) && hi > lo) {
    const v = Math.max(lo, Math.min(hi, markerValue));
    const idx = bins.findIndex((b) => v < b.hi);
    markerBin = idx === -1 ? bins.length - 1 : idx;
  }
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
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} padding={{ left: 0, right: 0 }} />
            <YAxis width={48} tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<HistTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Bar dataKey="n">
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === markerBin ? 'var(--mantine-color-blue-7)' : 'var(--mantine-color-indigo-5)'}
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
              background: 'var(--mantine-color-blue-6)',
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
                borderTop: '8px solid var(--mantine-color-blue-6)',
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
                color: 'var(--mantine-color-blue-6)',
              }}
            >
              {markerLabel}
            </Text>
          </div>
        )}
      </div>
      <ChartData caption="Salary distribution" columns={['Salary range', 'People']} rows={bins.map((b) => [b.range, b.n])} />
    </>
  );
}
