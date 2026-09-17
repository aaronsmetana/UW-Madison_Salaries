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

export interface PlacedSideLabel extends SideLabel {
  /** 0 on the line beside the plot; 1 a row further out, where two would otherwise touch. */
  row: number;
}

/**
 * Several markers' labels on one edge of a plot, kept apart. Each is placed as `placeSideLabel` would
 * place it alone; where two would sit closer than `apart` px, both take their shortest wording; any
 * still touching after that, the later one (along x) moves out a row. On a phone the TTC relabel and
 * the Sep 2025 reporting change printed as one run, "TTC reclassification9-month reporting".
 */
export function placeSideLabels(
  marks: readonly { x: number; texts: readonly string[] }[],
  plot: { left: number; right: number },
  width: (t: string) => number,
  gap = 4,
  apart = 6
): (PlacedSideLabel | null)[] {
  const span = (p: SideLabel) => {
    const w = width(p.text);
    return p.anchor === 'start' ? [p.x, p.x + w] : [p.x - w, p.x];
  };
  const touch = (a: PlacedSideLabel | null, b: PlacedSideLabel | null) => {
    if (!a || !b || a.row !== b.row) return false;
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    return a0 < b1 + apart && b0 < a1 + apart;
  };
  const place = (pick: (i: number) => readonly string[]) =>
    marks.map((m, i) => {
      const p = placeSideLabel(m.x, plot, pick(i), width, gap);
      return p ? { ...p, row: 0 } : null;
    });
  let out = place((i) => marks[i].texts);
  const clashing = new Set<number>();
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (touch(out[i], out[j])) { clashing.add(i); clashing.add(j); }
  if (!clashing.size) return out;
  out = place((i) => (clashing.has(i) ? marks[i].texts.slice(-1) : marks[i].texts));
  const order = marks.map((_, i) => i).sort((a, b) => marks[a].x - marks[b].x);
  order.forEach((i, k) => {
    for (const j of order.slice(0, k)) if (touch(out[i], out[j]) && out[i]) out[i] = { ...out[i]!, row: 1 };
  });
  return out;
}

/**
 * Does the segment a-b pass through `box`? Liang-Barsky, so a line that merely touches a corner does
 * not count. Used to keep a leader from crossing a label it does not belong to — a leader that runs
 * through another name is worse than no leader at all, because it reads as pointing at that one.
 */
export function segmentHitsBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: Box,
  pad = 0,
): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - (box.left - pad)],
    [dx, (box.right + pad) - a.x],
    [-dy, a.y - (box.top - pad)],
    [dy, (box.bottom + pad) - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 > t0;
}

/** What it costs a label to sit straight over another marked point, in the same units as the distance
 *  from its own point: about two rows' worth, so a label will go a good way round rather than wall a
 *  neighbour in, but will still take the place if there is nowhere else. */
const WALLED_IN = 45;

/** A label that belongs to one point on a chart, and must stay by it. */
export interface NearLabel {
  id: number;
  /** The point it names, and the radius to keep clear of it (the dot's own drawn size). */
  x: number;
  y: number;
  r: number;
  width: number;
  /** Placed first, so the one the reader is following gets the closest place there is. */
  priority: number;
}

export interface PlacedNearLabel {
  id: number;
  cx: number;
  cy: number;
  box: Box;
  /** Where its leader meets it: the edge or corner the line from the point ends on. */
  anchor: { x: number; y: number };
}

/**
 * A label for each point, as near to its own point as there is room for.
 *
 * The other approach — one bank of labels along the top of the plot, each with a leader down to its
 * point — was tried and read wrongly: the names became a legend at the top of the page rather than
 * annotations on the graph, and every leader crossed the whole plot to get back to its dot. So each
 * label is placed against its own point: straight above it, straight below, or out along a 45-degree
 * ray, where the label hangs off the end of the ray by its near corner.
 *
 * 45 degrees, and nothing in between, because a reader follows a line by its angle: a fan of leaders
 * at arbitrary angles has to be traced one by one, while a bank of parallel diagonals reads at a
 * glance. Hanging the label off the ray's end rather than centring it on the ray is what lets several
 * of them nest — each sits clear of the next ray out, so a crowd of dots grows a staircase of names
 * rather than a heap.
 *
 * Nothing is drawn over a marked point, no label over another, and no leader through a name it does
 * not belong to — that last one reads as pointing at the wrong person, which is worse than no leader.
 * A label with nowhere to go is left out; the search list still names everyone.
 */
