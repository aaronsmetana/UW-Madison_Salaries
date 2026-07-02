import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Stack, Text, SimpleGrid, Group, Alert, Loader, Tabs, Anchor, Skeleton, Card, Select,
} from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { SchoolsPanel } from '../components/SchoolsPanel';
import { EarnersPanel } from '../components/EarnersPanel';
import { TitlesPanel } from '../components/TitlesPanel';
import { TrendsPanel } from '../components/TrendsPanel';
import { ChangesPanel } from '../components/ChangesPanel';
import { CohortPanel } from '../components/CohortPanel';
import { useSummary, useManifest, useSql, useActiveSnapshotId, useReferenceStatus } from '../lib/hooks';
import { getDB } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, earningsExpr, paidHeadcount, snapWhere, whereAll, filterKey } from '../lib/queries';
import { usd, usdCompact, num, pct } from '../lib/format';
import { dropdownProps } from '../lib/selectProps';
import { useCountUp } from '../lib/motion';
import { ControlBar } from '../app/ControlBar';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { SegmentedToggle } from '../components/SegmentedToggle';

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

/** Snapshot-over-snapshot delta chip (▲/▼ %, or "flat") over the full from→to window. */
function Delta({ frac, prevLabel, curLabel }: { frac: number | null; prevLabel: string | null; curLabel?: string | null }) {
  if (prevLabel == null) return null;
  const range = curLabel ? `${prevLabel} → ${curLabel}` : `vs ${prevLabel}`;
  if (frac == null || Math.abs(frac) < 0.0005) return <Text span size="xs" c="dimmed">≈ flat · {range}</Text>;
  const up = frac >= 0;
  return <Text span size="xs" c={up ? 'pos' : 'red'}>{up ? '▲' : '▼'} {pct(Math.abs(frac))} · {range}</Text>;
}

interface SnapMed { id: string; label: string; med: number }

/** Combined median + snapshots tile: the median's growth over a selectable snapshot range (defaulting to
 *  the widest span), with the current median, a sparkline of the chosen slice, and the top-10% threshold. */
function MedianGrowthCard({ series, p90, loading }: { series: SnapMed[]; p90: number | null; loading: boolean }) {
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [dollarMode, setDollarMode] = useState<'nominal' | 'real'>('nominal');
  const railStyle = { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--accent-grad)' } as const;
  const labelStyle = { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' } as const;

  if (loading || series.length < 2) {
    return (
      <Card padding="lg" style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
        <div aria-hidden style={railStyle} />
        <Text tt="uppercase" c="dimmed" style={labelStyle}>Median pay growth</Text>
        <Skeleton height={24} width={120} radius="sm" mt={8} />
      </Card>
    );
  }

  // Real mode: convert every point to REAL_BASE_YEAR dollars using its own snapshot year (the id's
  // leading YYYY) before computing growth — so growth reflects real purchasing power, not inflation.
  const displaySeries = dollarMode === 'real'
    ? series.map((s) => ({ ...s, med: toReal(s.med, Number(s.id.slice(0, 4)) || REAL_BASE_YEAR) }))
    : series;

  // Resolve the picked range, defaulting to widest (first → last) and keeping `from` strictly before `to`.
  const fIdx = Math.min(Math.max(0, displaySeries.findIndex((s) => s.id === fromId)), displaySeries.length - 2);
  const tRaw = displaySeries.findIndex((s) => s.id === toId);
  const tIdx = Math.max(fIdx + 1, tRaw < 0 ? displaySeries.length - 1 : tRaw);
  const from = displaySeries[fIdx];
  const to = displaySeries[tIdx];
  const growth = from.med ? (to.med - from.med) / from.med : null;
  const slice = displaySeries.slice(fIdx, tIdx + 1).map((s) => s.med);
  const up = (growth ?? 0) >= 0;
  const fromOpts = displaySeries.slice(0, tIdx).map((s) => ({ value: s.id, label: s.label }));
  const toOpts = displaySeries.slice(fIdx + 1).map((s) => ({ value: s.id, label: s.label }));

  return (
    <Card padding="lg" style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={railStyle} />
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text tt="uppercase" c="dimmed" style={labelStyle}>Median pay growth</Text>
        <SegmentedToggle
          size="xs"
          value={dollarMode}
          onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
          options={[{ id: 'nominal', label: 'Nominal' }, { id: 'real', label: `${REAL_BASE_YEAR} $` }]}
        />
      </Group>
      <Group align="baseline" gap={8} mt={6} wrap="nowrap">
        <Text style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }} c={up ? 'pos' : 'red'}>
          {growth == null ? '—' : `${up ? '+' : ''}${(growth * 100).toFixed(1)}%`}
        </Text>
        <Text size="sm" c="dimmed">{usd(from.med)} → {usd(to.med)}</Text>
      </Group>
      {slice.length > 1 && <div style={{ marginTop: 6 }}><MiniSparkline values={slice} width={150} /></div>}
      <Group gap={6} mt={8} wrap="nowrap" align="center">
        <Select {...dropdownProps('sm')} w={118} aria-label="From snapshot" data={fromOpts} value={from.id}
          onChange={setFromId} allowDeselect={false} comboboxProps={{ width: 210, position: 'bottom-start' }} />
        <Text size="xs" c="dimmed">→</Text>
        <Select {...dropdownProps('sm')} w={118} aria-label="To snapshot" data={toOpts} value={to.id}
          onChange={setToId} allowDeselect={false} comboboxProps={{ width: 210, position: 'bottom-start' }} />
      </Group>
      {p90 != null && <Text size="xs" c="dimmed" mt={6}>top 10% ≥ {usd(p90)}{dollarMode === 'real' ? ' (nominal)' : ''}</Text>}
    </Card>
  );
}

