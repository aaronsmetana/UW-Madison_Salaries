import { useId, useMemo, useState, type ReactNode } from 'react';
import { Card, Text } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, LabelList } from 'recharts';
import { AXIS_TICK, GRID, BAR_RADIUS, TIP_STYLE } from '../lib/chartStyle';
import { CardTitle } from './CardTitle';
import { ChartData } from './ChartData';
import { barGradientDefs } from './chartDefs';
import { num } from '../lib/format';
import { chartAnim, MOTION, prefersReducedMotion } from '../lib/motion';
import { raiseBucket, raiseBucketLabel, raiseBuckets } from '../lib/raiseBuckets';
import { niceCeil, niceStep } from '../lib/rangeScale';
import { useWidth } from '../lib/useWidth';

/** The chart's top margin, where a capped no-change bar is cut. */
const DIST_TOP = 24;

/**
 * Continuing raises in the site's 1% bins (lib/raiseBuckets), with one raise marked: the median in Divisions →
 * Changes, the usual raise on the Raises page. Every bin takes its place on the axis, empty or not.
 */
export function RaiseDistribution({ counts, marker, title, period, className }: {
  /** Raises per bin, as `raiseBucketSql` counts them; undefined while loading. */
  counts: readonly { bucket: number; n: number }[] | undefined;
  /** The raise the dashed line marks: `label` on the chart ("median"), `name` in the note ("median raise"). */
  marker: { value: number; label: string; name: string } | null;
  title: ReactNode;
  /** The pair, for the table under the chart: "Mar 2026 → Sep 2026". */
  period: string;
  className?: string;
}) {
  const uid = useId();
  const reduceMotion = prefersReducedMotion();
  const [hoveredDist, setHoveredDist] = useState<number | null>(null);
  const raiseDist = useMemo(() => {
    if (!counts) return undefined;
    const by = new Map(counts.map((r) => [Number(r.bucket), r.n]));
    return raiseBuckets().map((k) => ({ bucket: k, label: raiseBucketLabel(k), n: by.get(k) ?? 0 }));
  }, [counts]);
  const distGradientColors = {
    red5: 'var(--mantine-color-red-5)', gray4: 'var(--mantine-color-gray-4)', pos5: 'var(--mantine-color-pos-5)',
  };
  // Down below 0, up above it, and the no-change bar neutral.
  const distColorSlot = (bucket: number) => (bucket < 0 ? 'red5' : bucket === 0 ? 'gray4' : 'pos5');

  // One bin can hold nearly everyone. Between two snapshots with no pay-plan raise almost everyone's pay
  // stands still — Sep 2025 to Mar 2026, 18,122 of 19,273 at 0% against 391 in the largest raise bin —
  // and a pay-plan step puts them all at one raise instead: Mar to Sep 2026, 14,810 in the +2% bin. On one
  // scale every other bin is a sliver under that one bar. Past 3× the next largest, the axis stops at that
  // one (×1.25) and the tall bar runs off its top, broken, with its count written on it.
  const distCap = useMemo(() => {
    const d = [...(raiseDist ?? [])].sort((a, b) => b.n - a.n);
    const [top, next] = d;
    return top && next && next.n > 0 && top.n > 3 * next.n ? { bucket: top.bucket, cap: niceCeil(next.n * 1.25) } : null;
  }, [raiseDist]);
  // Labels every 2% (5% on a narrow card) and always at 0%, which the automatic thinning dropped — the
  // one bin the note below names. The ends are the open tails, "< −10%" and "> +20%".
  const [distBoxRef, distW] = useWidth<HTMLDivElement>();
  const distTicks = useMemo(() => {
    const d = raiseDist ?? [];
    if (d.length < 3) return undefined;
    const step = distW > 0 && distW < 560 ? 5 : 2;
    const first = d[0].bucket, last = d[d.length - 1].bucket;
    return d.filter((r) => r.bucket === first || r.bucket === last || (r.bucket % step === 0 && r.bucket > first + 1 && r.bucket < last - 1)).map((r) => r.label);
  }, [raiseDist, distW]);
  const markerAt = marker ? raiseBucketLabel(raiseBucket(marker.value)) : null;

  return (
    <Card
      withBorder
      padding="lg"
      className={`raise-dist-card${className ? ` ${className}` : ''}`}
      data-raise-bins={(raiseDist ?? []).map((r) => r.bucket).join(',')}
      data-raise-counts={(raiseDist ?? []).filter((r) => r.n > 0).map((r) => `${r.bucket}:${r.n}`).join(',')}
      data-raise-cap={distCap?.cap ?? ''}
      data-raise-capped={distCap?.bucket ?? ''}
      ref={distBoxRef}
    >
      <CardTitle mb="sm">{title}</CardTitle>
      <ResponsiveContainer width="100%" height={240}>
        {/* Right margin for the last label, "> +20%", centred on the last bin at the plot's edge. */}
        <BarChart data={raiseDist ?? []} margin={{ left: 12, right: 24, top: DIST_TOP }} className="raise-dist">
          <defs>{barGradientDefs(`${uid}-dist`, distGradientColors)}</defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" tick={AXIS_TICK} ticks={distTicks} interval={0} />
          <YAxis width={48} tick={AXIS_TICK} domain={distCap ? [0, distCap.cap] : [0, 'auto']} allowDataOverflow={!!distCap}
            ticks={distCap ? Array.from({ length: Math.round(distCap.cap / niceStep(distCap.cap / 5)) + 1 }, (_, i) => i * niceStep(distCap.cap / 5)) : undefined}
            tickFormatter={(v: number) => num(v)} />
          <Tooltip formatter={(v: number) => [num(v), 'People']} cursor={{ fill: 'var(--mantine-color-default-hover)' }} contentStyle={TIP_STYLE} />
          {markerAt && (
            <ReferenceLine x={markerAt} stroke="var(--mantine-color-accent-6)" strokeDasharray="3 3"
              label={{ value: marker!.label, position: 'top', fontSize: 10, fill: 'var(--mantine-color-accent-7)' }} />
          )}
          <Bar
            {...chartAnim(reduceMotion, MOTION.reveal)}
            dataKey="n"
            name="People"
            radius={BAR_RADIUS}
            onMouseEnter={(_, i) => setHoveredDist(i)}
            onMouseLeave={() => setHoveredDist(null)}
          >
            {(raiseDist ?? []).map((r, i) => (
              <Cell
                key={i}
                className={`raise-bin raise-bin-${r.bucket < 0 ? 'down' : r.bucket === 0 ? 'zero' : 'up'}`}
                fill={`url(#${uid}-dist-bar-${distColorSlot(r.bucket)})`}
                fillOpacity={hoveredDist != null && hoveredDist !== i ? 0.45 : 1}
              />
            ))}
            {/* The no-change bar says how many: under the continuing-raise rule these are people whose
                pay did not move at all. A cut bar says how many too, since its height no longer can. */}
            <LabelList
              dataKey="n"
              position="top"
              content={(props) => {
                const { x, y, width, value, index } = props as { x: number; y: number; width: number; value: number; index: number };
                const bucket = raiseDist?.[index]?.bucket;
                if (!value || (bucket !== 0 && bucket !== distCap?.bucket)) return null;
                const zero = bucket === 0 ? ' raise-zero-label' : '';
                if (bucket !== distCap?.bucket) return <text className={`raise-count-label${zero}`} x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--mantine-color-text)">{num(value)}</text>;
                // Capped: the bar is cut at the top of the plot (DIST_TOP, the chart's top margin), so
                // it gets a break across it and its count just under the break.
                const top = DIST_TOP;
                return (
                  <g>
                    <path className="raise-cap-break" d={`M${x - 2} ${top + 7} L${x + width + 2} ${top + 2} M${x - 2} ${top + 12} L${x + width + 2} ${top + 7}`} stroke="var(--mantine-color-body)" strokeWidth={2.5} />
                    <text className={`raise-count-label raise-cap-label${zero}`} x={x + width / 2} y={top + 26} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--mantine-color-text)" stroke="var(--mantine-color-body)" strokeWidth={3} paintOrder="stroke">{num(value)}</text>
                  </g>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed">
        1% bins of raises as this site prints them, to a tenth of a percent: "+3%" is a raise above 2.0% up to 3.0%,
        and "0%" is pay that did not move. Changes past
        −10% or +20% are gathered at the ends. Green = raise, red = cut, grey = no change{marker ? `; the dashed line
        marks the ${marker.name}` : ''}.{distCap ? ` The ${distCap.bucket === 0 ? 'no-change' : `"${raiseBucketLabel(distCap.bucket)}"`} bar runs past the top of the scale, broken, so the other bins are not slivers beside it; its count is written on it.` : ''}
      </Text>
      <ChartData
        caption="Raise distribution (% change)"
        columns={['% bin', 'People']}
        rows={(raiseDist ?? []).map((r) => [r.label, r.n])}
        n={(raiseDist ?? []).reduce((s, r) => s + r.n, 0)}
        unit="people"
        period={period}
      />
    </Card>
  );
}
