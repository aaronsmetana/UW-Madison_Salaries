import { useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  Stack, Title, Text, Group, Button, Card, SimpleGrid, Table, Anchor, Loader, Alert, Tabs,
  ScrollArea,
} from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconDownload } from '@tabler/icons-react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter,
} from 'recharts';
import { StatCard, StatRow } from '../components/StatCard';
import { CardTitle } from '../components/CardTitle';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { SortableTh, type SortState } from '../components/SortableTh';
import { useDocTitle } from '../lib/useDocTitle';
import { useCrumbs } from '../app/PageTop';
import { CompareSetButton } from '../components/CompareSetButton';
import { ToolLinks } from '../components/ToolLinks';
import { usePref } from '../lib/prefs';
import { AXIS_TICK, GRID, Y_PAD, TIP_STYLE, TIP_LABEL_STYLE, fmtUsd, BAR_RADIUS, chartKeys } from '../lib/chartStyle';
import { withSnapX, snapAxisProps } from '../lib/snapTime';
import { useSql, useActiveSnapshotId, useActiveSnapshotLabel, useSummary } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr, earningsExpr, personPay, paidHeadcount, peopleSql, filterWhere, filterKey, GRADED_APPT, gradedCols } from '../lib/queries';
import { belowMinimumSql, bandScaleSql } from '../lib/bands';
import { usd, num, fullName, spanLabel } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { ChartData } from '../components/ChartData';
import { MARK_POPULATION } from '../components/markers';
import { MiniBar } from '../components/MiniBar';
import { TipSurface } from '../components/chart/ChartTooltip';
import { ICON } from '../lib/ui';
import { chartAnim, MOTION, prefersReducedMotion } from '../lib/motion';

/**
 * The tenure/pay scatter plots one dot per person, so a large division would otherwise hand Recharts
 * tens of thousands of nodes. The cap is a render budget, not a data statement — which is exactly why
 * the chart has to say when it bites, rather than letting the plotted count read as the headcount.
 */
const TENURE_PLOT_CAP = 3000;

interface TenureRow { person_key: string; fn: string | null; ln: string | null; tenure: number; pay: number }

