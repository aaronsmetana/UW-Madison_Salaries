import { Fragment, useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, ActionIcon, Loader, Tooltip } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconSearch, IconSearchOff, IconChevronRight, IconDownload } from '@tabler/icons-react';
import { useControls, type Metric } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { peopleSql, snapWhere, whereAll, filterKey } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { usd, num } from '../lib/format';
import { useTray } from '../state/tray';
import { downloadCSV } from '../lib/csv';
import { MiniBar } from './MiniBar';
import { TrayButton } from './TrayButton';
import { SortableTh } from './SortableTh';
import { EmptyState } from './EmptyState';
import { ICON } from '../lib/ui';
import { MiniRange } from './MiniRange';
import { rangeScale } from '../lib/rangeScale';
import { fmtK } from '../lib/chartStyle';

interface SchoolRow { school: string; headcount: number; med: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null }
interface DeptRow { department: string; headcount: number; med: number | null }

type SortKey = 'school' | 'headcount' | 'med';

/** Lazily-loaded department breakdown for an expanded division row. */
function DeptRows({ where, school, metric, colSpan }: {
  where: string; school: string; metric: Metric; colSpan: number;
}) {
  const { data } = useSql<DeptRow>(
    ['schools-depts', where, school, metric],
    `WITH pe AS (${peopleSql({ metric, where: `${where} AND school = ${sqlStr(school)} AND department IS NOT NULL`, by: ['department'] })})
     SELECT department, count(*) FILTER (WHERE pay > 0) headcount, median(pay) FILTER (WHERE pay > 0) med
     FROM pe GROUP BY department ORDER BY headcount DESC LIMIT 50`
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
        <Table.Tr key={d.department} className="dept-row">
          <Table.Td className="dept-cell">
            <Anchor
              component={Link}
              to={`/explore?${new URLSearchParams({ school, dept: d.department })}`}
              size="sm"
              c="var(--mantine-color-text)"
              underline="hover"
              lineClamp={1}
              className="dept-link"
            >
              {d.department}
            </Anchor>
            <Text className="fold-under" size="xs" c="dimmed">{num(d.headcount)} people</Text>
          </Table.Td>
          <Table.Td ta="right" data-fold><Text size="sm" c="dimmed">{num(d.headcount)}</Text><MiniBar frac={d.headcount / maxHc} /></Table.Td>
          <Table.Td ta="right"><Text size="sm" c="dimmed">{usd(d.med)}</Text></Table.Td>
          <Table.Td data-fold />
          <Table.Td />
        </Table.Tr>
      ))}
    </>
  );
}

