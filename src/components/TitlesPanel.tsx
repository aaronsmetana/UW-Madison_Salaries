import { Fragment, useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, Tooltip, Mark } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconSearch, IconSearchOff, IconDownload } from '@tabler/icons-react';
import { Eyebrow } from './Eyebrow';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { salaryExpr, paidHeadcount, snapWhere, whereAll, filterKey } from '../lib/queries';
import { usd, num } from '../lib/format';
import { useTray } from '../state/tray';
import { downloadCSV } from '../lib/csv';
import { MiniBar } from './MiniBar';
import { EmptyState } from './EmptyState';
import { TrayButton } from './TrayButton';
import { SortableTh, type SortState } from './SortableTh';

interface TitleRow {
  job_code: string; title: string; n: number; med: number | null;
  p25: number | null; p75: number | null; lo: number | null; hi: number | null;
}
type SortKey = 'title' | 'job_code' | 'n' | 'med';

/** Compact box plot for a title's pay spread: lo–hi whisker, p25–p75 box, median tick. */
function MiniRange({ lo, p25, med, p75, hi, width = 150, height = 16 }: {
  lo: number; p25: number; med: number; p75: number; hi: number; width?: number; height?: number;
}) {
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * (width - 2) + 1;
  const mid = height / 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block', marginTop: 3 }}>
      <line x1={x(lo)} y1={mid} x2={x(hi)} y2={mid} stroke="var(--mantine-color-default-border)" strokeWidth={2} />
      <rect x={x(p25)} y={mid - 5} width={Math.max(1, x(p75) - x(p25))} height={10} rx={2}
        fill="var(--mantine-color-accent-2)" stroke="var(--mantine-color-accent-5)" strokeWidth={0.75} />
      <line x1={x(med)} y1={mid - 6} x2={x(med)} y2={mid + 6} stroke="var(--mantine-color-accent-7)" strokeWidth={2} />
    </svg>
  );
}

/** Bold the matched span of a title (case-insensitive, first occurrence). */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<Mark color="accent">{text.slice(i, i + q.length)}</Mark>{text.slice(i + q.length)}</>;
}

const THRESHOLDS = [{ id: '0', label: 'All' }, { id: '5', label: '≥5' }, { id: '25', label: '≥25' }, { id: '100', label: '≥100' }];

