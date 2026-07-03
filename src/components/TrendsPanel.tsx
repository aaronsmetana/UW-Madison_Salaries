import { useMemo } from 'react';
import { Card, Text, Loader, Group } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceLine, LabelList,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, fmtUsd, fmtSnapTick } from '../lib/chartStyle';
import { lineGlowDefs } from './chartDefs';
import { TipSurface } from './chart/ChartTooltip';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, paidHeadcount, whereAll, filterKey } from '../lib/queries';
import { usd, num, pct } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { ChartData } from './ChartData';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { SegmentedToggle } from './SegmentedToggle';
import { YoyPill } from './chart/pills';
import { usePref } from '../lib/prefs';

interface Row { id: string; label: string; date: string; med: number | null; hc: number; renew: number | null }
interface Plot extends Row { yoy: number | null }

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
    <TipSurface>
      <Text size="sm" fw={600}>{label}</Text>
      <Text size="sm">
        Median {usd(p.med)}{' '}
        {p.yoy != null && <Text span c={p.yoy >= 0 ? 'pos' : 'red'}>({p.yoy >= 0 ? '+' : ''}{pct(p.yoy)})</Text>}
      </Text>
      <Text size="xs" c="dimmed">
        {num(p.hc)} paid{p.renew != null ? ` · ${num(p.renew)} renewable` : ''}
      </Text>
    </TipSurface>
  );
}

export function TrendsPanel() {
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const reduce = prefersReducedMotion();
  const [dollarMode, setDollarMode] = usePref<'nominal' | 'real'>('dollarMode', 'nominal');
  const [hcScale, setHcScale] = usePref<'linear' | 'log'>('scaleMode', 'linear');
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
    return rows.map((r) => {
      if (dollarMode !== 'real' || r.med == null) return r;
      const year = Number(String(r.date).slice(0, 4)) || REAL_BASE_YEAR;
      return { ...r, med: toReal(r.med, year) };
    }).map((r, i, real) => {
      const prev = real[i - 1];
      const yoy = prev && prev.date !== r.date && prev.med != null && r.med != null && prev.med !== 0
        ? (r.med - prev.med) / prev.med
        : null;
      return { ...r, yoy };
    });
  }, [data, dollarMode]);

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
      <Group justify="space-between" align="center" mb="md" wrap="wrap">
        <Text size="sm" fw={600}>Median salary &amp; headcount over time</Text>
        <Group gap="sm" wrap="wrap">
          <SegmentedToggle
            value={dollarMode}
            onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
            options={[{ id: 'nominal', label: 'Nominal' }, { id: 'real', label: `${REAL_BASE_YEAR} $` }]}
          />
          <SegmentedToggle
            value={hcScale}
            onChange={(v) => setHcScale(v as 'linear' | 'log')}
            options={[{ id: 'linear', label: 'Linear' }, { id: 'log', label: 'Log' }]}
          />
        </Group>
      </Group>
      {/* Two stacked single-axis panels sharing an x-axis (syncId) instead of one dual-axis chart —
          a shared plot with two different y-scales makes the point where the lines cross meaningless.
          The median panel keeps the full rich tooltip (it reads hc/renew off the same `plot` rows even
          though those lines render below); the headcount panel suppresses its own tooltip and relies on
          the synced crosshair, matching the same convention as Person's trend+FTE stack. */}
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 28, bottom: 0 }}>
          <defs>{lineGlowDefs('expltrend')}</defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" tick={false} />
          <YAxis tickFormatter={fmtUsd} width={92} tick={AXIS_TICK} padding={Y_PAD}
            label={{ value: 'Median salary', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-accent-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip content={<TrendTip />} />

          {ttcLabel && (
            <ReferenceLine x={ttcLabel} stroke="var(--mantine-color-accent-5)" strokeDasharray="3 3"
              label={{ value: 'TTC reclassification', position: 'top', fontSize: 10, fill: 'var(--mantine-color-accent-7)' }} />
          )}

          {/* Median: gradient area + soft-glow underlay + primary line. */}
          <Area type="monotone" dataKey="med" stroke="none" fill="url(#expltrend-area-grad)" isAnimationActive={false} legendType="none" />
          <Line type="monotone" dataKey="med" stroke="var(--mantine-color-accent-6)" strokeWidth={6} strokeOpacity={0.4} dot={false} legendType="none" isAnimationActive={false} filter="url(#expltrend-line-glow)" />
          <Line type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot activeDot={<ActiveDot />} isAnimationActive={!reduce} animationDuration={800} animationEasing="ease-out" />

          {/* YoY % pills, drawn last so they sit above the area fill (legend-less duplicate). */}
          <Line type="monotone" dataKey="med" stroke="none" dot={false} legendType="none" isAnimationActive={false}>
            <LabelList dataKey="yoy" content={<YoyPill topThreshold={40} offset={20} count={plot.length} />} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ height: 16 }} />

      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} tickMargin={10} height={34} />
          <YAxis
            width={92}
            tick={AXIS_TICK}
            padding={Y_PAD}
            scale={hcScale === 'log' ? 'log' : 'auto'}
            domain={hcScale === 'log' ? [0.5, 'auto'] : undefined}
            allowDataOverflow={hcScale === 'log'}
            label={{ value: 'Headcount', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-pos-6)', fontSize: 12, textAnchor: 'middle' } }}
          />
          <Tooltip content={() => null} />
          <Legend />

          {coverageLabel && (
            <ReferenceLine x={coverageLabel} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4"
              label={{ value: 'coverage change', position: 'top', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
          )}

          <Line type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-pos-6)" strokeWidth={2} dot strokeDasharray="4 2" isAnimationActive={!reduce} />
          <Line type="monotone" dataKey="renew" name="Ongoing (renewable) appts" stroke="var(--mantine-color-orange-6)" strokeWidth={2} dot connectNulls={false} isAnimationActive={!reduce} />
        </ComposedChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        {dollarMode === 'real'
          ? `Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).`
          : 'Nominal dollars (not inflation-adjusted).'}{' '}
        Headcount = people with a paid appointment; unpaid $0 affiliate
        appointments are excluded. <b>Ongoing (renewable)</b> = staff on a continuing (&ldquo;Regular&rdquo;)
        appointment — excludes terminal and temporary ones; appointment type is only recorded from Sep 2025 on,
        so that line starts there. The dashed <b>coverage change</b> marker flags a snapshot whose source covered
        fewer staff, not a real headcount cliff.
      </Text>
      <ChartData
        caption={dollarMode === 'real' ? `Median salary, headcount & renewable staff over time (in ${REAL_BASE_YEAR} dollars)` : 'Median salary, headcount & renewable staff over time'}
        columns={['Snapshot', 'Median', 'YoY %', 'Headcount', 'Renewable']}
        rows={plot.map((d) => [d.label, d.med, d.yoy == null ? '' : pct(d.yoy), d.hc, d.renew])}
      />
    </Card>
  );
}
