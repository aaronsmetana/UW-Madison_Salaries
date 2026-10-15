import { Fragment, useLayoutEffect, useState, type ReactNode } from 'react';
import { Badge, Box, Button, Card, Group, Popover, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconCheck, IconFileSpreadsheet } from '@tabler/icons-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, Tooltip as ChartTip } from 'recharts';
import { CardTitle } from '../CardTitle';
import { CsvButton } from '../CsvButton';
import { NewBadge } from '../NewBadge';
import { DeltaChip } from '../Delta';
import { SortableTh, type SortState } from '../SortableTh';
import { TipSurface } from '../chart/ChartTooltip';
import { AXIS_TICK, GRID, CHART_FONT, chartKeys } from '../../lib/chartStyle';
import { dropdownProps } from '../../lib/selectProps';
import { downloadCSV } from '../../lib/csv';
import { num, usd } from '../../lib/format';
import { ICON } from '../../lib/ui';
import type { Manifest, SnapshotInfo } from '../../lib/manifest';

/** Note rows the rest of the site links to by name: a person's "TTC", the caveats' scope change. */
const NOTE_IDS: Record<string, string> = { '2021-11-post': 'ttc', '2023-10': 'scope-change' };

/** Table header with an explanatory tooltip (the dotted "help" underline). */
function Th({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <Table.Th ta="right">
      <Tooltip label={tip} multiline w={250} withArrow>
        <span className="help-underline">{children}</span>
      </Tooltip>
    </Table.Th>
  );
}

type Row = { key: string; label: string; short: string; sub: string; flag: number | null; rows: number; paid: number; median: number | null };

/** An axis label: "Nov '21", "pre" or "post" under the pair that share a month, and a snapshot's note number. */
function SnapTick({ x = 0, y = 0, payload, rows }: { x?: number; y?: number; payload?: { value: string }; rows: Row[] }) {
  const r = rows.find((d) => d.key === payload?.value);
  if (!r) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={CHART_FONT} fill="var(--text-faint)">{r.short}</text>
      {r.sub && <text dy={26} textAnchor="middle" fontSize={CHART_FONT} fill="var(--text-faint)">{r.sub}</text>}
      {r.flag != null && (
        <g transform={`translate(0,${r.sub ? 40 : 26})`}>
          <circle r={8.5} fill="var(--caution-bg)" stroke="var(--caution-ink)" strokeWidth={1} />
          <text dy={4} textAnchor="middle" fontSize={CHART_FONT} fontWeight={700} fill="var(--caution-ink)">{r.flag}</text>
        </g>
      )}
    </g>
  );
}

/** One bar for a snapshot's rows, and inside it, narrower and darker, its people paid. */
function RowsPaid(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload || height <= 0) return null;
  const inner = Math.max(0, height * (payload.paid / payload.rows));
  const w = width * 0.46;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill="var(--snap-rows)" />
      <rect x={x + (width - w) / 2} y={y + height - inner} width={w} height={inner} rx={2} fill="var(--snap-paid)" />
    </g>
  );
}

function SnapTip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{r.label}</Text>
      <Text size="xs">{num(r.rows)} rows · {num(r.paid)} people paid</Text>
      <Text size="xs">Median per row {usd(r.median)}</Text>
    </TipSurface>
  );
}

const shortOf = (s: SnapshotInfo) => {
  const d = new Date(`${s.snapshot_date.slice(0, 10)}T00:00:00Z`);
  return `${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(2)}`;
};

/**
 * Every report the data was built from: the eleven at a glance, then the ingestion table — counts, medians per
 * row, what changed snapshot to snapshot, and each note under its snapshot — and how each spreadsheet's columns
 * were read. Every figure is the manifest's.
 */
