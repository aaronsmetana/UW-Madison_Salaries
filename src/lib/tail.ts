/**
 * The landing graph's long tail: the people at or above its cap, who at rest sit in a pile past a break,
 * unrolled onto one axis that runs to the top salary (routes/Home). The graph squeezes to its true share
 * of that axis, and the pile's dots fly out to their own pay, stacked into a low hill.
 */

/**
 * How narrow the graph is drawn, as a share of its width, with the axis run out to `top`: under the cap it
 * spans `span` from `lo` across `plotW` px; unrolled, `lo` to `top` spans the whole row, `rowW` px. With no
 * tail past the graph's own end, as it is.
 */
export function squeezeFactor(lo: number, span: number, top: number, plotW: number, rowW: number): number {
  if (!(span > 0) || !(top > lo + span) || !(plotW > 0) || !(rowW > 0)) return 1;
  return (span * rowW) / ((top - lo) * plotW);
}

/**
 * The hill the tail's dots stack into: for dots at `xs` (CSS px across `width`), each pixel column's
 * height — the dots there, evened out over `blur` px either side, at `perDot` px² each, so they pack as
 * tightly as the graph's own; never over `most` px, and nothing where no dot is.
 */
export function tailHeights(xs: ArrayLike<number>, width: number, perDot: number, most: number, blur = 6): Float32Array {
  const n = Math.max(1, Math.ceil(width));
  const count = new Float32Array(n);
  for (let k = 0; k < xs.length; k++) {
    const c = Math.min(n - 1, Math.max(0, Math.floor(xs[k])));
    count[c] += 1;
  }
  // Two box passes: a soft hump rather than a staircase.
  let cur = count;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n);
    let run = 0;
    const w = 2 * blur + 1;
    for (let c = -blur; c < n + blur; c++) {
      if (c + blur < n) run += cur[c + blur];
      if (c - blur - 1 >= 0) run -= cur[c - blur - 1];
      if (c >= 0 && c < n) next[c] = run / w;
    }
    cur = next;
  }
  const out = new Float32Array(n);
  for (let c = 0; c < n; c++) out[c] = Math.min(most, cur[c] * perDot);
  return out;
}
