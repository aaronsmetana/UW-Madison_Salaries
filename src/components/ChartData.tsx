import { useState } from 'react';
import { VisuallyHidden, ActionIcon, Tooltip, Table, Button, Text } from '@mantine/core';
import { IconTable, IconDownload } from '@tabler/icons-react';
import { downloadCSV } from '../lib/csv';
import { ICON } from '../lib/ui';
import { SourceNote } from './SourceNote';

/** Beyond this the table stops being a fallback and becomes an obstruction — see `cell` and the cap
 *  note below. The CSV still carries every row, which is what a reader who wants them all should take. */
const MAX_TABLE_ROWS = 200;

/**
 * How one cell reads.
 *
 * Values arrived here raw, so a tenure printed as `11.266255989048597` and a median as
 * `63659.200000000004` — fifteen significant digits and visible floating-point noise, in the
 * screen-reader fallback and on the printed page. Round numbers and group thousands; leave strings
 * exactly as the caller wrote them, since those are already formatted ("+2.0%", "$120k–$140k").
 *
 * Deliberately no currency symbol: this component cannot know a column's unit, and guessing from the
 * header would be wrong the first time someone adds a column called "Change". The header carries the
 * unit; the cell carries the number. The CSV is untouched either way — it is the machine-readable
 * copy, and rounding it would be a regression.
 */
function cell(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * A chart's data as a table — a screen-reader/print-only fallback by default, with a toggle to make
 * it visible for anyone who'd rather read numbers than a plot — plus the chart's provenance footer.
 *
 * The two live together because they are one row of the card: the same strip that says where the
 * figures came from is the strip that lets you take them. Keeping them apart would have meant two
 * stacked dimmed lines under every chart, and a `SourceNote` sitting beside a `ChartData` at
 * thirteen call sites is exactly the "two components for one job" pattern this pass is undoing.
 *
 * The CSV button used to appear only *after* the reader opened the table, so the download was
 * hidden behind an affordance most people never pressed. It is always visible now.
 *
 * The table renders whether or not it is visible, so its size is a real cost even when nobody opens
 * it: a 3,000-point scatter put 3,000 rows of raw floats into the accessibility tree and onto the
 * printed page. It is capped now, and the cap says so.
 */
export function ChartData({
  caption,
  columns,
  rows,
  n,
  unit,
  period,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
  /** The population the chart describes, when that differs from its row count (see `SourceNote`). */
  n?: number | null;
  unit?: string;
  period?: string | null;
}) {
  const [visible, setVisible] = useState(false);
  if (!rows.length) return null;

  const shown = rows.length > MAX_TABLE_ROWS ? rows.slice(0, MAX_TABLE_ROWS) : rows;
  const capNote = shown.length < rows.length
    ? `Showing the first ${MAX_TABLE_ROWS.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows — the CSV has them all.`
    : null;

  const exportCsv = () =>
    downloadCSV(
      `${caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.csv`,
      rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))
    );

  // One footer for both states, rendered directly under the chart either way — so opening the table
  // doesn't move the button that closes it to the far side of a screenful of rows.
  const footer = (
    <SourceNote
      n={n ?? rows.length}
      unit={unit}
      period={period}
      actions={
        <>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={<IconDownload size={ICON.inline} />}
            onClick={exportCsv}
          >
            CSV
          </Button>
          <Tooltip label={visible ? 'Hide table' : 'View as table'} withArrow>
            <ActionIcon
              size="sm"
              variant={visible ? 'light' : 'subtle'}
              color={visible ? 'accent' : 'gray'}
              aria-label={visible ? 'Hide chart data table' : 'View chart data as a table'}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
            >
              <IconTable size={ICON.compact} />
            </ActionIcon>
          </Tooltip>
        </>
      }
    />
  );

  if (!visible) {
    return (
      <>
        {footer}
        <VisuallyHidden>
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {capNote}
        </VisuallyHidden>
      </>
    );
  }

  return (
    <div>
      {footer}
      <Table.ScrollContainer minWidth={Math.max(320, columns.length * 110)}>
        <Table striped withTableBorder mt={4} stickyHeader>
          <Table.Caption>{caption}</Table.Caption>
          <Table.Thead>
            <Table.Tr>{columns.map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((r, i) => (
              <Table.Tr key={i}>{r.map((v, j) => <Table.Td key={j}>{cell(v)}</Table.Td>)}</Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {capNote && <Text size="xs" c="dimmed" mt={4}>{capNote}</Text>}
    </div>
  );
}
