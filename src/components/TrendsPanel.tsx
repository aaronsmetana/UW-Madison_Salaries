import { Card, Text, Loader } from '@mantine/core';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, scopeWhere } from '../lib/queries';
import { usd } from '../lib/format';

interface Row { label: string; date: string; med: number | null; hc: number }

export function TrendsPanel() {
  const { scope, metric } = useControls();
  const expr = salaryExpr(metric);
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric],
    `SELECT any_value(snapshot_label) label, any_value(snapshot_date) date,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, count(DISTINCT person_key) hc
     FROM salaries WHERE ${scopeWhere(scope)} GROUP BY snapshot_id ORDER BY date`
  );

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <Text size="sm" fw={600} mb="md">Median salary &amp; headcount over time</Text>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data ?? []} margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis yAxisId="med" tickFormatter={(v) => usd(v)} width={84} tick={{ fontSize: 12 }} />
          <YAxis yAxisId="hc" orientation="right" width={56} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number, key) => (key === 'med' ? usd(v) : v)} />
          <Legend />
          <Line yAxisId="med" type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-indigo-6)" strokeWidth={2} dot />
          <Line yAxisId="hc" type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-teal-6)" strokeWidth={2} dot strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
