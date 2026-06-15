import { useEffect } from 'react';
import {
  Stack, Title, Text, Card, SimpleGrid, Group, Badge, Alert, Loader, Tabs, Table, Button, Anchor,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { SearchBox } from '../components/SearchBox';
import { TrendsPanel } from '../components/TrendsPanel';
import { ChangesPanel } from '../components/ChangesPanel';
import { CohortPanel } from '../components/CohortPanel';
import { useSummary, useManifest, useSql, useActiveSnapshotId } from '../lib/hooks';
import { getDB } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, scopeWhere, snapWhere } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num } from '../lib/format';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="lg">
      <Text size="sm" c="dimmed">{label}</Text>
      <Title order={3}>{value}</Title>
    </Card>
  );
}

interface Kpis { headcount: number; total_payroll: number | null; med: number | null }
interface SchoolRow { school: string; headcount: number; med: number | null }
interface EarnerRow { person_key: string; fn: string; ln: string; title: string | null; school: string | null; pay: number }

export default function Explore() {
  const { data: summary, isLoading } = useSummary();
  const { data: manifest } = useManifest();
  const { scope, metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { add } = useTray();

  useEffect(() => {
    getDB().catch(() => {});
  }, []);

  const enabled = !!snap;
  const where = `${snapWhere(snap ?? '')} AND ${scopeWhere(scope)}`;

  const { data: kpis } = useSql<Kpis>(
    ['kpis', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric],
    `SELECT count(DISTINCT person_key) headcount,
        sum(${expr}) FILTER (WHERE ${expr} > 0) total_payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${where}`,
    enabled
  );
  const k = kpis?.[0];

  const { data: schools } = useSql<SchoolRow>(
    ['browse-schools', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric],
    `SELECT school, count(DISTINCT person_key) headcount,
        median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${where} AND school IS NOT NULL
     GROUP BY school ORDER BY headcount DESC`,
    enabled
  );

  const { data: earners } = useSql<EarnerRow>(
    ['top-earners', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(title) title, any_value(school) school, sum(${expr}) pay
     FROM salaries WHERE ${where} AND ${expr} > 0
     GROUP BY person_key ORDER BY pay DESC LIMIT 15`,
    enabled
  );

  const flagged = manifest?.snapshots.filter((s) => s.status === 'warning' || s.status === 'error') ?? [];

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Explore</Title>
        <Text c="dimmed">Search a person, scan the current scope, or browse schools and top earners.</Text>
      </div>

      <SearchBox />

      {flagged.length > 0 && (
        <Alert color="yellow" title={`${flagged.length} data-health note${flagged.length > 1 ? 's' : ''}`}>
          {flagged.slice(0, 3).map((s) => (
            <Text size="sm" key={s.snapshot_id}>
              <b>{s.snapshot_id}</b>: {s.messages.join('; ')}
            </Text>
          ))}
          <Anchor component={Link} to="/data" size="xs">
            Full report →
          </Anchor>
        </Alert>
      )}

      {isLoading ? (
        <Loader />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 4 }}>
          <Kpi label="Headcount" value={num(k?.headcount)} />
          <Kpi label="Median salary" value={usd(k?.med)} />
          <Kpi label="Total payroll" value={usd(k?.total_payroll)} />
          <Kpi label="Snapshots" value={num(summary?.snapshot_count)} />
        </SimpleGrid>
      )}

      <Tabs defaultValue="schools">
        <Tabs.List>
          <Tabs.Tab value="schools">Schools</Tabs.Tab>
          <Tabs.Tab value="earners">Top earners</Tabs.Tab>
          <Tabs.Tab value="trends">Trends</Tabs.Tab>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="cohorts">Cohorts</Tabs.Tab>
          <Tabs.Tab value="coverage">Coverage</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="schools" pt="md">
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>School / Division</Table.Th>
                <Table.Th ta="right">Headcount</Table.Th>
                <Table.Th ta="right">Median</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(schools ?? []).map((s) => (
                <Table.Tr key={s.school}>
                  <Table.Td>
                    <Anchor component={Link} to={`/school/${encodeURIComponent(s.school)}`}>
                      {s.school}
                    </Anchor>
                  </Table.Td>
                  <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                  <Table.Td ta="right">{usd(s.med)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-xs" variant="subtle" onClick={() => add({ type: 'school', id: s.school, label: s.school })}>
                      + tray
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="earners" pt="md">
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Title</Table.Th>
                <Table.Th>School</Table.Th>
                <Table.Th ta="right">Pay</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(earners ?? []).map((e) => (
                <Table.Tr key={e.person_key}>
                  <Table.Td>
                    <Anchor component={Link} to={`/person/${encodeURIComponent(e.person_key)}`}>
                      {e.fn} {e.ln}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{e.title ?? '—'}</Table.Td>
                  <Table.Td>{e.school ?? '—'}</Table.Td>
                  <Table.Td ta="right">{usd(e.pay)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md">
          <TrendsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="changes" pt="md">
          <ChangesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="cohorts" pt="md">
          <CohortPanel />
        </Tabs.Panel>

        <Tabs.Panel value="coverage" pt="md">
          <Group gap="xs">
            {summary?.snapshots.map((s) => (
              <Badge key={s.id} variant="outline" color="gray">
                {s.label} · {num(s.rows)}
              </Badge>
            ))}
          </Group>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
