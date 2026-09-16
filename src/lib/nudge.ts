/**
 * Dots on a scatter nudged apart, each by as little as it takes to stand clear of the ones already
 * placed — and never further than `maxShift` px from where its values put it.
 *
 * A same-title scatter can have a hundred people on one exact salary: Research Associate's 103 on
 * $60,416, mostly in their first three years, were one thick bar in which 71% of dots had their centre
 * under another. The landing graph gives every dot its own room by moving it at most a few pixels
 * (lib/dotLayout `packDots`); this is the same promise in two dimensions. A dot that cannot find room
 * within `maxShift` stays exactly where its values put it and is counted `crowded`, so the chart can
 * say how honest its picture is rather than wander a person off their pay.
 */
export const NUDGE_MAX = 10;

export interface NudgePoint {
  /** Where its values put it, px. */
  x: number;
  y: number;
  /** Holds its place whatever is there (the subject): placed first, never moved. */
  fixed?: boolean;
  /** Its own radius, px, where it is not the one given for all (a larger mark). */
  r?: number;
}

export interface Nudged {
  /** Where each point is drawn, px, in the order given. */
  xs: Float64Array;
  ys: Float64Array;
  /** Points that found no room within `maxShift` and overlap another where their values put them. */
  crowded: number;
  /** The furthest any point was moved, px. */
  maxShift: number;
}

/**
 * Places `pts` in order (fixed ones first), each at the first spot clear of every placed dot by the two
 * radii and `gap` — its own spot if that is clear, else the nearest on rings half a pixel apart out to
 * `maxShift`, inside `bounds` when given. Radii are each point's own, or `r`. Deterministic: the same
 * input draws the same picture.
 */
export function nudgeApart(
  pts: readonly NudgePoint[], r: number, maxShift = NUDGE_MAX, gap = 0.8,
  bounds?: { x0: number; y0: number; x1: number; y1: number },
): Nudged {
  const n = pts.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  const radius = (i: number) => pts[i].r ?? r;
  let widest = r;
  for (let i = 0; i < n; i++) widest = Math.max(widest, radius(i));
  // A cell as wide as the widest spacing any two dots need, so a clash is always in a neighbouring cell.
  const pitch = 2 * widest + gap;
  const grid = new Map<number, number[]>();
  const cellOf = (v: number) => Math.floor(v / pitch);
  const keyOf = (cx: number, cy: number) => cx * 1_000_003 + cy;
  const clear = (i: number, x: number, y: number) => {
    const cx = cellOf(x), cy = cellOf(y);
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cy - 1; b <= cy + 1; b++) {
        const list = grid.get(keyOf(a, b));
        if (!list) continue;
        for (const j of list) {
          const need = radius(i) + radius(j) + gap;
          if ((xs[j] - x) ** 2 + (ys[j] - y) ** 2 < need * need - 1e-9) return false;
        }
      }
    }
    return true;
  };
  const put = (i: number, x: number, y: number) => {
    xs[i] = x; ys[i] = y;
    const k = keyOf(cellOf(x), cellOf(y));
    const list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  };
  const inside = (x: number, y: number) => !bounds || (x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1);
  let crowded = 0, most = 0;
  const order = [...pts.keys()].sort((a, b) => Number(!!pts[b].fixed) - Number(!!pts[a].fixed) || a - b);
  for (const i of order) {
    const { x, y, fixed } = pts[i];
    if (fixed || clear(i, x, y)) { put(i, x, y); continue; }
    let placed = false;
    for (let rad = 0.5; rad <= maxShift + 1e-9 && !placed; rad += 0.5) {
      const steps = Math.max(8, Math.ceil((2 * Math.PI * rad) / 0.8));
      for (let k = 0; k < steps; k++) {
        // Starting straight up and alternating sides, so a crowd spreads evenly rather than all one way.
        const t = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps) - Math.PI / 2;
        const px = x + rad * Math.cos(t), py = y + rad * Math.sin(t);
        if (inside(px, py) && clear(i, px, py)) {
          put(i, px, py);
          most = Math.max(most, rad);
          placed = true;
          break;
        }
      }
    }
    if (!placed) { put(i, x, y); crowded++; }
  }
  return { xs, ys, crowded, maxShift: most };
}
