import { Fragment, useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, ActionIcon, Loader } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconPlus, IconSearch, IconCheck, IconChevronRight } from '@tabler/icons-react';
import { useControls, type Metric } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { salaryExpr, paidHeadcount, snapWhere, whereAll, filterKey } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { usd, num } from '../lib/format';
import { useTray } from '../state/tray';
import { MiniBar } from './MiniBar';

interface SchoolRow { school: string; headcount: number; med: number | null; p25: number | null; p75: number | null }
interface DeptRow { department: string; headcount: number; med: number | null }

type SortKey = 'school' | 'headcount' | 'med';

/** Lazily-loaded department breakdown for an expanded division row. */
function DeptRows({ where, school, expr, metric, colSpan }: {
  where: string; school: string; expr: string; metric: Metric; colSpan: number;
}) {
  const { data } = useSql<DeptRow>(
    ['schools-depts', where, school, metric],
    `SELECT department, ${paidHeadcount(metric)} headcount, median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${where} AND school = ${sqlStr(school)} AND department IS NOT NULL
     GROUP BY department ORDER BY headcount DESC LIMIT 50`
  );
  if (!data) {
    return (
      <Table.Tr>
        <Table.Td colSpan={colSpan}><Group gap="xs" pl="lg"><Loader size="xs" /><Text size="xs" c="dimmed">Loading departments…</Text></Group></Table.Td>
      </Table.Tr>
    );
  }
  if (data.length === 0) {
    return <Table.Tr><Table.Td colSpan={colSpan}><Text size="xs" c="dimmed" pl="lg">No departments recorded.</Text></Table.Td></Table.Tr>;
  }
  const maxHc = Math.max(...data.map((d) => d.headcount), 1);
  return (
    <>
      {data.map((d) => (
        <Table.Tr key={d.department} style={{ background: 'var(--mantine-color-default-hover)' }}>
          <Table.Td style={{ paddingLeft: 44 }}><Text size="sm" c="dimmed" lineClamp={1}>{d.department}</Text></Table.Td>
          <Table.Td ta="right"><Text size="sm" c="dimmed">{num(d.headcount)}</Text><MiniBar frac={d.headcount / maxHc} /></Table.Td>
          <Table.Td ta="right"><Text size="sm" c="dimmed">{usd(d.med)}</Text></Table.Td>
          <Table.Td />
          <Table.Td />
        </Table.Tr>
      ))}
    </>
  );
}

export function SchoolsPanel() {
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { add, has } = useTray();
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const { data: schools } = useSql<SchoolRow>(
    ['browse-schools', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `SELECT school, ${paidHeadcount(metric)} headcount,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.25) FILTER (WHERE ${expr} > 0) p25,
        quantile_cont(${expr}, 0.75) FILTER (WHERE ${expr} > 0) p75
     FROM salaries WHERE ${where} AND school IS NOT NULL
     GROUP BY school ORDER BY headcount DESC`,
    !!snap
  );

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'headcount', dir: 'desc' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (s: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s); else n.add(s);
      return n;
    });

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    let rows = schools ?? [];
    if (t) rows = rows.filter((r) => r.school.toLowerCase().includes(t));
    const { key, dir } = sort;
    const sorted = [...rows].sort((a, b) => {
      const cmp = key === 'school' ? a.school.localeCompare(b.school) : Number(a[key] ?? 0) - Number(b[key] ?? 0);
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [schools, q, sort]);

  const maxHc = useMemo(() => Math.max(1, ...(schools ?? []).map((s) => s.headcount)), [schools]);
  const medExtent = useMemo(() => {
    const meds = (schools ?? []).map((s) => s.med).filter((v): v is number => v != null);
    return meds.length ? { min: Math.min(...meds), max: Math.max(...meds) } : { min: 0, max: 1 };
  }, [schools]);
  const medFrac = (m: number | null) =>
    m == null ? 0 : medExtent.max === medExtent.min ? 1 : (m - medExtent.min) / (medExtent.max - medExtent.min);

  const sortTh = (key: SortKey, label: string, align?: 'right') => (
    <Table.Th
      ta={align}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </Table.Th>
  );

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <TextInput
          size="md"
          w={320}
          placeholder="Search divisions…"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed">{num(view.length)} of {num((schools ?? []).length)} divisions</Text>
      </Group>
      <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present">
        <Table stickyHeader miw={680}>
          <Table.Thead>
            <Table.Tr>
              {sortTh('school', 'School / Division')}
              {sortTh('headcount', 'Headcount', 'right')}
              {sortTh('med', 'Median', 'right')}
              <Table.Th ta="right">Range (p25–p75)</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((s) => {
              const open = expanded.has(s.school);
              const inTray = has(s.school);
              return (
                <Fragment key={s.school}>
                  <Table.Tr className="peer-row">
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <ActionIcon
                          variant="subtle" color="gray" size="sm"
                          aria-label={open ? `Collapse ${s.school}` : `Expand ${s.school} departments`}
                          onClick={() => toggle(s.school)}
                        >
                          <IconChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }} />
                        </ActionIcon>
                        <Anchor component={Link} to={`/school/${encodeURIComponent(s.school)}`} c="var(--mantine-color-text)" underline="hover" fw={500} lineClamp={1}>
                          {s.school}
                        </Anchor>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      {num(s.headcount)}
                      <MiniBar frac={s.headcount / maxHc} />
                    </Table.Td>
                    <Table.Td ta="right">
                      {usd(s.med)}
                      <MiniBar frac={medFrac(s.med)} color="var(--mantine-color-pos-5)" />
                    </Table.Td>
                    <Table.Td ta="right" c="dimmed">
                      {s.p25 != null && s.p75 != null ? `${usd(s.p25)} – ${usd(s.p75)}` : '—'}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button
                        className="peer-add"
                        size="compact-xs"
                        variant={inTray ? 'light' : 'outline'}
                        color={inTray ? 'pos' : 'accent'}
                        radius="xl"
                        leftSection={inTray ? <IconCheck size={12} /> : <IconPlus size={12} />}
                        disabled={inTray}
                        onClick={() => add({ type: 'school', id: s.school, label: s.school })}
                      >
                        {inTray ? 'In tray' : 'Compare'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                  {open && <DeptRows where={where} school={s.school} expr={expr} metric={metric} colSpan={5} />}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </>
  );
}