export function SnapshotsTab({ manifest, ordered, latestId }: { manifest: Manifest; ordered: SnapshotInfo[]; latestId: string | null }) {
  const [sort, setSort] = useState<SortState<'date' | 'rows'>>({ key: 'date', dir: 'asc' });
  const [mapId, setMapId] = useState<string | null>(latestId);
  // The table's own box, measured: the fade at its right edge only while it actually scrolls.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    if (!viewport) return undefined;
    const measure = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    const table = viewport.querySelector('table');
    if (table) ro.observe(table);
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [viewport]);

  // Notes numbered in the order the snapshots run, so a chart's badge and the table's row say the same number.
  const noted = ordered.filter((s) => s.note || s.status !== 'ok');
  const flagOf = new Map(noted.map((s, i) => [s.snapshot_id, i + 1]));
  const prevOf = new Map(ordered.slice(1).map((s, i) => [s.snapshot_id, ordered[i]]));
  const change = (cur?: number | null, prev?: number | null) => (cur != null && prev ? (cur - prev) / prev : null);
  const sorted = [...ordered].sort((a, b) =>
    (sort.key === 'rows' ? a.row_count - b.row_count : ordered.indexOf(a) - ordered.indexOf(b)) * (sort.dir === 'asc' ? 1 : -1));
  const bad = ordered.filter((s) => s.status !== 'ok');
  const built = manifest.generated_at?.slice(0, 16).replace('T', ' ');

  const chart: Row[] = ordered.map((s) => ({
    key: s.snapshot_id,
    label: s.snapshot_label,
    short: shortOf(s),
    sub: s.ttc_variant ? (s.snapshot_id.endsWith('-pre') ? 'pre' : 'post') : '',
    flag: flagOf.get(s.snapshot_id) ?? null,
    rows: s.row_count,
    paid: s.distinct_people_paid ?? 0,
    median: s.salary_median,
  }));
  const first = chart[0];
  const last = chart[chart.length - 1];
  const rowsTop = Math.max(10_000, Math.ceil(Math.max(...chart.map((r) => r.rows)) / 10_000) * 10_000);
  const medTop = Math.max(100_000, Math.ceil(Math.max(...chart.map((r) => r.median ?? 0)) / 25_000) * 25_000);
  const tickH = noted.length ? 54 : 34;

  const exportCsv = () =>
    downloadCSV(`uw-salaries-snapshots-${latestId ?? 'latest'}.csv`, ordered.map((s) => ({
      snapshot: s.snapshot_id, label: s.snapshot_label, source_file: s.source_file, source_sheet: s.source_sheet,
      rows: s.row_count, people: s.distinct_people, paid: s.distinct_people_paid ?? '', unpaid_zero: s.zero_or_null_salary,
      median_per_row: s.salary_median ?? '', status: s.status, note: s.note ?? '',
    })));
  const mapped = ordered.find((s) => s.snapshot_id === mapId) ?? ordered[ordered.length - 1];

  return (
    <Stack gap="lg">
      <Card id="snapshot-glance">
        <CardTitle anchorId="snapshot-glance"
          sub={noted.length ? 'Numbered snapshots carry a note in the table below. Two breaks matter most: the Nov 2021 relabel and the Oct 2023 scope change.' : undefined}>
          {num(ordered.length)} snapshots at a glance
        </CardTitle>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <figure className="glance-figure">
            <figcaption>
              <Text size="sm" fw={650}>Rows in the report, and people paid</Text>
              <Group gap="md" className="glance-key" aria-hidden>
                <span><span className="glance-swatch" style={{ background: 'var(--snap-rows)' }} /> Rows</span>
                <span><span className="glance-swatch" style={{ background: 'var(--snap-paid)' }} /> People paid</span>
              </Group>
            </figcaption>
            <ResponsiveContainer width="100%" height={210 + tickH}>
              <BarChart {...chartKeys(`Rows in each report, ${num(first?.rows)} in ${first?.label} to ${num(last?.rows)} in ${last?.label}; people paid, ${num(first?.paid)} to ${num(last?.paid)}`)}
                data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid {...GRID} />
                <XAxis dataKey="key" interval={0} height={tickH} tickLine={false} tick={<SnapTick rows={chart} />} />
                <YAxis domain={[0, rowsTop]} ticks={Array.from({ length: rowsTop / 5_000 + 1 }, (_, i) => i * 5_000)}
                  tickFormatter={(v: number) => (v % 10_000 === 0 ? (v === 0 ? '0' : `${v / 1000}k`) : '')} width={36} tick={AXIS_TICK} />
                <ChartTip content={<SnapTip />} cursor={{ fill: 'var(--hover-bg)' }} />
                <Bar dataKey="rows" shape={<RowsPaid />} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </figure>
          <figure className="glance-figure">
            <figcaption>
              <Text size="sm" fw={650}>Median pay, per row</Text>
              <Text size="xs" c="dimmed">{usd(first?.median)} → {usd(last?.median)}, nominal</Text>
            </figcaption>
            <ResponsiveContainer width="100%" height={210 + tickH}>
              <BarChart {...chartKeys(`Median pay per row, ${usd(first?.median)} in ${first?.label} to ${usd(last?.median)} in ${last?.label}`)}
                data={chart} margin={{ top: 22, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid {...GRID} />
                <XAxis dataKey="key" interval={0} height={tickH} tickLine={false} tick={<SnapTick rows={chart} />} />
                <YAxis domain={[0, medTop]} ticks={Array.from({ length: medTop / 12_500 + 1 }, (_, i) => i * 12_500)}
                  tickFormatter={(v: number) => (v % 25_000 === 0 ? (v === 0 ? '0' : `$${v / 1000}k`) : '')} width={44} tick={AXIS_TICK} />
                <ChartTip content={<SnapTip />} cursor={{ fill: 'var(--hover-bg)' }} />
                <Bar dataKey="median" fill="var(--snap-median)" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="median" position="top" fontSize={CHART_FONT} fill="var(--text-faint)"
                    formatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </figure>
        </SimpleGrid>
      </Card>

      <Card id="snapshots" className="snapshots-card">
        <CardTitle
          anchorId="snapshots"
          sub={
            <Group gap={6} wrap="nowrap" component="span" className="ingest-status">
              {bad.length === 0 && <IconCheck size={ICON.compact} className="ok-icon" aria-hidden />}
              <span>
                {bad.length === 0 ? `All ${num(ordered.length)} ingested without errors` : `${num(ordered.length - bad.length)} of ${num(ordered.length)} ingested without errors`}
                {` · ${num(manifest.total_rows)} records · schema v${manifest.schema_version} · built ${built}`}
              </span>
            </Group>
          }
          right={
            <Group gap="xs">
              <CsvButton onClick={exportCsv} label="Download the snapshot table as CSV" />
              <Popover width={380} position="bottom-end" shadow="md" withArrow>
                <Popover.Target>
                  <Button size="xs" variant="default" leftSection={<IconFileSpreadsheet size={ICON.compact} aria-hidden />}>Source files</Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Text size="xs" c="dimmed" mb={6}>Each snapshot&apos;s workbook and sheet, as published.</Text>
                  <Stack gap={6} className="source-files">
                    {ordered.map((s) => (
                      <div key={s.snapshot_id}>
                        <Text size="xs" fw={600}>{s.snapshot_label}</Text>
                        <Text size="xs" className="mono">{s.source_file}</Text>
                        <Text size="xs" c="dimmed" className="mono">{s.source_sheet}</Text>
                      </div>
                    ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            </Group>
          }
        >
          Per-snapshot ingestion
        </CardTitle>
        {/* No bounded height (G11): the page has one vertical scroll, and the box only ever scrolls sideways. The keyboard
            region is the viewport, the nearest scroller to whatever has focus. */}
        <ScrollArea.Autosize type="auto" offsetScrollbars="present" className="data-snap-scroll" viewportRef={setViewport}
          viewportProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Per-snapshot ingestion table' }} data-overflowing={overflowing || undefined}>
          <Table striped={false} miw={760} className="data-snap-table">
            <Table.Thead>
              <Table.Tr>
                <SortableTh sortKey="date" label="Snapshot" sort={sort} onSort={setSort} />
                <SortableTh sortKey="rows" label="Rows" sort={sort} onSort={setSort} align="right" tip="Rows in the source spreadsheet — one per appointment (a person can hold several)." />
                <Th tip="Distinct identities in the report (name + hire date).">People</Th>
                <Th tip="People with at least one paid appointment — the headcount used across the site.">Paid</Th>
                <Th tip="Change in paid headcount vs the previous snapshot.">Δ Paid</Th>
                <Th tip="Appointments with no salary (affiliates given campus access), excluded from headcount and salary statistics.">Unpaid $0</Th>
                {/* Per row, on purpose: this table reports on the source's rows. Every other median on the site counts people. */}
                <Th tip="Median actual pay per appointment row, as the source lists them — a person with two appointments counts twice here. Every other median on the site counts each person once.">Median / row</Th>
                <Th tip="Change in the median per row vs the previous snapshot.">Δ Median</Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((s) => {
                const prev = prevOf.get(s.snapshot_id);
                const flag = flagOf.get(s.snapshot_id);
                return (
                  <Fragment key={s.snapshot_id}>
                    <Table.Tr data-snapshot={s.snapshot_id} data-noted={flag != null || undefined}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>{s.snapshot_label}</Text>
                          {flag != null && <span className="note-flag" aria-label={`note ${flag}`}>{flag}</span>}
                          {s.snapshot_id === latestId && <NewBadge />}
                          {s.status !== 'ok' && <Badge size="xs" color={s.status === 'error' ? 'red' : 'orange'} variant="light"><VisuallyHidden>Status: </VisuallyHidden>{s.status}</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">{num(s.row_count)}</Table.Td>
                      <Table.Td ta="right">{num(s.distinct_people)}</Table.Td>
                      <Table.Td ta="right" fw={650}>{s.distinct_people_paid != null ? num(s.distinct_people_paid) : '—'}</Table.Td>
                      <Table.Td ta="right">{prev ? <DeltaChip tone="neutral" flatLabel="0.0%" frac={change(s.distinct_people_paid, prev.distinct_people_paid)} /> : '—'}</Table.Td>
                      <Table.Td ta="right">{num(s.zero_or_null_salary)}</Table.Td>
                      <Table.Td ta="right" fw={650}>{usd(s.salary_median)}</Table.Td>
                      <Table.Td ta="right">{prev ? <DeltaChip tone="neutral" flatLabel="0.0%" frac={change(s.salary_median, prev.salary_median)} /> : '—'}</Table.Td>
                    </Table.Tr>
                    {flag != null && (
                      <Table.Tr className="snap-note-row" id={NOTE_IDS[s.snapshot_id] ?? `note-${s.snapshot_id}`} data-note-for={s.snapshot_id}>
                        <Table.Td colSpan={8}>
                          <Group gap={8} wrap="nowrap" align="flex-start">
                            <span className="note-flag" aria-hidden>{flag}</span>
                            <Text size="sm">
                              {s.note}
                              {s.messages?.length ? ` ${s.messages.join('; ')}.` : ''}
                              {s.unmapped_headers?.length ? ` Unmapped columns: ${s.unmapped_headers.join(', ')}.` : ''}
                            </Text>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        <Text size="xs" c="dimmed" mt="sm">
          Hover any column heading for its definition. A numbered note sits under its snapshot — the Nov 2021 TTC relabel, the
          Oct 2023 scope change, or what the newest release changed.
        </Text>
      </Card>

      <Card id="mapping">
        <CardTitle
          anchorId="mapping"
          sub="Columns are auto-detected per snapshot. A mis-detection is one way a value gets the wrong label."
          right={
            <Select {...dropdownProps('sm')} w={200} label="Snapshot" className="mapping-select"
              data={[...ordered].reverse().map((s) => ({ value: s.snapshot_id, label: s.snapshot_label }))}
              value={mapped?.snapshot_id ?? null} onChange={setMapId} allowDeselect={false} />
          }
        >
          How each spreadsheet was read
        </CardTitle>
        <div className="mapping-grid" data-snapshot={mapped?.snapshot_id}>
          {Object.entries(mapped?.detected_mapping ?? {}).map(([field, col]) => (
            <div key={field} className="mapping-pair">
              <code className="mono">{field}</code>
              <Text span size="sm" c="dimmed" className="mono" lineClamp={1} title={col}>← {col}</Text>
            </div>
          ))}
        </div>
        {(mapped?.unmapped_headers?.length ?? 0) > 0 && (
          <Box mt="sm"><Text size="xs" c="dimmed">Unmapped (ignored) source columns: {mapped!.unmapped_headers.join(', ')}.</Text></Box>
        )}
      </Card>
    </Stack>
  );
}
