import { Fragment, useMemo, useState } from 'react';
import { ShowAll, useShowAll } from './ShowAll';
import { Group, Text, Table, Anchor, ScrollArea, TextInput, ActionIcon, Loader, Tooltip, VisuallyHidden } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconSearch, IconSearchOff, IconChevronRight } from '@tabler/icons-react';
import { CsvButton } from './CsvButton';
import { MinPeople } from './MinPeople';
import { useControls, type Metric } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { peopleSql, snapWhere, whereAll, filterKey, PRIOR_FOOTING, growthBetween } from '../lib/queries';
import { usePeriod } from '../lib/period';
import { sqlStr } from '../lib/duckdb';
import { usd, num, fmtChange } from '../lib/format';
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
interface DeptRow { department: string; headcount: number; med: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null }

type SortKey = 'school' | 'headcount' | 'med' | 'dhc' | 'dmed';

/**
 * Lazily-loaded department breakdown for an expanded division row: each department with the division's own columns
 * (I4) — its people and median, their change over the page's period, and its spread on the divisions' scale — and
 * a press on it opens the page scoped to it. They were a name, a count and a median: a dead end. A department has no
 * Compare (the tray holds people, divisions and titles).
 */
function DeptRows({ where, whereFrom, school, metric, colSpan, scale, period, href }: {
  where: string; whereFrom: string | null; school: string; metric: Metric; colSpan: number;
  scale: ReturnType<typeof rangeScale>;
  period: { from: { date: string; label: string }; to: { date: string } } | null;
  /** The page scoped to a department. */
  href: (department: string) => string;
}) {
  const nav = useNavigate();
  const inSchool = `school = ${sqlStr(school)} AND department IS NOT NULL`;
  const { data } = useSql<DeptRow>(
    ['schools-depts', where, school, metric],
    `WITH pe AS (${peopleSql({ metric, where: `${where} AND ${inSchool}`, by: ['department'] })})
     SELECT department, count(*) FILTER (WHERE pay > 0) headcount, median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25, quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75,
        min(pay) FILTER (WHERE pay > 0) lo, max(pay) FILTER (WHERE pay > 0) hi
     FROM pe GROUP BY department ORDER BY headcount DESC LIMIT 50`
  );
  // Over the page's period, as a division's: its people and median then, and its median now on then's footing.
  const { data: before } = useSql<{ department: string; headcount: number; med: number | null }>(
    ['schools-depts-from', whereFrom ?? '', school, metric],
    `WITH pe AS (${peopleSql({ metric, where: `${whereFrom} AND ${inSchool}`, by: ['department'] })})
     SELECT department, count(*) FILTER (WHERE pay > 0) headcount, median(pay) FILTER (WHERE pay > 0) med FROM pe GROUP BY department`,
    !!whereFrom
  );
  const { data: prior } = useSql<{ department: string; med_prior: number | null }>(
    ['schools-depts-prior', where, school, metric],
    `WITH po AS (${peopleSql({ metric, where: `${where} AND ${inSchool}`, by: ['department'], from: PRIOR_FOOTING })})
     SELECT department, median(pay) FILTER (WHERE pay > 0) med_prior FROM po GROUP BY department`,
    !!whereFrom
  );
  const change = useMemo(() => {
    const b = new Map((before ?? []).map((r) => [r.department, r]));
    const p = new Map((prior ?? []).map((r) => [r.department, r.med_prior]));
    return new Map((data ?? []).map((d) => {
      const then = b.get(d.department);
      if (!then || !period) return [d.department, null] as const;
      const growth = then.med != null && d.med != null
        ? growthBetween({ date: period.from.date, value: then.med }, { date: period.to.date, value: d.med, prior: p.get(d.department) ?? null }).growth
        : null;
      return [d.department, { dhc: d.headcount - then.headcount, dmed: growth }] as const;
    }));
  }, [data, before, prior, period]);
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
      {data.map((d) => {
        const c = change.get(d.department);
        const canPlot = d.lo != null && d.p25 != null && d.med != null && d.p75 != null && d.hi != null && d.hi > d.lo;
        return (
          <Table.Tr key={d.department} className="dept-row" style={{ cursor: 'pointer' }} onClick={() => nav(href(d.department))}>
            <Table.Td className="dept-cell">
              <Anchor
                component={Link}
                to={href(d.department)}
                size="sm"
                c="var(--mantine-color-text)"
                underline="hover"
                lineClamp={1}
                className="dept-link"
                onClick={(e) => e.stopPropagation()}
              >
                {d.department}
              </Anchor>
              <Text className="fold-under" size="xs" c="dimmed">{num(d.headcount)} people</Text>
            </Table.Td>
            <Table.Td ta="right" data-fold><Text size="sm" c="dimmed">{num(d.headcount)}</Text><MiniBar frac={d.headcount / maxHc} color="var(--bar)" /></Table.Td>
            <Table.Td ta="right"><Text size="sm" c="dimmed">{usd(d.med)}</Text></Table.Td>
            <Table.Td ta="right" data-fold className="dept-dhc">
              {!period ? null : c == null ? <Text span size="sm" c="dimmed">new</Text> : <Text span size="sm" c="dimmed">{c.dhc > 0 ? '+' : c.dhc < 0 ? '−' : ''}{num(Math.abs(c.dhc))}</Text>}
            </Table.Td>
            <Table.Td ta="right" data-fold className="dept-dmed">
              {!period ? null : c?.dmed == null ? <Text span size="sm" c="dimmed">—</Text> : <Text span size="sm" fw={600} c={Math.abs(c.dmed) < 0.0005 ? 'dimmed' : c.dmed > 0 ? 'up' : 'down'}>{fmtChange(c.dmed)}</Text>}
            </Table.Td>
            <Table.Td ta="right" data-fold>
              {canPlot ? (
                <Tooltip withArrow multiline label={`min ${usd(d.lo)} · p25 ${usd(d.p25)} · median ${usd(d.med)} · p75 ${usd(d.p75)} · max ${usd(d.hi)}`}>
                  <div><MiniRange scale={scale} lo={d.lo!} p25={d.p25!} med={d.med!} p75={d.p75!} hi={d.hi!} /></div>
                </Tooltip>
              ) : <Text span size="sm" c="dimmed">—</Text>}
            </Table.Td>
            <Table.Td />
          </Table.Tr>
        );
      })}
    </>
  );
}

