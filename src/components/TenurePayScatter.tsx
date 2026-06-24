import type { ReactNode } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Box, Group, Text } from '@mantine/core';
import { usd } from '../lib/format';

export interface ScatterPoint {
  tenure: number;
  pay: number;
  sameSchool: boolean;
  isSelf: boolean;
  name: string;
}

/** Least-squares fit of pay on tenure over the current cohort. */
function leastSquares(pts: ScatterPoint[]): { slope: number; intercept: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const tBar = pts.reduce((s, p) => s + p.tenure, 0) / n;
  const sBar = pts.reduce((s, p) => s + p.pay, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.tenure - tBar) * (p.pay - sBar);
    den += (p.tenure - tBar) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: sBar - slope * tBar };
}

/** A circle marker; Recharts injects cx/cy when passed as a Scatter `shape`. */
function PeerDot({ cx, cy, r = 4.5, fill, stroke }: { cx?: number; cy?: number; r?: number; fill?: string; stroke?: string }) {
  if (cx == null || cy == null) return <g />;
  return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.9} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />;
}

function ScatterTip({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Box style={{ background: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: '6px 10px' }}>
      <Text size="xs" fw={600}>{d.name}{d.isSelf ? ' (this person)' : ''}</Text>
      <Text size="xs" c="dimmed">{d.tenure.toFixed(1)} yrs · {usd(d.pay)}</Text>
    </Box>
  );
}

function LegendSwatch({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <Group gap={6} wrap="nowrap" align="center">{swatch}<Text size="xs" c="dimmed">{label}</Text></Group>
  );
}

/**
 * Pay-vs-tenure scatter for everyone with the same title (the caller filters to the active cohort).
 * The subject pops in accent; same-school peers are green, others gray. A dashed least-squares line shows
 * the pay tenure alone predicts, and a callout reads whether the subject sits above or below that curve.
 */
export function TenurePayScatter({
  points,
  self,
  titleLabel,
}: {
  points: ScatterPoint[];
  self: { tenure: number; pay: number } | null;
  titleLabel: string;
}) {
  const reg = leastSquares(points);
  const tMax = Math.max(10, ...points.map((p) => p.tenure), self?.tenure ?? 0);
  const xMax = Math.ceil(tMax / 10) * 10;
  const xTicks: number[] = [];
  for (let t = 0; t <= xMax; t += 10) xTicks.push(t);

  const others = points.filter((p) => !p.isSelf && !p.sameSchool);
  const schoolPts = points.filter((p) => !p.isSelf && p.sameSchool);
  const selfPts = points.filter((p) => p.isSelf);

  const expected = reg && self ? reg.intercept + reg.slope * self.tenure : null;
  const gap = expected != null && self ? self.pay - expected : null;
  const above = gap != null && gap >= 0;

  return (
    <div>
      {expected != null && gap != null && self && (
        <Box
          mb="md"
          style={{
            borderLeft: `3px solid ${above ? 'var(--mantine-color-pos-6)' : 'var(--mantine-color-orange-5)'}`,
            background: above ? 'var(--mantine-color-pos-light)' : 'var(--mantine-color-orange-light)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <Text size="sm">
            <b>{above ? 'Above' : 'Below'} the tenure curve.</b> At {self.tenure.toFixed(1)} yrs, {titleLabel} typically
            pays {usd(expected)}. This person earns <b>{usd(Math.abs(gap))}</b> {above ? 'more' : 'less'} than tenure alone predicts.
          </Text>
        </Box>
      )}

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ left: 12, right: 16, top: 10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="tenure"
            name="Tenure"
            domain={[0, xMax]}
            ticks={xTicks}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => `${v}y`}
          />
          <YAxis
            type="number"
            dataKey="pay"
            name="Pay"
            width={56}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
            domain={['auto', 'auto']}
            padding={{ top: 10, bottom: 10 }}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTip />} />
          {reg && (
            <ReferenceLine
              stroke="var(--mantine-color-gray-5)"
              strokeDasharray="6 4"
              strokeWidth={2}
              ifOverflow="extendDomain"
              segment={[{ x: 0, y: reg.intercept }, { x: xMax, y: reg.intercept + reg.slope * xMax }]}
            />
          )}
          <Scatter data={others} shape={<PeerDot fill="var(--mantine-color-gray-5)" />} isAnimationActive={false} />
          <Scatter data={schoolPts} shape={<PeerDot fill="var(--mantine-color-pos-6)" />} isAnimationActive={false} />
          <Scatter data={selfPts} shape={<PeerDot r={7.5} fill="var(--mantine-color-accent-6)" stroke="var(--mantine-color-body)" />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>

      <Group gap="lg" mt="xs" wrap="wrap">
        <LegendSwatch swatch={<svg width={14} height={14} aria-hidden><circle cx={7} cy={7} r={6} fill="var(--mantine-color-accent-6)" stroke="var(--mantine-color-body)" strokeWidth={1.5} /></svg>} label="This person" />
        <LegendSwatch swatch={<svg width={12} height={12} aria-hidden><circle cx={6} cy={6} r={4.5} fill="var(--mantine-color-pos-6)" /></svg>} label="Same school" />
        <LegendSwatch swatch={<svg width={12} height={12} aria-hidden><circle cx={6} cy={6} r={4.5} fill="var(--mantine-color-gray-5)" /></svg>} label="Others" />
        <LegendSwatch swatch={<svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-gray-5)" strokeWidth={2} strokeDasharray="6 4" /></svg>} label="Tenure-expected pay" />
      </Group>
    </div>
  );
}
