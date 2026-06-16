import { useMemo, useState } from 'react';
import { Stack, Title, Text, Card, Table, Loader, SegmentedControl, Group } from '@mantine/core';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ScatterChart, Scatter,
} from 'recharts';
import { useTray } from '../state/tray';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr } from '../lib/queries';
import { usd, num, pct } from '../lib/format';
import { ChartData } from '../components/ChartData';

const PALETTE = [
  'var(--mantine-color-indigo-6)', 'var(--mantine-color-teal-6)', 'var(--mantine-color-orange-6)',
  'var(--mantine-color-grape-6)', 'var(--mantine-color-cyan-7)', 'var(--mantine-color-red-6)',
  'var(--mantine-color-lime-7)', 'var(--mantine-color-pink-6)',
];

interface PRow { person_key: string; label: string; date: string; pay: number; tenure: number | null }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }

export default function Compare() {
  const { items } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const [xMode, setXMode] = useState<'date' | 'tenure'>('date');

  const persons = items.filter((i) => i.type === 'person');
  const schools = items.filter((i) => i.type === 'school');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');

  const { data: pdata, isFetching: pLoading } = useSql<PRow>(
    ['cmp-people', personIds, metric],
    `SELECT person_key, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, sum(${expr}) pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
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

  const { data: standingData } = useSql<{ person_key: string; label: string; date: string; pctile: number }>(
    ['cmp-standing', personIds, metric],
    `WITH pop AS (SELECT snapshot_id, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, school, person_key, sum(${expr}) pay
                  FROM salaries WHERE ${expr} > 0 GROUP BY snapshot_id, school, person_key),
          ranked AS (SELECT *, percent_rank() OVER (PARTITION BY snapshot_id, school ORDER BY pay) pr FROM pop)
     SELECT person_key, label, date, round(pr * 100) pctile FROM ranked WHERE person_key IN (${personIds}) ORDER BY date`,
    persons.length > 0
  );

  const labelMap = useMemo(() => new Map(persons.map((p) => [p.id, p.label])), [persons]);

  const standingSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of standingData ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pctile;
      byLabel.set(r.label, row);
    }
    return [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [standingData]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { label: string; date: string; pay: number; tenure: number | null }[]>();
    for (const r of pdata ?? []) {
      const arr = m.get(r.person_key) ?? [];
      arr.push({ label: r.label, date: r.date, pay: r.pay, tenure: r.tenure });
      m.set(r.person_key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return m;
  }, [pdata]);

  const { series, latest } = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    const latestByPerson = new Map<string, number>();
    for (const r of pdata ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pay;
      byLabel.set(r.label, row);
      latestByPerson.set(r.person_key, r.pay);
    }
    const series = [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { series, latest: latestByPerson };
  }, [pdata]);

  // gap to the top earner in the group, per snapshot
  const gapSeries = useMemo(
    () =>
      series.map((row) => {
        const o: Record<string, string | number> = { label: row.label as string };
        const vals = persons.map((p) => row[p.id]).filter((v): v is number => typeof v === 'number');
        const max = vals.length ? Math.max(...vals) : null;
        if (max != null) persons.forEach((p) => { const v = row[p.id]; if (typeof v === 'number') o[p.id] = v - max; });
        return o;
      }),
    [series, persons]
  );

  const cadence = useMemo(
    () =>
      persons.map((p) => {
        const arr = (perPerson.get(p.id) ?? []).filter((x) => x.pay > 0);
        let raises = 0;
        let sumPct = 0;
        let streak = 0;
        let longest = 0;
        for (let i = 1; i < arr.length; i++) {
          const delta = arr[i].pay - arr[i - 1].pay;
          if (delta > 0) {
            raises++;
            sumPct += delta / arr[i - 1].pay;
            streak = 0;
          } else {
            streak++;
            longest = Math.max(longest, streak);
          }
        }
        return { id: p.id, label: p.label, raises, avgPct: raises ? sumPct / raises : null, longest, periods: Math.max(0, arr.length - 1) };
      }),
    [perPerson, persons]
  );

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
          <Group justify="space-between" mb="md">
            <Text size="sm" fw={600}>People — salary trajectory</Text>
            <SegmentedControl
              size="xs"
              value={xMode}
              onChange={(v) => setXMode(v as 'date' | 'tenure')}
              data={[{ value: 'date', label: 'By date' }, { value: 'tenure', label: 'By tenure' }]}
            />
          </Group>
          {pLoading ? (
            <Loader />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                {xMode === 'date' ? (
                  <LineChart data={series} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number, key) => [usd(v), labelMap.get(String(key)) ?? key]} />
                    <Legend formatter={(key) => labelMap.get(String(key)) ?? key} />
                    {persons.map((p, i) => (
                      <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
                    ))}
                  </LineChart>
                ) : (
                  <ScatterChart margin={{ left: 12, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" dataKey="tenure" name="Tenure" unit="y" tick={{ fontSize: 12 }} />
                    <YAxis type="number" dataKey="pay" tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number, k) => (k === 'pay' ? usd(v) : `${Number(v).toFixed(1)} yrs`)} />
                    <Legend />
                    {persons.map((p, i) => (
                      <Scatter
                        key={p.id}
                        name={p.label}
                        data={(perPerson.get(p.id) ?? []).filter((x) => x.tenure != null && x.pay > 0).map((x) => ({ tenure: x.tenure, pay: x.pay }))}
                        line
                        fill={PALETTE[i % PALETTE.length]}
                      />
                    ))}
                  </ScatterChart>
                )}
              </ResponsiveContainer>
              <ChartData
                caption="Salary by snapshot"
                columns={['Snapshot', ...persons.map((p) => p.label)]}
                rows={series.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
              />
              <Text size="xs" c="dimmed" mt={4}>
                {xMode === 'tenure' ? 'Aligned by years since hire — compares people at the same career stage.' : 'By calendar snapshot.'}
              </Text>
            </>
          )}
        </Card>
      )}

      {persons.length > 1 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Pay gap to the top earner in this group</Text>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={gapSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number, key) => [usd(v), labelMap.get(String(key)) ?? key]} />
              <Legend formatter={(key) => labelMap.get(String(key)) ?? key} />
              {persons.map((p, i) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Text size="xs" c="dimmed">0 = highest-paid in the group at that snapshot; below 0 = behind by that amount.</Text>
        </Card>
      )}

      {persons.length > 0 && standingSeries.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Relative standing within school (percentile over time)</Text>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={standingSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} width={48} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v: number, key) => [`${v}th pctile`, labelMap.get(String(key)) ?? key]} />
              <Legend formatter={(key) => labelMap.get(String(key)) ?? key} />
              {persons.map((p, i) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Text size="xs" c="dimmed">Each person's percentile among peers in their own school at that snapshot.</Text>
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Raise cadence &amp; stagnation</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th ta="right">Latest</Table.Th>
                <Table.Th ta="right">Raises</Table.Th>
                <Table.Th ta="right">Avg raise</Table.Th>
                <Table.Th ta="right">Longest no-raise streak</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cadence.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.label}</Table.Td>
                  <Table.Td ta="right">{usd(latest.get(c.id) ?? null)}</Table.Td>
                  <Table.Td ta="right">{c.raises} / {c.periods}</Table.Td>
                  <Table.Td ta="right">{c.avgPct == null ? '—' : pct(c.avgPct)}</Table.Td>
                  <Table.Td ta="right">{c.longest} {c.longest === 1 ? 'period' : 'periods'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
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
