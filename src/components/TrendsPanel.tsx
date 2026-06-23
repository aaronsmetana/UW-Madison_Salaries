import { Card, Text, Loader } from '@mantine/core';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, paidHeadcount, whereAll, filterKey } from '../lib/queries';
import { usd, num } from '../lib/format';
import { ChartData } from './ChartData';

interface Row { label: string; date: string; med: number | null; hc: number; renew: number | null }

export function TrendsPanel() {
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    // `renew` = paid employees on a renewable ("Regular") appointment — excludes Terminal and Temporary.
    // Appointment type is only recorded from the Sep 2025 dump on, so it's NULL (not 0) for older
    // snapshots, leaving those points off the line instead of plotting a misleading zero.
    `SELECT any_value(snapshot_label) AS "label", any_value(snapshot_date) date,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, ${paidHeadcount(metric)} hc,
        CASE WHEN count(*) FILTER (WHERE employee_type IS NOT NULL) = 0 THEN NULL
             ELSE count(DISTINCT person_key) FILTER (WHERE ${expr} > 0 AND employee_type = 'Regular') END AS renew
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
          <YAxis yAxisId="med" tickFormatter={(v) => usd(v)} width={92} tick={{ fontSize: 12 }} padding={{ top: 6, bottom: 6 }}
            label={{ value: 'Median salary', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-accent-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <YAxis yAxisId="hc" orientation="right" width={72} tick={{ fontSize: 12 }} padding={{ top: 6, bottom: 6 }}
            label={{ value: 'Headcount', angle: 90, position: 'insideRight', style: { fill: 'var(--mantine-color-pos-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip formatter={(v: number, key) => (key === 'med' ? usd(v) : num(v))} />
          <Legend />
          <Line yAxisId="med" type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot />
          <Line yAxisId="hc" type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-pos-6)" strokeWidth={2} dot strokeDasharray="4 2" />
          <Line yAxisId="hc" type="monotone" dataKey="renew" name="Renewable (non-terminal)" stroke="var(--mantine-color-orange-6)" strokeWidth={2} dot connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        Headcount = people with a paid appointment; unpaid $0 affiliate appointments are excluded.
        Renewable = ongoing (&ldquo;Regular&rdquo;) appointments — excludes terminal and temporary ones;
        appointment type is only recorded from Sep 2025 on, so that line starts there.
      </Text>
      <ChartData caption="Median salary, headcount & renewable staff over time" columns={['Snapshot', 'Median', 'Headcount', 'Renewable']} rows={(data ?? []).map((d) => [d.label, d.med, d.hc, d.renew])} />
    </Card>
  );
}
