import { useParams, Link } from 'react-router-dom';
import { Stack, Title, Text, Card, Table, Anchor, Loader, Alert, SimpleGrid, Badge } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { useControls } from '../state/controls';
import { salaryExpr } from '../lib/queries';
import { usd, num } from '../lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600}>{value}</Text>
    </Card>
  );
}

export default function TitlePage() {
  const { code } = useParams();
  const jobCode = decodeURIComponent(code ?? '');
  const snap = useActiveSnapshotId();
  const { metric } = useControls();
  const expr = salaryExpr(metric);
  const enabled = !!snap && !!jobCode;
  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode)}`;

  const { data: hdr, isLoading } = useSql<{ title: string; n: number; med: number | null; lo: number | null; hi: number | null }>(
    ['title-hdr', jobCode, snap ?? '', metric],
    `SELECT arg_max(title, salary) title, count(DISTINCT person_key) n,
        median(${expr}) FILTER (WHERE ${expr} > 0) med, min(${expr}) FILTER (WHERE ${expr} > 0) lo, max(${expr}) FILTER (WHERE ${expr} > 0) hi
     FROM salaries WHERE ${base}`,
    enabled
  );
  const h = hdr?.[0];

  const { data: bySchool } = useSql<{ school: string; n: number; med: number | null }>(
    ['title-school', jobCode, snap ?? '', metric],
    `SELECT school, count(DISTINCT person_key) n, median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${base} AND school IS NOT NULL GROUP BY school ORDER BY n DESC`,
    enabled
  );

  const { data: dist } = useSql<{ bucket: number; n: number }>(
    ['title-dist', jobCode, snap ?? '', metric],
    `SELECT (floor(${expr} / 20000) * 20000)::BIGINT bucket, count(*) n FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY 1 ORDER BY 1`,
    enabled
  );
  const distData = (dist ?? []).map((d) => ({ label: `${Math.round(d.bucket / 1000)}k`, n: d.n }));

  const { data: people } = useSql<{ person_key: string; fn: string; ln: string; school: string | null; pay: number }>(
    ['title-people', jobCode, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(school) school, sum(${expr}) pay
     FROM salaries WHERE ${base} AND ${expr} > 0 GROUP BY person_key ORDER BY pay DESC LIMIT 25`,
    enabled
  );

  if (isLoading) return <Loader />;
  if (h && h.n === 0) return <Alert color="gray">No people with job code {jobCode} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{h?.title ?? jobCode}</Title>
        <Text c="dimmed">Job code <Badge variant="light">{jobCode}</Badge> · market view across UW (current snapshot)</Text>
      </div>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="People" value={num(h?.n)} />
        <Stat label="Median" value={usd(h?.med)} />
        <Stat label="Lowest" value={usd(h?.lo)} />
        <Stat label="Highest" value={usd(h?.hi)} />
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Pay by school (market view)</Text>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>School</Table.Th>
              <Table.Th ta="right">People</Table.Th>
              <Table.Th ta="right">Median</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(bySchool ?? []).map((s) => (
              <Table.Tr key={s.school}>
                <Table.Td>
                  <Anchor component={Link} to={`/school/${encodeURIComponent(s.school)}`}>{s.school}</Anchor>
                </Table.Td>
                <Table.Td ta="right">{num(s.n)}</Table.Td>
                <Table.Td ta="right">{usd(s.med)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Salary distribution ($20k bins)</Text>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={distData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis width={48} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="n" fill="var(--mantine-color-indigo-5)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Highest paid in this title</Text>
        <Table>
          <Table.Tbody>
            {(people ?? []).map((p) => (
              <Table.Tr key={p.person_key}>
                <Table.Td>
                  <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`}>{p.fn} {p.ln}</Anchor>
                  <Text size="xs" c="dimmed">{p.school}</Text>
                </Table.Td>
                <Table.Td ta="right">{usd(p.pay)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
