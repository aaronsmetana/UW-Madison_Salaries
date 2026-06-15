import { useMemo } from 'react';
import { Stack, Title, Text, Card, Table, Loader } from '@mantine/core';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTray } from '../state/tray';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr } from '../lib/queries';
import { usd, num } from '../lib/format';

const PALETTE = [
  'var(--mantine-color-indigo-6)', 'var(--mantine-color-teal-6)', 'var(--mantine-color-orange-6)',
  'var(--mantine-color-grape-6)', 'var(--mantine-color-cyan-7)', 'var(--mantine-color-red-6)',
  'var(--mantine-color-lime-7)', 'var(--mantine-color-pink-6)',
];

interface PRow { person_key: string; label: string; date: string; pay: number }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }

export default function Compare() {
  const { items } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);

  const persons = items.filter((i) => i.type === 'person');
  const schools = items.filter((i) => i.type === 'school');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');

  const { data: pdata, isFetching: pLoading } = useSql<PRow>(
    ['cmp-people', personIds, metric],
    `SELECT person_key, any_value(snapshot_label) label, any_value(snapshot_date) date, sum(${expr}) pay
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    persons.length > 0
  );

  const { data: sdata, isFetching: sLoading } = useSql<SRow>(
    ['cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, count(DISTINCT person_key) headcount,
        sum(${expr}) FILTER (WHERE ${expr} > 0) payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames}) GROUP BY school`,
    schools.length > 0 && !!snap
  );

  const labelMap = useMemo(() => new Map(persons.map((p) => [p.id, p.label])), [persons]);

  const { series, latest } = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    const latestByPerson = new Map<string, number>();
    for (const r of pdata ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pay;
      byLabel.set(r.label, row);
      latestByPerson.set(r.person_key, r.pay); // rows ordered by date → last wins
    }
    const series = [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { series, latest: latestByPerson };
  }, [pdata]);

  if (items.length === 0) {
    return (
      <Stack>
        <Title order={2}>Compare</Title>
        <Text c="dimmed">Your tray is empty — add people or schools (＋) from Explore or a profile to compare them here.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Compare</Title>

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">People — salary over time</Text>
          {pLoading ? (
            <Loader />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={series} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number, key) => [usd(v), labelMap.get(String(key)) ?? key]} />
                  <Legend formatter={(key) => labelMap.get(String(key)) ?? key} />
                  {persons.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={p.id} name={p.label}
                      stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <Table mt="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Person</Table.Th>
                    <Table.Th ta="right">Latest {metric === 'full' ? '' : metric} salary</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {persons.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>{p.label}</Table.Td>
                      <Table.Td ta="right">{usd(latest.get(p.id) ?? null)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      {schools.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Schools — side-by-side (current snapshot)</Text>
          {sLoading ? (
            <Loader />
          ) : (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">Headcount</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right">90th pctile</Table.Th>
                  <Table.Th ta="right">Total payroll</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sdata ?? []).map((s) => (
                  <Table.Tr key={s.school}>
                    <Table.Td>{s.school}</Table.Td>
                    <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(s.med)}</Table.Td>
                    <Table.Td ta="right">{usd(s.p90)}</Table.Td>
                    <Table.Td ta="right">{usd(s.payroll)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      )}
    </Stack>
  );
}
