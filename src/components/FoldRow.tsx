import type { ReactNode } from 'react';
import { Table, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

/** A phone's screen, where a `.fold-table` folds its context columns away (app.css). */
export function useFolded(): boolean {
  return useMediaQuery('screen and (max-width: 48em)', false, { getInitialValueInEffect: false }) ?? false;
}

/**
 * A row's second line on a phone (M3), as a row of its own across the table's width: where someone works (and
 * whatever else the row folded away), with `aside` at its right end. Under the name, in the name's own cell, a
 * school was cut off mid-word at two lines ("College of Letters & Scienc…") while the width under the pay sat
 * empty. The row above keeps the name and, right-aligned, the pay.
 *
 * Drawn only where the table folds (`useFolded`): a wider screen has the columns themselves.
 */
export function FoldRow({ span, children, aside, onClick, pointed, onPoint, className }: {
  /** How many columns the table has, folded or not. */
  span: number;
  children: ReactNode;
  aside?: ReactNode;
  /** The row above's own press, so the two lines are one target. */
  onClick?: () => void;
  pointed?: boolean;
  onPoint?: (on: boolean) => void;
  /** The row above's own marks (`row-this`), so the two lines read as one row. */
  className?: string;
}) {
  return (
    <Table.Tr
      className={className ? `fold-row ${className}` : 'fold-row'}
      data-pointed={pointed || undefined}
      onClick={onClick}
      onMouseEnter={onPoint ? () => onPoint(true) : undefined}
      onMouseLeave={onPoint ? () => onPoint(false) : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <Table.Td colSpan={span}>
        <div className="fold-row-line">
          <Text span size="xs" c="dimmed" className="fold-row-text">{children}</Text>
          {aside != null && <Text span size="xs" c="dimmed" className="fold-row-aside">{aside}</Text>}
        </div>
      </Table.Td>
    </Table.Tr>
  );
}
