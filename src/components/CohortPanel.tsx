import { useMemo, useState } from 'react';
import { Stack, Card, Text, Loader, Paper, SimpleGrid, Group } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceArea, ReferenceLine,
} from 'recharts';
import { AXIS_TICK, GRID } from '../lib/chartStyle';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { whereAll, filterKey } from '../lib/queries';
import { num, pct } from '../lib/format';
import { ChartData } from './ChartData';
import { StatCard } from './StatCard';
import { SegmentedToggle } from './SegmentedToggle';

/** Hover card: capitalized "Retention" plus the underlying counts so the % is grounded. */
function RetentionTip({ active, payload, label }: {
  active?: boolean;
  label?: string;
  payload?: { payload: { retention: number; stayed: number; left: number; total: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>Hired {label}</Text>
      <Text size="sm">Retention: {d.retention}%</Text>
      <Text size="xs" c="dimmed">{num(d.stayed)} stayed · {num(d.left)} left · {num(d.total)} hired</Text>
    </Paper>
  );
}

/** Red→green by retention % (a quick magnitude read when the bars are sorted by value). */
const retColor = (r: number) => `hsl(${Math.round(Math.max(0, Math.min(100, r)) * 1.2)}, 55%, 42%)`;

export function CohortPanel() {
  const { scope, filters } = useControls();
  const { data: summary } = useSummary();
  const latest = summary?.snapshots[summary.snapshots.length - 1];
  const latestYear = latest ? Number(latest.date.slice(0, 4)) : 2026;
  const where = whereAll(scope, filters);
  const scopeVal = scope.kind === 'school' ? scope.value : '';
  const [sortMode, setSortMode] = useState<'year' | 'retention'>('year');

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

  if (isFetching && !data) return <Loader />;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard size="sm" label="Median tenure · current staff" value={t?.med != null ? `${t.med.toFixed(1)} yrs` : '—'} />
        <StatCard size="sm" label="Hired in the last 5 years" value={t && t.n ? pct(t.recent5 / t.n) : '—'} sub={t ? `${num(t.recent5)} of ${num(t.n)}` : undefined} />
        <StatCard size="sm" label="Snapshots span" value={latest ? `2021 – ${latestYear}` : '—'} sub="data begins Nov 2021" />
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
          <Text size="sm" fw={600}>Retention by hire year (share still here)</Text>
          <SegmentedToggle
            size="xs" value={sortMode} onChange={(v) => setSortMode(v as 'year' | 'retention')}
            options={[{ id: 'year', label: 'By year' }, { id: 'retention', label: 'By retention' }]}
          />
        </Group>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="year" tick={AXIS_TICK} interval={sortMode === 'year' ? 2 : 0} />
            <YAxis width={48} tick={AXIS_TICK} unit="%" domain={[0, 100]} />
            <Tooltip content={<RetentionTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Legend />
            {/* Pre-2021 cohorts are left-censored: we only see those who survived to the first snapshot. */}
            {sortMode === 'year' && (
              <ReferenceArea x1="1990" x2="2021" fill="var(--mantine-color-default-border)" fillOpacity={0.35}
                label={{ value: 'survivors only', position: 'insideTop', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
            )}
            <Bar dataKey="retention" name="Retained" stackId="r">
              {chart.map((c, i) => <Cell key={i} fill={sortMode === 'retention' ? retColor(c.retention) : 'var(--mantine-color-pos-6)'} />)}
            </Bar>
            <Bar dataKey="lost" name="Left" stackId="r" fill="var(--mantine-color-gray-4)" />
          </BarChart>
        </ResponsiveContainer>
        <ChartData caption="Retention by hire year" columns={['Hire year', 'Retained %', 'Left %']} rows={chart.map((c) => [c.year, c.retention, c.lost])} />
        <Text size="xs" c="dimmed">
          Each bar is one hire-year cohort: green = share still present in the latest snapshot ({latest?.label}),
          grey = share since gone. Snapshots begin in 2021, so the shaded pre-2021 cohorts reflect only survivors
          already employed by then; the most recent cohorts are also immature (little time to attrit yet).
        </Text>
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Workforce turnover — paid staff joining vs leaving</Text>
        {flowFetching && !flow ? (
          <Loader />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={turnover} margin={{ left: 12, right: 12, top: 8 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis width={56} tick={AXIS_TICK} />
                <Tooltip
                  formatter={(v: number, key) => [num(v), key === 'joined' ? 'Joined' : key === 'departed' ? 'Left' : 'Net']}
                  cursor={{ fill: 'var(--mantine-color-default-hover)' }}
                />
                <Legend />
                {coverageLabel && (
                  <ReferenceLine x={coverageLabel} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4"
                    label={{ value: 'coverage change', position: 'insideTopRight', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
                )}
                <ReferenceLine y={0} stroke="var(--mantine-color-default-border)" />
                <Bar dataKey="joined" name="Joined" fill="var(--mantine-color-pos-6)" />
                <Bar dataKey="departed" name="Left" fill="var(--mantine-color-red-6)" />
                <Line type="monotone" dataKey="net" name="Net change" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
            <ChartData caption="Workforce turnover" columns={['As of', 'Joined', 'Left', 'Net']} rows={turnover.map((x) => [x.label, x.joined, x.departed, x.net])} />
            <Text size="xs" c="dimmed">
              Paid employees who joined vs left between each snapshot and the one before it; the accent line is the
              net change. Counts paid staff only (unpaid $0 affiliates excluded); the duplicate Pre-TTC snapshot is
              omitted. The dashed marker flags the snapshot with the most churn — usually a source-coverage change,
              not a real hiring/exit wave.
            </Text>
          </>
        )}
      </Card>
    </Stack>
  );
}
