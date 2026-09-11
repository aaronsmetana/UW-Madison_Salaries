/**
 * Placing text on a chart so that no two pieces of it land on each other.
 *
 * Recharts draws every label blind to its neighbours: a `LabelList` renders each point's label from
 * that point alone, and a `ReferenceLine` label knows its own x and nothing else. On a date axis the
 * spacing between snapshots runs from 17px (the TTC pair) to 280px, and on a phone the whole axis is
 * under 200px, so "each label where its point is" overprints. These functions see every label at
 * once and decide where each goes — or, when they cannot all fit, say so, so the caller can move them
 * somewhere that has room instead of drawing them on top of one another.
 */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;

/**
 * Rows for a set of labels that sit side by side (the title-era labels above the trend chart).
 *
 * Labels arrive in x order as horizontal extents. Each takes the first row whose previous label ends
 * at least `gap` before it starts. Null when any label leaves `bounds` or finds no row: the labels do
 * not fit, and the caller lists them under the chart rather than draw some and drop others.
 */
export function packLabelRows(
  spans: readonly { left: number; right: number }[],
  bounds: { left: number; right: number },
  rows = 2,
  gap = 6
): number[] | null {
  const end = Array<number>(rows).fill(-Infinity);
  const out: number[] = [];
  for (const s of spans) {
    if (s.left < bounds.left - 0.5 || s.right > bounds.right + 0.5) return null;
    const r = end.findIndex((e) => e + gap <= s.left);
    if (r < 0) return null;
    end[r] = s.right;
    out.push(r);
  }
  return out;
}

/** One change chip to place: centred on `x`, beside a point at `y`. */
export interface ChipRequest {
  id: number;
  x: number;
  y: number;
  width: number;
  /** Placed first. Title changes, then the largest changes, so thinning drops the least telling. */
  priority: number;
  /** Try below the point before above it. */
  preferBelow?: boolean;
}

export interface PlacedChip {
  id: number;
  cx: number;
  cy: number;
  box: Box;
}

/**
 * Where each change chip goes, given everything it must not cover.
 *
 * A chip sits `offset` above or below its point, nudged inward at the plot's left and right edges,
 * and must stay inside `plot` and clear of every `obstacle` (title-change markers) and every chip
 * already placed. Chips are placed in priority order; one with no free position is left out — the
 * tooltip and the history table still carry its figure, and a chip drawn over another one carries
 * nothing.
 */
export function placeChips(
  chips: readonly ChipRequest[],
  obstacles: readonly Box[],
  plot: Box,
  o: { height?: number; offset?: number; pad?: number } = {}
): PlacedChip[] {
  const h = o.height ?? 15;
  const offset = o.offset ?? 22;
  const pad = o.pad ?? 2;
  const placed: PlacedChip[] = [];
  const order = [...chips].sort((a, b) => b.priority - a.priority || a.x - b.x);
  for (const c of order) {
    const cx = Math.min(Math.max(c.x, plot.left + c.width / 2), plot.right - c.width / 2);
    const tries = c.preferBelow ? [c.y + offset, c.y - offset] : [c.y - offset, c.y + offset];
    for (const cy of tries) {
      const box = { left: cx - c.width / 2, right: cx + c.width / 2, top: cy - h / 2, bottom: cy + h / 2 };
      if (box.top < plot.top || box.bottom > plot.bottom) continue;
      if (obstacles.some((ob) => overlaps(box, ob, pad))) continue;
      if (placed.some((p) => overlaps(box, p.box, pad))) continue;
      placed.push({ id: c.id, cx, cy, box });
      break;
    }
  }
  return placed.sort((a, b) => a.id - b.id);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * The drawn width of `text` at `fontSize` px in the page's own font. Falls back to an average glyph
 * width where there is no canvas (tests), which is close enough to decide whether labels fit.
 */
export function measureText(text: string, fontSize = 10): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * fontSize * 0.56;
  measureCtx.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width;
}

export interface SideLabel {
  text: string;
  /** SVG text-anchor: 'start' sits after the line, 'end' before it. */
  anchor: 'start' | 'end';
  x: number;
}

/**
 * A label beside a vertical marker at `x`: after the line when it fits inside the plot, else before
 * it; the short wording only when the full one fits on neither side; nothing when neither does. A
 * marker near the right edge used to run its label off the chart ("…reported differentl").
 */
export function placeSideLabel(
  x: number,
  plot: { left: number; right: number },
  texts: readonly string[],
  width: (t: string) => number,
  gap = 4
): SideLabel | null {
  const after = plot.right - (x + gap);
  const before = x - gap - plot.left;
  for (const text of texts) {
    const w = width(text);
    if (w <= after) return { text, anchor: 'start', x: x + gap };
    if (w <= before) return { text, anchor: 'end', x: x - gap };
  }
  return null;
}