/** Tenure-vs-pay hover card: who the dot is, their pay and tenure, and a click hint. */
function TenureTip({ active, payload }: { active?: boolean; payload?: { payload: TenureRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{fullName(d.fn, d.ln) || '—'}</Text>
      <Text size="xs">Pay: {usd(d.pay)}</Text>
      <Text size="xs">Tenure: {d.tenure.toFixed(1)} years</Text>
      <Text size="xs" c="dimmed" mt={2}>Click to view profile</Text>
    </TipSurface>
  );
}

interface Score {
  headcount: number; total_payroll: number | null; med: number | null; mean: number | null;
  p25: number | null; p75: number | null; p90: number | null; lo: number | null; hi: number | null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard size="sm" label={label} value={value} />;
}

export default function School() {
  const reduceMotion = prefersReducedMotion();
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);
  const { id } = useParams();
  const name = decodeURIComponent(id ?? '');
  useDocTitle(name);
  useCrumbs([{ label: 'Divisions', to: '/explore' }, { label: name }]);
  const snap = useActiveSnapshotId();
  // The id keys the SQL; the label is what a chart footer shows a reader.
  const snapLabel = useActiveSnapshotLabel();
  const { metric, filters } = useControls();
  // Reorganizations this division took part in (summary `reorganizations`): formed by one, or giving whole
  // departments to one. Its headcount and median move there for that, and a reader should hear so.
  const { data: summary } = useSummary();
  const reorgNotes = useMemo(() => {
    const label = (sid: string) => summary?.snapshots.find((x) => x.id === sid)?.label ?? sid;
    const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    return (summary?.reorganizations ?? []).flatMap((r) => {
      if (r.school === name) {
        return [`Formed in ${label(r.to_id)} from whole departments of ${r.from.map((f) => `${f.school} (${list(f.departments)})`).join('; ')} — a reorganization. Its trend starts there.`];
      }
      const gave = r.from.find((f) => f.school === name);
      return gave
        ? [`${label(r.to_id)}: ${list(gave.departments)} — ${num(gave.people)} people — moved, whole, to the new ${r.school}. A reorganization: they are not departures.`]
        : [];
    });
  }, [summary, name]);
  const expr = salaryExpr(metric);
  const nav = useNavigate();
  // Active tab lives in the URL (?tab=…), same convention as Explore/Person, so a shared link opens on
  // the same tab; "overview" is the implicit default and stays out of the query string.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const setTab = (v: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!v || v === 'overview') n.delete('tab');
        else n.set('tab', v);
        return n;
      },
      { replace: true }
    );
  const [distScale, setDistScale] = usePref<'linear' | 'log'>('scaleMode', 'linear');
  const enabled = !!snap;
  const fk = filterKey(filters);
  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND school = ${sqlStr(name)} AND ${filterWhere(filters)}`;

  const { data: scoreRows, isLoading } = useSql<Score>(
    ['school-score', name, snap ?? '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: base })})
     SELECT (SELECT ${paidHeadcount(metric)} FROM salaries WHERE ${base}) headcount,
        (SELECT sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) FROM salaries WHERE ${base}) total_payroll,
        median(pay) FILTER (WHERE pay > 0) med,
        avg(pay) FILTER (WHERE pay > 0) mean,
        quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75,
        quantile_cont(pay, 0.90) FILTER (WHERE pay > 0) p90,
        min(pay) FILTER (WHERE pay > 0) lo,
        max(pay) FILTER (WHERE pay > 0) hi
     FROM pe`,
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
    `WITH pe AS (${peopleSql({ metric, where: `school = ${sqlStr(name)} AND ${filterWhere(filters)}`, by: ['snapshot_id'], extra: 'any_value(snapshot_label) lbl, any_value(snapshot_date) dt' })})
     SELECT any_value(lbl) AS "label", any_value(dt) date,
        median(pay) FILTER (WHERE pay > 0) med, count(*) FILTER (WHERE pay > 0) hc
     FROM pe GROUP BY snapshot_id ORDER BY date`,
    !!name
  );
  const trendRows = useMemo(() => withSnapX(trend ?? []), [trend]);

  const { data: bandRows } = useSql<{ banded: number; floored: number; graded: number; avg_pos: number | null; over_max: number; below_min: number }>(
    ['school-band', name, snap ?? '', metric, fk],
    // One row per person, placed by the full-time rate of the appointment that carries the grade
    // (GRADED_APPT), against the band in that snapshot's units (lib/bands) — as every other band in the
    // app is. A grade HR publishes with a minimum only counts toward "below the minimum" and nothing else.
    `WITH p AS (SELECT ${gradedCols()} FROM (SELECT person_key, ${GRADED_APPT} graded FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY person_key)),
     b AS (SELECT p.*, g."grade" IS NOT NULL has_band, g."min" * ${bandScaleSql('p.band_comp')} mn, g."max" * ${bandScaleSql('p.band_comp')} mx
           FROM p LEFT JOIN grades g ON g."grade" = p.grade_number AND g."basis" = p.grade_basis)
     SELECT count(*) FILTER (WHERE mx IS NOT NULL) banded,
        count(*) FILTER (WHERE has_band AND mx IS NULL) floored,
        count(*) FILTER (WHERE grade_number IS NOT NULL) graded,
        avg((band_rate - mn) / NULLIF(mx - mn, 0)) FILTER (WHERE mx IS NOT NULL AND band_rate BETWEEN mn AND mx) avg_pos,
        count(*) FILTER (WHERE mx IS NOT NULL AND band_rate > mx) over_max,
        count(*) FILTER (WHERE has_band AND ${belowMinimumSql('band_rate', 'mn', 'grade_basis')}) below_min
     FROM b`,
    enabled
  );
  const band = bandRows?.[0];

  const { data: tenurePay } = useSql<TenureRow>(
    ['school-tenure', name, snap ?? '', metric, fk],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure,
        ${personPay(metric)} pay
     FROM salaries WHERE ${base} AND ${expr} > 0 AND date_of_hire IS NOT NULL GROUP BY person_key
     LIMIT ${TENURE_PLOT_CAP}`,
    enabled
  );

  const { data: depts } = useSql<{ department: string; headcount: number; med: number | null; payroll: number | null }>(
    ['school-depts-full', name, snap ?? '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: `${base} AND department IS NOT NULL`, by: ['department'], extra: `sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) earn` })})
     SELECT department, count(*) FILTER (WHERE pay > 0) headcount,
        median(pay) FILTER (WHERE pay > 0) med,
        sum(earn) payroll
     FROM pe GROUP BY department ORDER BY headcount DESC`,
    enabled
  );
  type DeptSortKey = 'department' | 'headcount' | 'med' | 'payroll';
  const [deptSort, setDeptSort] = useState<SortState<DeptSortKey>>({ key: 'headcount', dir: 'desc' });
  const deptView = useMemo(() => {
    const rows = depts ?? [];
    const { key, dir } = deptSort;
    const sorted = [...rows].sort((a, b) => {
      const cmp = key === 'department' ? a.department.localeCompare(b.department) : Number(a[key] ?? 0) - Number(b[key] ?? 0);
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [depts, deptSort]);
  const maxDeptHc = useMemo(() => Math.max(1, ...(depts ?? []).map((d) => d.headcount)), [depts]);
  const exportDeptsCsv = () =>
    downloadCSV(
      `uw-${name}-departments-${snap ?? 'latest'}.csv`,
      (depts ?? []).map((d) => ({
        department: d.department,
        headcount: d.headcount,
        median: d.med != null ? Math.round(d.med) : '',
        total_payroll: d.payroll != null ? Math.round(d.payroll) : '',
      }))
    );

  if (isLoading) return <Loader />;
  if (s && s.headcount === 0) return <Alert color="gray">No records for {name} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      {/* Wraps like PageHeader's own action slot — see the note on Person's header. `nowrap` squeezed the
          button until its label clipped. */}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Title order={1}>{name}</Title>
          <ToolLinks
            links={[
              { label: 'Raises in this division', to: `/raises?sch=${encodeURIComponent(name)}` },
              { label: 'Screen this division', to: `/screening?sch=${encodeURIComponent(name)}&run=1` },
            ]}
          />
        </div>
        <CompareSetButton item={{ type: 'school', id: name, label: name }} />
      </Group>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="dist">Trends &amp; distribution</Tabs.Tab>
          <Tabs.Tab value="people">People</Tabs.Tab>
          <Tabs.Tab value="departments">Departments</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
      <Stack gap="lg">
      <StatRow cols={{ base: 2, sm: 4 }}>
        <Stat label="Headcount" value={num(s?.headcount)} />
        <Stat label="Median" value={usd(s?.med)} />
        <Stat label="Mean" value={usd(s?.mean)} />
        <Stat label="Total payroll" value={usd(s?.total_payroll)} />
        <Stat label="25th pctile" value={usd(s?.p25)} />
        <Stat label="75th pctile" value={usd(s?.p75)} />
        <Stat label="90th pctile" value={usd(s?.p90)} />
        <Stat label="Range" value={`${usd(s?.lo)} – ${usd(s?.hi)}`} />
      </StatRow>

      <Card withBorder padding="lg">
        <CardTitle>Pay-band utilization</CardTitle>
        {band && band.banded + band.floored > 0 ? (
          <>
            <StatRow cols={{ base: 2, sm: 4 }} flush className="school-band-stats">
              <Stat label="Avg band position" value={band.avg_pos == null ? '—' : `${Math.round(band.avg_pos * 100)}%`} />
              {/* The denominator is the point: with only a couple of grades seeded, a bare "90" reads as a
                  school-wide finding when it covers a sliver of the graded population. */}
              <Stat label="People with a grade range" value={`${num(band.banded)} of ${num(band.graded)}`} />
              <Stat label="Over max" value={num(band.over_max)} />
              <Stat label="Below grade minimum" value={num(band.below_min)} />
            </StatRow>
            {band.floored > 0 && (
              <Text size="xs" c="dimmed" mt="sm" className="school-band-floors">
                {num(band.floored)} more {band.floored === 1 ? 'has a grade' : 'have grades'} HR publishes with a minimum only: counted
                in &ldquo;Below grade minimum&rdquo;, and in nothing that needs a range.
              </Text>
            )}
            {/* Says what the number covers, not how a maintainer would widen the coverage. The repo
                path this used to print belongs in the README's pay-band section, where the person who
                can act on it will actually be. */}
            {band.graded > 0 && band.banded / band.graded < 0.5 && (
              <Text size="xs" c="dimmed" mt="sm" className="school-band-share">
                The average band position and &ldquo;Over max&rdquo; describe the {Math.round((band.banded / band.graded) * 100)}% of this
                division&apos;s graded appointments whose grade HR publishes with a range, not the whole division.
              </Text>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">
            HR publishes no range or minimum for this division&apos;s grades, so there is nothing to measure its
            salaries against here.
          </Text>
        )}
      </Card>
      </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="dist" pt="md">
          <Stack gap="lg">
      <Card withBorder padding="lg">
        <CardTitle sub="A compression check: whether longer-serving staff are paid more than newer ones.">Tenure vs. pay</CardTitle>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="tenure" name="Tenure" unit=" yrs" tick={AXIS_TICK} />
            <YAxis type="number" dataKey="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} />
            <Tooltip content={<TenureTip />} cursor={{ strokeDasharray: '3 3' }} />
            {/* A population with no one singled out, so MARK_POPULATION: the dots are the data here,
                not the quiet context MARK_PEER is for. `--bar` is for bars, which are counts, and it
                is a lighter tone because a bar is a large filled area where a dot is a few pixels. */}
            <Scatter
              {...chartAnim(reduceMotion, MOTION.slow)}
              data={tenurePay ?? []}
              fill={MARK_POPULATION}
              fillOpacity={0.5}
              // No rim (DOT_RIM): this is a crowd of up to 3,000, where overlapping half-tone dots are
              // what shades the dense regions darker, and a rim on each cut that shading into bubbles.
              cursor="pointer"
              onClick={(pt: { person_key?: string; payload?: { person_key?: string } }) => {
                const k = pt?.person_key ?? pt?.payload?.person_key;
                if (k) nav(`/person/${encodeURIComponent(k)}`);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
        {(tenurePay ?? []).length >= TENURE_PLOT_CAP && (
          <Text size="xs" c="dimmed">
            Divisions larger than {num(TENURE_PLOT_CAP)} people are capped here, so this cloud is a sample rather than everyone.
          </Text>
        )}
        <ChartData
          caption="Tenure vs pay"
          columns={['Tenure (yrs)', 'Pay']}
          rows={(tenurePay ?? []).map((t) => [t.tenure, t.pay])}
          unit="people plotted"
          period={snapLabel ? `as of ${snapLabel}` : undefined}
          about="A flat or downward cloud suggests salary compression (newer hires paid like — or above — veterans)."
        />
      </Card>

      <Card withBorder padding="lg">
        <CardTitle>Median salary over time</CardTitle>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart {...chartKeys('Median salary over time')} data={trendRows} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...snapAxisProps(trendRows)} tick={AXIS_TICK} />
            <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
            {/* The row's own label: on a date axis Recharts' label is the x value, a timestamp. */}
            <Tooltip formatter={(v: number) => usd(v)} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
            <Line type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot {...chartAnim(reduceMotion, MOTION.slow)} />
          </LineChart>
        </ResponsiveContainer>
        {/* A reorganization moved whole departments in or out: the trend's step there is that, and says so. */}
        {reorgNotes.map((t) => (
          <Text key={t} size="xs" c="dimmed" mt="xs" className="school-reorg-note">{t}</Text>
        ))}
        <ChartData
          caption="Median salary over time"
          columns={['Snapshot', 'Median', 'Headcount']}
          rows={(trend ?? []).map((t) => [t.label, t.med, t.hc])}
          unit="snapshots"
          period={spanLabel((trend ?? []).map((t) => t.label))}
        />
      </Card>

      <Card withBorder padding="lg">
        <CardTitle
          right={
            <SegmentedToggle
              value={distScale}
              onChange={(v) => setDistScale(v as 'linear' | 'log')}
              options={[{ id: 'linear', label: 'Linear' }, { id: 'log', label: 'Log' }]}
            />
          }
          sub="The latest snapshot, in $20k bins."
        >
          Salary distribution
        </CardTitle>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart {...chartKeys('Salary distribution')} data={distData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} />
            <YAxis
              width={48}
              tick={AXIS_TICK}
              scale={distScale === 'log' ? 'log' : 'auto'}
              domain={distScale === 'log' ? [0.5, 'auto'] : undefined}
              allowDataOverflow={distScale === 'log'}
            />
            <Tooltip formatter={(v: number) => [num(v), 'People']} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
            <Bar
              {...chartAnim(reduceMotion, MOTION.slow)}
              dataKey="n"
              name="People"
              fill="var(--bar)"
              radius={BAR_RADIUS}
              onMouseEnter={(_, i) => setHoveredBin(i)}
              onMouseLeave={() => setHoveredBin(null)}
            >
              {distData.map((_, i) => <Cell key={i} fillOpacity={hoveredBin != null && hoveredBin !== i ? 0.45 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartData
          caption="Salary distribution"
          columns={['Salary bin', 'People']}
          rows={distData.map((d) => [d.label, d.n])}
          n={distData.reduce((s, d) => s + d.n, 0)}
          unit="salary records"
          period={snapLabel ? `as of ${snapLabel}` : undefined}
        />
      </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="people" pt="md">
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="lg">
          <CardTitle>Composition by category</CardTitle>
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
          <CardTitle>Top earners</CardTitle>
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

        <Tabs.Panel value="departments" pt="md">
          <Card withBorder padding="lg">
            <CardTitle
              right={
                <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.compact} />} onClick={exportDeptsCsv} disabled={!depts?.length}>
                  CSV
                </Button>
              }
            >
              Departments in {name}
            </CardTitle>
            {depts && depts.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">No departments recorded for this school.</Text>
            ) : (
              // Wide content scrolls inside its own container, never the document — and never gets
              // clipped out of reach either. Without this the Card's `overflow: hidden` swallowed
              // 219px at phone width: Headcount, Median and Total payroll, i.e. every number in the
              // table, with no scrollbar to reach them. Matches the five other wide tables in the app.
              <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present">
                <Table stickyHeader miw={560}>
                <Table.Thead>
                  <Table.Tr>
                    <SortableTh sortKey="department" label="Department" sort={deptSort} onSort={setDeptSort} />
                    <SortableTh sortKey="headcount" label="Headcount" sort={deptSort} onSort={setDeptSort} align="right" />
                    <SortableTh sortKey="med" label="Median" sort={deptSort} onSort={setDeptSort} align="right" />
                    <SortableTh sortKey="payroll" label="Total payroll" sort={deptSort} onSort={setDeptSort} align="right" />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {deptView.map((d) => (
                    <Table.Tr
                      key={d.department}
                      className="peer-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => nav(`/explore?school=${encodeURIComponent(name)}&dept=${encodeURIComponent(d.department)}`)}
                    >
                      <Table.Td>
                        <Anchor component={Link} to={`/explore?school=${encodeURIComponent(name)}&dept=${encodeURIComponent(d.department)}`} c="var(--mantine-color-text)" underline="hover" onClick={(e) => e.stopPropagation()} lineClamp={1}>
                          {d.department}
                        </Anchor>
                      </Table.Td>
                      <Table.Td ta="right">
                        {num(d.headcount)}
                        <MiniBar frac={d.headcount / maxDeptHc} />
                      </Table.Td>
                      <Table.Td ta="right">{usd(d.med)}</Table.Td>
                      <Table.Td ta="right">{usd(d.payroll)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            <Text size="xs" c="dimmed" mt="sm">
              Click a department to see it on its own under Divisions.
            </Text>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
