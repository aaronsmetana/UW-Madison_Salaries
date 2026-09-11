import { Fragment, useMemo, useState } from 'react';
import { Group, Text, Table, Button, Anchor, ScrollArea, TextInput, Tooltip, Mark } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconSearch, IconSearchOff, IconDownload } from '@tabler/icons-react';
import { Eyebrow } from './Eyebrow';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { peopleSql, snapWhere, whereAll, filterKey } from '../lib/queries';
import { usd, num } from '../lib/format';
import { useTray } from '../state/tray';
import { downloadCSV } from '../lib/csv';
import { MiniBar } from './MiniBar';
import { EmptyState } from './EmptyState';
import { TrayButton } from './TrayButton';
import { MiniRange } from './MiniRange';
import { rangeScale } from '../lib/rangeScale';
import { fmtK } from '../lib/chartStyle';
import { SortableTh, type SortState } from './SortableTh';
import { ICON } from '../lib/ui';

interface TitleRow {
  job_code: string; title: string; n: number; med: number | null;
  p25: number | null; p75: number | null; lo: number | null; hi: number | null;
  /** The employee category most of the title's holders are in (Faculty, Academic Staff, …). */
  cat: string | null;
}
type SortKey = 'title' | 'job_code' | 'n' | 'med';

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
  const nav = useNavigate();
  const { add, has } = useTray();
  const where = `${snapWhere(snap ?? '')} AND ${whereAll(scope, filters)}`;

  const { data: titles } = useSql<TitleRow>(
    ['browse-titles', snap ?? '', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `WITH pe AS (${peopleSql({ metric, where: `${where} AND job_code IS NOT NULL`, by: ['job_code'], extra: 'arg_max(title, salary) t, arg_max(employee_category, salary) cat' })}),
          cats AS (SELECT job_code, cat, count(*) c FROM pe WHERE cat IS NOT NULL GROUP BY job_code, cat),
          main AS (SELECT job_code, first(cat ORDER BY c DESC, cat) cat FROM cats GROUP BY job_code)
     SELECT job_code, arg_max(t, pay) title, count(*) FILTER (WHERE pay > 0) n,
        median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75,
        min(pay) FILTER (WHERE pay > 0) lo, max(pay) FILTER (WHERE pay > 0) hi,
        any_value(main.cat) cat
     FROM pe LEFT JOIN main USING (job_code) GROUP BY job_code ORDER BY n DESC`,
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
  // One scale for the whole column, so equal widths are equal dollars on every row.
  const scale = useMemo(() => rangeScale((titles ?? []).map((t) => t.p75)), [titles]);

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
          leftSection={<IconSearch size={ICON.control} />} value={q} onChange={(e) => setQ(e.currentTarget.value)}
        />
        {/* Wraps: on a phone the CSV button ran past the screen's edge. */}
        <Group gap="sm" wrap="wrap">
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
          <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.compact} />} onClick={exportCsv} disabled={!titles?.length}>
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
        <Table stickyHeader miw={820} className="fold-table">
          <Table.Thead>
            <Table.Tr>
              <SortableTh sortKey="title" label="Title" sort={sort} onSort={setSort} />
              <SortableTh sortKey="job_code" label="Job code" sort={sort} onSort={setSort} fold />
              <SortableTh sortKey="n" label="People" sort={sort} onSort={setSort} align="right" fold />
              <SortableTh sortKey="med" label="Median" sort={sort} onSort={setSort} align="right" />
              <Table.Th ta="right" data-fold w={216} className="range-th">Pay spread · {scale.lo === 0 ? '$0' : fmtK(scale.lo)}–{fmtK(scale.hi)}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {view.map((t) => {
              const inTray = has(t.job_code);
              const canPlot = t.lo != null && t.p25 != null && t.med != null && t.p75 != null && t.hi != null && t.hi > t.lo;
              return (
                <Fragment key={t.job_code}>
                  {/* A click anywhere on the row opens the title; the keyboard gets there by the title's
                      link. The row was a button around a link and a button, which a screen reader cannot
                      read as either. */}
                  <Table.Tr
                    className="peer-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => nav(`/paycheck?code=${encodeURIComponent(t.job_code)}`)}
                  >
                    <Table.Td>
                      <div>
                        <Anchor component={Link} to={`/paycheck?code=${encodeURIComponent(t.job_code)}`} onClick={(e) => e.stopPropagation()}>
                          <Highlight text={t.title} q={q.trim()} />
                        </Anchor>
                        {t.cat && <span className="cat-tag">{t.cat}</span>}
                      </div>
                      <Text className="fold-under" size="xs" c="dimmed">
                        {t.job_code} · {num(t.n)} people{t.p25 != null && t.p75 != null ? ` · ${usd(t.p25)} – ${usd(t.p75)}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td data-fold><span className="code-pill">{t.job_code}</span></Table.Td>
                    <Table.Td ta="right" data-fold>
                      {num(t.n)}
                      <MiniBar frac={t.n / maxN} />
                    </Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right" data-fold>
                      {canPlot ? (
                        <Tooltip
                          withArrow multiline
                          label={`min ${usd(t.lo)} · p25 ${usd(t.p25)} · median ${usd(t.med)} · p75 ${usd(t.p75)} · max ${usd(t.hi)}`}
                        >
                          <div><MiniRange scale={scale} lo={t.lo!} p25={t.p25!} med={t.med!} p75={t.p75!} hi={t.hi!} /></div>
                        </Tooltip>
                      ) : (
                        <Text span size="sm" c="dimmed">—</Text>
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
        Each spread is on one scale, printed in the header, so equal widths are equal dollars on every row:
        the line runs from the lowest to the highest pay, the box is the middle 50%, and the tick the median.
        A spread that runs past the scale is cut at the edge and marked with an arrow. Hover for the exact
        five-number summary.
      </Text>
    </>
  );
}
