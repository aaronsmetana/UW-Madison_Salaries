import { useEffect, useState } from 'react';
import {
  Stack, Title, Text, Group, Button, Select, SegmentedControl, Card, Table, SimpleGrid, Divider,
} from '@mantine/core';
import { useControls, METRIC_LABEL, scopeLabel } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num } from '../lib/format';
import { downloadCSV } from '../lib/csv';

interface Score {
  headcount: number; total_payroll: number | null; med: number | null; mean: number | null;
  p25: number | null; p75: number | null; p90: number | null;
}
interface Earner { person_key: string; fn: string; ln: string; title: string | null; pay: number }
interface SchoolCard { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface Peep { person_key: string; fn: string; ln: string; title: string | null; latest_pay: number | null }

export default function Reports() {
  const { scope, metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { data: summary } = useSummary();
  const { items } = useTray();
  const snapLabel = summary?.snapshots.find((x) => x.id === snap)?.label ?? snap ?? '—';

  const [type, setType] = useState('school');

  const { data: schoolList } = useSql<{ school: string }>(
    ['rpt-schools', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE school IS NOT NULL AND snapshot_id = ${sqlStr(snap ?? '')} ORDER BY school`,
    !!snap
  );
  const [school, setSchool] = useState<string | null>(null);
  useEffect(() => {
    if (!school) setSchool(scope.kind === 'school' ? scope.value : (schoolList?.[0]?.school ?? null));
  }, [school, scope, schoolList]);

  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND school = ${sqlStr(school ?? '')}`;
  const schoolEnabled = type === 'school' && !!snap && !!school;

  const { data: scoreRows } = useSql<Score>(
    ['rpt-score', school, snap ?? '', metric],
    `SELECT count(DISTINCT person_key) headcount,
        sum(${expr}) FILTER (WHERE ${expr} > 0) total_payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        avg(${expr}) FILTER (WHERE ${expr} > 0) mean,
        quantile_cont(${expr}, 0.25) FILTER (WHERE ${expr} > 0) p25,
        quantile_cont(${expr}, 0.75) FILTER (WHERE ${expr} > 0) p75,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE ${base}`,
    schoolEnabled
  );
  const sc = scoreRows?.[0];

  const { data: earners } = useSql<Earner>(
    ['rpt-earners', school, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(title) title, sum(${expr}) pay
     FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY person_key ORDER BY pay DESC LIMIT 25`,
    schoolEnabled
  );

  // Comparison report (tray)
  const persons = items.filter((i) => i.type === 'person');
  const schools = items.filter((i) => i.type === 'school');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');

  const { data: peeps } = useSql<Peep>(
    ['rpt-peeps', personIds, metric],
    `SELECT person_key, arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln,
        arg_max(title, snapshot_date) title, arg_max(${expr}, snapshot_date) latest_pay
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && persons.length > 0
  );

  const { data: cmpSchools } = useSql<SchoolCard>(
    ['rpt-cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, count(DISTINCT person_key) headcount,
        sum(${expr}) FILTER (WHERE ${expr} > 0) payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames}) GROUP BY school`,
    type === 'comparison' && schools.length > 0 && !!snap
  );

  const generated = new Date().toISOString().slice(0, 10);

  return (
    <Stack gap="lg">
      <Group justify="space-between" className="no-print">
        <Title order={2}>Reports</Title>
        <Group>
          <SegmentedControl
            value={type}
            onChange={setType}
            data={[
              { value: 'school', label: 'School' },
              { value: 'comparison', label: 'Comparison (tray)' },
            ]}
          />
          <Button variant="default" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </Group>
      </Group>

      {type === 'school' && (
        <>
          <Group className="no-print">
            <Select
              label="School"
              data={(schoolList ?? []).map((s) => ({ value: s.school, label: s.school }))}
              value={school}
              onChange={setSchool}
              searchable
              w={360}
            />
            <Button
              variant="light"
              mt={24}
              disabled={!earners?.length}
              onClick={() => downloadCSV(`${school}-top-earners-${snap}.csv`, (earners ?? []) as unknown as Record<string, unknown>[])}
            >
              Download CSV
            </Button>
          </Group>

          <Card withBorder padding="xl" className="print-area">
            <Title order={3}>UW–Madison Salary Report</Title>
            <Text c="dimmed">
              {school} · as of {snapLabel} · {METRIC_LABEL[metric]} · generated {generated}
            </Text>
            <Divider my="md" />
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Stat label="Headcount" value={num(sc?.headcount)} />
              <Stat label="Total payroll" value={usd(sc?.total_payroll)} />
              <Stat label="Median" value={usd(sc?.med)} />
              <Stat label="Mean" value={usd(sc?.mean)} />
              <Stat label="25th pctile" value={usd(sc?.p25)} />
              <Stat label="75th pctile" value={usd(sc?.p75)} />
              <Stat label="90th pctile" value={usd(sc?.p90)} />
            </SimpleGrid>
            <Text size="sm" fw={600} mt="lg" mb="xs">Top earners</Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Title</Table.Th>
                  <Table.Th ta="right">Salary</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(earners ?? []).map((e) => (
                  <Table.Tr key={e.person_key}>
                    <Table.Td>{e.fn} {e.ln}</Table.Td>
                    <Table.Td>{e.title ?? '—'}</Table.Td>
                    <Table.Td ta="right">{usd(e.pay)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Footer />
          </Card>
        </>
      )}

      {type === 'comparison' && (
        <Card withBorder padding="xl" className="print-area">
          <Title order={3}>UW–Madison Salary Comparison</Title>
          <Text c="dimmed">
            {scopeLabel(scope)} · {snapLabel} · {METRIC_LABEL[metric]} · generated {generated}
          </Text>
          <Divider my="md" />
          {items.length === 0 && <Text c="dimmed">Add people or schools to the tray to build a comparison report.</Text>}
          {persons.length > 0 && (
            <>
              <Text size="sm" fw={600} mb="xs">People</Text>
              <Table mb="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Title (latest)</Table.Th>
                    <Table.Th ta="right">Latest salary</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(peeps ?? []).map((p) => (
                    <Table.Tr key={p.person_key}>
                      <Table.Td>{p.fn} {p.ln}</Table.Td>
                      <Table.Td>{p.title ?? '—'}</Table.Td>
                      <Table.Td ta="right">{usd(p.latest_pay)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
          {schools.length > 0 && (
            <>
              <Text size="sm" fw={600} mb="xs">Schools</Text>
              <Table>
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
                  {(cmpSchools ?? []).map((s) => (
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
            </>
          )}
          <Footer />
        </Card>
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

function Footer() {
  return (
    <Text size="xs" c="dimmed" mt="xl">
      Source: UW–Madison salary data (Wisconsin public record). Salaries shown are the full annual rate unless
      the FTE-adjusted or base-pay metric is selected. Zero/unreported salaries are excluded from statistics.
      Person identity is matched on name + date of hire and is best-effort.
    </Text>
  );
}
