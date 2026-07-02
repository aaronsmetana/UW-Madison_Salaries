import { useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, Stack, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconSearch, IconSearchOff, IconDownload } from '@tabler/icons-react';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { salaryExpr, personPay, snapWhere, whereAll, filterKey } from '../lib/queries';
import { usd, num, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { SegmentedToggle } from './SegmentedToggle';
import { MiniBar } from './MiniBar';
import { RankDeltaChip } from './Delta';
import { SortableTh, type SortState } from './SortableTh';
import { GlossaryTerm } from './GlossaryTerm';
import { EmptyState } from './EmptyState';

interface EarnerRow {
  person_key: string; fn: string; ln: string; title: string | null; job_code: string | null;
  school: string | null; department: string | null; fte: number | null; pay: number;
}

type SortKey = 'name' | 'title' | 'school' | 'fte' | 'pay';

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
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'pay', dir: 'desc' });

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

  // Pay rank is anchored to the underlying pay-desc query order, independent of the table's current
  // display sort — "#12" always means "12th highest pay in this scope," not "12th row shown."
  const payRank = useMemo(() => new Map(earners.map((e, i) => [e.person_key, i + 1])), [earners]);

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = t
      ? earners.filter((e) => fullName(e.fn, e.ln).toLowerCase().includes(t) || (e.title ?? '').toLowerCase().includes(t))
      : earners;
    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      switch (sort.key) {
        case 'name': cmp = fullName(a.fn, a.ln).localeCompare(fullName(b.fn, b.ln)); break;
        case 'title': cmp = (a.title ?? '').localeCompare(b.title ?? ''); break;
        case 'school': cmp = (a.school ?? '').localeCompare(b.school ?? ''); break;
        case 'fte': cmp = (a.fte ?? 0) - (b.fte ?? 0); break;
        default: cmp = a.pay - b.pay;
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [earners, q, sort]);

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

      {earnersRaw && view.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconSearchOff size={18} />}
          title="No one matches"
          hint={`Nothing in this scope${q ? ' matches your search' : ''}. Try widening the scope or clearing filters.`}
        />
      ) : (
      <ScrollArea.Autosize mah={560} type="auto" offsetScrollbars="present">
        <Table stickyHeader miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={56} ta="right">#</Table.Th>
              <SortableTh sortKey="name" label="Name" sort={sort} onSort={setSort} />
              <SortableTh sortKey="title" label="Title" sort={sort} onSort={setSort} />
              <SortableTh sortKey="school" label="School" sort={sort} onSort={setSort} />
              <SortableTh sortKey="fte" label={<GlossaryTerm term="fte">FTE</GlossaryTerm>} sort={sort} onSort={setSort} align="right" />
              <SortableTh sortKey="pay" label="Pay" sort={sort} onSort={setSort} align="right" />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((e) => {
              const realRank = payRank.get(e.person_key) ?? 0;
              return (
                <Table.Tr key={e.person_key}>
                  <Table.Td ta="right">
                    <Text span c="dimmed">{realRank}</Text>
                    {prevSnap && <div style={{ lineHeight: 1.1 }}><RankDeltaChip prev={prevRankMap.get(e.person_key)} cur={realRank} /></div>}
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
                  <Table.Td ta="right" c={e.fte != null && Math.abs(e.fte - 1) > 0.005 ? 'orange' : 'dimmed'}>
                    {e.fte == null ? '—' : Math.abs(e.fte - 1) > 0.005 ? (
                      <Tooltip label={e.fte < 1 ? 'Part-time appointment' : 'Combined FTE across multiple appointments'} withArrow>
                        <span>{e.fte.toFixed(2)}</span>
                      </Tooltip>
                    ) : e.fte.toFixed(2)}
                  </Table.Td>
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
      )}

      <Stack gap={2} mt="xs">
        <Text size="xs" c="dimmed">
          Showing the top {num(view.length)}{q ? ` of ${num(earners.length)}` : ''} by pay in this scope. Pay is each
          person's annual rate for the snapshot (FTE-blended actual earnings when someone holds multiple appointments);
          an FTE ≠ 1.00 (amber) means a part-time appointment or a combined FTE across multiple roles.
        </Text>
        <Text size="xs" c="dimmed">
          Coaches and senior leaders may also receive deferred or supplemental compensation not captured here.
          {prevSnap ? ` ▲/▼ shows pay-rank movement since ${prevSnap.label}.` : ''}
        </Text>
      </Stack>
    </>
  );
}
