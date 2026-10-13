import { overlaps, type Box } from './labelLayout';

/**
 * Where a histogram's own labels go (SalaryHistogram, P38), worked out apart from the drawing so the rules can be
 * tested on their own. On the Report's histogram "this person" and "median" overlapped and a count sat under the
 * pin; these keep every label off every other.
 */

/** A column, by its extent across the plot and how high it reaches, its count included where that sits above it. */
export interface HistColumn {
  left: number;
  right: number;
  reach: number;
}

/**
 * The height the subject's pin stands at: over every column its label spans, its own included. It stood over its
 * own column alone, so a taller neighbour's bricks or count ran into "this person".
 */
export function pinClearance(cols: readonly HistColumn[], own: number, x: number, labelWidth: number): number {
  const l = x - labelWidth / 2;
  const r = x + labelWidth / 2;
  return cols.reduce((m, c) => (c.right < l || c.left > r ? m : Math.max(m, c.reach)), own);
}

export type MedianPlace = 'over' | 'left' | 'right' | 'up';

/**
 * Where the word "median" goes: over its line, unless the pin's label is there; then beside the line on the side
 * away from the pin, if that stays on the plot and clear of it; else a row up. `x` is the line's position, `top` the
 * label's usual top, `pin` the pin label's box (null when there is no pin).
 */
export function medianPlace(
  { x, width, top, height }: { x: number; width: number; top: number; height: number },
  pin: Box | null,
  plotWidth: number,
  gap = 4,
): MedianPlace {
  if (!pin) return 'over';
  const box = (left: number): Box => ({ left, right: left + width, top, bottom: top + height });
  if (!overlaps(box(x - width / 2), pin, 2)) return 'over';
  const pinX = (pin.left + pin.right) / 2;
  const side = pinX >= x ? 'left' : 'right';
  const beside = box(side === 'left' ? x - gap - width : x + gap);
  if (beside.left >= 0 && beside.right <= plotWidth && !overlaps(beside, pin, 2)) return side;
  return 'up';
}
