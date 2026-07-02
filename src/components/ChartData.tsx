import { useState } from 'react';
import { VisuallyHidden, Group, ActionIcon, Tooltip, Table, Button } from '@mantine/core';
import { IconTable, IconDownload } from '@tabler/icons-react';
import { downloadCSV } from '../lib/csv';

/**
 * A chart's data as a table: a screen-reader/print-only fallback by default, with a small toggle to
 * make it visible (and downloadable as CSV) for anyone who'd rather read numbers than a plot — the
 * a11y artifact this app already built for every chart becomes a feature for everyone.
 */
export function ChartData({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
}) {
  const [visible, setVisible] = useState(false);
  if (!rows.length) return null;

  const exportCsv = () =>
    downloadCSV(
      `${caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.csv`,
      rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))
    );

  if (!visible) {
    return (
      <>
        <Group justify="flex-end" mt={4}>
          <Tooltip label="View as table" withArrow>
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="View chart data as a table" aria-pressed={false} onClick={() => setVisible(true)}>
              <IconTable size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
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
      <Group justify="flex-end" gap={4} mt={4}>
        <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconDownload size={12} />} onClick={exportCsv}>CSV</Button>
        <Tooltip label="Hide table" withArrow>
          <ActionIcon size="sm" variant="light" color="accent" aria-label="Hide chart data table" aria-pressed onClick={() => setVisible(false)}>
            <IconTable size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
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
