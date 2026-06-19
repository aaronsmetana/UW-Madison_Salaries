import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Stack, Title, Text, Group, Button, Card, Table, Badge, Alert, SimpleGrid, Anchor, NumberInput, Tabs, Paper, ScrollArea,
} from '@mantine/core';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot, ReferenceLine,
} from 'recharts';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { useSql, useGrades, useSummary } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, pct, fullName } from '../lib/format';
import { PayBandBar } from '../components/PayBandBar';
import { PeerRangeBar } from '../components/PeerRangeBar';
import { SalaryHistogram } from '../components/SalaryHistogram';
import { ChartData } from '../components/ChartData';
import { LoadingState } from '../components/Loading';

/** Salary-trend hover card: the title at that snapshot, actual pay, and the full-time rate breakdown. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; title: string | null; salary: number; rate?: number; fte?: number; appts?: number; med?: number | null } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const partTime = d.rate != null && Math.round(d.rate) !== Math.round(d.salary);
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Actual paid: {usd(d.salary)}</Text>
      {partTime && (
        <Text size="xs" c="dimmed">Full-time rate: {usd(d.rate)}{d.fte != null ? ` · ${+d.fte.toFixed(2)} FTE` : ''}</Text>
      )}
      {d.med != null && <Text size="xs" c="dimmed">Title median: {usd(d.med)}</Text>}
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </Paper>
  );
}

/** Title-change marker on the actual-pay line: a diamond with a faint halo (Recharts injects cx/cy). */
function TitleChangeDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  const s = 6;
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="var(--mantine-color-indigo-6)" opacity={0.15} />
      <path
        d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
        fill="var(--mantine-color-indigo-7)"
        stroke="var(--mantine-color-body)"
        strokeWidth={1.5}
      />
    </g>
  );
}

/** Custom legend below the trend chart, explaining the title-era demarcations. */
function TrendLegend({ hasTitleChange, showFte }: { hasTitleChange: boolean; showFte: boolean }) {
  const item = (swatch: ReactNode, label: string) => (
    <Group gap={6} wrap="nowrap" align="center">
      {swatch}
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
  return (
    <Group gap="lg" mt="xs" wrap="wrap">
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-indigo-6)" strokeWidth={2} /></svg>,
        'Actual pay',
      )}
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-gray-5)" strokeWidth={2} strokeDasharray="5 3" /></svg>,
        'Title median — resets at each title change',
      )}
      {showFte && item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-teal-6)" strokeWidth={2} strokeDasharray="4 2" /></svg>,
        'Appointment (FTE) — right axis',
      )}
      {hasTitleChange && item(
        <svg width={14} height={14} aria-hidden><path d="M7,1 L13,7 L7,13 L1,7 Z" fill="var(--mantine-color-indigo-7)" /></svg>,
        'Title change',
      )}
      {hasTitleChange && item(
        <svg width={10} height={14} aria-hidden><line x1={5} y1={1} x2={5} y2={13} stroke="var(--mantine-color-gray-4)" strokeWidth={1} strokeDasharray="2 3" /></svg>,
        'New title era',
      )}
    </Group>
  );
}

/** Short label for the vertical title-era divider so long titles don't overrun the chart. */
const shortTitle = (s: string | null) => (s && s.length > 16 ? `${s.slice(0, 15)}…` : s ?? '');

interface Row {
  first_name: string | null;
  last_name: string | null;
  snapshot_id: string;
  snapshot_label: string;
  snapshot_date: string;
  school: string | null;
  department: string | null;
  title: string | null;
  job_code: string | null;
  salary: number | null;
  salary_fte_adjusted: number | null;
  fte: number | null;
  date_of_hire: string | null;
  employee_category: string | null;
  grade_number: number | null;
  grade_basis: string | null;
}

interface PeerStats { n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; hi: number | null }
interface PeerRow { person_key: string; fn: string | null; ln: string | null; school: string | null; department: string | null; tenure: number | null; pay: number }

