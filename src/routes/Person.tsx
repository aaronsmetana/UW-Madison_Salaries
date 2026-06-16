import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Stack, Title, Text, Group, Button, Card, Table, Badge, Loader, Alert, SimpleGrid, Anchor, NumberInput, Tabs,
} from '@mantine/core';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useSql, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { useTray } from '../state/tray';
import { usd, num } from '../lib/format';
import { PayBandBar } from '../components/PayBandBar';
import { PeerRangeBar } from '../components/PeerRangeBar';
import { ChartData } from '../components/ChartData';

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

  // Salary trend: sum appointments within each snapshot.
  const trend = useMemo(() => {
    const by = new Map<string, { id: string; label: string; date: string; salary: number }>();
    for (const r of rows) {
      const cur = by.get(r.snapshot_id) ?? { id: r.snapshot_id, label: r.snapshot_label, date: r.snapshot_date, salary: 0 };
      cur.salary += r.salary ?? 0;
      by.set(r.snapshot_id, cur);
    }
    // Same-date TTC pair: show pre-TTC to the left of post-TTC.
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...by.values()].sort(
      (a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id)
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
    `WITH pp AS (SELECT person_key, sum(salary) pay, any_value(school) school FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} GROUP BY person_key)
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
    `WITH pp AS (SELECT person_key, sum(salary) pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peers } = useSql<PeerRow>(
    ['peer-list', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, sum(salary) pay
        FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, fn, ln, pay FROM pp WHERE pay > 0 ORDER BY pay DESC LIMIT 25`,
    !!lastSnap && !!jobCode
  );

  const [pctRaise, setPctRaise] = useState<number>(3);
  const [years, setYears] = useState<number>(5);

  if (isLoading) return <Loader />;
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
                <Text size="xs" c="dimmed">Snapshots present</Text>
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
                <Text size="xs" c="dimmed" mt="sm">
                  Among {num(peer.n)} people with the title {latest?.title} (job code {jobCode}) in the latest snapshot.
                </Text>
              </Card>
            )}

            {peers && peers.length > 1 && (
              <Card withBorder padding="lg">
                <Text size="sm" fw={600} mb="md">Others with this title</Text>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th ta="right">Salary</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {peers.map((p) => {
                      const isYou = p.person_key === key;
                      return (
                        <Table.Tr
                          key={p.person_key}
                          onClick={() => !isYou && nav(`/person/${encodeURIComponent(p.person_key)}`)}
                          style={{ cursor: isYou ? 'default' : 'pointer' }}
                        >
                          <Table.Td>
                            <Text size="sm" c={isYou ? undefined : 'indigo'} fw={isYou ? 700 : undefined}>
                              {`${p.fn ?? ''} ${p.ln ?? ''}`.trim() || '—'}
                            </Text>
                            {isYou && <Badge ml="xs" size="xs" variant="light">this person</Badge>}
                          </Table.Td>
                          <Table.Td ta="right">{usd(p.pay)}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
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
            <Tooltip formatter={(v: number) => usd(v)} />
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
            {rows.map((r, i) => (
              <Table.Tr key={`${r.snapshot_id}-${i}`}>
                <Table.Td>
                  <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
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
