/**
 * A crosshair overlay for a Recharts numeric x/y chart: dashed hairlines from a data point to both
 * axes, a ring around the point, and two small value pills docked on the axes. Render it via
 * `<Customized component={CrosshairLayer} pointX={…} pointY={…} .../>` — Recharts spreads its full
 * computed render state (including `xAxisMap`/`yAxisMap`/`offset`, each carrying the real d3 scale
 * functions) onto every `Customized` child (see `generateCategoricalChart.renderCustomized` in
 * recharts' source), so this gets pixel-exact placement instead of hand-approximating the plot's
 * margins/axis widths the way e.g. SalaryHistogram's marker pin does.
 *
 * Every piece is drawn once at a fixed position and moved with a CSS `transform`, so switching the
 * active point (hover → another point, or hover-out → back to the resting point) glides smoothly
 * instead of the crosshair jumping or the whole layer re-rendering from scratch.
 */
interface AxisMapEntry { scale: (v: number) => number }
interface PlotOffset { top: number; left: number; width: number; height: number }

export interface CrosshairLayerProps {
  xAxisMap?: Record<string, AxisMapEntry>;
  yAxisMap?: Record<string, AxisMapEntry>;
  offset?: PlotOffset;
  pointX: number;
  pointY: number;
  xPillLabel: string;
  yPillLabel: string;
  /** Larger ring when the active point is a hovered peer rather than the resting "self" point. */
  emphasize?: boolean;
  /** Skip the glide transition (reduced motion) — jump straight to the new position. */
  instant?: boolean;
}

export function CrosshairLayer({
  xAxisMap, yAxisMap, offset, pointX, pointY, xPillLabel, yPillLabel, emphasize, instant,
}: CrosshairLayerProps) {
  const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined;
  const yScale = yAxisMap ? Object.values(yAxisMap)[0]?.scale : undefined;
  if (!xScale || !yScale || !offset) return null;
  const cx = xScale(pointX);
  const cy = yScale(pointY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  const { top, left, width, height } = offset;
  const transition = instant ? 'none' : 'transform 260ms cubic-bezier(.22,.8,.3,1)';
  const stroke = 'var(--mantine-color-accent-6)';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Vertical hairline — a fixed-length segment translated horizontally to the point's x. */}
      <g style={{ transform: `translateX(${cx}px)`, transition }}>
        <line x1={0} y1={top} x2={0} y2={top + height} stroke={stroke} strokeWidth={1} strokeDasharray="3 4" opacity={0.55} />
      </g>
      {/* Horizontal hairline — a fixed-length segment translated vertically to the point's y. */}
      <g style={{ transform: `translateY(${cy}px)`, transition }}>
        <line x1={left} y1={0} x2={left + width} y2={0} stroke={stroke} strokeWidth={1} strokeDasharray="3 4" opacity={0.55} />
      </g>
      {/* Ring around the active point. */}
      <g style={{ transform: `translate(${cx}px, ${cy}px)`, transition }}>
        <circle r={emphasize ? 9 : 7} fill="none" stroke={stroke} strokeWidth={2} />
      </g>
      {/* x-axis value pill, docked on the bottom axis under the point. */}
      <g style={{ transform: `translate(${cx}px, ${top + height}px)`, transition }}>
        <foreignObject x={-44} y={7} width={88} height={22} style={{ overflow: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <span className="chart-value-pill">{xPillLabel}</span>
          </div>
        </foreignObject>
      </g>
      {/* y-axis value pill, docked on the left axis beside the point. */}
      <g style={{ transform: `translate(${left}px, ${cy}px)`, transition }}>
        <foreignObject x={-74} y={-11} width={68} height={22} style={{ overflow: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <span className="chart-value-pill">{yPillLabel}</span>
          </div>
        </foreignObject>
      </g>
    </g>
  );
}
