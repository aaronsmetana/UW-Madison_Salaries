import { useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  Stack, Title, Text, Group, Button, Card, SimpleGrid, Table, Anchor, Loader, Alert, SegmentedControl, Tabs,
} from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter,
} from 'recharts';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, earningsExpr, personPay, paidHeadcount, filterWhere, filterKey } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, fullName } from '../lib/format';
import { ChartData } from '../components/ChartData';

interface TenureRow { person_key: string; fn: string | null; ln: string | null; tenure: number; pay: number }

/** Tenure-vs-pay hover card: who the dot is, their pay and tenure, and a click hint. */
function TenureTip({ active, payload }: { active?: boolean; payload?: { payload: TenureRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: '6px 10px' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{fullName(d.fn, d.ln) || '—'}</div>
      <div style={{ fontSize: 12 }}>Pay: {usd(d.pay)}</div>
      <div style={{ fontSize: 12 }}>Tenure: {d.tenure.toFixed(1)} years</div>
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Click to view profile</div>
    </div>
  );
}

interface Score {
  headcount: number; total_payroll: number | null; med: number | null; mean: number | null;
  p25: number | null; p75: number | null; p90: number | null; lo: number | null; hi: number | null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600}>{value}</Text>
    </Card>
  );
}

export default function School() {
  const { id } = useParams();
  const name = decodeURIComponent(id ?? '');
  const snap = useActiveSnapshotId();
  const { metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const { add, has } = useTray();
  const nav = useNavigate();
  const [distScale, setDistScale] = useState<'linear' | 'log'>('linear');
  const enabled = !!snap;
  const fk = filterKey(filters);
  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND school = ${sqlStr(name)} AND ${filterWhere(filters)}`;

  const { data: scoreRows, isLoading } = useSql<Score>(
    ['school-score', name, snap ?? '', metric, fk],
    `SELECT ${paidHeadcount(metric)} headcount,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) total_payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        avg(${expr}) FILTER (WHERE ${expr} > 0) mean,
        quantile_cont(${expr}, 0.25) FILTER (WHERE ${expr} > 0) p25,
        quantile_cont(${expr}, 0.75) FILTER (WHERE ${expr} > 0) p75,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90,
        min(${expr}) FILTER (WHERE ${expr} > 0) lo,
        max(${expr}) FILTER (WHERE ${expr} > 0) hi
     FROM salaries WHERE ${base}`,
    enabled
  );
  const s = scoreRows?.[0];

  const { data: dist } = useSql<{ bucket: number; n: number }>(
    ['school-dist', name, snap ?? '', metric, fk],
    `SELECT (floor(${expr} / 20000) * 20000)::BIGINT bucket, count(*) n
     FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY 1 ORDER BY 1`,
    enabled
  );
  const distData = useMemo(
    () => (dist ?? []).map((d) => ({ label: `${Math.round(d.bucket / 1000)}k`, n: d.n })),
    [dist]
  );

  const { data: comp } = useSql<{ cat: string; n: number }>(
    ['school-comp', name, snap ?? '', metric, fk],
    `SELECT COALESCE(employee_category, '—') cat, ${paidHeadcount(metric)} n
     FROM salaries WHERE ${base} GROUP BY 1 ORDER BY 2 DESC`,
    enabled
  );

  const { data: earners } = useSql<{ person_key: string; fn: string; ln: string; title: string | null; pay: number }>(
    ['school-earners', name, snap ?? '', metric, fk],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(title) title, ${personPay(metric)} pay
     FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY person_key ORDER BY pay DESC LIMIT 12`,
    enabled
  );

  const { data: trend } = useSql<{ label: string; date: string; med: number | null; hc: number }>(
    ['school-trend', name, metric, fk],
    `SELECT any_value(snapshot_label) AS "label", any_value(snapshot_date) date,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, ${paidHeadcount(metric)} hc
     FROM salaries WHERE school = ${sqlStr(name)} AND ${filterWhere(filters)} GROUP BY snapshot_id ORDER BY date`,
    !!name
  );

  const { data: bandRows } = useSql<{ banded: number; avg_pos: number | null; over_max: number; below_min: number }>(
    ['school-band', name, snap ?? '', metric, fk],
    `SELECT count(*) FILTER (WHERE g."grade" IS NOT NULL) banded,
        avg((p.pay - g."min") / NULLIF(g."max" - g."min", 0)) FILTER (WHERE g."grade" IS NOT NULL AND p.pay BETWEEN g."min" AND g."max") avg_pos,
        count(*) FILTER (WHERE g."grade" IS NOT NULL AND p.pay > g."max") over_max,
        count(*) FILTER (WHERE g."grade" IS NOT NULL AND p.pay < g."min") below_min
     FROM (SELECT person_key, grade_number, grade_basis, ${personPay('full')} pay
           FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY 1, 2, 3) p
     LEFT JOIN grades g ON g."grade" = p.grade_number AND g."basis" = p.grade_basis`,
    enabled
  );
  const band = bandRows?.[0];

  const { data: tenurePay } = useSql<TenureRow>(
    ['school-tenure', name, snap ?? '', metric, fk],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure,
        ${personPay(metric)} pay
     FROM salaries WHERE ${base} AND ${expr} > 0 AND date_of_hire IS NOT NULL GROUP BY person_key LIMIT 3000`,
    enabled
  );

  if (isLoading) return <Loader />;
  if (s && s.headcount === 0) return <Alert color="gray">No records for {name} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Title order={2}>{name}</Title>
        <Button
          variant={has(name) ? 'light' : 'filled'}
          disabled={has(name)}
          onClick={() => add({ type: 'school', id: name, label: name })}
        >
          {has(name) ? 'In tray' : '+ Add to tray'}
        </Button>
      </Group>

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="dist">Trends &amp; distribution</Tabs.Tab>
          <Tabs.Tab value="people">People</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Headcount" value={num(s?.headcount)} />
        <Stat label="Median" value={usd(s?.med)} />
        <Stat label="Mean" value={usd(s?.mean)} />
        <Stat label="Total payroll" value={usd(s?.total_payroll)} />
        <Stat label="25th pctile" value={usd(s?.p25)} />
        <Stat label="75th pctile" value={usd(s?.p75)} />
        <Stat label="90th pctile" value={usd(s?.p90)} />
        <Stat label="Range" value={`${usd(s?.lo)} – ${usd(s?.hi)}`} />
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Pay-band utilization</Text>
        {band && band.banded > 0 ? (
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Avg band position" value={band.avg_pos == null ? '—' : `${Math.round(band.avg_pos * 100)}%`} />
            <Stat label="People with a grade range" value={num(band.banded)} />
            <Stat label="Over max" value={num(band.over_max)} />
            <Stat label="Below min" value={num(band.below_min)} />
          </SimpleGrid>
        ) : (
          <Text size="sm" c="dimmed">
            No matching pay-band ranges yet — add grades to <code>data/reference/salary-grades.csv</code> to
            enable this (currently only grades 15 &amp; 27 are seeded).
          </Text>
        )}
      </Card>
        </Tabs.Panel>

        <Tabs.Panel value="dist" pt="md">
          <Stack gap="lg">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Tenure vs pay (compression check)</Text>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" dataKey="tenure" name="Tenure" unit=" yrs" tick={{ fontSize: 12 }} />
            <YAxis type="number" dataKey="pay" tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
            <Tooltip content={<TenureTip />} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter
              data={tenurePay ?? []}
              fill="var(--bar)"
              fillOpacity={0.5}
              cursor="pointer"
              onClick={(pt: { person_key?: string; payload?: { person_key?: string } }) => {
                const k = pt?.person_key ?? pt?.payload?.person_key;
                if (k) nav(`/person/${encodeURIComponent(k)}`);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
        <ChartData caption="Tenure vs pay" columns={['Tenure (yrs)', 'Pay']} rows={(tenurePay ?? []).map((t) => [t.tenure, t.pay])} />
        <Text size="xs" c="dimmed">
          A flat or downward cloud suggests salary compression (newer hires paid like — or above — veterans).
        </Text>
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Median salary over time</Text>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend ?? []} margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => usd(v)} />
            <Line type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
        <ChartData caption="Median salary over time" columns={['Snapshot', 'Median', 'Headcount']} rows={(trend ?? []).map((t) => [t.label, t.med, t.hc])} />
      </Card>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600}>Salary distribution (current snapshot, $20k bins)</Text>
          <SegmentedControl
            size="xs"
            value={distScale}
            onChange={(v) => setDistScale(v as 'linear' | 'log')}
            data={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }]}
          />
        </Group>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={distData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              width={48}
              tick={{ fontSize: 12 }}
              scale={distScale === 'log' ? 'log' : 'auto'}
              domain={distScale === 'log' ? [0.5, 'auto'] : undefined}
              allowDataOverflow={distScale === 'log'}
            />
            <Tooltip formatter={(v: number) => [num(v), 'People']} />
            <Bar dataKey="n" name="People" fill="var(--bar)" />
          </BarChart>
        </ResponsiveContainer>
        <ChartData caption="Salary distribution" columns={['Salary bin', 'People']} rows={distData.map((d) => [d.label, d.n])} />
      </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="people" pt="md">
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Composition by category</Text>
          <Table>
            <Table.Tbody>
              {(comp ?? []).map((c) => (
                <Table.Tr key={c.cat}>
                  <Table.Td>{c.cat}</Table.Td>
                  <Table.Td ta="right">{num(c.n)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Top earners</Text>
          <Table>
            <Table.Tbody>
              {(earners ?? []).map((e) => (
                <Table.Tr key={e.person_key}>
                  <Table.Td>
                    <Anchor component={Link} to={`/person/${encodeURIComponent(e.person_key)}`}>
                      {fullName(e.fn, e.ln)}
                    </Anchor>
                    <Text size="xs" c="dimmed">{e.title}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{usd(e.pay)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </SimpleGrid>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
