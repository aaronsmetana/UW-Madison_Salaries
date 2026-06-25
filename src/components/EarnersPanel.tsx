import { useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, Stack } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconSearch, IconDownload } from '@tabler/icons-react';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { salaryExpr, personPay, snapWhere, whereAll, filterKey } from '../lib/queries';
import { usd, num, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { SegmentedToggle } from './SegmentedToggle';
import { MiniBar } from './MiniBar';

interface EarnerRow {
  person_key: string; fn: string; ln: string; title: string | null; job_code: string | null;
  school: string | null; department: string | null; fte: number | null; pay: number;
}

/** ▲/▼ movement vs the previous snapshot's pay rank (or "new" to the top ranks). */
function RankDelta({ prev, cur }: { prev?: number; cur: number }) {
  if (prev == null) return <Text span style={{ fontSize: 10 }} c="accent.6">new</Text>;
  const d = prev - cur;
  if (d === 0) return <Text span style={{ fontSize: 10 }} c="dimmed">—</Text>;
  const up = d > 0;
  return <Text span style={{ fontSize: 10 }} c={up ? 'pos' : 'red'}>{up ? '▲' : '▼'}{Math.abs(d)}</Text>;
}

export function EarnersPanel() {
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const { data: summary } = useSummary();
  const expr = salaryExpr(metric);
  const scopeVal = scope.kind === 'school' ? scope.value : '';
  const fk = filterKey(filters);
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const [limit, setLimit] = useState(100);
  const [q, setQ] = useState('');

  const { data: earnersRaw } = useSql<EarnerRow>(
    ['top-earners', snap ?? '', scope.kind, scopeVal, metric, fk, limit],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        arg_max(title, salary) title, arg_max(job_code, salary) job_code,
        arg_max(school, salary) school, arg_max(department, salary) department,
        sum(fte) FILTER (WHERE salary > 0) fte, ${personPay(metric)} pay
     FROM salaries WHERE ${where} AND ${expr} > 0
     GROUP BY person_key ORDER BY pay DESC LIMIT ${limit}`,
    !!snap
  );
  const earners = useMemo(() => earnersRaw ?? [], [earnersRaw]);

  // Previous distinct-date snapshot, for pay-rank movement.
  const snapsAsc = summary?.snapshots ?? [];
  const cur = snapsAsc.find((s) => s.id === snap);
  const prevSnap = cur ? [...snapsAsc].filter((s) => s.date < cur.date).at(-1) : undefined;
  const { data: prevRanks } = useSql<{ person_key: string; rnk: number }>(
    ['earners-prevrank', prevSnap?.id ?? '', scope.kind, scopeVal, metric, fk],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE ${snapWhere(prevSnap?.id ?? '')} AND ${whereAll(scope, filters)} GROUP BY person_key HAVING ${personPay(metric)} > 0)
     SELECT person_key, rnk FROM (SELECT person_key, row_number() OVER (ORDER BY pay DESC) rnk FROM pp) WHERE rnk <= 2000`,
    !!snap && !!prevSnap
  );
  const prevRankMap = useMemo(() => new Map((prevRanks ?? []).map((r) => [r.person_key, r.rnk])), [prevRanks]);

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return earners;
    return earners.filter((e) => fullName(e.fn, e.ln).toLowerCase().includes(t) || (e.title ?? '').toLowerCase().includes(t));
  }, [earners, q]);

  const maxPay = earners[0]?.pay ?? 1;

  const exportCsv = () =>
    downloadCSV(
      `uw-top-${limit}-earners-${snap ?? 'latest'}.csv`,
      earners.map((e, i) => ({
        rank: i + 1, name: fullName(e.fn, e.ln), title: e.title ?? '', job_code: e.job_code ?? '',
        school: e.school ?? '', department: e.department ?? '', fte: e.fte ?? '', pay: Math.round(e.pay),
      }))
    );

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <TextInput
          size="md" w={300} placeholder="Search name or title…"
          leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Group gap="sm" wrap="nowrap">
          <SegmentedToggle
            size="xs" label="Show top" value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[{ id: '25', label: '25' }, { id: '100', label: '100' }, { id: '500', label: '500' }]}
          />
          <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportCsv} disabled={!earners.length}>
            CSV
          </Button>
        </Group>
      </Group>

      <ScrollArea.Autosize mah={560} type="auto" offsetScrollbars="present">
        <Table stickyHeader miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={56} ta="right">#</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>School</Table.Th>
              <Table.Th ta="right">FTE</Table.Th>
              <Table.Th ta="right">Pay</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((e) => {
              const realRank = earners.indexOf(e) + 1;
              return (
                <Table.Tr key={e.person_key}>
                  <Table.Td ta="right">
                    <Text span c="dimmed">{realRank}</Text>
                    {prevSnap && <div style={{ lineHeight: 1.1 }}><RankDelta prev={prevRankMap.get(e.person_key)} cur={realRank} /></div>}
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={`/person/${encodeURIComponent(e.person_key)}`}>{fullName(e.fn, e.ln)}</Anchor>
                    {e.department && <Text size="xs" c="dimmed" lineClamp={1}>{e.department}</Text>}
                  </Table.Td>
                  <Table.Td>
                    {e.job_code
                      ? <Anchor component={Link} to={`/paycheck?code=${encodeURIComponent(e.job_code)}`} c="var(--mantine-color-text)" underline="hover">{e.title ?? '—'}</Anchor>
                      : (e.title ?? '—')}
                  </Table.Td>
                  <Table.Td><Text span size="sm" lineClamp={1}>{e.school ?? '—'}</Text></Table.Td>
                  <Table.Td ta="right" c={e.fte != null && e.fte < 0.95 ? 'orange' : 'dimmed'}>{e.fte != null ? e.fte.toFixed(2) : '—'}</Table.Td>
                  <Table.Td ta="right">
                    {usd(e.pay)}
                    <MiniBar frac={e.pay / maxPay} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>

      <Stack gap={2} mt="xs">
        <Text size="xs" c="dimmed">
          Showing the top {num(view.length)}{q ? ` of ${num(earners.length)}` : ''} by pay in this scope. Pay is each
          person's annual rate for the snapshot (FTE-blended actual earnings when someone holds multiple appointments);
          an FTE below 1.00 (amber) means a partial appointment, so the rate is more than they actually earned.
        </Text>
        <Text size="xs" c="dimmed">
          Coaches and senior leaders may also receive deferred or supplemental compensation not captured here.
          {prevSnap ? ` ▲/▼ shows pay-rank movement since ${prevSnap.label}.` : ''}
        </Text>
      </Stack>
    </>
  );
}
