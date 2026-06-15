import { useEffect, useState } from 'react';
import { Stack, Card, Text, Group, Select, SimpleGrid, Table, Alert, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, scopeWhere } from '../lib/queries';
import { usd, num, pct } from '../lib/format';

interface Mover { person_key: string; fn: string; ln: string; title: string | null; a_pay: number; b_pay: number; delta: number; pct: number }
interface Promo { person_key: string; fn: string; ln: string; a_title: string | null; b_title: string | null; delta: number | null }
interface SummaryRow { stayers: number; joiners: number; leavers: number; title_changes: number; median_raise: number | null }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600}>{value}</Text>
    </Card>
  );
}

export function ChangesPanel() {
  const { scope, metric } = useControls();
  const expr = salaryExpr(metric);
  const where = scopeWhere(scope);
  const { data: summary } = useSummary();
  const snaps = summary?.snapshots ?? [];

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  useEffect(() => {
    if (snaps.length >= 2 && !fromId && !toId) {
      setFromId(snaps[snaps.length - 2].id);
      setToId(snaps[snaps.length - 1].id);
    }
  }, [snaps, fromId, toId]);

  const enabled = !!fromId && !!toId && fromId !== toId;
  const A = sqlStr(fromId ?? '');
  const B = sqlStr(toId ?? '');
  const scopeKey = scope.kind === 'school' ? scope.value : '';
  const cte = `WITH a AS (SELECT person_key, sum(${expr}) pay, arg_max(job_code, salary) job, arg_max(title, salary) title
                          FROM salaries WHERE snapshot_id = ${A} AND ${where} GROUP BY person_key),
                    b AS (SELECT person_key, sum(${expr}) pay, arg_max(job_code, salary) job, arg_max(title, salary) title,
                                 any_value(first_name) fn, any_value(last_name) ln
                          FROM salaries WHERE snapshot_id = ${B} AND ${where} GROUP BY person_key)`;

  const { data: sumData } = useSql<SummaryRow>(
    ['chg-sum', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL) stayers,
            count(*) FILTER (WHERE a.person_key IS NULL) joiners,
            count(*) FILTER (WHERE b.person_key IS NULL) leavers,
            count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL AND a.job IS DISTINCT FROM b.job) title_changes,
            median((b.pay - a.pay) / a.pay) FILTER (WHERE a.pay > 0 AND b.pay > 0) median_raise
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key`,
    enabled
  );
  const s = sumData?.[0];

  const moverSelect = `${cte}
     SELECT b.person_key, b.fn, b.ln, b.title, a.pay a_pay, b.pay b_pay, (b.pay - a.pay) delta, (b.pay - a.pay) / a.pay pct
     FROM a JOIN b ON a.person_key = b.person_key WHERE a.pay > 0 AND b.pay > 0`;
  const { data: raises } = useSql<Mover>(['chg-raise', fromId, toId, scopeKey, metric], `${moverSelect} ORDER BY delta DESC LIMIT 12`, enabled);
  const { data: cuts } = useSql<Mover>(['chg-cut', fromId, toId, scopeKey, metric], `${moverSelect} ORDER BY delta ASC LIMIT 12`, enabled);
  const { data: promos } = useSql<Promo>(
    ['chg-promo', fromId, toId, scopeKey, metric],
    `${cte} SELECT b.person_key, b.fn, b.ln, a.title a_title, b.title b_title, (b.pay - a.pay) delta
     FROM a JOIN b ON a.person_key = b.person_key WHERE a.job IS DISTINCT FROM b.job ORDER BY delta DESC LIMIT 12`,
    enabled
  );

  const isTTC = !!fromId && !!toId && fromId.includes('pre') && toId.includes('post');
  const opts = [...snaps].reverse().map((x) => ({ value: x.id, label: x.label }));

  const moverRows = (rows?: Mover[]) =>
    (rows ?? []).map((m) => (
      <Table.Tr key={m.person_key}>
        <Table.Td>
          <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{m.fn} {m.ln}</Anchor>
          <Text size="xs" c="dimmed">{m.title}</Text>
        </Table.Td>
        <Table.Td ta="right">{usd(m.a_pay)} → {usd(m.b_pay)}</Table.Td>
        <Table.Td ta="right" c={m.delta >= 0 ? 'teal' : 'red'}>{m.delta >= 0 ? '+' : ''}{usd(m.delta)}</Table.Td>
        <Table.Td ta="right">{pct(m.pct)}</Table.Td>
      </Table.Tr>
    ));

  return (
    <Stack gap="lg">
      <Group>
        <Select size="xs" w={170} label="From" data={opts} value={fromId} onChange={setFromId} allowDeselect={false} />
        <Select size="xs" w={170} label="To" data={opts} value={toId} onChange={setToId} allowDeselect={false} />
      </Group>

      {isTTC && (
        <Alert color="blue" title="TTC reclassification boundary">
          This pair spans the Nov-2021 Title &amp; Total Compensation restructure — nearly everyone's title/job
          code changed at once. Treat "title changes" here as a structural reclassification, not promotions.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        <Stat label="Continuing" value={num(s?.stayers)} />
        <Stat label="New hires" value={num(s?.joiners)} />
        <Stat label="Departures" value={num(s?.leavers)} />
        <Stat label="Title changes" value={num(s?.title_changes)} />
        <Stat label="Median raise" value={s?.median_raise == null ? '—' : pct(s.median_raise)} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Biggest raises</Text>
          <Table><Table.Tbody>{moverRows(raises)}</Table.Tbody></Table>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Biggest decreases</Text>
          <Table><Table.Tbody>{moverRows(cuts)}</Table.Tbody></Table>
        </Card>
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="sm">Title / job-code changes {isTTC ? '(reclassification)' : '(promotions & laterals)'}</Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>From → To title</Table.Th>
              <Table.Th ta="right">Pay change</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(promos ?? []).map((p) => (
              <Table.Tr key={p.person_key}>
                <Table.Td>
                  <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`}>{p.fn} {p.ln}</Anchor>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.a_title ?? '—'} → {p.b_title ?? '—'}</Text>
                </Table.Td>
                <Table.Td ta="right" c={(p.delta ?? 0) >= 0 ? 'teal' : 'red'}>
                  {p.delta == null ? '—' : `${p.delta >= 0 ? '+' : ''}${usd(p.delta)}`}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
