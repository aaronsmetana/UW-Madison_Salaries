import { useId, useMemo, useState } from 'react';
import { Stack, Card, Text, SimpleGrid } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceArea, ReferenceLine,
} from 'recharts';
import { AXIS_TICK, GRID, BAR_RADIUS, TIP_STYLE, TIP_LABEL_STYLE, fmtSnapTick } from '../lib/chartStyle';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { whereAll, filterKey } from '../lib/queries';
import { num, pct, spanLabel } from '../lib/format';
import { ChartData } from './ChartData';
import { StatCard } from './StatCard';
import { StatSkeleton, ChartSkeleton } from './Loading';
import { SegmentedToggle } from './SegmentedToggle';
import { CardTitle } from './CardTitle';
import { SvgPill } from './chart/pills';
import { TipSurface } from './chart/ChartTooltip';
import { barGradientDefs } from './chartDefs';

/** Hover card: capitalized "Retention" plus the underlying counts so the % is grounded. */
function RetentionTip({ active, payload, label }: {
  active?: boolean;
  label?: string;
  payload?: { payload: { retention: number; stayed: number; left: number; total: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>Hired {label}</Text>
      <Text size="sm">Retention: {d.retention}%</Text>
      <Text size="xs" c="dimmed">{num(d.stayed)} stayed · {num(d.left)} left · {num(d.total)} hired</Text>
    </TipSurface>
  );
}

/** Retention % is a magnitude (share retained), not a polarity — a sequential single-hue ramp reads it
 *  correctly, where a red→green diverging scale would misuse the reserved status colors and be a
 *  classic CVD-confusable pair. Five steps, light→dark, off the accent ramp. */
const RETENTION_RAMP = [
  'var(--mantine-color-accent-2)', 'var(--mantine-color-accent-4)', 'var(--mantine-color-accent-6)',
  'var(--mantine-color-accent-7)', 'var(--mantine-color-accent-9)',
];
const retColor = (r: number) => {
  const pct = Math.max(0, Math.min(100, r));
  const idx = Math.min(RETENTION_RAMP.length - 1, Math.floor(pct / (100 / RETENTION_RAMP.length)));
  return RETENTION_RAMP[idx];
};

/** A ReferenceArea label: resolves Recharts' injected viewBox to a point near the area's top-center,
 *  then renders it as a legible pill via the shared SvgPill. */
function AreaPillLabel({ viewBox, text }: { viewBox?: { x?: number; y?: number; width?: number }; text: string }) {
  if (!viewBox || viewBox.x == null || viewBox.y == null) return null;
  const cx = viewBox.x + (viewBox.width ?? 0) / 2;
  const cy = viewBox.y + 12;
  return <SvgPill x={cx} y={cy} text={text} fontWeight={500} />;
}

export function CohortPanel() {
  const uid = useId();
  const { scope, filters } = useControls();
  const { data: summary } = useSummary();
  const latest = summary?.snapshots[summary.snapshots.length - 1];
  const latestYear = latest ? Number(latest.date.slice(0, 4)) : 2026;
  const where = whereAll(scope, filters);
  const scopeVal = scope.kind === 'school' ? scope.value : '';
  const [sortMode, setSortMode] = useState<'year' | 'retention'>('year');
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);

  const { data, isFetching } = useSql<{ hire_year: number; total: number; still_here: number }>(
    ['cohort', scope.kind, scopeVal, latest?.id ?? '', filterKey(filters)],
    `WITH latest AS (SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(latest?.id ?? '')} AND ${where})
     SELECT s.hire_year hire_year, count(DISTINCT s.person_key) total,
        count(DISTINCT s.person_key) FILTER (WHERE l.person_key IS NOT NULL) still_here
     FROM salaries s LEFT JOIN latest l ON s.person_key = l.person_key
     WHERE s.hire_year IS NOT NULL AND s.hire_year BETWEEN 1990 AND 2026 AND ${where}
     GROUP BY s.hire_year ORDER BY s.hire_year`,
    !!latest
  );

  // Median tenure + recent-hire share of current staff (an honest "how settled is this workforce" read).
  const { data: tenureRows } = useSql<{ med: number | null; n: number; recent5: number }>(
    ['cohort-tenure', scope.kind, scopeVal, latest?.id ?? '', filterKey(filters)],
    `WITH pp AS (
        SELECT person_key, date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(latest?.id ?? '')} AND ${where} AND salary > 0 GROUP BY person_key)
     SELECT median(tenure) med, count(*) n, count(*) FILTER (WHERE tenure <= 5) recent5 FROM pp WHERE tenure >= 0`,
    !!latest
  );
  const t = tenureRows?.[0];

  // Turnover: paid staff joining vs leaving between consecutive snapshots (Pre-TTC duplicate excluded).
  const { data: flow, isFetching: flowFetching } = useSql<{ lbl: string; joined: number; departed: number }>(
    ['turnover', scope.kind, scopeVal, filterKey(filters)],
    `WITH ord AS (
        SELECT snapshot_id, any_value(snapshot_label) "label", any_value(snapshot_date) dt,
               dense_rank() OVER (ORDER BY any_value(snapshot_date), snapshot_id) rn
        FROM salaries WHERE ${where} AND snapshot_id NOT LIKE '%-pre' GROUP BY snapshot_id
     ),
     paid AS (
        SELECT DISTINCT o.rn, s.person_key FROM salaries s JOIN ord o ON s.snapshot_id = o.snapshot_id
        WHERE ${where} AND s.salary > 0
     ),
     flow AS (
        SELECT coalesce(c.rn, p.rn) rn,
               count(*) FILTER (WHERE p.person_key IS NULL) joined,
               count(*) FILTER (WHERE c.person_key IS NULL) departed
        FROM (SELECT rn, person_key FROM paid) c
        FULL OUTER JOIN (SELECT rn + 1 AS rn, person_key FROM paid) p
          ON c.rn = p.rn AND c.person_key = p.person_key
        GROUP BY coalesce(c.rn, p.rn)
     )
     SELECT o."label" lbl, f.joined, f.departed FROM flow f JOIN ord o ON o.rn = f.rn
     WHERE f.rn > 1 ORDER BY o.dt`,
    !!latest
  );

  const chart = useMemo(() => {
    const rows = (data ?? []).map((r) => {
      const retention = r.total ? Math.max(0, Math.min(100, Math.round((100 * r.still_here) / r.total))) : 0;
      return { year: String(r.hire_year), retention, lost: 100 - retention, stayed: r.still_here, left: r.total - r.still_here, total: r.total };
    });
    return sortMode === 'retention' ? [...rows].sort((a, b) => b.retention - a.retention) : rows;
  }, [data, sortMode]);

  const turnover = useMemo(() => (flow ?? []).map((r) => ({ label: r.lbl, joined: r.joined, departed: r.departed, net: r.joined - r.departed })), [flow]);
  // Snapshot with the most churn (joined + left) — usually a data-coverage change rather than real turnover.
  const coverageLabel = useMemo(() => {
    let max = 0; let lbl: string | undefined;
    turnover.forEach((r) => { const tot = r.joined + r.departed; if (tot > max) { max = tot; lbl = r.label; } });
    return lbl;
  }, [turnover]);

  if (isFetching && !data) {
    return (
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <StatSkeleton size="sm" />
          <StatSkeleton size="sm" />
          <StatSkeleton size="sm" />
        </SimpleGrid>
        <Card withBorder padding="lg"><ChartSkeleton height={300} /></Card>
        <Card withBorder padding="lg"><ChartSkeleton height={280} /></Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard size="sm" label="Median tenure · current staff" value={t?.med != null ? `${t.med.toFixed(1)} yrs` : '—'} />
        <StatCard size="sm" label="Hired in the last 5 years" value={t && t.n ? pct(t.recent5 / t.n) : '—'} sub={t ? `${num(t.recent5)} of ${num(t.n)}` : undefined} />
        <StatCard size="sm" label="Snapshots span" value={latest ? `2021 – ${latestYear}` : '—'} sub="data begins Nov 2021" />
      </SimpleGrid>

      <Card withBorder padding="lg">
        <CardTitle
          right={
            <SegmentedToggle
              size="xs" value={sortMode} onChange={(v) => setSortMode(v as 'year' | 'retention')}
              options={[{ id: 'year', label: 'By year' }, { id: 'retention', label: 'By retention' }]}
            />
          }
        >
          Retention by hire year (share still here)
        </CardTitle>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart} margin={{ left: 12, right: 12 }}>
            <defs>{barGradientDefs(uid, { stayed: 'var(--mantine-color-pos-6)', lost: 'var(--mantine-color-gray-4)' })}</defs>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="year" tick={AXIS_TICK} interval={sortMode === 'year' ? 2 : 0} />
            <YAxis width={48} tick={AXIS_TICK} unit="%" domain={[0, 100]} />
            <Tooltip content={<RetentionTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Legend />
            {/* Pre-2021 cohorts are left-censored: we only see those who survived to the first snapshot. */}
            {sortMode === 'year' && (
              <ReferenceArea x1="1990" x2="2021" fill="var(--mantine-color-default-border)" fillOpacity={0.35}
                label={<AreaPillLabel text="pre-2021 hires: survivors only" />} />
            )}
            <Bar
              dataKey="retention"
              name="Retained"
              fill={`url(#${uid}-bar-stayed)`}
              stackId="r"
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              onMouseEnter={(_, i) => setHoveredYear(i)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              {chart.map((c, i) => (
                <Cell
                  key={i}
                  fill={sortMode === 'retention' ? retColor(c.retention) : `url(#${uid}-bar-stayed)`}
                  fillOpacity={hoveredYear != null && hoveredYear !== i ? 0.45 : 1}
                />
              ))}
            </Bar>
            <Bar
              dataKey="lost"
              name="Left"
              stackId="r"
              fill={`url(#${uid}-bar-lost)`}
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              radius={BAR_RADIUS}
              onMouseEnter={(_, i) => setHoveredYear(i)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              {chart.map((_, i) => <Cell key={i} fillOpacity={hoveredYear != null && hoveredYear !== i ? 0.45 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <Text size="xs" c="dimmed">
          Each bar is one hire-year cohort: green = share still present in the latest snapshot ({latest?.label}),
          grey = share since gone. Snapshots begin in 2021, so the shaded pre-2021 cohorts reflect only survivors
          already employed by then; the most recent cohorts are also immature (little time to attrit yet).
        </Text>
        <ChartData
          caption="Retention by hire year"
          columns={['Hire year', 'Retained %', 'Left %']}
          rows={chart.map((c) => [c.year, c.retention, c.lost])}
          unit="hire-year cohorts"
          period={latest?.label ? `as of ${latest.label}` : undefined}
        />
      </Card>

      <Card withBorder padding="lg">
        <CardTitle>Workforce turnover — paid staff joining vs leaving</CardTitle>
        {flowFetching && !flow ? (
          <ChartSkeleton height={280} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={turnover} margin={{ left: 12, right: 12, top: 8 }}>
                <defs>{barGradientDefs(`${uid}-flow`, { joined: 'var(--mantine-color-pos-6)', departed: 'var(--mantine-color-red-6)' })}</defs>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
                <YAxis width={56} tick={AXIS_TICK} />
                <Tooltip
                  formatter={(v: number, key) => [num(v), key === 'joined' ? 'Joined' : key === 'departed' ? 'Left' : 'Net']}
                  cursor={{ fill: 'var(--mantine-color-default-hover)' }}
                  contentStyle={TIP_STYLE}
                  labelStyle={TIP_LABEL_STYLE}
                />
                <Legend />
                {coverageLabel && (
                  <ReferenceLine x={coverageLabel} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4"
                    label={{ value: 'coverage change', position: 'insideTopRight', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
                )}
                <ReferenceLine y={0} stroke="var(--mantine-color-default-border)" />
                <Bar
                  dataKey="joined"
                  name="Joined"
                  fill={`url(#${uid}-flow-bar-joined)`}
                  radius={BAR_RADIUS}
                  onMouseEnter={(_, i) => setHoveredFlow(i)}
                  onMouseLeave={() => setHoveredFlow(null)}
                >
                  {turnover.map((_, i) => <Cell key={i} fillOpacity={hoveredFlow != null && hoveredFlow !== i ? 0.45 : 1} />)}
                </Bar>
                <Bar
                  dataKey="departed"
                  name="Left"
                  fill={`url(#${uid}-flow-bar-departed)`}
                  radius={BAR_RADIUS}
                  onMouseEnter={(_, i) => setHoveredFlow(i)}
                  onMouseLeave={() => setHoveredFlow(null)}
                >
                  {turnover.map((_, i) => <Cell key={i} fillOpacity={hoveredFlow != null && hoveredFlow !== i ? 0.45 : 1} />)}
                </Bar>
                <Line type="monotone" dataKey="net" name="Net change" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
            <Text size="xs" c="dimmed">
              Paid employees who joined vs left between each snapshot and the one before it; the accent line is the
              net change. Counts paid staff only (unpaid $0 affiliates excluded); the duplicate Pre-TTC snapshot is
              omitted. The dashed marker flags the snapshot with the most churn — usually a source-coverage change,
              not a real hiring/exit wave.
            </Text>
            <ChartData
              caption="Workforce turnover"
              columns={['As of', 'Joined', 'Left', 'Net']}
              rows={turnover.map((x) => [x.label, x.joined, x.departed, x.net])}
              unit="snapshot steps"
              period={spanLabel(turnover.map((x) => x.label))}
            />
          </>
        )}
      </Card>
    </Stack>
  );
}
