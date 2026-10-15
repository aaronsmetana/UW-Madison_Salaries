import { useParams } from 'react-router-dom';
import { ShowAll, useShowAll } from '../components/ShowAll';
import { Fragment, useMemo, useState } from 'react';
import {
  Stack, Title, Text, Group, Card, SimpleGrid, Table, Anchor, Loader, Alert, Tabs,
  ScrollArea, Select, UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CsvButton } from '../components/CsvButton';
import {
  ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter, Customized,
} from 'recharts';
import { StatCard, StatRow } from '../components/StatCard';
import { CardTitle } from '../components/CardTitle';
import { SortableTh, type SortState } from '../components/SortableTh';
import { useDocTitle } from '../lib/useDocTitle';
import { useCrumbs } from '../app/PageTop';
import { CompareSetButton } from '../components/CompareSetButton';
import { ToolLinks } from '../components/ToolLinks';
import { AXIS_TICK, GRID, Y_PAD, TIP_STYLE, TIP_LABEL_STYLE, fmtUsd, fmtK, BAR_RADIUS, chartKeys, fmtCount, categoryInk } from '../lib/chartStyle';
import { withSnapX, snapAxisProps } from '../lib/snapTime';
import { useSql, useActiveSnapshotId, useActiveSnapshotLabel, useSummary, useSearchIndex } from '../lib/hooks';
import { NotFoundPanel } from '../components/NotFoundPanel';
import { closeMatches } from '../lib/search';
import { sqlStr } from '../lib/duckdb';
import { useControls, METRIC_LABEL } from '../state/controls';
import { salaryExpr, personEarnings, personPay, paidHeadcount, peopleSql, filterWhere, filterKey, GRADED_APPT, gradedCols, mainOf } from '../lib/queries';
import { belowMinimumSql, bandScaleSql } from '../lib/bands';
import { usd, num, fullName, spanLabel, pct } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { ChartData } from '../components/ChartData';
import { MiniBar } from '../components/MiniBar';
import { TipSurface } from '../components/chart/ChartTooltip';
import { EndLabels } from '../components/chart/EndLabels';
import { chartAnim, useEntrance, markTabSwitch } from '../lib/motion';
import { EarnersPanel } from '../components/EarnersPanel';
import { dropdownProps } from '../lib/selectProps';

import { OverflowTabsList } from '../components/OverflowTabsList';
/**
 * The tenure/pay scatter plots one dot per person, so a large division would otherwise hand Recharts
 * tens of thousands of nodes. The cap is a render budget, not a data statement — which is exactly why
 * the chart has to say when it bites, rather than letting the plotted count read as the headcount.
 */
const TENURE_PLOT_CAP = 3000;
/** Under this FTE an appointment's actual pay is a sliver of a year's (SC3): a quarter-time job. */
const SMALL_FTE = 0.25;

interface TenureRow { person_key: string; fn: string | null; ln: string | null; tenure: number; pay: number; cat: string | null }