export default function Person() {
  const { id } = useParams();
  const key = decodeURIComponent(id ?? '');
  const nav = useNavigate();
  const { add, has } = useTray();

  const { data, isLoading, error } = useSql<Row>(
    ['person', key],
    `SELECT first_name, last_name, snapshot_id, snapshot_label, snapshot_date, school, department,
            title, job_code, salary, salary_fte_adjusted, fte, date_of_hire, employee_category,
            grade_number, grade_basis
     FROM salaries WHERE person_key = ${sqlStr(key)} ORDER BY snapshot_date`,
    !!key
  );
  const { data: grades } = useGrades();

  const { data: summary } = useSummary();

  const rows = useMemo(() => data ?? [], [data]);
  const latest = rows[rows.length - 1];
  const name = (latest ? fullName(latest.first_name, latest.last_name) : '') || key;

  // Flag people who aren't in the most recent snapshot (likely no longer employed).
  const campusLatest = summary?.snapshots[summary.snapshots.length - 1] ?? null;
  const departed = !!(latest && campusLatest && String(latest.snapshot_date) < String(campusLatest.date));

  // Salary trend: one point per snapshot. `salary` (the plotted line) is ACTUAL pay — the reported
  // FTE-adjusted figure (Σ salary_fte_adjusted, falling back to rate × FTE), summed across concurrent
  // appointments. We also carry the full-time `rate` (Σ salary) and total `fte` for the breakdown.
  const trend = useMemo(() => {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ttcSuffix = (id: string) => (id.endsWith('-pre') ? ' (Pre-TTC)' : id.endsWith('-post') ? ' (Post-TTC)' : '');
    const fullLabel = (date: string, id: string) => {
      const m = Number(String(date).slice(5, 7));
      return `${MONTHS[m - 1] ?? ''} ${String(date).slice(0, 4)}${ttcSuffix(id)}`.trim();
    };
    const by = new Map<string, { id: string; label: string; full: string; date: string; rows: Row[] }>();
    for (const r of rows) {
      let cur = by.get(r.snapshot_id);
      if (!cur) {
        cur = { id: r.snapshot_id, label: r.snapshot_label, full: fullLabel(r.snapshot_date, r.snapshot_id), date: r.snapshot_date, rows: [] };
        by.set(r.snapshot_id, cur);
      }
      cur.rows.push(r);
    }
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...by.values()]
      .map((g) => {
        const appts = g.rows.length;
        const paid = g.rows.reduce((s, r) => s + (r.salary_fte_adjusted ?? (r.salary ?? 0) * (r.fte ?? 1)), 0);
        const rate = g.rows.reduce((s, r) => s + (r.salary ?? 0), 0);
        const fte = g.rows.reduce((s, r) => s + (r.fte ?? 1), 0);
        // primary appointment = highest FTE (tie-break highest salary) — drives the displayed title
        const primary = g.rows.reduce((best, r) => {
          const bf = best.fte ?? 0, rf = r.fte ?? 0;
          return rf > bf || (rf === bf && (r.salary ?? 0) > (best.salary ?? 0)) ? r : best;
        }, g.rows[0]);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary: paid, rate, fte, title: primary.title, job_code: primary.job_code, appts };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

  // Median pay for the title the person held at each snapshot (market context for the trend).
  const { data: titleMedRows } = useSql<{ snapshot_id: string; med: number | null }>(
    ['person-title-med', key],
    `WITH me AS (SELECT snapshot_id, arg_max(job_code, salary) job FROM salaries
        WHERE person_key = ${sqlStr(key)} AND job_code IS NOT NULL GROUP BY snapshot_id),
      pp AS (SELECT s.snapshot_id, s.person_key, ${personPay('fte')} pay
        FROM salaries s JOIN me ON s.snapshot_id = me.snapshot_id AND s.job_code = me.job
        GROUP BY s.snapshot_id, s.person_key)
     SELECT snapshot_id, median(pay) med FROM pp WHERE pay > 0 GROUP BY snapshot_id`,
    !!key
  );
  const trendData = useMemo(() => {
    const med = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med]));
    // `era` increments at each title change so the median can be drawn as disconnected per-title segments.
    let era = 0;
    return trend.map((t, i) => {
      if (i > 0 && t.job_code !== trend[i - 1].job_code) era++;
      return { ...t, med: med.get(t.id) ?? null, era };
    });
  }, [trend, titleMedRows]);

  // Distinct title eras (for disconnected median segments) and the points where the title changes.
  const eras = useMemo(() => [...new Set(trendData.map((t) => t.era))], [trendData]);
  const titleChanges = useMemo(
    () => trendData.filter((t, i) => i > 0 && t.era !== trendData[i - 1].era),
    [trendData],
  );

  // FTE (appointment level) only matters when it deviates from full-time at some point — otherwise a
  // flat 100% line is just noise. Show a right-axis FTE line for anyone with a non-full snapshot.
  const showFte = useMemo(() => trendData.some((t) => Math.abs((t.fte ?? 1) - 1) > 0.005), [trendData]);
  const fteMax = useMemo(() => Math.max(1, ...trendData.map((t) => t.fte ?? 1)), [trendData]);

  // Appointment count per snapshot (for the "split" flag in the history table).
  const apptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.snapshot_id, (m.get(r.snapshot_id) ?? 0) + 1);
    return m;
  }, [rows]);

  // History rows ordered chronologically, with pre-TTC above post-TTC for the shared-date pair.
  const historyRows = useMemo(() => {
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...rows].sort(
      (a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id)
    );
  }, [rows]);

  const tenureYears = useMemo(() => {
    const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
    if (!hire) return null;
    return Math.max(0, (Date.now() - new Date(hire).getTime()) / (365.25 * 864e5));
  }, [rows]);

  const firstSalary = trend[0]?.salary ?? null; // actual paid
  const lastSalary = trend[trend.length - 1]?.salary ?? null; // actual paid
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;
  // Span of available salary data (oldest → latest snapshot) — the window the change is measured over.
  const firstDate = trend[0]?.date ?? null;
  const lastDate = trend[trend.length - 1]?.date ?? null;
  const spanYears = firstDate && lastDate ? (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 864e5) : null;
  const oldestLabel = trend[0]?.label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? null;
  const oldestAgeYears = firstDate ? (Date.now() - new Date(firstDate).getTime()) / (365.25 * 864e5) : null;
  // Full-time rate (and its growth) — shown alongside actual pay where they diverge (FTE changes).
  const firstRate = trend[0]?.rate ?? null;
  const lastRate = trend[trend.length - 1]?.rate ?? null;
  const lastFte = trend[trend.length - 1]?.fte ?? null;
  const rateChange = firstRate && lastRate ? (lastRate - firstRate) / firstRate : null;
  const partTime = lastRate != null && lastSalary != null && Math.round(lastRate) !== Math.round(lastSalary);
  const chgDiffer = totalChange != null && rateChange != null && Math.abs(totalChange - rateChange) > 0.005;
  const sgnPct = (x: number | null) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

  // One-line career summary under the header.
  const careerLine = useMemo(() => {
    const firstTitle = trend[0]?.title;
    const latestTitle = latest?.title;
    if (!latestTitle || trend.length === 0) return null;
    const hireYear = rows.find((r) => r.date_of_hire)?.date_of_hire?.slice(0, 4) ?? trend[0]?.date?.slice(0, 4);
    const p0 = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
    const chg = totalChange == null ? null
      : chgDiffer && rateChange != null ? `actual ${p0(totalChange)} · rate ${p0(rateChange)}`
      : p0(totalChange);
    const span = spanYears != null && spanYears >= 0.1 ? `${spanYears.toFixed(1)} years of salary data` : null;
    if (firstTitle && firstTitle !== latestTitle) {
      return `Joined ${hireYear ?? '—'} as ${firstTitle}; now ${latestTitle}${chg && span ? ` (${chg} over ${span})` : ''}.`;
    }
    return `${latestTitle}${hireYear ? ` since ${hireYear}` : ''}${chg && span ? ` — ${chg} over ${span}` : ''}.`;
  }, [trend, latest, rows, totalChange, rateChange, chgDiffer, spanYears]);

  const band = useMemo(() => {
    if (!latest || latest.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === latest.grade_number && g.basis === latest.grade_basis) ?? null;
  }, [latest, grades]);

  const lastSnap = latest?.snapshot_id ?? '';
  const { data: standingRows } = useSql<{ uw: number; sch: number | null }>(
    ['standing', key, lastSnap, lastSalary ?? 0],
    `WITH pp AS (SELECT person_key, ${personPay('fte')} pay, any_value(school) school FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} GROUP BY person_key)
     SELECT round(100.0 * avg(CASE WHEN pay <= ${lastSalary ?? 0} THEN 1 ELSE 0 END), 0) uw,
            round(100.0 * avg(CASE WHEN pay <= ${lastSalary ?? 0} THEN 1 ELSE 0 END) FILTER (WHERE school = ${sqlStr(latest?.school ?? '')}), 0) sch
     FROM pp WHERE pay > 0`,
    !!latest && lastSalary != null && lastSalary > 0
  );
  const standing = standingRows?.[0];

  // Same-title peers = everyone sharing this person's job_code at the latest snapshot.
  const jobCode = latest?.job_code ?? null;
  const { data: peerStatsRows } = useSql<PeerStats>(
    ['peer-stats', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, ${personPay('fte')} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peers } = useSql<PeerRow>(
    ['peer-list', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(school) school, any_value(department) department,
        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 AS tenure,
        ${personPay('fte')} pay
        FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, tenure, pay FROM pp WHERE pay > 0 ORDER BY pay DESC`,
    !!lastSnap && !!jobCode
  );
  const peerRank = useMemo(() => {
    const i = (peers ?? []).findIndex((p) => p.person_key === key);
    return i >= 0 ? i + 1 : null;
  }, [peers, key]);

  const { data: peerPayRows } = useSql<{ pay: number }>(
    ['peer-pays', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, ${personPay('fte')} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peerPays = useMemo(() => (peerPayRows ?? []).map((r) => r.pay), [peerPayRows]);
  const peerPct = useMemo(() => {
    if (!peerPays.length || lastSalary == null) return null;
    const below = peerPays.filter((p) => p <= lastSalary).length;
    return Math.round((100 * below) / peerPays.length);
  }, [peerPays, lastSalary]);

  // Scroll the peer list so this person's row is centered/visible (viewport only — no page jump).
  const peerViewportRef = useRef<HTMLDivElement>(null);
  const subjectRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const vp = peerViewportRef.current;
    const row = subjectRowRef.current;
    if (!vp || !row) return;
    const vpRect = vp.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    vp.scrollTop += rowRect.top - vpRect.top - vp.clientHeight / 2 + rowRect.height / 2;
  }, [peers]);

  const [pctRaise, setPctRaise] = useState<number>(2);
  const [years, setYears] = useState<number>(5);

  if (isLoading) return <LoadingState label="Loading person…" />;
  if (error) return <Alert color="red">Failed to load person: {(error as Error).message}</Alert>;
  if (!rows.length) return <Alert color="gray">No records found for this person.</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{name}</Title>
          <Text c="dimmed">
            {latest?.job_code ? (
              <Anchor component={Link} to={`/title/${encodeURIComponent(latest.job_code)}`}>{latest?.title}</Anchor>
            ) : (
              latest?.title
            )}
            {' '}·{' '}
            {latest?.school ? (
              <Anchor component={Link} to={`/school/${encodeURIComponent(latest.school)}`}>
                {latest.school}
              </Anchor>
            ) : (
              '—'
            )}
            {latest?.department ? ` · ${latest.department}` : ''}
          </Text>
          {careerLine && <Text size="sm" c="dimmed" mt={4}>{careerLine}</Text>}
        </div>
        <Button
          variant={has(key) ? 'light' : 'filled'}
          onClick={() => add({ type: 'person', id: key, label: name })}
          disabled={has(key)}
        >
          {has(key) ? 'In tray' : '+ Add to tray'}
        </Button>
      </Group>

      {departed && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          Not in the latest snapshot ({campusLatest?.label}) — may no longer be employed. Last seen {latest?.snapshot_label}.
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="pay">Pay &amp; standing</Tabs.Tab>
          <Tabs.Tab value="trends">Salary trend</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="lg">
            <Card withBorder padding="lg">
              <Text size="sm" c="dimmed">Actual pay{latest?.snapshot_label ? ` · ${latest.snapshot_label}` : ''}</Text>
              <Title order={1} style={{ fontSize: '2.5rem', lineHeight: 1.1 }}>{usd(lastSalary)}</Title>
              {latest?.title && <Text size="sm" c="dimmed" mt={4}>{latest.title}</Text>}
              {partTime && (
                <Text size="xs" c="dimmed" mt={2}>
                  {lastFte != null ? `${+lastFte.toFixed(2)} FTE · ` : ''}full-time rate {usd(lastRate)}
                </Text>
              )}
            </Card>

            <SimpleGrid cols={{ base: 3, sm: 3 }}>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Change (first→latest)</Text>
                <Text fw={600}>{sgnPct(totalChange)}</Text>
                {chgDiffer && <Text size="xs" c="dimmed">rate {sgnPct(rateChange)}</Text>}
              </Card>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Tenure</Text>
                <Text fw={600}>{tenureYears == null ? '—' : `${tenureYears.toFixed(1)} yrs`}</Text>
              </Card>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Salary snapshots on record</Text>
                <Text fw={600}>{num(trend.length)}</Text>
                {oldestLabel && (
                  <Text size="xs" c="dimmed">
                    oldest {oldestLabel}{oldestAgeYears != null ? ` · ${oldestAgeYears.toFixed(1)} yrs ago` : ''}
                  </Text>
                )}
              </Card>
            </SimpleGrid>

            {peer && peer.n === 1 && jobCode && (
              <Card withBorder padding="lg">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="sm">
                    {name} is the only employee at UW with the title {latest?.title} (job code {jobCode}) in the latest snapshot — no one else to compare against.
                  </Text>
                  <Anchor component={Link} to={`/title/${encodeURIComponent(jobCode)}`} size="sm" style={{ whiteSpace: 'nowrap' }}>Title page →</Anchor>
                </Group>
              </Card>
            )}

            {peer && peer.n > 1 && lastSalary != null && jobCode &&
              peer.lo != null && peer.p25 != null && peer.med != null && peer.p75 != null && peer.hi != null && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap">
                  <Text size="sm" fw={600}>How this person compares to others with the same title</Text>
                  <Anchor component={Link} to={`/title/${encodeURIComponent(jobCode)}`} size="sm">Title page →</Anchor>
                </Group>
                <PeerRangeBar min={peer.lo} p25={peer.p25} median={peer.med} p75={peer.p75} max={peer.hi} value={lastSalary} />
                {peerPct != null && (
                  <Text size="sm" mt="sm">
                    Paid more than <b>{peerPct}%</b> of people with this title.
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt={4} mb="md">
                  Among {num(peer.n)} people with the title {latest?.title} (job code {jobCode}) in the latest snapshot.
                </Text>
                <SalaryHistogram
                  values={peerPays}
                  markerValue={lastSalary}
                  markerLabel="this person"
                  tooFewText={`Only ${num(peer.n)} ${peer.n === 1 ? 'person has' : 'people have'} this title — too few to chart a distribution.`}
                />
              </Card>
            )}

            {peers && peers.length > 1 && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap">
                  <Text size="sm" fw={600}>Others with this title</Text>
                  {peerRank != null && (
                    <Text size="sm" c="dimmed">
                      {name} ranks <b>#{peerRank}</b> of {num(peers.length)} by salary
                    </Text>
                  )}
                </Group>
                <ScrollArea.Autosize mah={460} type="auto" offsetScrollbars="present" viewportRef={peerViewportRef}>
                  <Table striped highlightOnHover stickyHeader miw={760}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={48} ta="right">#</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>School</Table.Th>
                        <Table.Th>Department</Table.Th>
                        <Table.Th ta="right">Tenure</Table.Th>
                        <Table.Th ta="right">Salary</Table.Th>
                        <Table.Th w={132} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {peers.map((p, i) => {
                        const isYou = p.person_key === key;
                        const inTray = has(p.person_key);
                        const sameSchool = !isYou && !!p.school && p.school === latest?.school;
                        return (
                          <Table.Tr
                            key={p.person_key}
                            className={`peer-row${sameSchool ? ' peer-same-school' : ''}`}
                            ref={isYou ? subjectRowRef : undefined}
                            onClick={() => !isYou && nav(`/person/${encodeURIComponent(p.person_key)}`)}
                            tabIndex={isYou ? undefined : 0}
                            role={isYou ? undefined : 'button'}
                            onKeyDown={(e) => {
                              if (!isYou && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                nav(`/person/${encodeURIComponent(p.person_key)}`);
                              }
                            }}
                            style={{ cursor: isYou ? 'default' : 'pointer', background: isYou ? 'var(--mantine-color-indigo-light)' : undefined }}
                          >
                            <Table.Td ta="right" c="dimmed">{i + 1}</Table.Td>
                            <Table.Td>
                              <Text span size="sm" c={isYou ? undefined : 'indigo'} fw={isYou ? 700 : undefined}>
                                {fullName(p.fn, p.ln) || '—'}
                              </Text>
                              {isYou && <Badge ml="xs" size="xs" variant="filled">this person</Badge>}
                            </Table.Td>
                            <Table.Td title={sameSchool ? `Same school as ${name}` : undefined}>
                              <Text span size="sm" lineClamp={1}>{p.school ?? '—'}</Text>
                            </Table.Td>
                            <Table.Td><Text span size="sm" c="dimmed" lineClamp={1}>{p.department ?? '—'}</Text></Table.Td>
                            <Table.Td ta="right" fw={isYou ? 700 : undefined}>{p.tenure != null ? `${Math.max(0, p.tenure).toFixed(1)} yrs` : '—'}</Table.Td>
                            <Table.Td ta="right" fw={isYou ? 700 : undefined}>{usd(p.pay)}</Table.Td>
                            <Table.Td ta="right">
                              <Button
                                className="peer-add"
                                size="compact-xs"
                                variant={inTray ? 'light' : 'filled'}
                                color={inTray ? 'gray' : 'indigo'}
                                radius="xl"
                                leftSection={inTray ? undefined : <IconPlus size={12} />}
                                disabled={inTray}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) });
                                }}
                              >
                                {inTray ? 'In tray' : 'Add to tray'}
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
                {latest?.school && peers.some((p) => p.person_key !== key && p.school === latest.school) && (
                  <Text size="xs" c="dimmed" mt="xs">Rows shaded teal share {name}'s school ({latest.school}).</Text>
                )}
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="pay" pt="md">
          <Stack gap="lg">
      {standing && (
        <Card withBorder padding="md">
          <Text size="sm" fw={600} mb="xs">Standing (latest snapshot)</Text>
          <Group gap="xl">
            <Text size="sm">All-UW: paid more than <b>{standing.uw}%</b></Text>
            {standing.sch != null && (
              <Text size="sm">Within {latest?.school}: more than <b>{standing.sch}%</b></Text>
            )}
          </Group>
        </Card>
      )}

      {band && lastRate != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">
            Pay band — grade {latest?.grade_number} (full-time rate vs the official range)
          </Text>
          <PayBandBar min={band.min} max={band.max} value={lastRate} />
        </Card>
      )}

      {lastRate != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Raise / what-if simulator</Text>
          <Text size="xs" c="dimmed" mb="sm">Projects the full-time salary rate; actual pay scales with FTE.</Text>
          <Group align="flex-end" wrap="wrap">
            <NumberInput label="Annual raise %" value={pctRaise} onChange={(v) => setPctRaise(typeof v === 'number' ? v : 0)} w={140} step={0.5} min={0} suffix="%" />
            <NumberInput label="Years" value={years} onChange={(v) => setYears(typeof v === 'number' ? v : 0)} w={120} min={0} max={40} />
            <div>
              <Text size="xs" c="dimmed">Projected full-time rate</Text>
              <Text fw={700} size="lg">{usd(lastRate * Math.pow(1 + pctRaise / 100, years))}</Text>
            </div>
          </Group>
          {band && lastRate >= band.max && (
            <Text size="xs" c="dimmed" mt="xs">
              This rate is already at or above the top of grade {latest?.grade_number}'s pay band ({usd(band.max)}) — effectively maxed out, so there are no years to reach the cap at the current raise rate.
            </Text>
          )}
          {band && lastRate < band.max && pctRaise > 0 && (
            <Text size="xs" c="dimmed" mt="xs">
              At {pctRaise}%/yr, ~{Math.ceil(Math.log(band.max / lastRate) / Math.log(1 + pctRaise / 100))} yrs to reach the band max ({usd(band.max)}).
            </Text>
          )}
        </Card>
      )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Salary over time</Text>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData} margin={{ left: 12, right: 12, top: 18 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="pay" tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
            {showFte && (
              <YAxis
                yAxisId="fte"
                orientation="right"
                domain={[0, fteMax]}
                width={56}
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${Math.round(v * 100)}%`}
                label={{ value: 'FTE', angle: 90, position: 'insideRight', style: { fill: 'var(--mantine-color-teal-7)', fontSize: 12, textAnchor: 'middle' } }}
              />
            )}
            <Tooltip content={<TrendTooltip />} />
            {/* Faint divider + new-title label at each title change, segmenting the chart into title eras. */}
            {titleChanges.map((t) => (
              <ReferenceLine
                key={`div-${t.id}`}
                yAxisId="pay"
                x={t.label}
                stroke="var(--mantine-color-gray-4)"
                strokeWidth={1}
                strokeDasharray="2 4"
                label={{ value: shortTitle(t.title), position: 'top', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }}
              />
            ))}
            {/* Title median drawn as one disconnected segment per era — old/new titles are different baselines. */}
            {eras.map((e) => (
              <Line
                key={`med-${e}`}
                yAxisId="pay"
                type="monotone"
                dataKey={(d) => (d.era === e ? d.med : null)}
                name="Title median"
                stroke="var(--mantine-color-gray-5)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
                legendType="none"
                isAnimationActive={false}
              />
            ))}
            <Line yAxisId="pay" type="monotone" dataKey="salary" name="Actual pay" stroke="var(--mantine-color-indigo-6)" strokeWidth={2} dot />
            {/* Appointment level (FTE) on a right 0–100% axis — only when the person is ever non-full-time. */}
            {showFte && (
              <Line yAxisId="fte" type="monotone" dataKey="fte" name="Appointment (FTE)" stroke="var(--mantine-color-teal-6)" strokeWidth={2} strokeDasharray="4 2" dot connectNulls isAnimationActive={false} legendType="none" />
            )}
            {titleChanges.map((t) =>
              t.salary != null ? (
                <ReferenceDot key={`tc-${t.id}`} yAxisId="pay" x={t.label} y={t.salary} shape={<TitleChangeDot />} />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
        <TrendLegend hasTitleChange={titleChanges.length > 0} showFte={showFte} />
        <ChartData caption="Salary over time" columns={['Snapshot', 'Actual pay', 'Full-time rate', 'Title median']} rows={trendData.map((t) => [t.label, t.salary, t.rate, t.med])} />
      </Card>
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="md">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Title & salary history</Text>
        <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Snapshot</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Job code</Table.Th>
              <Table.Th>School / Dept</Table.Th>
              <Table.Th ta="right">Rate</Table.Th>
              <Table.Th ta="right">Actual pay</Table.Th>
              <Table.Th ta="right">FTE</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {historyRows.map((r, i) => {
              const prior = i > 0 ? historyRows[i - 1] : null;
              const jobChanged = !!prior && r.job_code !== prior.job_code;
              const sameDate = !!prior && String(r.snapshot_date) === String(prior.snapshot_date);
              const ttcReclass = jobChanged && sameDate && (r.salary ?? 0) === (prior?.salary ?? 0);
              const actual = r.salary_fte_adjusted ?? (r.salary ?? 0) * (r.fte ?? 1);
              const priorActual = prior ? (prior.salary_fte_adjusted ?? (prior.salary ?? 0) * (prior.fte ?? 1)) : null;
              const deltaPct = priorActual ? (actual - priorActual) / priorActual : null;
              return (
                <Table.Tr key={`${r.snapshot_id}-${i}`}>
                  <Table.Td>
                    <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                    {(apptCounts.get(r.snapshot_id) ?? 0) > 1 && (
                      <Badge variant="light" color="orange" size="xs" ml={6}>split</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.title ?? '—'}
                    {jobChanged && (
                      <Badge ml="xs" size="xs" variant="light" color={ttcReclass ? 'gray' : 'indigo'}>
                        {ttcReclass ? 'Reclassified (TTC)' : 'New title'}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{r.job_code ?? '—'}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.school ?? '—'}</Text>
                    <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{usd(r.salary)}</Table.Td>
                  <Table.Td ta="right">
                    {usd(actual)}
                    {deltaPct != null && deltaPct !== 0 && (
                      <Text size="xs" c={deltaPct > 0 ? 'teal' : 'red'}>
                        {deltaPct > 0 ? '+' : ''}{pct(deltaPct)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{r.fte ?? '—'}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        </Table.ScrollContainer>
      </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
