import { useMemo } from 'react';
import { Stack, Title, Text, Group, Card, Table, Badge, SimpleGrid, Alert, Paper } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot, Legend } from 'recharts';
import { useSql, useGrades, useSummary } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay } from '../lib/queries';
import { METRIC_LABEL, type Metric } from '../state/controls';
import { usd, num, pct, fullName } from '../lib/format';
import { PeerRangeBar } from './PeerRangeBar';
import { PayBandBar } from './PayBandBar';
import { SalaryHistogram } from './SalaryHistogram';
import { ChartData } from './ChartData';
import { LoadingState } from './Loading';

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
  pay: number | null;
  earn: number | null;
  rate_raw: number | null;
  fte: number | null;
  date_of_hire: string | null;
  grade_number: number | null;
  grade_basis: string | null;
}
interface PeerStats { n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; hi: number | null }

/** Salary-trend hover card: full month, the title at that snapshot (it can change), and salary. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; title: string | null; salary: number; appts?: number; med?: number | null } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Salary: {usd(d.salary)}</Text>
      {d.med != null && <Text size="xs" c="dimmed">Title median: {usd(d.med)}</Text>}
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </Paper>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} fz="lg">{value}</Text>
    </Paper>
  );
}

/**
 * Single-page, print-friendly dashboard for one employee: headline stats, salary/title history
 * over time, and how they compare to others in their title. Reuses the same data shapes and
 * charts as the /person/:id profile, reflowed for a report.
 */
