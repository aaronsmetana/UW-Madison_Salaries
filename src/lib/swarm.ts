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

/** The air between two dots of a beeswarm, beyond their own radii. */
export const SWARM_PAD = 1.5;

/**
 * A beeswarm: each dot's offset from a centreline, so that no two dots overlap, every dot as close to the
 * line as the dots placed before it allow, and the same input always gives the same picture.
 *
 * The person the chart is about goes first, on the line. Everyone else follows in order of `xs` (lowest
 * pay first) and takes the offset nearest the line that clears every dot already placed (radius `r`, and
 * SWARM_PAD between). Where two offsets are as near, the one above the line wins, then the one below on the
 * next tie, so a run of equal pays fans out both ways rather than climbing one side.
 *
 * Returns null when a dot would sit further than `maxOffset` from the line: the cohort is too dense for
 * dots at this width, and the caller draws its density instead.
 */
export function beeswarm(xs: number[], r: number, maxOffset: number, first = -1): number[] | null {
  const n = xs.length;
  const ys = new Array<number>(n).fill(0);
  const reach = 2 * r + SWARM_PAD;
  const order = xs.map((_, i) => i).filter((i) => i !== first).sort((a, b) => xs[a] - xs[b] || a - b);
  if (first >= 0 && first < n) order.unshift(first);
  // The dots placed so far; a new one looks only at those within `reach` of it.
  const placed: number[] = [];
  let flip = false;
  for (const i of order) {
    const x = xs[i];
    // Every offset a placed neighbour forbids, as an open interval.
    const blocked: [number, number][] = [];
    for (const j of placed) {
      const dx = Math.abs(xs[j] - x);
      if (dx >= reach) continue;
      const h = Math.sqrt(reach * reach - dx * dx);
      blocked.push([ys[j] - h, ys[j] + h]);
    }
    const free = (y: number) => blocked.every(([a, b]) => y <= a + 1e-9 || y >= b - 1e-9);
    // The line itself, or an edge of a forbidden interval: the nearest free one of those.
    const candidates = [0, ...blocked.flatMap(([a, b]) => [a, b])].filter(free);
    let best = Infinity;
    for (const y of candidates) {
      const d = Math.abs(y), bd = Math.abs(best);
      if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && (flip ? y > best : y < best))) best = y;
    }
    if (Math.abs(best) > 1e-9) flip = !flip;
    if (!(Math.abs(best) <= maxOffset)) return null;
    ys[i] = Math.abs(best) < 1e-9 ? 0 : best;
    placed.push(i);
  }
  return ys;
}
