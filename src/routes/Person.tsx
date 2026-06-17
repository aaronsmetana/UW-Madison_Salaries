import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Stack, Title, Text, Group, Button, Card, Table, Badge, Alert, SimpleGrid, Anchor, NumberInput, Tabs, Paper, ScrollArea,
} from '@mantine/core';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useSql, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num } from '../lib/format';
import { PayBandBar } from '../components/PayBandBar';
import { PeerRangeBar } from '../components/PeerRangeBar';
import { SalaryHistogram } from '../components/SalaryHistogram';
import { ChartData } from '../components/ChartData';
import { LoadingState } from '../components/Loading';

/** Salary-trend hover card: full month, the title at that snapshot (it can change), and salary. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; title: string | null; salary: number; appts?: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Salary: {usd(d.salary)}</Text>
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </Paper>
  );
}

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
interface PeerRow { person_key: string; fn: string | null; ln: string | null; pay: number }

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

  const rows = data ?? [];
  const latest = rows[rows.length - 1];
  const name = latest ? `${latest.first_name ?? ''} ${latest.last_name ?? ''}`.trim() : key;

  // Salary trend: one point per snapshot. Single appointment → its full rate; multiple concurrent
  // appointments → FTE-blended actual earnings (Σ rate × FTE), not the nonsensical sum of full rates.
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
        const salary = appts > 1
          ? g.rows.reduce((s, r) => s + (r.salary ?? 0) * (r.fte ?? 1), 0)
          : (g.rows[0].salary ?? 0);
        // primary appointment = highest FTE (tie-break highest salary) — drives the displayed title
        const primary = g.rows.reduce((best, r) => {
          const bf = best.fte ?? 0, rf = r.fte ?? 0;
          return rf > bf || (rf === bf && (r.salary ?? 0) > (best.salary ?? 0)) ? r : best;
        }, g.rows[0]);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary, title: primary.title, appts };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

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

  const firstSalary = trend[0]?.salary ?? null;
  const lastSalary = trend[trend.length - 1]?.salary ?? null;
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;

  const band = useMemo(() => {
    if (!latest || latest.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === latest.grade_number && g.basis === latest.grade_basis) ?? null;
  }, [latest, grades]);

  const lastSnap = latest?.snapshot_id ?? '';
  const { data: standingRows } = useSql<{ uw: number; sch: number | null }>(
    ['standing', key, lastSnap, lastSalary ?? 0],
    `WITH pp AS (SELECT person_key, ${personPay('full')} pay, any_value(school) school FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} GROUP BY person_key)
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
    `WITH pp AS (SELECT person_key, ${personPay('full')} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peers } = useSql<PeerRow>(
    ['peer-list', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, ${personPay('full')} pay
        FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, fn, ln, pay FROM pp WHERE pay > 0 ORDER BY pay DESC`,
    !!lastSnap && !!jobCode
  );
  const peerRank = useMemo(() => {
    const i = (peers ?? []).findIndex((p) => p.person_key === key);
    return i >= 0 ? i + 1 : null;
  }, [peers, key]);

  const { data: peerPayRows } = useSql<{ pay: number }>(
    ['peer-pays', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, ${personPay('full')} pay FROM salaries
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
        </div>
        <Button
          variant={has(key) ? 'light' : 'filled'}
          onClick={() => add({ type: 'person', id: key, label: name })}
          disabled={has(key)}
        >
          {has(key) ? 'In tray' : '+ Add to tray'}
        </Button>
      </Group>

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
              <Text size="sm" c="dimmed">Latest salary{latest?.snapshot_label ? ` · ${latest.snapshot_label}` : ''}</Text>
              <Title order={1} style={{ fontSize: '2.5rem', lineHeight: 1.1 }}>{usd(lastSalary)}</Title>
              {latest?.title && <Text size="sm" c="dimmed" mt={4}>{latest.title}</Text>}
            </Card>

            <SimpleGrid cols={{ base: 3, sm: 3 }}>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Change (first→latest)</Text>
                <Text fw={600}>{totalChange == null ? '—' : `${(totalChange * 100).toFixed(1)}%`}</Text>
              </Card>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Tenure</Text>
                <Text fw={600}>{tenureYears == null ? '—' : `${tenureYears.toFixed(1)} yrs`}</Text>
              </Card>
              <Card withBorder padding="md">
                <Text size="xs" c="dimmed">Salary Snapshots With Persons Name Available</Text>
                <Text fw={600}>{num(trend.length)}</Text>
              </Card>
            </SimpleGrid>

            {peer && peer.n > 0 && lastSalary != null && jobCode &&
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
                <ScrollArea.Autosize mah={460} type="auto" viewportRef={peerViewportRef}>
                  <Table striped highlightOnHover stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={48} ta="right">#</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th ta="right">Salary</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {peers.map((p, i) => {
                        const isYou = p.person_key === key;
                        return (
                          <Table.Tr
                            key={p.person_key}
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
                                {`${p.fn ?? ''} ${p.ln ?? ''}`.trim() || '—'}
                              </Text>
                              {isYou && <Badge ml="xs" size="xs" variant="filled">this person</Badge>}
                            </Table.Td>
                            <Table.Td ta="right" fw={isYou ? 700 : undefined}>{usd(p.pay)}</Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
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

      {band && lastSalary != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">
            Pay band — grade {latest?.grade_number} (latest snapshot)
          </Text>
          <PayBandBar min={band.min} max={band.max} value={lastSalary} />
        </Card>
      )}

      {lastSalary != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Raise / what-if simulator</Text>
          <Group align="flex-end" wrap="wrap">
            <NumberInput label="Annual raise %" value={pctRaise} onChange={(v) => setPctRaise(typeof v === 'number' ? v : 0)} w={140} step={0.5} min={0} suffix="%" />
            <NumberInput label="Years" value={years} onChange={(v) => setYears(typeof v === 'number' ? v : 0)} w={120} min={0} max={40} />
            <div>
              <Text size="xs" c="dimmed">Projected salary</Text>
              <Text fw={700} size="lg">{usd(lastSalary * Math.pow(1 + pctRaise / 100, years))}</Text>
            </div>
          </Group>
          {band && lastSalary >= band.max && (
            <Text size="xs" c="dimmed" mt="xs">
              This salary is already at or above the top of grade {latest?.grade_number}'s pay band ({usd(band.max)}) — effectively maxed out, so there are no years to reach the cap at the current raise rate.
            </Text>
          )}
          {band && lastSalary < band.max && pctRaise > 0 && (
            <Text size="xs" c="dimmed" mt="xs">
              At {pctRaise}%/yr, ~{Math.ceil(Math.log(band.max / lastSalary) / Math.log(1 + pctRaise / 100))} yrs to reach the band max ({usd(band.max)}).
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
          <LineChart data={trend} margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => usd(v)} width={80} tick={{ fontSize: 12 }} />
            <Tooltip content={<TrendTooltip />} />
            <Line type="monotone" dataKey="salary" stroke="var(--mantine-color-indigo-6)" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
        <ChartData caption="Salary over time" columns={['Snapshot', 'Salary']} rows={trend.map((t) => [t.label, t.salary])} />
      </Card>
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="md">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Title & salary history</Text>
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
            {historyRows.map((r, i) => (
              <Table.Tr key={`${r.snapshot_id}-${i}`}>
                <Table.Td>
                  <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                  {(apptCounts.get(r.snapshot_id) ?? 0) > 1 && (
                    <Badge variant="light" color="orange" size="xs" ml={6}>split</Badge>
                  )}
                </Table.Td>
                <Table.Td>{r.title ?? '—'}</Table.Td>
                <Table.Td>{r.job_code ?? '—'}</Table.Td>
                <Table.Td>
                  <Text size="sm">{r.school ?? '—'}</Text>
                  <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                </Table.Td>
                <Table.Td ta="right">{usd(r.salary)}</Table.Td>
                <Table.Td ta="right">{r.fte ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
