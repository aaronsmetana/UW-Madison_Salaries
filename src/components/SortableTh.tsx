import type { ReactNode } from 'react';
import { Table, UnstyledButton, Group, Tooltip } from '@mantine/core';
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

export interface SortState<K extends string> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * A sortable, `aria-sort`-annotated table header cell: click toggles desc→asc→desc on the same column,
 * or jumps to desc on a new one. Callers own where the sort state lives (local state, URL params, …) —
 * this only computes what the next state should be and renders the affordance.
 *
 * The label sits inside a real `<button>`, which is the canonical ARIA pattern for a sortable header
 * (`<th aria-sort><button>`). It used to be a bare `<th onClick>` styled with `cursor: pointer` — it
 * looked clickable but was not focusable and was never announced as a control, so sorting was
 * mouse-only across every table in the app.
 *
 * `.sort-th` resets the button's inherited font so the label keeps the shared uppercase/11px/dimmed
 * header treatment (`app.css`); without it a button's UA styles win and the sortable columns render
 * ~45% larger and in sentence case beside their neighbours.
 *
 * `tip` puts an explanatory tooltip on the button itself rather than on a nested focusable span —
 * nesting one interactive element inside another is invalid and unreachable by keyboard.
 */
export function SortableTh<K extends string>({
  sortKey,
  label,
  srLabel,
  sort,
  onSort,
  align,
  tip,
}: {
  sortKey: K;
  label: ReactNode;
  /** Spoken name, when `label` isn't a plain string. Defaults to `label`, then to `sortKey`. */
  srLabel?: string;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  align?: 'right';
  tip?: string;
}) {
  const active = sort.key === sortKey;
  const nextDir: 'asc' | 'desc' = active && sort.dir === 'desc' ? 'asc' : 'desc';

  const control = (
    <UnstyledButton
      className="sort-th"
      onClick={() => onSort({ key: sortKey, dir: nextDir })}
      aria-label={`Sort by ${srLabel ?? (typeof label === 'string' ? label : sortKey)}`}
    >
      <Group gap={4} wrap="nowrap" justify={align === 'right' ? 'flex-end' : 'flex-start'}>
        <span>{label}</span>
        {active
          ? (sort.dir === 'asc' ? <IconChevronUp size={ICON.inline} /> : <IconChevronDown size={ICON.inline} />)
          : <IconSelector size={ICON.inline} style={{ opacity: 0.35 }} />}
      </Group>
    </UnstyledButton>
  );

  return (
    <Table.Th
      ta={align}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ whiteSpace: 'nowrap' }}
    >
      {tip ? <Tooltip label={tip} withArrow multiline w={260}>{control}</Tooltip> : control}
    </Table.Th>
  );
}
