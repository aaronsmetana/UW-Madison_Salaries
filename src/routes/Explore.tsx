import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { Stack, Text, Group, Alert, Loader, Tabs, Anchor, Skeleton, VisuallyHidden, Tooltip, Portal } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard, StatRow, StatCell } from '../components/StatCard';
import { SchoolsPanel } from '../components/SchoolsPanel';
import { EarnersPanel } from '../components/EarnersPanel';
import { TitlesPanel } from '../components/TitlesPanel';
import { TrendsPanel } from '../components/TrendsPanel';
import { ChangesPanel } from '../components/ChangesPanel';
import { CohortPanel } from '../components/CohortPanel';
import { useSummary, useManifest, useSql, useActiveSnapshotId } from '../lib/hooks';
import { getDB } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { personEarnings, paidHeadcount, peopleSql, snapWhere, whereAll, filterKey, PRIOR_FOOTING, growthBetween } from '../lib/queries';
import { usd, usdShort, num, fmtChange } from '../lib/format';
import { ICON } from '../lib/ui';
import { ControlBar } from '../app/ControlBar';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { DeltaChip } from '../components/Delta';
import { useDocTitle } from '../lib/useDocTitle';
import { usePref } from '../lib/prefs';

import { OverflowTabsList } from '../components/OverflowTabsList';
import { usePeriod, type PeriodSnap } from '../lib/period';
import { markTabSwitch } from '../lib/motion';
/** A KPI tile that count-ups its value (reduced-motion safe) and shows a skeleton while loading. */
function Kpi({ label, value, format, exact, sub, to, loading }: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  /** The figure in full, for a rounded one: on hover and to a screen reader. */
  exact?: (n: number) => string;
  sub?: ReactNode;
  to?: string;
  loading?: boolean;
}) {
  // The figure itself, not counted up to it: mid-animation the tiles read "Headcount 8,208" and "Total payroll
  // $781.16M" on their way to 21,962 and $2.1B, and a reader could take either (G7).
  const display = loading
    ? <Skeleton height={24} width={96} radius="sm" mt={4} />
    : value == null ? '—' : exact ? <span title={exact(value)} aria-label={exact(value)}>{format(value)}</span> : format(value);
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

/** Snapshot-over-snapshot delta chip over the full from→to window — headcount/payroll are population
 *  size, not a status, so this always renders `neutral` (dimmed rather than red/green). */
function Delta({ frac, prevLabel, curLabel }: { frac: number | null; prevLabel: string | null; curLabel?: string | null }) {
  if (prevLabel == null) return null;
  const range = curLabel ? `${prevLabel} → ${curLabel}` : `vs ${prevLabel}`;
  return <DeltaChip frac={frac} tone="neutral" suffix={` · ${range}`} />;
}

interface SnapMed { id: string; label: string; date: string; med: number; prior: number | null }

/** The median's growth over the page's period (lib/period), with the median at each end, a sparkline of the
 *  period and the top-10% threshold. Read-only (D2): the period is the control bar's, and so is the dollars mode.
 *  It had a Nominal / 2026 $ toggle and two snapshot pickers of its own, a second period on the page. */
function MedianGrowthCard({ series, from, to, p90, loading }: {
  series: SnapMed[];
  from: PeriodSnap | null;
  to: PeriodSnap | null;
  p90: number | null;
  loading: boolean;
}) {
  const [dollarMode] = usePref<'nominal' | 'real'>('dollarMode', 'nominal');
  const lflId = useId();

  if (loading || series.length < 2 || !from || !to) {
    // Loading, the card is the loaded one's shape and height, line for line: the figure, the period, the
    // sparkline and the top-10% line, so the row of tiles does not grow under the reader as it loads.
    return (
      <StatCell label="Median pay growth">
        <Skeleton height={28} width={210} radius="sm" mt={6} />
        <Skeleton height={18} width={170} radius="sm" mt={6} />
        <Skeleton height={26} width={150} radius="sm" mt={6} />
        <Skeleton height={18} width={130} radius="sm" mt={6} />
      </StatCell>
    );
  }

  // Real mode: convert every point to REAL_BASE_YEAR dollars using its own snapshot year (the id's
  // leading YYYY) before computing growth — so growth reflects real purchasing power, not inflation.
  const displaySeries = dollarMode === 'real'
    ? series.map((s) => {
      const year = Number(s.id.slice(0, 4)) || REAL_BASE_YEAR;
      return { ...s, med: toReal(s.med, year), prior: s.prior != null ? toReal(s.prior, year) : null };
    })
    : series;

  // The period's ends on this series, which leaves out the Pre-TTC twin: a period from it starts at its pair.
  const at = (p: PeriodSnap) => {
    const i = displaySeries.findIndex((s) => s.id === p.id);
    return i >= 0 ? i : displaySeries.findIndex((s) => s.date >= p.date);
  };
  const fIdx = Math.max(0, at(from));
  const tIdx = Math.max(fIdx, at(to) < 0 ? displaySeries.length - 1 : at(to));
  const a = displaySeries[fIdx];
  const b = displaySeries[tIdx];
  // Like for like across a reporting change: the later median restated to the earlier's footing (queries
  // `growthBetween`). As reported, Faculty's +40.8% held a +17.6% step that was how 9-month pay was reported.
  const { growth, changes } = fIdx < tIdx
    ? growthBetween({ date: a.date, value: a.med }, { date: b.date, value: b.med, prior: b.prior })
    : { growth: null, changes: [] as ReturnType<typeof growthBetween>['changes'] };
  const slice = displaySeries.slice(fIdx, tIdx + 1).map((s) => s.med);
  const up = (growth ?? 0) >= 0;

  return (
    <StatCell label="Median pay growth">
      <Group align="baseline" gap={8} mt={6} wrap="nowrap">
        <Text style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }} c={growth == null ? undefined : up ? 'up' : 'down'} data-figure="median-growth">
          {growth == null ? '—' : fmtChange(growth)}
        </Text>
        <Text size="sm" c="dimmed">{usd(a.med)} → {usd(b.med)}</Text>
        {/* On the figure's own line, not a line of its own under it: the tile is drawn at its loaded height while
            it loads, and a note arriving after it moved the tabs down the page. */}
        {changes.length > 0 && (() => {
          const why = `Like for like: the ${changes[0].sinceLabel} change in ${changes[0].what} (×${changes[0].ratio}) taken out. As reported, ${a.med ? fmtChange(b.med / a.med - 1) : '—'}.`;
          return (
            <>
              <Tooltip withArrow multiline w={280} events={{ hover: true, focus: true, touch: true }} label={why}>
                {/* 24px tall: a finger's target, as every one on a phone is (polish.spec). */}
                <Text size="xs" c="dimmed" className="growth-lfl" tabIndex={0} role="button" aria-describedby={lflId}
                  style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, whiteSpace: 'nowrap', cursor: 'help' }}>
                  <span style={{ borderBottom: '1px dotted currentColor' }}>like for like</span>
                </Text>
              </Tooltip>
              <Portal><span id={lflId} hidden>{why}</span></Portal>
            </>
          );
        })()}
      </Group>
      <Text size="xs" c="dimmed" mt={4} className="growth-period">
        {from.label} → {to.label}{dollarMode === 'real' ? ` · in ${REAL_BASE_YEAR} dollars` : ''}
      </Text>
      {slice.length > 1 && <div style={{ marginTop: 6 }}><MiniSparkline values={slice} width={150} /></div>}
      {p90 != null && <Text size="xs" c="dimmed" mt={6}>top 10% ≥ {usd(p90)}{dollarMode === 'real' ? ' (nominal)' : ''}</Text>}
    </StatCell>
  );
}

