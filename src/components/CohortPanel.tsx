import { Card, Text, Loader, Paper } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { whereAll, filterKey } from '../lib/queries';
import { num } from '../lib/format';
import { ChartData } from './ChartData';

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

export function CohortPanel() {
  const { scope, filters } = useControls();
  const { data: summary } = useSummary();
  const latest = summary?.snapshots[summary.snapshots.length - 1];
  const where = whereAll(scope, filters);

  const { data, isFetching } = useSql<{ hire_year: number; total: number; still_here: number }>(
    ['cohort', scope.kind, scope.kind === 'school' ? scope.value : '', latest?.id ?? '', filterKey(filters)],
    `WITH latest AS (SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(latest?.id ?? '')} AND ${where})
     SELECT s.hire_year hire_year, count(DISTINCT s.person_key) total,
        count(DISTINCT s.person_key) FILTER (WHERE l.person_key IS NOT NULL) still_here
     FROM salaries s LEFT JOIN latest l ON s.person_key = l.person_key
     WHERE s.hire_year IS NOT NULL AND s.hire_year BETWEEN 1990 AND 2026 AND ${where}
     GROUP BY s.hire_year ORDER BY s.hire_year`,
    !!latest
  );

  const chart = (data ?? []).map((r) => ({
    year: String(r.hire_year),
    retention: r.total ? Math.round((100 * r.still_here) / r.total) : 0,
    stayed: r.still_here,
    left: r.total - r.still_here,
    total: r.total,
  }));

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <Text size="sm" fw={600} mb="md">Cohort retention by hire year</Text>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chart} margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={2} />
          <YAxis width={48} tick={{ fontSize: 12 }} unit="%" domain={[0, 100]} />
          <Tooltip content={<RetentionTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
          <Bar dataKey="retention" name="Retention" fill="var(--mantine-color-teal-6)" />
        </BarChart>
      </ResponsiveContainer>
      <ChartData caption="Cohort retention by hire year" columns={['Hire year', 'Retention %']} rows={chart.map((c) => [c.year, c.retention])} />
      <Text size="xs" c="dimmed">
        Of people with each hire year seen in the data, the share still present in the latest snapshot
        ({latest?.label}). Snapshots begin in 2021, so earlier cohorts reflect survivors already employed by then.
      </Text>
    </Card>
  );
}
