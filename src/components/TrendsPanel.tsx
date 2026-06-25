import { useMemo } from 'react';
import { Card, Text, Loader, Paper } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceLine, LabelList,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD } from '../lib/chartStyle';
import { lineGlowDefs } from './chartDefs';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, paidHeadcount, whereAll, filterKey } from '../lib/queries';
import { usd, num, pct } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { ChartData } from './ChartData';

interface Row { id: string; label: string; date: string; med: number | null; hc: number; renew: number | null }
interface Plot extends Row { yoy: number | null }

/** +X% / −X% pill above each median point (the YoY change vs the previous snapshot). */
function YoyLabel(props: { x?: number; y?: number; value?: number | null }) {
  const { x, y, value } = props;
  if (x == null || y == null || value == null) return null;
  const up = value >= 0;
  const txt = `${up ? '+' : ''}${(value * 100).toFixed(1)}%`;
  const color = up ? 'var(--mantine-color-pos-7)' : 'var(--mantine-color-red-7)';
  const w = txt.length * 6 + 8;
  const cy = y > 40 ? y - 20 : y + 20;
  return (
    <g>
      <rect x={x - w / 2} y={cy - 7.5} width={w} height={15} rx={7} fill="var(--mantine-color-body)" fillOpacity={0.85} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
      <text x={x} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={color}>{txt}</text>
    </g>
  );
}

/** Hover marker for the median line: an accent dot with a soft halo. */
function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="var(--mantine-color-accent-6)" opacity={0.18} />
      <circle cx={cx} cy={cy} r={5} fill="var(--mantine-color-accent-6)" stroke="var(--mantine-color-body)" strokeWidth={2} />
    </g>
  );
}

function TrendTip({ active, payload, label }: {
  active?: boolean; label?: string; payload?: { payload: Plot }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>{label}</Text>
      <Text size="sm">
        Median {usd(p.med)}{' '}
        {p.yoy != null && <Text span c={p.yoy >= 0 ? 'pos' : 'red'}>({p.yoy >= 0 ? '+' : ''}{pct(p.yoy)})</Text>}
      </Text>
      <Text size="xs" c="dimmed">
        {num(p.hc)} paid{p.renew != null ? ` · ${num(p.renew)} renewable` : ''}
      </Text>
    </Paper>
  );
}

export function TrendsPanel() {
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const reduce = prefersReducedMotion();
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    // `renew` = paid employees on a renewable ("Regular") appointment — excludes Terminal and Temporary.
    // Appointment type is only recorded from the Sep 2025 dump on, so it's NULL (not 0) for older
    // snapshots, leaving those points off the line instead of plotting a misleading zero.
    `SELECT snapshot_id id, any_value(snapshot_label) AS "label", any_value(snapshot_date) date,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, ${paidHeadcount(metric)} hc,
        CASE WHEN count(*) FILTER (WHERE employee_type IS NOT NULL) = 0 THEN NULL
             ELSE count(DISTINCT person_key) FILTER (WHERE ${expr} > 0 AND employee_type = 'Regular') END AS renew
     FROM salaries WHERE ${whereAll(scope, filters)} GROUP BY snapshot_id ORDER BY date`
  );

  const plot = useMemo<Plot[]>(() => {
    const rows = data ?? [];
    return rows.map((r, i) => {
      const prev = rows[i - 1];
      const yoy = prev && prev.date !== r.date && prev.med != null && r.med != null && prev.med !== 0
        ? (r.med - prev.med) / prev.med
        : null;
      return { ...r, yoy };
    });
  }, [data]);

  // The TTC reclassification boundary (the post-TTC Nov-2021 snapshot) and the snapshot with the largest
  // headcount drop (a data-coverage change, not mass departures) — annotated so neither is misread.
  const ttcLabel = plot.find((r) => r.id?.endsWith('-post'))?.label;
  const coverageLabel = useMemo(() => {
    let worst = 0.12;
    let lbl: string | undefined;
    plot.forEach((r, i) => {
      const prev = plot[i - 1];
      if (prev && prev.hc > 0 && r.hc != null) {
        const drop = (prev.hc - r.hc) / prev.hc;
        if (drop > worst) { worst = drop; lbl = r.label; }
      }
    });
    return lbl;
  }, [plot]);

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <Text size="sm" fw={600} mb="md">Median salary &amp; headcount over time</Text>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={plot} margin={{ left: 12, right: 16, top: 28, bottom: 0 }}>
          <defs>{lineGlowDefs('expltrend')}</defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" tick={AXIS_TICK} />
          <YAxis yAxisId="med" tickFormatter={(v) => usd(v)} width={92} tick={AXIS_TICK} padding={Y_PAD}
            label={{ value: 'Median salary', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-accent-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <YAxis yAxisId="hc" orientation="right" width={72} tick={AXIS_TICK} padding={Y_PAD}
            label={{ value: 'Headcount', angle: 90, position: 'insideRight', style: { fill: 'var(--mantine-color-pos-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip content={<TrendTip />} />
          <Legend />

          {ttcLabel && (
            <ReferenceLine yAxisId="med" x={ttcLabel} stroke="var(--mantine-color-accent-5)" strokeDasharray="3 3"
              label={{ value: 'TTC reclassification', position: 'top', fontSize: 10, fill: 'var(--mantine-color-accent-7)' }} />
          )}
          {coverageLabel && (
            <ReferenceLine yAxisId="hc" x={coverageLabel} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4"
              label={{ value: 'coverage change', position: 'top', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
          )}

          {/* Median: gradient area + soft-glow underlay + primary line with YoY pills. */}
          <Area yAxisId="med" type="monotone" dataKey="med" stroke="none" fill="url(#expltrend-area-grad)" isAnimationActive={false} legendType="none" />
          <Line yAxisId="med" type="monotone" dataKey="med" stroke="var(--mantine-color-accent-6)" strokeWidth={6} strokeOpacity={0.4} dot={false} legendType="none" isAnimationActive={false} filter="url(#expltrend-line-glow)" />
          <Line yAxisId="med" type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot activeDot={<ActiveDot />} isAnimationActive={!reduce} animationDuration={800} animationEasing="ease-out">
            <LabelList dataKey="yoy" content={<YoyLabel />} />
          </Line>

          <Line yAxisId="hc" type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-pos-6)" strokeWidth={2} dot strokeDasharray="4 2" isAnimationActive={!reduce} />
          <Line yAxisId="hc" type="monotone" dataKey="renew" name="Ongoing (renewable) appts" stroke="var(--mantine-color-orange-6)" strokeWidth={2} dot connectNulls={false} isAnimationActive={!reduce} />
        </ComposedChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        Nominal dollars (not inflation-adjusted). Headcount = people with a paid appointment; unpaid $0 affiliate
        appointments are excluded. <b>Ongoing (renewable)</b> = staff on a continuing (&ldquo;Regular&rdquo;)
        appointment — excludes terminal and temporary ones; appointment type is only recorded from Sep 2025 on,
        so that line starts there. The dashed <b>coverage change</b> marker flags a snapshot whose source covered
        fewer staff, not a real headcount cliff.
      </Text>
      <ChartData caption="Median salary, headcount & renewable staff over time" columns={['Snapshot', 'Median', 'YoY %', 'Headcount', 'Renewable']} rows={plot.map((d) => [d.label, d.med, d.yoy == null ? '' : pct(d.yoy), d.hc, d.renew])} />
    </Card>
  );
}