export function TitlesPanel() {
  const { scope, metric, filters } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const nav = useNavigate();
  const { add, has } = useTray();
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const { data: titles } = useSql<TitleRow>(
    ['browse-titles', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.25) FILTER (WHERE ${expr} > 0) p25,
        quantile_cont(${expr}, 0.75) FILTER (WHERE ${expr} > 0) p75,
        min(${expr}) FILTER (WHERE ${expr} > 0) lo, max(${expr}) FILTER (WHERE ${expr} > 0) hi
     FROM salaries WHERE ${where} AND job_code IS NOT NULL GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );

  const [q, setQ] = useState('');
  const [minN, setMinN] = useState(0);
  // Sort persists in the URL (?tsort/&tdir) so a shared link reopens with the same ordering.
  const [params, setParams] = useSearchParams();
  const sortKey = (params.get('tsort') as SortKey) || 'n';
  const sortDir = (params.get('tdir') as 'asc' | 'desc') || 'desc';
  const setSort = (next: SortState<SortKey>) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('tsort', next.key);
        n.set('tdir', next.dir);
        return n;
      },
      { replace: true }
    );

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    let rows = titles ?? [];
    if (minN > 0) rows = rows.filter((r) => r.n >= minN);
    if (t) rows = rows.filter((r) => r.title.toLowerCase().includes(t) || r.job_code.toLowerCase().includes(t));
    const sorted = [...rows].sort((a, b) => {
      const cmp = sortKey === 'title' || sortKey === 'job_code'
        ? String(a[sortKey]).localeCompare(String(b[sortKey]))
        : Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [titles, q, minN, sortKey, sortDir]);

  const maxN = useMemo(() => Math.max(1, ...(titles ?? []).map((t) => t.n)), [titles]);

  const exportCsv = () =>
    downloadCSV(
      `uw-titles-${snap ?? 'latest'}.csv`,
      (titles ?? []).map((t) => ({
        title: t.title,
        job_code: t.job_code,
        people: t.n,
        median: t.med != null ? Math.round(t.med) : '',
        p25: t.p25 != null ? Math.round(t.p25) : '',
        p75: t.p75 != null ? Math.round(t.p75) : '',
        min: t.lo != null ? Math.round(t.lo) : '',
        max: t.hi != null ? Math.round(t.hi) : '',
      }))
    );

  const sort: SortState<SortKey> = { key: sortKey, dir: sortDir };

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <TextInput
          size="md" w={340} placeholder="Search titles or job codes…"
          leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Group gap="sm" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <Eyebrow>Min people</Eyebrow>
            <Button.Group>
              {THRESHOLDS.map((th) => (
                <Button key={th.id} size="compact-xs" variant={minN === Number(th.id) ? 'filled' : 'default'}
                  color="accent" onClick={() => setMinN(Number(th.id))}>{th.label}</Button>
              ))}
            </Button.Group>
          </Group>
          <Text size="xs" c="dimmed">{num(view.length)} of {num((titles ?? []).length)} titles</Text>
          <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportCsv} disabled={!titles?.length}>
            CSV
          </Button>
        </Group>
      </Group>
      {titles && view.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconSearchOff size={18} />}
          title="No titles match"
          hint={`Nothing in this scope${q || minN ? ' matches your search/filters' : ''}. Try widening the scope or clearing filters.`}
        />
      ) : (
      <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present">
        <Table stickyHeader miw={820}>
          <Table.Thead>
            <Table.Tr>
              <SortableTh sortKey="title" label="Title" sort={sort} onSort={setSort} />
              <SortableTh sortKey="job_code" label="Job code" sort={sort} onSort={setSort} />
              <SortableTh sortKey="n" label="People" sort={sort} onSort={setSort} align="right" />
              <SortableTh sortKey="med" label="Median" sort={sort} onSort={setSort} align="right" />
              <Table.Th ta="right">Range (p25–p75)</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((t) => {
              const inTray = has(t.job_code);
              const canPlot = t.lo != null && t.p25 != null && t.med != null && t.p75 != null && t.hi != null && t.hi > t.lo;
              return (
                <Fragment key={t.job_code}>
                  <Table.Tr
                    className="peer-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => nav(`/paycheck?code=${encodeURIComponent(t.job_code)}`)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(`/paycheck?code=${encodeURIComponent(t.job_code)}`); } }}
                  >
                    <Table.Td>
                      <Anchor component={Link} to={`/paycheck?code=${encodeURIComponent(t.job_code)}`} onClick={(e) => e.stopPropagation()}>
                        <Highlight text={t.title} q={q.trim()} />
                      </Anchor>
                    </Table.Td>
                    <Table.Td c="dimmed">{t.job_code}</Table.Td>
                    <Table.Td ta="right">
                      {num(t.n)}
                      <MiniBar frac={t.n / maxN} />
                    </Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right">
                      <Text span size="sm" c="dimmed">{t.p25 != null && t.p75 != null ? `${usd(t.p25)} – ${usd(t.p75)}` : '—'}</Text>
                      {canPlot && (
                        <Tooltip
                          withArrow multiline
                          label={`min ${usd(t.lo)} · p25 ${usd(t.p25)} · median ${usd(t.med)} · p75 ${usd(t.p75)} · max ${usd(t.hi)}`}
                        >
                          <div><MiniRange lo={t.lo!} p25={t.p25!} med={t.med!} p75={t.p75!} hi={t.hi!} /></div>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <TrayButton
                        inTray={inTray}
                        stopPropagation
                        onAdd={() => add({ type: 'title', id: t.job_code, label: t.title })}
                      />
                    </Table.Td>
                  </Table.Tr>
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Range shows the middle 50% (p25–p75); the bar is a mini box plot of the full min–max spread with the
        median tick. Hover the bar for the exact five-number summary.
      </Text>
    </>
  );
}
