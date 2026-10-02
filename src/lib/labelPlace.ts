/**
 * Where a person's name label goes beside their dot: as close as it can be without covering the people,
 * the words and the lines around it — the person-page redesign's placement, one function for both charts.
 *
 * Every candidate is a centre at one of 36 angles and 9 gaps from the dot (the label's nearest edge `gap`
 * pixels past the dot's own 6px). A candidate that leaves the plot, or whose nearest edge comes within 8px
 * of the dot's centre, is out. The rest are scored, lowest best:
 * - the gap (×0.18), so near beats far;
 * - the direction, up and to the right preferred (1.2 × (1 − cos(θ − (−0.6)))), so a label sits where a
 *   reader looks first when nothing else decides it;
 * - every dot it covers (with 3px to spare), 12 × that dot's weight: 1, a dimmed one 0.12, the one pointed
 *   at 3;
 * - every box of words it overlaps, 6 × the box's weight (the median's and the band's labels, the trend
 *   line's name; a readout 10);
 * - every sampled point of a line it lies on, the line's weight (the median 0.25, a trend line 0.3, the
 *   person's own guides 0.6);
 * - every dot its leader would pass through, 0.6 × that dot's weight;
 * - a dividing line (`divides`) between the name and its dot (the way from the dot to the name's centre
 *   crosses it), 40 × the line's weight: a name across a trend line from its dot reads as the other side's (the scatter's rule
 *   before this placement, kept);
 * - how far it would move from where it is now (×0.006), so it does not jump for nothing.
 *
 * The leader runs from 7px outside the dot's centre to the nearest point of the label, and is left out
 * when that is under 11px: a label that close needs no line to say whose it is.
 */

export interface Pt { x: number; y: number }
export interface Box { x0: number; y0: number; x1: number; y1: number; weight?: number }
export interface Dot { x: number; y: number; r: number; weight?: number }
/** A line on the plot, sampled. `divides`: a name must stay on its dot's side of it (a trend line). */
export interface Line { points: Pt[]; weight: number; divides?: boolean }
export interface Placement { x: number; y: number; leader: { x1: number; y1: number; x2: number; y2: number } | null }

const ANGLES = 36;
const GAPS = [2, 6, 11, 17, 24, 32, 42, 54, 68];
const PREFERRED = -0.6;

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxOf = (c: Pt, w: number, h: number): Box => ({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 });
/** The point of a box nearest to `p` (p itself when inside). */
const nearest = (b: Box, p: Pt): Pt => ({ x: Math.max(b.x0, Math.min(b.x1, p.x)), y: Math.max(b.y0, Math.min(b.y1, p.y)) });
/** Whether segments a–b and c–d cross or touch. A way that passes exactly through a sampled point of a line
 *  has crossed it. */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) <= 0 && o(c, d, a) * o(c, d, b) <= 0;
}
const near1 = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;
/** Distance from `p` to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function leaderFor(anchor: Pt, label: Box): Placement['leader'] {
  const end = nearest(label, anchor);
  const d = Math.hypot(end.x - anchor.x, end.y - anchor.y);
  if (d < 11) return null;
  const k = 7 / d;
  return { x1: anchor.x + (end.x - anchor.x) * k, y1: anchor.y + (end.y - anchor.y) * k, x2: end.x, y2: end.y };
}

export function placeLabel({ anchor, size, bounds, dots = [], boxes = [], lines = [], current = null }: {
  /** The dot's centre. */
  anchor: Pt;
  /** The label's measured width and height. */
  size: { w: number; h: number };
  /** The plot area: a label never leaves it. */
  bounds: Box;
  /** Everyone else's dot (not the anchor's own). */
  dots?: Dot[];
  /** Words already on the plot. */
  boxes?: Box[];
  /** Lines on the plot, sampled into points. */
  lines?: Line[];
  /** Where the label's centre is now, if it is drawn. */
  current?: Pt | null;
}): Placement {
  const hw = size.w / 2, hh = size.h / 2;
  let best: { c: Pt; score: number } | null = null;
  for (let a = 0; a < ANGLES; a++) {
    const th = (a / ANGLES) * 2 * Math.PI - Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th);
    // From the centre to the box's edge along u.
    const t = Math.min(Math.abs(ux) > 1e-9 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hh / Math.abs(uy) : Infinity);
    for (const gap of GAPS) {
      const c = { x: anchor.x + ux * (6 + gap + t), y: anchor.y + uy * (6 + gap + t) };
      const box = boxOf(c, size.w, size.h);
      if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.y0 < bounds.y0 || box.y1 > bounds.y1) continue;
      const edge = nearest(box, anchor);
      if (Math.hypot(edge.x - anchor.x, edge.y - anchor.y) < 8) continue;

      let score = gap * 0.18 + 1.2 * (1 - Math.cos(th - PREFERRED));
      const padded = { x0: box.x0 - 3, y0: box.y0 - 3, x1: box.x1 + 3, y1: box.y1 + 3 };
      const leader = leaderFor(anchor, box);
      for (const d of dots) {
        const w = d.weight ?? 1;
        const n = nearest(padded, d);
        if (Math.hypot(n.x - d.x, n.y - d.y) < d.r) score += 12 * w;
        if (leader && segDist(d, { x: leader.x1, y: leader.y1 }, { x: leader.x2, y: leader.y2 }) < d.r) score += 0.6 * w;
      }
      for (const b of boxes) if (overlap(box, b)) score += 6 * (b.weight ?? 1);
      for (const l of lines) {
        for (const p of l.points) if (p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) score += l.weight;
        // Not a line that starts at the dot (its own guides): every way out of the dot touches those.
        if (l.divides) for (let i = 1; i < l.points.length; i++) {
          const p0 = l.points[i - 1], p1 = l.points[i];
          if (near1(p0, anchor) || near1(p1, anchor)) continue;
          if (crosses(anchor, c, p0, p1)) { score += 40 * l.weight; break; }
        }
      }
      if (current) score += Math.hypot(c.x - current.x, c.y - current.y) * 0.006;
      if (!best || score < best.score - 1e-9) best = { c, score };
    }
  }
  // Nowhere fits inside the plot (a plot narrower than the label): over the dot, clamped to the plot.
  const c = best?.c ?? {
    x: Math.max(bounds.x0 + hw, Math.min(bounds.x1 - hw, anchor.x)),
    y: Math.max(bounds.y0 + hh, Math.min(bounds.y1 - hh, anchor.y - 6 - hh - 2)),
  };
  return { x: c.x, y: c.y, leader: leaderFor(anchor, boxOf(c, size.w, size.h)) };
}

/** A vertical line from y0 to y1 at x, sampled every 4px, for `lines`. */
export function sampleVertical(x: number, y0: number, y1: number): Pt[] {
  const out: Pt[] = [];
  for (let y = y0; y <= y1; y += 4) out.push({ x, y });
  return out;
}
/** A straight line between two points, sampled every 4px. */
export function sampleSegment(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  return [...Array(n + 1)].map((_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}
