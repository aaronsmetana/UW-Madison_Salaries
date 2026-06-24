import { Stack, Card, Text, Loader, Paper } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { AXIS_TICK, GRID } from '../lib/chartStyle';
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
  const scopeVal = scope.kind === 'school' ? scope.value : '';

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

  const chart = (data ?? []).map((r) => {
    const retention = r.total ? Math.round((100 * r.still_here) / r.total) : 0;
    return { year: String(r.hire_year), retention, lost: 100 - retention, stayed: r.still_here, left: r.total - r.still_here, total: r.total };
  });
  const turnover = (flow ?? []).map((r) => ({ label: r.lbl, joined: r.joined, departed: r.departed }));

  if (isFetching && !data) return <Loader />;

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Retention by hire year (share still here)</Text>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="year" tick={AXIS_TICK} interval={2} />
            <YAxis width={48} tick={AXIS_TICK} unit="%" domain={[0, 100]} />
            <Tooltip content={<RetentionTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Legend />
            <Bar dataKey="retention" name="Retained" stackId="r" fill="var(--mantine-color-pos-6)" />
            <Bar dataKey="lost" name="Left" stackId="r" fill="var(--mantine-color-gray-4)" />
          </BarChart>
        </ResponsiveContainer>
        <ChartData caption="Retention by hire year" columns={['Hire year', 'Retained %', 'Left %']} rows={chart.map((c) => [c.year, c.retention, c.lost])} />
        <Text size="xs" c="dimmed">
          Each bar is one hire-year cohort: green = share still present in the latest snapshot ({latest?.label}),
          grey = share since gone. Snapshots begin in 2021, so earlier cohorts reflect survivors already employed by then.
        </Text>
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Workforce turnover — paid staff joining vs leaving</Text>
        {flowFetching && !flow ? (
          <Loader />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={turnover} margin={{ left: 12, right: 12 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis width={56} tick={AXIS_TICK} />
                <Tooltip formatter={(v: number, key) => [num(v), key === 'joined' ? 'Joined' : 'Left']} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
                <Legend />
                <Bar dataKey="joined" name="Joined" fill="var(--mantine-color-pos-6)" />
                <Bar dataKey="departed" name="Left" fill="var(--mantine-color-red-6)" />
              </BarChart>
            </ResponsiveContainer>
            <ChartData caption="Workforce turnover" columns={['As of', 'Joined', 'Left']} rows={turnover.map((t) => [t.label, t.joined, t.departed])} />
            <Text size="xs" c="dimmed">
              Paid employees who joined vs left between each snapshot and the one before it. Counts paid staff only
              (unpaid $0 affiliates excluded); the duplicate Pre-TTC snapshot is omitted.
            </Text>
          </>
        )}
      </Card>
    </Stack>
  );
}