export function SchoolsPanel() {
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const { add, has, remove } = useTray();
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

  // Each division against the page's period start (D10): its headcount and median then, and its median now on the
  // footing of then (PRIOR_FOOTING), so a change across a change in how pay is reported is like for like.
  const { from: periodFrom, to: periodTo } = usePeriod();
  const scopeVal = scope.kind === 'school' ? scope.value : '';
  const { data: before } = useSql<{ school: string; headcount: number; med: number | null }>(
    ['browse-schools-from', periodFrom?.id ?? '', scope.kind, scopeVal, metric, filterKey(filters)],
    `WITH pe AS (${peopleSql({ metric, where: `${snapWhere(periodFrom?.id ?? '')} AND ${whereAll(scope, filters)} AND school IS NOT NULL`, by: ['school'] })})
     SELECT school, count(*) FILTER (WHERE pay > 0) headcount, median(pay) FILTER (WHERE pay > 0) med FROM pe GROUP BY school`,
    !!snap && !!periodFrom
  );
  const { data: prior } = useSql<{ school: string; med_prior: number | null }>(
    ['browse-schools-prior', snap ?? '', scope.kind, scopeVal, metric, filterKey(filters)],
    `WITH po AS (${peopleSql({ metric, where: `${where} AND school IS NOT NULL`, by: ['school'], from: PRIOR_FOOTING })})
     SELECT school, median(pay) FILTER (WHERE pay > 0) med_prior FROM po GROUP BY school`,
    !!snap && !!periodFrom
  );
  const change = useMemo(() => {
    const b = new Map((before ?? []).map((r) => [r.school, r]));
    const p = new Map((prior ?? []).map((r) => [r.school, r.med_prior]));
    return new Map((schools ?? []).map((s) => {
      const then = b.get(s.school);
      if (!then || !periodFrom || !periodTo) return [s.school, null] as const;
      const growth = then.med != null && s.med != null
        ? growthBetween({ date: periodFrom.date, value: then.med }, { date: periodTo.date, value: s.med, prior: p.get(s.school) ?? null }).growth
        : null;
      return [s.school, { dhc: s.headcount - then.headcount, dmed: growth }] as const;
    }));
  }, [schools, before, prior, periodFrom, periodTo]);

  const [q, setQ] = useState('');
  // 25 people or more to start (I5): sorted by median, a division of 99 and one of 17 led the list. Only where the tab
  // lists every division: scoped to one, or filtered to a department (whose division holds only its people), it is
  // shown however small.
  const [minN, setMinN] = useState(25);
  const sizing = scope.kind === 'all' && !filters.department?.length;
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
    if (sizing && minN > 0) rows = rows.filter((r) => r.headcount >= minN);
    const { key, dir } = sort;
    // A division new in the period has no change: it sorts last either way.
    const val = (r: SchoolRow) => key === 'dhc' || key === 'dmed' ? change.get(r.school)?.[key] ?? null : Number(r[key] ?? 0);
    const sorted = [...rows].sort((a, b) => {
      if (key === 'school') return (dir === 'asc' ? 1 : -1) * a.school.localeCompare(b.school);
      const [x, y] = [val(a), val(b)];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (dir === 'asc' ? 1 : -1) * (Number(x) - Number(y));
    });
    return sorted;
  }, [schools, q, sort, change, sizing, minN]);
  // The first rows, the rest on "Show all" (G11): the page's one scroll, not a box inside it.
  const page = useShowAll(view, `${q}|${sort.key}|${sort.dir}|${sizing ? minN : 0}`);

  const maxHc = useMemo(() => Math.max(1, ...(schools ?? []).map((s) => s.headcount)), [schools]);
  const maxMed = useMemo(() => Math.max(1, ...(schools ?? []).map((s) => s.med ?? 0)), [schools]);
  const scale = useMemo(() => rangeScale((schools ?? []).map((s) => s.p75)), [schools]);
  const open = (school: string) => nav(`/school/${encodeURIComponent(school)}`);
  // A department: this page, scoped to it, the rest of the view kept.
  const [params] = useSearchParams();
  const deptHref = (school: string, department: string) => {
    const n = new URLSearchParams(params);
    n.set('school', school);
    n.set('dept', department);
    return `/divisions?${n}`;
  };
  const whereFrom = periodFrom ? `${snapWhere(periodFrom.id)} AND ${whereAll(scope, filters)}` : null;
  const period = periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null;
  // From zero, as a bar's length must be: scaled from the lowest median to the highest, Veterinary Medicine's
  // $63,088 was a sliver beside Information Technology's $107,720, a 1.7× gap drawn as about 7×.
  const medFrac = (m: number | null) => (m == null ? 0 : m / maxMed);

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
        <Group gap="sm" wrap="wrap">
          {sizing && <MinPeople value={minN} onChange={setMinN} />}
          <Text size="xs" c="dimmed" className="schools-count">{num(view.length)} of {num((schools ?? []).length)} divisions</Text>
          <CsvButton onClick={exportCsv} disabled={!schools?.length} />
        </Group>
      </Group>
      {schools && view.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconSearchOff size={ICON.nav} />}
          title="No divisions match"
          hint={`Nothing in this scope${q ? ' matches your search' : ''}${sizing && minN ? ` with ${minN} people or more` : ''}. Try widening the scope, clearing filters or a lower minimum.`}
        />
      ) : (
      <>
      <div className="sticky-head">
      <ScrollArea.Autosize type="auto" offsetScrollbars="present">
        <Table stickyHeader stickyHeaderOffset="var(--app-shell-header-offset, 0px)" miw={900} className="fold-table">
          <Table.Thead>
            <Table.Tr>
              <SortableTh sortKey="school" label="School / Division" sort={sort} onSort={setSort} />
              <SortableTh sortKey="headcount" label="Headcount" sort={sort} onSort={setSort} align="right" fold />
              <SortableTh sortKey="med" label="Median" sort={sort} onSort={setSort} align="right" />
              <SortableTh sortKey="dhc" label="Δ people" sort={sort} onSort={setSort} align="right" fold />
              <SortableTh sortKey="dmed" label="Δ median" sort={sort} onSort={setSort} align="right" fold />
              <Table.Th ta="right" data-fold w={300} className="range-th">Pay spread · {scale.lo === 0 ? '$0' : fmtK(scale.lo)}–{fmtK(scale.hi)}</Table.Th>
              <Table.Th><VisuallyHidden>Compare</VisuallyHidden></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {page.shown.map((s) => {
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
                          <IconChevronRight size={ICON.compact} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease)' }} />
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
                      <MiniBar frac={s.headcount / maxHc} color="var(--bar)" />
                    </Table.Td>
                    <Table.Td ta="right">
                      {usd(s.med)}
                      <MiniBar frac={medFrac(s.med)} color="var(--bar)" />
                    </Table.Td>
                    {/* People are a count, not a direction: their change in the ink, signed. Pay is: its change in its
                        direction's colour. */}
                    <Table.Td ta="right" data-fold className="school-dhc">
                      {(() => { const c = change.get(s.school); return c == null ? <Text span size="sm" c="dimmed">new</Text> : <Text span size="sm">{c.dhc > 0 ? '+' : c.dhc < 0 ? '−' : ''}{num(Math.abs(c.dhc))}</Text>; })()}
                    </Table.Td>
                    <Table.Td ta="right" data-fold className="school-dmed">
                      {(() => { const g = change.get(s.school)?.dmed; return g == null ? <Text span size="sm" c="dimmed">—</Text> : <Text span size="sm" fw={600} c={Math.abs(g) < 0.0005 ? 'dimmed' : g > 0 ? 'up' : 'down'}>{fmtChange(g)}</Text>; })()}
                    </Table.Td>
                    <Table.Td ta="right" data-fold>
                      {canPlot ? (
                        <Tooltip withArrow multiline label={`min ${usd(s.lo)} · p25 ${usd(s.p25)} · median ${usd(s.med)} · p75 ${usd(s.p75)} · max ${usd(s.hi)}`}>
                          <div><MiniRange scale={scale} lo={s.lo!} p25={s.p25!} med={s.med!} p75={s.p75!} hi={s.hi!} /></div>
                        </Tooltip>
                      ) : <Text span size="sm" c="dimmed">—</Text>}
                    </Table.Td>
                    <Table.Td ta="right">
                      <TrayButton inTray={inTray} name={s.school} stopPropagation onAdd={() => add({ type: 'school', id: s.school, label: s.school })} onRemove={() => remove(s.school)} />
                    </Table.Td>
                  </Table.Tr>
                  {isOpen && <DeptRows where={where} whereFrom={whereFrom} school={s.school} metric={metric} colSpan={7} scale={scale} period={period} href={(d) => deptHref(s.school, d)} />}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      </div>
      <ShowAll shown={page.shown.length} total={page.total} onShowAll={page.showAll} pager={page.pager} />
      {periodFrom && (
        <Text size="xs" c="dimmed" mt="xs" className="schools-change-note">
          Δ: since {periodFrom.label}, the page&apos;s period; the median like for like across a change in how pay is
          reported. &ldquo;New&rdquo; is a division {periodFrom.label} did not have under this name.
        </Text>
      )}
      </>
      )}
    </>
  );
}
