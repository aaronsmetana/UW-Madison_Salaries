/** A body-colored rounded-rect pill behind text, so a label stays legible over whatever chart marks
 *  (bars, lines, reference areas) sit beneath it — the one way this app draws text over marks. */
export function SvgPill({
  x, y, text, color = 'var(--mantine-color-dimmed)', fontWeight = 700, fontSize = 10,
}: {
  x: number;
  y: number;
  text: string;
  color?: string;
  fontWeight?: number;
  fontSize?: number;
}) {
  const w = text.length * 6 + 8;
  const h = 15;
  return (
    <g>
      <rect
        x={x - w / 2} y={y - h / 2} width={w} height={h} rx={7}
        fill="var(--mantine-color-body)" fillOpacity={0.85}
        stroke={color} strokeOpacity={0.4} strokeWidth={1}
      />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={fontWeight} fill={color}>
        {text}
      </text>
    </g>
  );
}

/**
 * +X% / −X% pill above a line point — the change vs. the previous snapshot. Floats a consistent gap
 * above the point; only when the point sits near the chart's top edge does the pill drop below instead,
 * so it never collides with the top margin. Recharts' `LabelList` injects x/y/value/index; `count` (the
 * series length) lets the first/last pill nudge inward instead of clipping the left/right margins.
 */
export function YoyPill(props: {
  x?: number;
  y?: number;
  value?: number | null;
  index?: number;
  count?: number;
  topThreshold?: number;
  offset?: number;
}) {
  const { x, y, value, index, count, topThreshold = 48, offset = 22 } = props;
  if (x == null || y == null || value == null) return null;
  const up = value >= 0;
  const txt = `${up ? '+' : ''}${(value * 100).toFixed(1)}%`;
  const color = up ? 'var(--mantine-color-pos-7)' : 'var(--mantine-color-red-7)';
  const cy = y > topThreshold ? y - offset : y + offset;
  const w = txt.length * 6 + 8;
  let cx = x;
  if (index === 0) cx = x + w / 2;
  else if (count != null && index === count - 1) cx = x - w / 2;
  return <SvgPill x={cx} y={cy} text={txt} color={color} />;
}
