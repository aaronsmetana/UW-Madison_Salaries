import { Card, Text, Loader } from '@mantine/core';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, paidHeadcount, whereAll, filterKey } from '../lib/queries';
import { usd } from '../lib/format';
import { ChartData } from './ChartData';

interface Row { label: string; date: string; med: number | null; hc: number }

export function TrendsPanel() {
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `SELECT any_value(snapshot_label) AS "label", any_value(snapshot_date) date,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, ${paidHeadcount(metric)} hc
     FROM salaries WHERE ${whereAll(scope, filters)} GROUP BY snapshot_id ORDER BY date`
  );

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <Text size="sm" fw={600} mb="md">Median salary &amp; headcount over time</Text>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data ?? []} margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis yAxisId="med" tickFormatter={(v) => usd(v)} width={92} tick={{ fontSize: 12 }}
            label={{ value: 'Median salary', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-indigo-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <YAxis yAxisId="hc" orientation="right" width={72} tick={{ fontSize: 12 }}
            label={{ value: 'Headcount', angle: 90, position: 'insideRight', style: { fill: 'var(--mantine-color-teal-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip formatter={(v: number, key) => (key === 'med' ? usd(v) : v)} />
          <Legend />
          <Line yAxisId="med" type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-indigo-6)" strokeWidth={2} dot />
          <Line yAxisId="hc" type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-teal-6)" strokeWidth={2} dot strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>Headcount = people with a paid appointment; unpaid $0 affiliate appointments are excluded.</Text>
      <ChartData caption="Median salary & headcount over time" columns={['Snapshot', 'Median', 'Headcount']} rows={(data ?? []).map((d) => [d.label, d.med, d.hc])} />
    </Card>
  );
}