export function SchoolsPanel() {
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const { add, has } = useTray();
  const nav = useNavigate();
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const { data: schools } = useSql<SchoolRow>(
    ['browse-schools', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `WITH pe AS (${peopleSql({ metric, where: `${where} AND school IS NOT NULL`, by: ['school'] })})
     SELECT school, count(*) FILTER (WHERE pay > 0) headcount,
        median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75,
        min(pay) FILTER (WHERE pay > 0) lo, max(pay) FILTER (WHERE pay > 0) hi
     FROM pe GROUP BY school ORDER BY headcount DESC`,
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
  const scale = useMemo(() => rangeScale((schools ?? []).map((s) => s.p75)), [schools]);
  const open = (school: string) => nav(`/school/${encodeURIComponent(school)}`);
  const medFrac = (m: number | null) =>
    m == null ? 0 : medExtent.max === medExtent.min ? 1 : (m - medExtent.min) / (medExtent.max - medExtent.min);

  const exportCsv = () =>
    downloadCSV(
      `uw-schools-${snap ?? 'latest'}.csv`,
      (schools ?? []).map((s) => ({
        school: s.school,
        headcount: s.headcount,
        median: s.med != null ? Math.round(s.med) : '',
        p25: s.p25 != null ? Math.round(s.p25) : '',
        p75: s.p75 != null ? Math.round(s.p75) : '',
      }))
    );

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <TextInput
          size="md"
          w={320}
          placeholder="Search divisions…"
          leftSection={<IconSearch size={ICON.control} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed">{num(view.length)} of {num((schools ?? []).length)} divisions</Text>
          <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.compact} />} onClick={exportCsv} disabled={!schools?.length}>
            CSV
          </Button>
        </Group>
      </Group>
      {schools && view.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconSearchOff size={18} />}
          title="No divisions match"
          hint={`Nothing in this scope${q ? ' matches your search' : ''}. Try widening the scope or clearing filters.`}
        />
      ) : (
      <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present">
        <Table stickyHeader miw={680} className="fold-table">
          <Table.Thead>
            <Table.Tr>
              <SortableTh sortKey="school" label="School / Division" sort={sort} onSort={setSort} />
              <SortableTh sortKey="headcount" label="Headcount" sort={sort} onSort={setSort} align="right" fold />
              <SortableTh sortKey="med" label="Median" sort={sort} onSort={setSort} align="right" />
              <Table.Th ta="right" data-fold w={216} className="range-th">Pay spread · {scale.lo === 0 ? '$0' : fmtK(scale.lo)}–{fmtK(scale.hi)}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((s) => {
              const isOpen = expanded.has(s.school);
              const inTray = has(s.school);
              const canPlot = s.lo != null && s.p25 != null && s.med != null && s.p75 != null && s.hi != null && s.hi > s.lo;
              return (
                <Fragment key={s.school}>
                  {/* A click anywhere on the row opens the division; the chevron and the add button do
                      their own thing and stop there. The row is not itself a control — it holds three —
                      so the keyboard reaches the division by its name, which is the link. */}
                  <Table.Tr
                    className="peer-row school-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => open(s.school)}
                  >
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <ActionIcon
                          variant="subtle" color="gray" size="sm"
                          className="school-expand"
                          aria-label={isOpen ? `Collapse ${s.school}` : `Expand ${s.school} departments`}
                          aria-expanded={isOpen}
                          onClick={(e) => { e.stopPropagation(); toggle(s.school); }}
                        >
                          <IconChevronRight size={ICON.compact} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }} />
                        </ActionIcon>
                        <div style={{ minWidth: 0 }}>
                          <Anchor component={Link} to={`/school/${encodeURIComponent(s.school)}`} c="var(--mantine-color-text)" underline="hover" fw={500} lineClamp={2} onClick={(e) => e.stopPropagation()}>
                            {s.school}
                          </Anchor>
                          <Text className="fold-under" size="xs" c="dimmed">
                            {num(s.headcount)} people{s.p25 != null && s.p75 != null ? ` · ${usd(s.p25)} – ${usd(s.p75)}` : ''}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right" data-fold>
                      {num(s.headcount)}
                      <MiniBar frac={s.headcount / maxHc} />
                    </Table.Td>
                    <Table.Td ta="right">
                      {usd(s.med)}
                      <MiniBar frac={medFrac(s.med)} color="var(--mantine-color-pos-5)" />
                    </Table.Td>
                    <Table.Td ta="right" data-fold>
                      {canPlot ? (
                        <Tooltip withArrow multiline label={`min ${usd(s.lo)} · p25 ${usd(s.p25)} · median ${usd(s.med)} · p75 ${usd(s.p75)} · max ${usd(s.hi)}`}>
                          <div><MiniRange scale={scale} lo={s.lo!} p25={s.p25!} med={s.med!} p75={s.p75!} hi={s.hi!} /></div>
                        </Tooltip>
                      ) : <Text span size="sm" c="dimmed">—</Text>}
                    </Table.Td>
                    <Table.Td ta="right">
                      <TrayButton inTray={inTray} stopPropagation onAdd={() => add({ type: 'school', id: s.school, label: s.school })} />
                    </Table.Td>
                  </Table.Tr>
                  {isOpen && <DeptRows where={where} school={s.school} metric={metric} colSpan={5} />}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      )}
    </>
  );
}
