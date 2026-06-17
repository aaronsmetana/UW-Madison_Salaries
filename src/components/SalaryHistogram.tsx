import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Text } from '@mantine/core';
import { binSalaries, binIndexFor, MIN_FOR_HISTOGRAM } from '../lib/histogram';
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
  const markerIdx = markerValue != null ? binIndexFor(markerValue, bins) : -1;
  const marker = markerIdx >= 0 ? bins[markerIdx].label : null;

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis width={48} tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip content={<HistTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
          <Bar dataKey="n" fill="var(--mantine-color-indigo-5)" />
          {marker && (
            <ReferenceLine
              x={marker}
              stroke="var(--mantine-color-blue-6)"
              strokeWidth={2}
              label={{ value: markerLabel, position: 'top', fontSize: 11 }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      <ChartData caption="Salary distribution" columns={['Salary range', 'People']} rows={bins.map((b) => [b.range, b.n])} />
    </>
  );
}
