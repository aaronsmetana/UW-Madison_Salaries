import { assignLabelRows } from './chartStyle';

/** Dot geometry for the peer strip. One dot is one person; the pitch decides how many rows a cohort
 *  needs, and that in turn decides whether the strip can draw dots at all.
 *
 *  The radius is a parameter rather than a constant here on purpose. It used to be its own `DOT_R =
 *  4` while PeerStrip drew at `DOT_R.peer = 4.5` from the shared marker vocabulary, so the packer
 *  reserved 8px for a 9px dot and every row-neighbour overlapped by a pixel — a collision-free
 *  guarantee that was wrong by 12%, and invisible because the unit tests measured the packer against
 *  its own constant rather than against what got drawn. One radius, passed in from the caller that
 *  owns it, is the only arrangement that cannot drift again. */
export const DOT_GAP = 2;
export const rowHeight = (dotR: number): number => dotR * 2 + DOT_GAP;
/** Above this many rows a swarm stops reading as countable people and becomes a smear. A fit test
 *  rather than a headcount threshold: a tightly-clustered cohort of 60 needs more rows than a
 *  well-spread cohort of 140, and only the geometry knows which is which. */
export const MAX_ROWS = 8;

/**
 * Vertical row for each dot, packed so that no two dots on the same row overlap.
 *
 * This is `assignLabelRows` with a constant width — a dot is a label that is always `2r` across — so
 * there is no second packing algorithm to keep in step with the first. `values` must be sorted
 * ascending: the packer is greedy and fills each row left to right, so unsorted input still produces
 * a correct (non-overlapping) answer but a needlessly tall one.
 *
 * Returns an empty array when the container has not been measured yet — every centre would be 0 and
 * every dot would open its own row.
 */
export function dotRows(
  sortedValues: number[],
  at: (v: number) => number,
  widthPx: number,
  dotR: number,
): number[] {
  if (widthPx <= 0 || !sortedValues.length) return [];
  return assignLabelRows(
    sortedValues.map((v) => at(v) * widthPx),
    sortedValues.map(() => dotR * 2),
    DOT_GAP,
  );
}
