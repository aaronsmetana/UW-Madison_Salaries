import { useEffect, useState, useMemo } from 'react';
import {
  Stack, Text, SimpleGrid, Group, Alert, Loader, Tabs, Table, Button, Anchor, ScrollArea, TextInput,
} from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { TrendsPanel } from '../components/TrendsPanel';
import { ChangesPanel } from '../components/ChangesPanel';
import { CohortPanel } from '../components/CohortPanel';
import { useSummary, useManifest, useSql, useActiveSnapshotId, useReferenceStatus } from '../lib/hooks';
import { getDB } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, earningsExpr, personPay, paidHeadcount, snapWhere, whereAll, filterKey } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, fullName } from '../lib/format';
import { ControlBar } from '../app/ControlBar';

function Kpi({ label, value, to }: { label: string; value: string; to?: string }) {
  return <StatCard size="md" label={label} value={value} to={to} />;
}

interface Kpis { headcount: number; all_people: number; total_payroll: number | null; med: number | null }
interface SchoolRow { school: string; headcount: number; med: number | null }
interface EarnerRow { person_key: string; fn: string; ln: string; title: string | null; school: string | null; pay: number }

export default function Explore() {
  const { data: summary, isLoading } = useSummary();
  const { data: manifest } = useManifest();
  const { data: refStatus } = useReferenceStatus();
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { add } = useTray();

  useEffect(() => {
    getDB().catch(() => {});
  }, []);

  // Active tab lives in the URL (?tab=…) so "Copy link" restores the exact view; "schools" is the
  // implicit default and stays out of the query string.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'schools';
  const setTab = (v: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!v || v === 'schools') n.delete('tab');
        else n.set('tab', v);
        return n;
      },
      { replace: true }
    );

  const enabled = !!snap;
  const fk = filterKey(filters);
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const { data: kpis } = useSql<Kpis>(
    ['kpis', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT ${paidHeadcount(metric)} headcount, count(DISTINCT person_key) all_people,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) total_payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${where}`,
    enabled
  );
  const k = kpis?.[0];

  const { data: schools } = useSql<SchoolRow>(
    ['browse-schools', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT school, ${paidHeadcount(metric)} headcount,
        median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${where} AND school IS NOT NULL
     GROUP BY school ORDER BY headcount DESC`,
    enabled
  );

  const { data: earners } = useSql<EarnerRow>(
    ['top-earners', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(title) title, any_value(school) school, ${personPay(metric)} pay
     FROM salaries WHERE ${where} AND ${expr} > 0
     GROUP BY person_key ORDER BY pay DESC LIMIT 100`,
    enabled
  );

  const { data: titles } = useSql<{ job_code: string; title: string; n: number; med: number | null; lo: number | null; hi: number | null }>(
    ['browse-titles', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        min(${expr}) FILTER (WHERE ${expr} > 0) lo, max(${expr}) FILTER (WHERE ${expr} > 0) hi
     FROM salaries WHERE ${where} AND job_code IS NOT NULL GROUP BY job_code ORDER BY n DESC`,
    enabled
  );

  // Titles tab: client-side search + sort over all titles.
  const [titleQ, setTitleQ] = useState('');
  const [titleSort, setTitleSort] = useState<{ key: 'title' | 'job_code' | 'n' | 'med'; dir: 'asc' | 'desc' }>({ key: 'n', dir: 'desc' });
  const titleView = useMemo(() => {
    const q = titleQ.trim().toLowerCase();
    let rows = titles ?? [];
    if (q) rows = rows.filter((t) => t.title.toLowerCase().includes(q) || t.job_code.toLowerCase().includes(q));
    const { key, dir } = titleSort;
    const sorted = [...rows].sort((a, b) => {
      const cmp = key === 'title' || key === 'job_code'
        ? String(a[key]).localeCompare(String(b[key]))
        : (Number(a[key] ?? 0) - Number(b[key] ?? 0));
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [titles, titleQ, titleSort]);
  const sortTh = (key: 'title' | 'job_code' | 'n' | 'med', label: string, align?: 'right') => (
    <Table.Th
      ta={align}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => setTitleSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      {label}{titleSort.key === key ? (titleSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </Table.Th>
  );

  const flagged = manifest?.snapshots.filter((s) => s.status === 'warning' || s.status === 'error') ?? [];

  return (
    <Stack gap="lg">
      <PageHeader
        title="General Comparisons"
        description="Browse divisions and schools side by side — headcount, median pay, and top earners — then add any school or title (＋ Compare) to line them up on the Compare page. Or jump straight to a person."
      />

      <ControlBar inline />

      <SearchBox />

      {refStatus && refStatus.status !== 'ok' && (
        <Alert color={refStatus.status === 'missing' ? 'gray' : 'orange'} title="Pay-band reference">
          {refStatus.status === 'missing'
            ? 'No pay-band grade ranges are loaded — paste them into data/reference/salary-grades.csv to enable pay-band views.'
            : `Pay-band ranges are from ${refStatus.max_effective_year}, but the latest data is ${refStatus.latest_snapshot_year} — ranges may be out of date. Refresh data/reference/salary-grades.csv from the Salary Structure page.`}
        </Alert>
      )}

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
        <div>
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <Kpi label="Headcount" value={num(k?.headcount)} />
            <Kpi label="Median salary" value={usd(k?.med)} />
            <Kpi label="Total payroll" value={usd(k?.total_payroll)} />
            <Kpi label="Snapshots" value={num(summary?.snapshot_count)} to="/data" />
          </SimpleGrid>
          {k && k.all_people > k.headcount && (
            <Text size="xs" c="dimmed" mt="xs">
              Headcount counts paid employees; {num(k.all_people - k.headcount)} unpaid $0 affiliate appointments excluded.
            </Text>
          )}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="schools">Schools</Tabs.Tab>
          <Tabs.Tab value="earners">Top earners</Tabs.Tab>
          <Tabs.Tab value="titles">Titles</Tabs.Tab>
          <Tabs.Tab value="trends">Trends</Tabs.Tab>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="cohorts">Retention</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="schools" pt="md">
          <Table>
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
                    <Anchor component={Link} to={`/school/${encodeURIComponent(s.school)}`} c="var(--mantine-color-text)" underline="hover" fw={500}>
                      {s.school}
                    </Anchor>
                  </Table.Td>
                  <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                  <Table.Td ta="right">{usd(s.med)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-xs" variant="light" radius="xl" leftSection={<IconPlus size={12} />} onClick={() => add({ type: 'school', id: s.school, label: s.school })}>
                      Compare
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="earners" pt="md">
          <Text size="xs" c="dimmed" mb="xs">Top {num((earners ?? []).length)} by pay in this scope.</Text>
          <ScrollArea.Autosize mah={560} type="auto" offsetScrollbars="present">
            <Table stickyHeader miw={620}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={48} ta="right">#</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">Pay</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(earners ?? []).map((e, i) => (
                  <Table.Tr key={e.person_key}>
                    <Table.Td ta="right" c="dimmed">{i + 1}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/person/${encodeURIComponent(e.person_key)}`}>
                        {fullName(e.fn, e.ln)}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{e.title ?? '—'}</Table.Td>
                    <Table.Td>{e.school ?? '—'}</Table.Td>
                    <Table.Td ta="right">{usd(e.pay)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Tabs.Panel>

        <Tabs.Panel value="titles" pt="md">
          <Group justify="space-between" mb="sm" wrap="nowrap">
            <TextInput
              size="md"
              w={360}
              placeholder="Search titles or job codes…"
              leftSection={<IconSearch size={16} />}
              value={titleQ}
              onChange={(e) => setTitleQ(e.currentTarget.value)}
            />
            <Text size="xs" c="dimmed">{num(titleView.length)} of {num((titles ?? []).length)} titles</Text>
          </Group>
          <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present">
            <Table stickyHeader miw={720}>
              <Table.Thead>
                <Table.Tr>
                  {sortTh('title', 'Title')}
                  {sortTh('job_code', 'Job code')}
                  {sortTh('n', 'People', 'right')}
                  {sortTh('med', 'Median', 'right')}
                  <Table.Th ta="right">Range</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {titleView.map((t) => (
                  <Table.Tr key={t.job_code}>
                    <Table.Td>
                      <Anchor component={Link} to={`/paycheck?code=${encodeURIComponent(t.job_code)}`}>{t.title}</Anchor>
                    </Table.Td>
                    <Table.Td>{t.job_code}</Table.Td>
                    <Table.Td ta="right">{num(t.n)}</Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right" c="dimmed">{t.lo != null && t.hi != null ? `${usd(t.lo)}–${usd(t.hi)}` : '—'}</Table.Td>
                    <Table.Td ta="right">
                      <Button size="compact-xs" variant="light" radius="xl" leftSection={<IconPlus size={12} />} onClick={() => add({ type: 'title', id: t.job_code, label: t.title })}>
                        Compare
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
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
      </Tabs>
    </Stack>
  );
}