interface Kpis { headcount: number; all_people: number; total_payroll: number | null; med: number | null; p90: number | null }

export default function Explore() {
  useDocTitle('Divisions');
  const { data: summary, isLoading } = useSummary();
  const { data: manifest } = useManifest();
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();

  useEffect(() => {
    getDB().catch(() => {});
  }, []);

  // Active tab lives in the URL (?tab=…) so "Copy link" restores the exact view; "schools" is the
  // implicit default and stays out of the query string.
  const [params, setParams] = useSearchParams();
  // `cohorts` is the Retention tab's name before G1; an old link still opens it.
  const tab = params.get('tab') === 'cohorts' ? 'retention' : (params.get('tab') ?? 'schools');
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
    // Headcount counts people with a paid appointment; the payroll, median and p90 are over PEOPLE
    // (peopleSql), so they describe the same population the headcount counts, and the payroll is the sum
    // of the pay shown for them (queries `personEarnings`).
    `WITH pe AS (${peopleSql({ metric, where, extra: `${personEarnings(metric)} earn` })})
     SELECT (SELECT ${paidHeadcount(metric)} FROM salaries WHERE ${where}) headcount,
        (SELECT count(DISTINCT person_key) FROM salaries WHERE ${where}) all_people,
        sum(earn) total_payroll,
        median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90
     FROM pe`,
    enabled
  );
  const k = kpis?.[0];

  // Changes over the page's one period (D1): from its start to its end, the snapshot shown.
  const { from: periodFrom, to: periodTo } = usePeriod();
  const prevSnapMeta = periodFrom ?? undefined;
  const curSnapMeta = periodTo ?? undefined;
  const { data: kprevRows } = useSql<{ headcount: number; total_payroll: number | null; med: number | null }>(
    ['kpis-prev', prevSnapMeta?.id ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: `${snapWhere(prevSnapMeta?.id ?? '')} AND ${whereAll(scope, filters)}`, extra: `${personEarnings(metric)} earn` })})
     SELECT (SELECT ${paidHeadcount(metric)} FROM salaries WHERE ${snapWhere(prevSnapMeta?.id ?? '')} AND ${whereAll(scope, filters)}) headcount,
        sum(earn) total_payroll,
        median(pay) FILTER (WHERE pay > 0) med
     FROM pe`,
    enabled && !!prevSnapMeta
  );
  const kp = kprevRows?.[0];
  const prevLabel = prevSnapMeta?.label ?? null;
  const frac = (cur?: number | null, prev?: number | null) =>
    cur != null && prev != null && prev !== 0 ? (cur - prev) / prev : null;

  // Median-over-time series for the KPI sparkline (one point per real snapshot; pre-TTC twin dropped).
  // With each median restated to the footing before every reporting change (`PRIOR_FOOTING`), for growth
  // measured across one.
  const { data: sparkRows } = useSql<{ id: string; label: string; dt: string; med: number | null; med_prior: number | null }>(
    ['kpi-spark', scope.kind, scope.kind === 'school' ? scope.value : '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: `${whereAll(scope, filters)} AND snapshot_id NOT LIKE '%-pre'`, by: ['snapshot_id'], extra: 'any_value(snapshot_label) lbl, any_value(snapshot_date) dt' })}),
          po AS (${peopleSql({ metric, where: `${whereAll(scope, filters)} AND snapshot_id NOT LIKE '%-pre'`, by: ['snapshot_id'], from: PRIOR_FOOTING })}),
          a AS (SELECT snapshot_id, any_value(lbl) lbl, CAST(any_value(dt) AS VARCHAR) dt, median(pay) FILTER (WHERE pay > 0) med FROM pe GROUP BY 1),
          b AS (SELECT snapshot_id, median(pay) FILTER (WHERE pay > 0) med_prior FROM po GROUP BY 1)
     SELECT a.snapshot_id id, a.lbl AS "label", a.dt, a.med, b.med_prior FROM a LEFT JOIN b USING (snapshot_id) ORDER BY a.dt`,
    enabled
  );
  const series = useMemo<SnapMed[]>(
    () => (sparkRows ?? []).filter((r) => r.med != null).map((r) => ({ id: r.id, label: r.label, date: String(r.dt), med: r.med as number, prior: r.med_prior })),
    [sparkRows]
  );

  const flagged = manifest?.snapshots.filter((s) => s.status === 'warning' || s.status === 'error') ?? [];

  return (
    <Stack gap="lg">
      <PageHeader
        title="Divisions"
        // Every tab in it (G9): a description that names one tab reads, on the others, as the wrong page.
        description="Campus by its schools and divisions: headcount and pay, the top earners, titles, trends over time, changes between two snapshots, and retention."
      />

      {/* No page-wide search here: its table has its own filter, and finding a person, title or division is
          the landing page's box and ⌘K anywhere. A second search above the figures was one too many. */}
      <ControlBar inline period dollars />

      {flagged.length > 0 && (
        <Alert
          variant="light"
          color="gray"
          className="alert-warn"
          icon={<IconAlertTriangle size={ICON.control} />}
          title={`${flagged.length} data-health note${flagged.length > 1 ? 's' : ''}`}
        >
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
          {/* On a phone, a row to scroll sideways rather than three screens of tiles (D6). */}
          <StatRow cols={{ base: 1, sm: 3 }} className="kpi-scroll">
            <Kpi
              label="Headcount"
              value={k?.headcount ?? null}
              format={num}
              loading={enabled && !k}
              sub={<Delta frac={frac(k?.headcount, kp?.headcount)} prevLabel={prevLabel} curLabel={curSnapMeta?.label ?? null} />}
            />
            <MedianGrowthCard series={series} from={periodFrom} to={periodTo} p90={k?.p90 ?? null} loading={series.length < 2} />
            <Kpi
              label="Total payroll"
              value={k?.total_payroll ?? null}
              format={usdShort}
              exact={usd}
              loading={enabled && !k}
              sub={
                <Stack gap={2}>
                  {/* What it sums, and that the Pay setting above does not change it (D4). */}
                  <Text span size="xs" c="dimmed" className="payroll-measure">actual pay, summed: each person at their FTE, under either Pay setting</Text>
                  <Delta frac={frac(k?.total_payroll, kp?.total_payroll)} prevLabel={prevLabel} curLabel={curSnapMeta?.label ?? null} />
                </Stack>
              }
            />
          </StatRow>
          {k && k.all_people > k.headcount && (
            <Text size="xs" c="dimmed" mt="xs">
              Headcount counts paid employees; {num(k.all_people - k.headcount)} unpaid $0 affiliate appointments
              excluded (<Anchor component={Link} to="/data" inherit>what's counted →</Anchor>).
            </Text>
          )}
        </div>
      )}

      <Tabs value={tab} onChange={(v) => { markTabSwitch(); setTab(v); }} keepMounted={false}>
        <OverflowTabsList>
          <Tabs.Tab value="schools">Schools</Tabs.Tab>
          <Tabs.Tab value="earners">Top earners</Tabs.Tab>
          <Tabs.Tab value="titles">Titles</Tabs.Tab>
          <Tabs.Tab value="trends">Trends</Tabs.Tab>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="retention">Retention</Tabs.Tab>
        </OverflowTabsList>

        {/* Each panel names itself in a heading only a screen reader hears: the tab list is not a heading, and the
            page had an h1 and nothing under it. */}
        <Tabs.Panel value="schools" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Schools</VisuallyHidden>
          <SchoolsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="earners" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Top earners</VisuallyHidden>
          <EarnersPanel />
        </Tabs.Panel>

        <Tabs.Panel value="titles" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Titles</VisuallyHidden>
          <TitlesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Trends</VisuallyHidden>
          <TrendsPanel />
        </Tabs.Panel>

        <Tabs.Panel value="changes" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Changes</VisuallyHidden>
          <ChangesPanel />
        </Tabs.Panel>

        <Tabs.Panel value="retention" pt="md" className="tab-rise">
          <VisuallyHidden component="h2">Retention</VisuallyHidden>
          <CohortPanel />
        </Tabs.Panel>
      </Tabs>

      {summary && (
        <Text size="xs" c="dimmed" ta="right">
          {/* The snapshots it spans are in the footer on every page; this line keeps what is this page's. */}
          {num(summary.total_rows)} rows{' · '}<Anchor component={Link} to="/data" inherit>data health →</Anchor>
        </Text>
      )}
    </Stack>
  );
}
