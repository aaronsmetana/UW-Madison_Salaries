import { useEffect, useRef, useState } from 'react';
import { Button, Group, Pagination, Text } from '@mantine/core';
import { num } from '../lib/format';

/** How many rows a long list shows before its "Show all": a hundred ran the Titles page to 9,000px. */
export const LIST_PAGE = 25;
/** How many rows a page holds once all are asked for (I6): "Show all 1,315" drew every row of Divisions' Titles at
 *  once, a page about 75,000px tall. */
export const PAGE_ROWS = 100;

/** The rows of `rows` to draw: the first `size`, or — all asked for — the page `page` of PAGE_ROWS; and how many pages. */
export function pageOf<T>(rows: readonly T[], all: boolean, page: number, size = LIST_PAGE) {
  if (!all) return { shown: rows.length <= size ? rows : rows.slice(0, size), pages: 1, from: 0 };
  if (rows.length <= PAGE_ROWS) return { shown: rows, pages: 1, from: 0 };
  const pages = Math.ceil(rows.length / PAGE_ROWS);
  const p = Math.min(Math.max(1, page), pages);
  return { shown: rows.slice((p - 1) * PAGE_ROWS, p * PAGE_ROWS), pages, from: (p - 1) * PAGE_ROWS };
}

/**
 * A long list shown in part, the rest one press away (G11). A page has one vertical scroll, its own: a list
 * kept in a scroll box of its own put a second one inside it, with the rows past the box's foot a scroll inside
 * a scroll away. The first `size` rows, then on "Show all" the rest, a hundred a page past a hundred (I6); back to
 * the first rows when `reset` changes (a new filter, sort or step).
 */
export function useShowAll<T>(rows: readonly T[], reset: unknown, size = LIST_PAGE) {
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setAll(false); setPage(1); }, [reset]);
  const { shown, pages, from } = pageOf(rows, all, page, size);
  return { shown, all, total: rows.length, showAll: () => setAll(true), pager: { page, pages, from, setPage } };
}

export interface Pager { page: number; pages: number; from: number; setPage: (p: number) => void }

/**
 * A list's foot while it is shown in part: how many of how many, and the button for the rest; once all are asked
 * for and they run past a page, which rows these are and the pages, each turn bringing the list's top back into
 * view (the list is the element just before this foot).
 */
export function ShowAll({ shown, total, onShowAll, pager }: { shown: number; total: number; onShowAll: () => void; pager?: Pager }) {
  const ref = useRef<HTMLDivElement>(null);
  if (pager && pager.pages > 1) {
    return (
      <Group ref={ref} justify="center" gap="md" p="md" className="show-all list-pager" wrap="wrap">
        <Text size="sm" c="dimmed" className="list-pager-range">Rows {num(pager.from + 1)}–{num(pager.from + shown)} of {num(total)}</Text>
        <Pagination size="sm" total={pager.pages} value={pager.page} siblings={1} boundaries={1}
          getControlProps={(c) => ({ 'aria-label': c === 'previous' ? 'Previous page' : c === 'next' ? 'Next page' : undefined })}
          onChange={(p) => {
            pager.setPage(p);
            // The list: what comes just before this foot, or before whatever holds it. Its top under the page's own
            // header, which is fixed over the top of the window.
            let at: Element | null = ref.current;
            while (at && !at.previousElementSibling) at = at.parentElement;
            const list = (at?.previousElementSibling ?? null) as HTMLElement | null;
            const head = ref.current ? parseFloat(getComputedStyle(ref.current).getPropertyValue('--app-shell-header-offset')) || 0 : 0;
            const top = list ? list.getBoundingClientRect().top - head - 12 : 0;
            if (top < 0) window.scrollBy({ top });
          }} />
      </Group>
    );
  }
  if (shown >= total) return null;
  return (
    <Group justify="center" gap="sm" p="md" className="show-all">
      <Text size="sm" c="dimmed">Showing {num(shown)} of {num(total)}</Text>
      <Button variant="default" size="sm" onClick={onShowAll}>Show all {num(total)}{total > PAGE_ROWS ? `, ${PAGE_ROWS} a page` : ''}</Button>
    </Group>
  );
}
