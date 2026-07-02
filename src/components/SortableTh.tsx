import type { ReactNode } from 'react';
import { Table } from '@mantine/core';

export interface SortState<K extends string> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * A clickable, `aria-sort`-annotated table header cell: click toggles desc→asc→desc on the same
 * column, or jumps to desc on a new one. Callers own where the sort state lives (local state, URL
 * params, …) — this only computes what the next state should be and renders the arrow.
 */
export function SortableTh<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  align,
}: {
  sortKey: K;
  label: ReactNode;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  align?: 'right';
}) {
  const active = sort.key === sortKey;
  const nextDir: 'asc' | 'desc' = active && sort.dir === 'desc' ? 'asc' : 'desc';
  return (
    <Table.Th
      ta={align}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => onSort({ key: sortKey, dir: nextDir })}
    >
      {label}{active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </Table.Th>
  );
}
