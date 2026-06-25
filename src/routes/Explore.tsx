import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  Stack, Text, SimpleGrid, Group, Alert, Loader, Tabs, Table, Button, Anchor, ScrollArea, TextInput, Skeleton,
} from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { SchoolsPanel } from '../components/SchoolsPanel';
import { EarnersPanel } from '../components/EarnersPanel';
import { TrendsPanel } from '../components/TrendsPanel';
import { ChangesPanel } from '../components/ChangesPanel';
import { CohortPanel } from '../components/CohortPanel';
import { useSummary, useManifest, useSql, useActiveSnapshotId, useReferenceStatus } from '../lib/hooks';
import { getDB } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, earningsExpr, paidHeadcount, snapWhere, whereAll, filterKey } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, usdCompact, num, pct } from '../lib/format';
import { useCountUp } from '../lib/motion';
import { ControlBar } from '../app/ControlBar';

/** A KPI tile that count-ups its value (reduced-motion safe) and shows a skeleton while loading. */
function Kpi({ label, value, format, sub, to, loading }: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  sub?: ReactNode;
  to?: string;
  loading?: boolean;
}) {
  const animated = useCountUp(value, 900);
  const display = loading
    ? <Skeleton height={24} width={96} radius="sm" mt={4} />
    : animated == null ? '—' : format(Math.round(animated));
  return <StatCard size="md" label={label} value={display} sub={loading ? undefined : sub} to={to} />;
}

/** A compact accent line sparkline (median over snapshots) — no axes, just shape. */
function MiniSparkline({ values, width = 132, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={1.5}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.2} fill="var(--mantine-color-accent-7)" />
    </svg>
  );
}

/** Snapshot-over-snapshot delta chip (▲/▼ %, or "no change"). */
function Delta({ frac, prevLabel }: { frac: number | null; prevLabel: string | null }) {
  if (prevLabel == null) return null;
  if (frac == null || Math.abs(frac) < 0.0005) return <Text span size="xs" c="dimmed">≈ flat vs {prevLabel}</Text>;
  const up = frac >= 0;
  return <Text span size="xs" c={up ? 'pos' : 'red'}>{up ? '▲' : '▼'} {pct(Math.abs(frac))} vs {prevLabel}</Text>;
}

interface Kpis { headcount: number; all_people: number; total_payroll: number | null; med: number | null; p90: number | null }

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
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.9) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE ${where}`,
    enabled
  );
  const k = kpis?.[0];

  // Deltas vs the previous distinct-date snapshot (skips the Nov-2021 TTC same-date twin).
  const snapsAsc = useMemo(() => summary?.snapshots ?? [], [summary]);
  const curSnapMeta = snapsAsc.find((s) => s.id === snap);
  const prevSnapMeta = curSnapMeta ? [...snapsAsc].filter((s) => s.date < curSnapMeta.date).at(-1) : undefined;
  const { data: kprevRows } = useSql<{ headcount: number; total_payroll: number | null; med: number | null }>(
    ['kpis-prev', prevSnapMeta?.id ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT ${paidHeadcount(metric)} headcount,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) total_payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${snapWhere(prevSnapMeta?.id ?? '')} AND ${whereAll(scope, filters)}`,
    enabled && !!prevSnapMeta
  );
  const kp = kprevRows?.[0];
  const prevLabel = prevSnapMeta?.label ?? null;
  const frac = (cur?: number | null, prev?: number | null) =>
    cur != null && prev != null && prev !== 0 ? (cur - prev) / prev : null;

  // Median-over-time series for the KPI sparkline (one point per real snapshot; pre-TTC twin dropped).
  const { data: sparkRows } = useSql<{ med: number | null }>(
    ['kpi-spark', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${whereAll(scope, filters)} AND snapshot_id NOT LIKE '%-pre'
     GROUP BY snapshot_id, snapshot_date ORDER BY snapshot_date`,
    enabled
  );
  const sparkMeds = useMemo(
    () => (sparkRows ?? []).map((r) => r.med).filter((v): v is number => v != null),
    [sparkRows]
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
            <Kpi
              label="Headcount"
              value={k?.headcount ?? null}
              format={num}
              loading={enabled && !k}
              sub={<Delta frac={frac(k?.headcount, kp?.headcount)} prevLabel={prevLabel} />}
            />
            <Kpi
              label="Median salary"
              value={k?.med ?? null}
              format={usd}
              loading={enabled && !k}
              sub={
                <Stack gap={4}>
                  {sparkMeds.length > 1 && <MiniSparkline values={sparkMeds} />}
                  <Group gap={8} wrap="wrap">
                    {k?.p90 != null && <Text span size="xs" c="dimmed">top 10% ≥ {usd(k.p90)}</Text>}
                    <Delta frac={frac(k?.med, kp?.med)} prevLabel={prevLabel} />
                  </Group>
                </Stack>
              }
            />
            <Kpi
              label="Total payroll"
              value={k?.total_payroll ?? null}
              format={usdCompact}
              loading={enabled && !k}
              sub={
                <Stack gap={2}>
                  <Text span size="xs" c="dimmed">{usd(k?.total_payroll)} · annualized FTE earnings</Text>
                  <Delta frac={frac(k?.total_payroll, kp?.total_payroll)} prevLabel={prevLabel} />
                </Stack>
              }
            />
            <Kpi
              label="Snapshots"
              value={summary?.snapshot_count ?? null}
              format={num}
              to="/data"
              sub={<Text span size="xs" c="dimmed">{num(summary?.total_rows)} rows · {snapsAsc[0]?.label} → {curSnapMeta?.label ?? snapsAsc.at(-1)?.label}</Text>}
            />
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
          <SchoolsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="earners" pt="md">
          <EarnersPanel />
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