/** Tenure-vs-pay hover card: who the dot is, their category, pay and tenure, and a click hint. */
function TenureTip({ active, payload }: { active?: boolean; payload?: { payload: TenureRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{fullName(d.fn, d.ln) || '—'}</Text>
      {d.cat && <Text size="xs" c="dimmed">{d.cat}</Text>}
      <Text size="xs">Pay: {usd(d.pay)}</Text>
      <Text size="xs">Tenure: {d.tenure.toFixed(1)} years</Text>
      <Text size="xs" c="dimmed" mt={2}>Click to view profile</Text>
    </TipSurface>
  );
}

interface Score {
  headcount: number; total_payroll: number | null; med: number | null;
  p25: number | null; p75: number | null; small: number | null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard size="sm" label={label} value={value} />;
}

/** A category's swatch and name, as the landing graph's legend draws them. */
function CatKey({ cat, n }: { cat: string; n?: number }) {
  return (
    <Group gap={6} wrap="nowrap" className="cat-key">
      <span className="series-dot" aria-hidden style={{ background: categoryInk(cat) }} />
      <Text size="xs" span>{cat}{n != null && <Text span c="dimmed"> {num(n)}</Text>}</Text>
    </Group>
  );
}

export default function School() {
  const entrance = useEntrance();
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);
  const { id } = useParams();
  const name = decodeURIComponent(id ?? '');
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
  /** The plotted median, named for the measure in force (G2). */
  const med = `Median ${METRIC_LABEL[metric].toLowerCase()}`;
  const nav = useNavigate();
  // Active tab lives in the URL (?tab=…), same convention as Explore/Person, so a shared link opens on
  // the same tab; "overview" is the implicit default and stays out of the query string. The trend and the
  // distribution moved to Overview (SC2), so an older link to their tab (`dist`) opens there.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') ?? 'overview';
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
  const enabled = !!snap;
  const fk = filterKey(filters);
  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND school = ${sqlStr(name)} AND ${filterWhere(filters)}`;

  // Whether the name is a division at all, in any snapshot: one missing only from this snapshot is real, and
  // says so; a name that never was is not found, and the page offers the divisions it is like (NF2).
  const { data: everRows } = useSql<{ n: number }>(['school-ever', name], `SELECT count(*) n FROM salaries WHERE school = ${sqlStr(name)}`, !!name);
  const { data: index } = useSearchIndex(true);
  // Kept out of the title and the trail until it is known to be a division: an address is not one by being typed.
  const unknown = !!everRows && Number(everRows[0]?.n ?? 0) === 0;
  useDocTitle(unknown ? 'Division not found' : name);
  useCrumbs([{ label: 'Divisions', to: '/divisions' }, { label: unknown ? 'Not found' : name }]);
  // `small`: the people whose appointments come to under a quarter-time (SC3) — at actual pay they are the
  // division's lowest figures, a part of a year's pay and not a low salary.
  const { data: scoreRows, isLoading } = useSql<Score>(
    ['school-score', name, snap ?? '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: base, extra: `${personEarnings(metric)} earn, sum(fte) FILTER (WHERE salary > 0 AND fte > 0) fte` })})
     SELECT (SELECT ${paidHeadcount(metric)} FROM salaries WHERE ${base}) headcount,
        sum(earn) total_payroll,
        median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75,
        count(*) FILTER (WHERE pay > 0 AND fte < ${SMALL_FTE}) small
     FROM pe`,
    enabled
  );
  const s = scoreRows?.[0];

  // People, not appointment records (SC3): one bar per person at their pay, as every headcount here counts them.
  const { data: dist } = useSql<{ bucket: number; n: number }>(
    ['school-dist', name, snap ?? '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: base })})
     SELECT (floor(pay / 20000) * 20000)::BIGINT bucket, count(*) n FROM pe WHERE pay > 0 GROUP BY 1 ORDER BY 1`,
    enabled
  );
  // The axis says money the way every other chart does (SC6): "$20k", not "20k".
  const distData = useMemo(() => (dist ?? []).map((d) => ({ label: fmtK(d.bucket), n: d.n })), [dist]);
  const distN = distData.reduce((t, d) => t + d.n, 0);

  // Each person once, in their main appointment's category.
  const { data: comp } = useSql<{ cat: string; n: number }>(
    ['school-comp', name, snap ?? '', metric, fk],
    `SELECT COALESCE(cat, '—') cat, count(*) n FROM (
       SELECT person_key, ${mainOf('employee_category')} cat FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY person_key)
     GROUP BY 1 ORDER BY 2 DESC`,
    enabled
  );
  const compTotal = (comp ?? []).reduce((t, c) => t + c.n, 0);

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

  // Tenure against pay within one title or category (SC4): across every job at once the cloud said nothing about
  // compression, which is a question about people doing the same work.
  const [tenureCat, setTenureCat] = useState<string | null>(null);
  const [tenureTitle, setTenureTitle] = useState<string | null>(null);
  const { data: titleOpts } = useSql<{ code: string; title: string; n: number }>(
    ['school-tenure-titles', name, snap ?? '', metric, fk],
    `SELECT code, any_value(title) title, count(*) n FROM (
       SELECT person_key, ${mainOf('job_code')} code, ${mainOf('title')} title FROM salaries
       WHERE ${base} AND ${expr} > 0 AND date_of_hire IS NOT NULL GROUP BY person_key)
     WHERE code IS NOT NULL GROUP BY code HAVING count(*) >= 3 ORDER BY n DESC, title`,
    enabled
  );
  const tenureWhere = [
    tenureCat ? `employee_category = ${sqlStr(tenureCat)}` : null,
    tenureTitle ? `job_code = ${sqlStr(tenureTitle)}` : null,
  ].filter(Boolean).join(' AND ');
  const { data: tenurePay } = useSql<TenureRow>(
    ['school-tenure', name, snap ?? '', metric, fk, tenureCat ?? '', tenureTitle ?? ''],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure,
        ${personPay(metric)} pay, ${mainOf('employee_category')} cat
     FROM salaries WHERE ${base} AND ${expr} > 0 AND date_of_hire IS NOT NULL${tenureWhere ? ` AND ${tenureWhere}` : ''}
     GROUP BY person_key
     LIMIT ${TENURE_PLOT_CAP}`,
    enabled
  );
  const tenureByCat = useMemo(() => {
    const m = new Map<string, TenureRow[]>();
    for (const r of tenurePay ?? []) {
      const k = r.cat ?? '—';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [tenurePay]);
  const tenureTitleName = tenureTitle ? (titleOpts ?? []).find((t) => t.code === tenureTitle)?.title ?? tenureTitle : null;

  const { data: depts } = useSql<{ department: string; headcount: number; med: number | null; payroll: number | null }>(
    ['school-depts-full', name, snap ?? '', metric, fk],
    `WITH pe AS (${peopleSql({ metric, where: `${base} AND department IS NOT NULL`, by: ['department'], extra: `${personEarnings(metric)} earn` })})
     SELECT department, count(*) FILTER (WHERE pay > 0) headcount,
        median(pay) FILTER (WHERE pay > 0) med,
        sum(earn) payroll
     FROM pe GROUP BY department ORDER BY headcount DESC`,
    enabled
  );
  // A division of one department has no Departments tab (SC5): its one row was the division again.
  const manyDepts = (depts?.length ?? 0) > 1;
  const tab = asked === 'dist' ? 'overview' : asked === 'departments' && depts && !manyDepts ? 'overview' : asked;
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
  // The first rows, the rest on "Show all" (G11): the page's one scroll, not a box inside it.
  const deptPage = useShowAll(deptView, `${deptSort.key}|${deptSort.dir}`);
  const maxDeptHc = useMemo(() => Math.max(1, ...(depts ?? []).map((d) => d.headcount)), [depts]);
  // A department opened in place (SC5): its titles under its row, where it sent the reader to Divisions.
  const [openDept, setOpenDept] = useState<string | null>(null);
  const { data: deptTitles, isFetching: deptTitlesLoading } = useSql<{ code: string; title: string | null; n: number; med: number | null }>(
    ['school-dept-titles', name, snap ?? '', metric, fk, openDept ?? ''],
    `WITH pe AS (${peopleSql({ metric, where: `${base} AND department = ${sqlStr(openDept ?? '')}`, by: ['job_code'], extra: 'any_value(title) title' })})
     SELECT job_code code, any_value(title) title, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med
     FROM pe GROUP BY job_code HAVING count(*) FILTER (WHERE pay > 0) > 0 ORDER BY n DESC, title LIMIT 8`,
    enabled && !!openDept
  );
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
  if (unknown) {
    const like = closeMatches(index?.divisions ?? [], (d) => d[0], name, 5);
    return (
      <NotFoundPanel
        title="Division not found"
        description="No school or division by that name is in the records, in any snapshot. The link may be out of date, or have a typo in it."
        searchKinds={['divisions']}
        suggestions={like.length > 0 && (
          <Stack gap={6} className="not-found-suggestions">
            {like.map(([school, n]) => (
              <Text key={school} size="sm">
                <Anchor component={Link} to={`/school/${encodeURIComponent(school)}`}>{school}</Anchor>
                <Text span c="dimmed"> · {num(n)} people</Text>
              </Text>
            ))}
          </Stack>
        )}
      />
    );
  }
  if (s && s.headcount === 0) return <Alert color="gray">No records for {name} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      {/* Wraps like PageHeader's own action slot — see the note on Person's header. `nowrap` squeezed the
          button until its label clipped. */}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Title order={1}>{name}</Title>
        </div>
        {/* The page's actions in one group, the tools that take this division among them (P3, as on a person). */}
        <Group gap="sm" wrap="wrap" style={{ flexShrink: 0, maxWidth: '100%' }}>
          <ToolLinks
            asButtons
            links={[
              { label: 'Raises in this division', to: `/raises?sch=${encodeURIComponent(name)}` },
              { label: 'Screen this division', to: `/screening?sch=${encodeURIComponent(name)}&run=1` },
            ]}
          />
          <CompareSetButton item={{ type: 'school', id: name, label: name }} />
        </Group>
      </Group>

      <Tabs value={tab} onChange={(v) => { markTabSwitch(); setTab(v); }}>
        <OverflowTabsList>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="tenure">Tenure &amp; pay</Tabs.Tab>
          <Tabs.Tab value="people">People</Tabs.Tab>
          {manyDepts && <Tabs.Tab value="departments">Departments</Tabs.Tab>}
        </OverflowTabsList>

        {/* The division at a glance (SC2): four figures, its pay laid out and how it has moved, then its bands.
            Eight tiles and no picture, with every chart a tab away. */}
        <Tabs.Panel value="overview" pt="md">
      <Stack gap="lg">
      <StatRow cols={{ base: 2, sm: 4 }}>
        <Stat label="Headcount" value={num(s?.headcount)} />
        <Stat label="Median" value={usd(s?.med)} />
        <Stat label="Middle half" value={`${usd(s?.p25)} – ${usd(s?.p75)}`} />
        <Stat label="Total payroll" value={usd(s?.total_payroll)} />
      </StatRow>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <Card withBorder padding="lg" className="school-dist">
        <CardTitle sub={`${num(distN)} people${snapLabel ? ` in ${snapLabel}` : ''}, in $20k bins.`}>
          {METRIC_LABEL[metric]} distribution
        </CardTitle>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart {...chartKeys(`${METRIC_LABEL[metric]} distribution`)} data={distData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} />
            <YAxis tickFormatter={fmtCount} width={48} tick={AXIS_TICK} />
            <Tooltip formatter={(v: number) => [num(v), 'People']} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
            <Bar
              {...chartAnim(!entrance)}
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
        {metric === 'fte' && (s?.small ?? 0) > 0 && (
          <Text size="xs" c="dimmed" mt={4} className="school-small-fte">
            {num(s!.small)} {s!.small === 1 ? 'person holds' : 'people hold'} under a quarter-time appointment, so at actual pay they
            are the lowest bars: a part of a year&apos;s pay, not a low salary. The full-time rate (Pay, above) places them at a full-time year.
          </Text>
        )}
        <ChartData
          caption={`${METRIC_LABEL[metric]} distribution`}
          columns={[`${METRIC_LABEL[metric]} bin`, 'People']}
          rows={distData.map((d) => [d.label, d.n])}
          n={distN}
          unit="people"
          period={snapLabel ? `as of ${snapLabel}` : undefined}
        />
      </Card>

      <Card withBorder padding="lg" className="school-trend">
        <CardTitle>{med} and headcount over time</CardTitle>
        <ResponsiveContainer width="100%" height={150}>
          {/* Room under the plot for its $0, the axis being the chart below's: at the edge, Recharts drops the tick. */}
          <LineChart {...chartKeys(`${med} over time`)} data={trendRows} syncId="school-trend" margin={{ left: 12, right: 12, top: 18, bottom: 10 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...snapAxisProps(trendRows)} tick={AXIS_TICK} hide />
            <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
            {/* The row's own label: on a date axis Recharts' label is the x value, a timestamp. */}
            <Tooltip formatter={(v: number) => usd(v)} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
            <Line type="linear" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot {...chartAnim(!entrance)} />
            {/* Each of the two charts says which it is, at its line's end. */}
            <Customized component={<EndLabels endSeries={[{ key: 'med', text: 'Median', color: 'var(--text-accent)' }]} />} />
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart {...chartKeys('Headcount over time')} data={trendRows} syncId="school-trend" margin={{ left: 12, right: 12, top: 18 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...snapAxisProps(trendRows)} tick={AXIS_TICK} />
            <YAxis tickFormatter={fmtCount} width={80} tick={AXIS_TICK} padding={Y_PAD} />
            <Tooltip formatter={(v: number) => [num(v), 'People']} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
            <Line type="linear" dataKey="hc" name="People" stroke="var(--mantine-color-gray-6)" strokeWidth={2} dot {...chartAnim(!entrance)} />
            <Customized component={<EndLabels endSeries={[{ key: 'hc', text: 'Headcount', color: 'var(--mantine-color-dimmed)' }]} />} />
          </LineChart>
        </ResponsiveContainer>
        {/* A reorganization moved whole departments in or out: the trend's step there is that, and says so. */}
        {reorgNotes.map((t) => (
          <Text key={t} size="xs" c="dimmed" mt="xs" className="school-reorg-note">{t}</Text>
        ))}
        <ChartData
          caption={`${med} over time`}
          columns={['Snapshot', med, 'Headcount']}
          rows={(trend ?? []).map((t) => [t.label, t.med, t.hc])}
          unit="snapshots"
          period={spanLabel((trend ?? []).map((t) => t.label))}
        />
      </Card>
      </SimpleGrid>

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

        <Tabs.Panel value="tenure" pt="md">
      <Card withBorder padding="lg" className="school-tenure">
        <CardTitle sub={`A compression check — whether longer-serving people are paid more than newer ones — means most within one title${(tenurePay ?? []).length ? `. ${num((tenurePay ?? []).length)} people` : ''}${tenureTitleName ? ` in ${tenureTitleName}` : tenureCat ? `, ${tenureCat}` : ''}${snapLabel ? `, ${snapLabel}` : ''}.`}>
          Tenure vs. pay
        </CardTitle>
        <Group gap="sm" wrap="wrap" mb="sm" align="flex-end">
          <Select {...dropdownProps('sm')} w={300} maw="100%" label="Title" placeholder="Every title" searchable clearable limit={80}
            data={(titleOpts ?? []).map((t) => ({ value: t.code, label: `${t.title} · ${num(t.n)}` }))}
            value={tenureTitle} onChange={setTenureTitle} className="school-tenure-title" />
          <Select {...dropdownProps('sm')} w={220} maw="100%" label="Category" placeholder="Every category" clearable
            data={(comp ?? []).filter((c) => c.cat !== '—').map((c) => c.cat)}
            value={tenureCat} onChange={setTenureCat} className="school-tenure-cat" />
        </Group>
        {/* Coloured by category (SC4), keyed here: one grey crowd mixed faculty, staff and trainees on one axis. */}
        <Group gap="md" wrap="wrap" mb={4} className="school-tenure-key">
          {tenureByCat.map(([cat, rows]) => <CatKey key={cat} cat={cat} n={rows.length} />)}
        </Group>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="tenure" name="Tenure" unit=" yrs" tick={AXIS_TICK} />
            <YAxis type="number" dataKey="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} />
            <Tooltip content={<TenureTip />} cursor={{ strokeDasharray: '3 3' }} />
            {/* One series a category, each in its ink. No rim (DOT_RIM): this is a crowd of up to 3,000, where
                overlapping half-tone dots are what shades the dense regions darker. */}
            {tenureByCat.map(([cat, rows]) => (
              <Scatter
                key={cat}
                className="school-tenure-dots"
                data-cat={cat}
                {...chartAnim(!entrance)}
                data={rows}
                name={cat}
                fill={categoryInk(cat)}
                fillOpacity={0.6}
                cursor="pointer"
                onClick={(pt: { person_key?: string; payload?: { person_key?: string } }) => {
                  const k = pt?.person_key ?? pt?.payload?.person_key;
                  if (k) nav(`/person/${encodeURIComponent(k)}`);
                }}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        {(tenurePay ?? []).length >= TENURE_PLOT_CAP && (
          <Text size="xs" c="dimmed">
            Divisions larger than {num(TENURE_PLOT_CAP)} people are capped here, so this cloud is a sample rather than everyone. Choose a title to see all of its people.
          </Text>
        )}
        <ChartData
          caption="Tenure vs pay"
          columns={['Tenure (yrs)', METRIC_LABEL[metric], 'Category']}
          rows={(tenurePay ?? []).map((t) => [t.tenure, t.pay, t.cat])}
          unit="people plotted"
          period={snapLabel ? `as of ${snapLabel}` : undefined}
          about="A flat or downward cloud within one title suggests salary compression (newer hires paid like — or above — veterans)."
        />
      </Card>
        </Tabs.Panel>

        <Tabs.Panel value="people" pt="md">
      <Stack gap="lg">
        {/* Composition drawn (SC7): each category's share a bar, in its own ink. */}
        <Card withBorder padding="lg" className="school-comp">
          <CardTitle sub="Each person once, in the category of their main appointment.">Composition by category</CardTitle>
          <Table maw={560}>
            <Table.Tbody>
              {(comp ?? []).map((c) => (
                <Table.Tr key={c.cat} className="school-comp-row" data-cat={c.cat} data-n={c.n}>
                  <Table.Td><CatKey cat={c.cat} /></Table.Td>
                  <Table.Td ta="right" w={180}>
                    {num(c.n)} <Text span size="xs" c="dimmed">· {pct(compTotal ? c.n / compTotal : 0, 0)}</Text>
                    <MiniBar frac={compTotal ? c.n / compTotal : 0} color={categoryInk(c.cat)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        {/* Everyone, sortable and searchable (SC7), where a dozen top earners stood: the table Divisions' Top earners
            is, kept to this division. */}
        <Card withBorder padding="lg" className="school-people">
          <CardTitle>People in {name}</CardTitle>
          <EarnersPanel school={name} />
        </Card>
      </Stack>
        </Tabs.Panel>

        {manyDepts && (
        <Tabs.Panel value="departments" pt="md">
          <Card withBorder padding="lg">
            <CardTitle
              right={
                <CsvButton onClick={exportDeptsCsv} disabled={!depts?.length} />
              }
            >
              Departments in {name}
            </CardTitle>
              {/* Wide content scrolls inside its own container, never the document — and never gets
                  clipped out of reach either. Without this the Card's `overflow: hidden` swallowed
                  219px at phone width: Headcount, Median and Total payroll, i.e. every number in the
                  table, with no scrollbar to reach them. Matches the five other wide tables in the app. */}
              <ScrollArea.Autosize type="auto" offsetScrollbars="present">
                <Table miw={560} className="school-dept-table">
                <Table.Thead>
                  <Table.Tr>
                    <SortableTh sortKey="department" label="Department" sort={deptSort} onSort={setDeptSort} />
                    <SortableTh sortKey="headcount" label="Headcount" sort={deptSort} onSort={setDeptSort} align="right" />
                    <SortableTh sortKey="med" label="Median" sort={deptSort} onSort={setDeptSort} align="right" />
                    <SortableTh sortKey="payroll" label="Total payroll" sort={deptSort} onSort={setDeptSort} align="right" />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {deptPage.shown.map((d) => {
                    const open = openDept === d.department;
                    return (
                      <Fragment key={d.department}>
                        <Table.Tr className="peer-row school-dept-row" data-open={open || undefined} style={{ cursor: 'pointer' }}
                          onClick={() => setOpenDept(open ? null : d.department)}>
                          <Table.Td>
                            <UnstyledButton className="school-dept-toggle" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpenDept(open ? null : d.department); }}>
                              <Group gap={6} wrap="nowrap">
                                {open ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
                                <Text size="sm" lineClamp={1}>{d.department}</Text>
                              </Group>
                            </UnstyledButton>
                          </Table.Td>
                          <Table.Td ta="right">
                            {num(d.headcount)}
                            <MiniBar frac={d.headcount / maxDeptHc} />
                          </Table.Td>
                          <Table.Td ta="right">{usd(d.med)}</Table.Td>
                          <Table.Td ta="right">{usd(d.payroll)}</Table.Td>
                        </Table.Tr>
                        {open && (
                          <Table.Tr className="school-dept-detail">
                            <Table.Td colSpan={4} pl="xl">
                              {deptTitlesLoading && !deptTitles ? <Loader size="xs" /> : (
                                <Table withRowBorders={false} verticalSpacing={2} maw={620} className="school-dept-titles">
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>Its largest titles</Table.Th>
                                      <Table.Th ta="right">People</Table.Th>
                                      <Table.Th ta="right">{med}</Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {(deptTitles ?? []).map((t) => (
                                      <Table.Tr key={t.code}>
                                        <Table.Td><Anchor component={Link} to={`/titles?code=${encodeURIComponent(t.code)}`} size="sm">{t.title ?? t.code}</Anchor></Table.Td>
                                        <Table.Td ta="right">{num(t.n)}</Table.Td>
                                        <Table.Td ta="right">{usd(t.med)}</Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              )}
                              <Anchor component={Link} size="sm" mt={6} display="inline-block" className="school-dept-open"
                                to={`/divisions?school=${encodeURIComponent(name)}&dept=${encodeURIComponent(d.department)}`}>
                                All of {d.department} under Divisions →
                              </Anchor>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
              <ShowAll shown={deptPage.shown.length} total={deptPage.total} onShowAll={deptPage.showAll} pager={deptPage.pager} />
            <Text size="xs" c="dimmed" mt="sm">
              Press a department for its largest titles.
            </Text>
          </Card>
        </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
