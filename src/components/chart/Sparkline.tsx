/**
 * A pay series in a few pixels: x by date (snapX), y from the series' own low to high, and a gap
 * wherever the series crosses a reporting change rather than a line that reads as a raise. Plain SVG —
 * it sits in the landing page's search, which loads no chart library. Decorative: the figure beside it
 * carries the information, so it is hidden from assistive technology.
 */
export function Sparkline({
  points,
  breaks = [],
  width = 48,
  height = 16,
  stroke = 'var(--mantine-color-accent-6)',
}: {
  points: readonly { x: number; y: number }[];
  /** Indices that start a new segment (snapTime's `reportingBreaks`). */
  breaks?: readonly number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) return null;
  const pad = 2;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const sy = (y: number) => (y1 === y0 ? height / 2 : height - pad - ((y - y0) / (y1 - y0)) * (height - 2 * pad));
  const brk = new Set(breaks);
  const d = points.map((p, i) => `${i === 0 || brk.has(i) ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden data-points={points.length} data-segments={1 + [...brk].filter((i) => i > 0 && i < points.length).length} style={{ flexShrink: 0, overflow: 'visible' }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(last.x)} cy={sy(last.y)} r={1.75} fill={stroke} />
    </svg>
  );
}