export function placeNearLabels(
  labels: readonly NearLabel[],
  plot: Box,
  o: { height?: number; lift?: number; step?: number; levels?: number; pad?: number; reach?: number } = {}
): PlacedNearLabel[] {
  const h = o.height ?? 19;
  const lift = o.lift ?? 8;
  const step = o.step ?? 21;
  const levels = o.levels ?? 5;
  const pad = o.pad ?? 4;
  // The furthest a leader may reach along its ray. Past this a name stops being read as this dot's and
  // starts being read as a legend with a line attached, which is the failure this replaced.
  const reach = o.reach ?? 104;
  // Every point stays clear, whether or not its own label is placed: a name over another green dot
  // hides the very thing it is pointing at.
  const points: Box[] = labels.map((l) => ({ left: l.x - l.r, right: l.x + l.r, top: l.y - l.r, bottom: l.y + l.r }));
  const placed: PlacedNearLabel[] = [];
  const order = [...labels].sort((a, b) => b.priority - a.priority || a.x - b.x);
  for (const l of order) {
    const half = l.width / 2;
    const spots: { cx: number; cy: number; anchor: { x: number; y: number }; cost: number }[] = [];
    for (let lvl = 0; lvl < levels; lvl++) {
      const t = l.r + lift + lvl * step;
      // Straight above and below: a vertical leader to the middle of the near edge.
      spots.push({ cx: l.x, cy: l.y - t - h / 2, anchor: { x: l.x, y: l.y - t }, cost: t });
      spots.push({ cx: l.x, cy: l.y + t + h / 2, anchor: { x: l.x, y: l.y + t }, cost: t + 0.1 });
      // Out along a 45-degree ray, the label hanging off its end by the near bottom (or top) corner.
      if (t > reach) continue;
      for (const dir of [-1, 1]) {
        const corner = l.x + dir * t;
        const cx = corner + dir * half;
        spots.push({ cx, cy: l.y - t - h / 2, anchor: { x: corner, y: l.y - t }, cost: t * Math.SQRT2 });
        spots.push({ cx, cy: l.y + t + h / 2, anchor: { x: corner, y: l.y + t }, cost: t * Math.SQRT2 + 0.1 });
      }
    }
    // A label that sits straight over another marked dot walls that dot in: every way out from it,
    // vertical or diagonal, then runs through this name. So covering someone else's sky costs, and in
    // a crowd the labels fan out along their rays instead of the first one taking the middle.
    for (const s of spots) {
      const above = s.cy < l.y;
      for (const other of labels) {
        if (other.id === l.id) continue;
        const inSpan = other.x > s.cx - half - pad && other.x < s.cx + half + pad;
        if (inSpan && (above ? other.y > s.cy : other.y < s.cy)) s.cost += WALLED_IN;
      }
    }
    spots.sort((a, b) => a.cost - b.cost);
    for (const s of spots) {
      const box = { left: s.cx - half, right: s.cx + half, top: s.cy - h / 2, bottom: s.cy + h / 2 };
      if (box.top < plot.top || box.bottom > plot.bottom) continue;
      if (box.left < plot.left || box.right > plot.right) continue;
      if (points.some((p) => overlaps(box, p, pad))) continue;
      if (placed.some((p) => overlaps(box, p.box, pad))) continue;
      // The leader has to get there without running through a name it does not belong to — which is
      // what simply stacking labels above one another would do, however clear of each other they are.
      if (placed.some((p) => segmentHitsBox({ x: l.x, y: l.y }, s.anchor, p.box, pad))) continue;
      placed.push({ id: l.id, cx: s.cx, cy: s.cy, box, anchor: s.anchor });
      break;
    }
  }
  return placed.sort((a, b) => a.id - b.id);
}
