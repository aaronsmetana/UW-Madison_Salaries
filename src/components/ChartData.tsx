import { useState } from 'react';
import { VisuallyHidden, ActionIcon, Tooltip, Table, Button } from '@mantine/core';
import { IconTable, IconDownload } from '@tabler/icons-react';
import { downloadCSV } from '../lib/csv';
import { ICON } from '../lib/ui';
import { SourceNote } from './SourceNote';

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
              {rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
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
            {rows.map((r, i) => (
              <Table.Tr key={i}>{r.map((v, j) => <Table.Td key={j}>{v ?? ''}</Table.Td>)}</Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}