interface Kpis { headcount: number; all_people: number; total_payroll: number | null; med: number | null; p90: number | null }

export default function Explore() {
  const { data: summary, isLoading } = useSummary();
  const { data: manifest } = useManifest();
  const { data: refStatus } = useReferenceStatus();
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);

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
  const { data: sparkRows } = useSql<{ id: string; label: string; med: number | null }>(
    ['kpi-spark', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `SELECT snapshot_id id, any_value(snapshot_label) AS "label", median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${whereAll(scope, filters)} AND snapshot_id NOT LIKE '%-pre'
     GROUP BY snapshot_id ORDER BY any_value(snapshot_date)`,
    enabled
  );
  const series = useMemo<SnapMed[]>(
    () => (sparkRows ?? []).filter((r) => r.med != null).map((r) => ({ id: r.id, label: r.label, med: r.med as number })),
    [sparkRows]
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
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Kpi
              label="Headcount"
              value={k?.headcount ?? null}
              format={num}
              loading={enabled && !k}
              sub={<Delta frac={frac(k?.headcount, kp?.headcount)} prevLabel={prevLabel} curLabel={curSnapMeta?.label ?? null} />}
            />
            <MedianGrowthCard series={series} p90={k?.p90 ?? null} loading={series.length < 2} />
            <Kpi
              label="Total payroll"
              value={k?.total_payroll ?? null}
              format={usdCompact}
              loading={enabled && !k}
              sub={
                <Stack gap={2}>
                  <Text span size="xs" c="dimmed">{usd(k?.total_payroll)} · annualized FTE earnings</Text>
                  <Delta frac={frac(k?.total_payroll, kp?.total_payroll)} prevLabel={prevLabel} curLabel={curSnapMeta?.label ?? null} />
                </Stack>
              }
            />
          </SimpleGrid>
          {k && k.all_people > k.headcount && (
            <Text size="xs" c="dimmed" mt="xs">
              Headcount counts paid employees; {num(k.all_people - k.headcount)} unpaid $0 affiliate appointments
              excluded (<Anchor component={Link} to="/data" inherit>what's counted →</Anchor>).
            </Text>
          )}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          <Tabs.Tab value="schools">Schools</Tabs.Tab>
          <Tabs.Tab value="earners">Top earners</Tabs.Tab>
          <Tabs.Tab value="titles">Titles</Tabs.Tab>
          <Tabs.Tab value="trends">Trends</Tabs.Tab>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="cohorts">Retention</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="schools" pt="md" className="tab-rise">
          <SchoolsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="earners" pt="md" className="tab-rise">
          <EarnersPanel />
        </Tabs.Panel>

        <Tabs.Panel value="titles" pt="md" className="tab-rise">
          <TitlesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md" className="tab-rise">
          <TrendsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="changes" pt="md" className="tab-rise">
          <ChangesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="cohorts" pt="md" className="tab-rise">
          <CohortPanel />
        </Tabs.Panel>
      </Tabs>

      {summary && (
        <Text size="xs" c="dimmed" ta="right">
          {num(summary.snapshot_count)} snapshots · {num(summary.total_rows)} rows · {snapsAsc[0]?.label} → {snapsAsc.at(-1)?.label}
          {summary.generated_at ? ` · data generated ${new Date(summary.generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
          {' · '}<Anchor component={Link} to="/data" inherit>data health →</Anchor>
        </Text>
      )}
    </Stack>
  );
}