export function PersonDashboard({ personKey, metric }: { personKey: string; metric: Metric }) {
  const expr = salaryExpr(metric);
  const generated = new Date().toISOString().slice(0, 10);

  const { data, isLoading, error } = useSql<Row>(
    ['dash-person', personKey, metric],
    `SELECT first_name, last_name, snapshot_id, snapshot_label, snapshot_date, school, department,
            title, job_code, ${expr} AS pay, ${earningsExpr(metric)} AS earn, salary AS rate_raw, fte, date_of_hire, grade_number, grade_basis
     FROM salaries WHERE person_key = ${sqlStr(personKey)} ORDER BY snapshot_date`,
    !!personKey
  );
  const { data: grades } = useGrades();

  const { data: summary } = useSummary();

  const rows = useMemo(() => data ?? [], [data]);
  const latest = rows[rows.length - 1];
  const name = (latest ? fullName(latest.first_name, latest.last_name) : '') || personKey;

  const campusLatest = summary?.snapshots[summary.snapshots.length - 1] ?? null;
  const departed = !!(latest && campusLatest && String(latest.snapshot_date) < String(campusLatest.date));

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
        // Single appointment → metric value; multiple concurrent → FTE-blended actual earnings.
        const salary = appts > 1 ? g.rows.reduce((s, r) => s + (r.earn ?? 0), 0) : (g.rows[0].pay ?? 0);
        const rate = g.rows.reduce((s, r) => s + (r.rate_raw ?? 0), 0); // full-time rate (for the pay band)
        const primary = g.rows.reduce((best, r) => {
          const bf = best.fte ?? 0, rf = r.fte ?? 0;
          return rf > bf || (rf === bf && (r.pay ?? 0) > (best.pay ?? 0)) ? r : best;
        }, g.rows[0]);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary, rate, title: primary.title, job_code: primary.job_code, appts };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

  const { data: titleMedRows } = useSql<{ snapshot_id: string; med: number | null }>(
    ['dash-title-med', personKey, metric],
    `WITH me AS (SELECT snapshot_id, arg_max(job_code, salary) job FROM salaries
        WHERE person_key = ${sqlStr(personKey)} AND job_code IS NOT NULL GROUP BY snapshot_id),
      pp AS (SELECT s.snapshot_id, s.person_key, ${personPay(metric)} pay
        FROM salaries s JOIN me ON s.snapshot_id = me.snapshot_id AND s.job_code = me.job
        GROUP BY s.snapshot_id, s.person_key)
     SELECT snapshot_id, median(pay) med FROM pp WHERE pay > 0 GROUP BY snapshot_id`,
    !!personKey
  );
  const trendData = useMemo(() => {
    const med = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med]));
    return trend.map((t) => ({ ...t, med: med.get(t.id) ?? null }));
  }, [trend, titleMedRows]);

  const apptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.snapshot_id, (m.get(r.snapshot_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const historyRows = useMemo(() => {
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...rows].sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id));
  }, [rows]);

  const tenureYears = useMemo(() => {
    const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
    if (!hire) return null;
    return Math.max(0, (Date.now() - new Date(hire).getTime()) / (365.25 * 864e5));
  }, [rows]);

  const firstSalary = trend[0]?.salary ?? null;
  const lastSalary = trend[trend.length - 1]?.salary ?? null;
  const lastRate = trend[trend.length - 1]?.rate ?? null; // full-time rate, for the pay-band placement
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;

  const careerLine = useMemo(() => {
    if (!trend.length) return null;
    const firstTitle = trend[0].title;
    const lastTitle = trend[trend.length - 1].title;
    const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
    const hireYear = hire ? String(hire).slice(0, 4) : null;
    const growth = totalChange != null ? ` (${totalChange > 0 ? '+' : ''}${pct(totalChange)} over ${num(trend.length)} salary snapshots)` : '';
    if (firstTitle && lastTitle && firstTitle !== lastTitle) {
      return `${hireYear ? `Joined ${hireYear} as ${firstTitle}` : `Started as ${firstTitle}`}; now ${lastTitle}${growth}.`;
    }
    const t = lastTitle ?? firstTitle;
    if (!t) return null;
    return `${t}${hireYear ? ` since ${hireYear}` : ''}${growth}.`;
  }, [trend, rows, totalChange]);

  const band = useMemo(() => {
    if (!latest || latest.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === latest.grade_number && g.basis === latest.grade_basis) ?? null;
  }, [latest, grades]);

  const lastSnap = latest?.snapshot_id ?? '';
  const { data: standingRows } = useSql<{ uw: number; sch: number | null }>(
    ['dash-standing', personKey, lastSnap, lastSalary ?? 0, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} GROUP BY person_key)
     SELECT round(100.0 * avg(CASE WHEN pay <= ${lastSalary ?? 0} THEN 1 ELSE 0 END), 0) uw,
            round(100.0 * avg(CASE WHEN pay <= ${lastSalary ?? 0} THEN 1 ELSE 0 END) FILTER (WHERE school = ${sqlStr(latest?.school ?? '')}), 0) sch
     FROM pp WHERE pay > 0`,
    !!latest && lastSalary != null && lastSalary > 0
  );
  const standing = standingRows?.[0];

  const jobCode = latest?.job_code ?? null;
  const { data: peerStatsRows } = useSql<PeerStats>(
    ['dash-peer-stats', jobCode ?? '', lastSnap, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peerPayRows } = useSql<{ pay: number }>(
    ['dash-peer-pays', jobCode ?? '', lastSnap, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peerPays = useMemo(() => (peerPayRows ?? []).map((r) => r.pay), [peerPayRows]);
  const peerPct = useMemo(() => {
    if (!peerPays.length || lastSalary == null) return null;
    return Math.round((100 * peerPays.filter((p) => p <= lastSalary).length) / peerPays.length);
  }, [peerPays, lastSalary]);
  const peerRank = useMemo(() => {
    if (!peerPays.length || lastSalary == null) return null;
    return peerPays.filter((p) => p > lastSalary).length + 1;
  }, [peerPays, lastSalary]);

  if (isLoading) return <LoadingState label="Loading report…" />;
  if (error) return <Alert color="red">Failed to load person: {(error as Error).message}</Alert>;
  if (!rows.length) return <Alert color="gray">No records found for this person.</Alert>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Employee Report — {name}</Title>
        <Text c="dimmed">
          {[
            latest?.title,
            latest?.grade_number != null ? `grade ${latest.grade_number}` : null,
            latest?.school,
            latest?.department,
          ].filter(Boolean).join(' · ')}
          {latest?.title ? ' · ' : ''}as of {latest?.snapshot_label} · {METRIC_LABEL[metric]} · generated {generated}
        </Text>
        {careerLine && <Text size="sm" c="dimmed" mt={4}>{careerLine}</Text>}
      </div>

      {departed && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          Not in the latest snapshot ({campusLatest?.label}) — may no longer be employed. Last seen {latest?.snapshot_label}.
        </Alert>
      )}

      {/* Headline stats */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Current salary" value={usd(lastSalary)} />
        <Stat label="Tenure" value={tenureYears != null ? `${tenureYears.toFixed(1)} yrs` : '—'} />
        <Stat label="Total growth (first→latest)" value={totalChange == null ? '—' : `${(totalChange * 100).toFixed(1)}%`} />
        <Stat label="Salary snapshots on record" value={num(trend.length)} />
        <Stat label="Among title peers" value={peerPct != null ? `top ${100 - peerPct}%` : '—'} />
        <Stat label="All-UW standing" value={standing ? `more than ${standing.uw}%` : '—'} />
        {standing?.sch != null && <Stat label={`Within ${latest?.school ?? 'school'}`} value={`more than ${standing.sch}%`} />}
      </SimpleGrid>

      {/* Salary over time */}
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Salary over time</Text>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
            <Tooltip content={<TrendTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="med" name="Title median" stroke="var(--mantine-color-dimmed)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
            <Line type="monotone" dataKey="salary" name="Salary" stroke="var(--mantine-color-indigo-6)" strokeWidth={2} dot />
            {trendData.map((t, i) =>
              i > 0 && t.job_code !== trendData[i - 1].job_code && t.salary != null ? (
                <ReferenceDot key={`tc-${t.id}`} x={t.label} y={t.salary} r={6} fill="var(--mantine-color-indigo-7)" stroke="var(--mantine-color-body)" strokeWidth={2} />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
        <Text size="xs" c="dimmed" mt={4}>Ringed dots mark a title/role change; the dashed line is the median for the title held at the time.</Text>
        <ChartData caption="Salary over time" columns={['Snapshot', 'Salary', 'Title median']} rows={trendData.map((t) => [t.label, t.salary, t.med])} />
      </Card>

      {/* Title & salary history */}
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Title &amp; salary history</Text>
        <Table.ScrollContainer minWidth={680}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Snapshot</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Job code</Table.Th>
              <Table.Th>School / Dept</Table.Th>
              <Table.Th ta="right">Salary</Table.Th>
              <Table.Th ta="right">FTE</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {historyRows.map((r, i) => {
              const prior = i > 0 ? historyRows[i - 1] : null;
              const jobChanged = !!prior && r.job_code !== prior.job_code;
              const sameDate = !!prior && String(r.snapshot_date) === String(prior.snapshot_date);
              const ttcReclass = jobChanged && sameDate && (r.pay ?? 0) === (prior?.pay ?? 0);
              const deltaPct = prior && prior.pay ? ((r.pay ?? 0) - prior.pay) / prior.pay : null;
              return (
              <Table.Tr key={`${r.snapshot_id}-${i}`}>
                <Table.Td>
                  <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                  {(apptCounts.get(r.snapshot_id) ?? 0) > 1 && (
                    <Badge variant="light" color="orange" size="xs" ml={6}>split</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.title ?? '—'}</Text>
                  {jobChanged && (
                    <Badge variant="light" color={ttcReclass ? 'gray' : 'indigo'} size="xs" mt={2}>
                      {ttcReclass ? 'Reclassified (TTC)' : 'New title'}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{r.job_code ?? '—'}</Table.Td>
                <Table.Td>
                  <Text size="sm">{r.school ?? '—'}</Text>
                  <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  {usd(r.pay)}
                  {deltaPct != null && deltaPct !== 0 && (
                    <Text size="xs" c={deltaPct > 0 ? 'teal' : 'red'}>{deltaPct > 0 ? '+' : ''}{pct(deltaPct)}</Text>
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

      {/* Same-title comparison (compact) */}
      {peer && peer.n === 1 && jobCode && (
        <Card withBorder padding="lg">
          <Text size="sm">
            {name} is the only employee at UW with the title {latest?.title} (job code {jobCode}) in the latest snapshot — no one else to compare against.
          </Text>
        </Card>
      )}

      {peer && peer.n > 1 && lastSalary != null && jobCode &&
        peer.lo != null && peer.p25 != null && peer.med != null && peer.p75 != null && peer.hi != null && (
        <Card withBorder padding="lg">
          <Group justify="space-between" mb="md" wrap="nowrap">
            <Text size="sm" fw={600}>How {name} compares to others with the title {latest?.title}</Text>
            {peerRank != null && <Text size="sm" c="dimmed">ranks <b>#{peerRank}</b> of {num(peer.n)} by salary</Text>}
          </Group>
          <PeerRangeBar min={peer.lo} p25={peer.p25} median={peer.med} p75={peer.p75} max={peer.hi} value={lastSalary} />
          {peerPct != null && (
            <Text size="sm" mt="sm">Paid more than <b>{peerPct}%</b> of people with this title.</Text>
          )}
          <Text size="xs" c="dimmed" mt={4} mb="md">
            Among {num(peer.n)} people with job code {jobCode} in the latest snapshot.
          </Text>
          <SalaryHistogram
            values={peerPays}
            markerValue={lastSalary}
            markerLabel="this person"
            tooFewText={`Only ${num(peer.n)} ${peer.n === 1 ? 'person has' : 'people have'} this title — too few to chart a distribution.`}
          />
        </Card>
      )}

      {/* Pay band */}
      {band && lastRate != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Pay band — grade {latest?.grade_number} (full-time rate vs the official range)</Text>
          <PayBandBar min={band.min} max={band.max} value={lastRate} />
        </Card>
      )}

      <Text size="xs" c="dimmed" mt="md">
        Source: UW–Madison salary data (Wisconsin public record), {METRIC_LABEL[metric]}. Title comparison uses everyone
        sharing this person's job code in their latest snapshot. Pay-band ranges are best-effort and only partially seeded.
        Person identity is matched on name + date of hire and is best-effort.
      </Text>
    </Stack>
  );
}
