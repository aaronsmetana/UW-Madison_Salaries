import { useEffect, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { num } from '../lib/format';

/** How many rows a long list shows before its "Show all": a hundred ran the Titles page to 9,000px. */
export const LIST_PAGE = 25;

/**
 * A long list shown in part, the rest one press away (G11). A page has one vertical scroll, its own: a list
 * kept in a scroll box of its own put a second one inside it, with the rows past the box's foot a scroll inside
 * a scroll away. The first `size` rows, then the rest on "Show all"; back to the first rows when `reset` changes
 * (a new filter, sort or step).
 */
export function useShowAll<T>(rows: readonly T[], reset: unknown, size = LIST_PAGE) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [reset]);
  return { shown: all || rows.length <= size ? rows : rows.slice(0, size), all, total: rows.length, showAll: () => setAll(true) };
}

/** A list's foot while it is shown in part: how many of how many, and the button for the rest. */
export function ShowAll({ shown, total, onShowAll }: { shown: number; total: number; onShowAll: () => void }) {
  if (shown >= total) return null;
  return (
    <Group justify="center" gap="sm" p="md" className="show-all">
      <Text size="sm" c="dimmed">Showing {num(shown)} of {num(total)}</Text>
      <Button variant="default" size="sm" onClick={onShowAll}>Show all {num(total)}</Button>
    </Group>
  );
}
