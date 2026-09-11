import { fmtChange } from '../../lib/format';
import { placeChips, type Box } from '../../lib/labelLayout';

/** A body-colored rounded-rect pill behind text, so a label stays legible over whatever chart marks
 *  (bars, lines, reference areas) sit beneath it — the one way this app draws text over marks.
 *
 *  This is the third expression of the tooltip surface, after `.chart-tip` in app.css and `TIP_STYLE`
 *  in lib/chartStyle.ts — and unlike those two it is deliberately NOT folded into them. It lives in
 *  SVG, where there is no backdrop to filter and no way to read `--tip-bg` through a `color-mix()`,
 *  so unifying it would mean re-faking the look with a third set of hardcoded numbers rather than
 *  sharing the first. The 0.85 fill is its own decision; if the tooltip tint moves, consider whether
 *  this should follow, but do not assume it can. */
/** The width `SvgPill` draws a label at — the one estimate, so layout and drawing agree. */
export const pillWidth = (text: string): number => text.length * 6 + 8;

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
  const w = pillWidth(text);
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
  const txt = fmtChange(value);
  const color = changeColor(value);
  const cy = y > topThreshold ? y - offset : y + offset;
  const w = pillWidth(txt);
  let cx = x;
  if (index === 0) cx = x + w / 2;
  else if (count != null && index === count - 1) cx = x - w / 2;
  return <SvgPill x={cx} y={cy} text={txt} color={color} />;
}

/** A change's colour: up, down, or dimmed for no change (`fmtChange` prints that as "0%"). */
function changeColor(value: number): string {
  return fmtChange(value) === '0%' ? 'var(--mantine-color-dimmed)' : value > 0 ? 'var(--mantine-color-pos-7)' : 'var(--mantine-color-red-7)';
}

/** The radius of a title-change marker's halo (TitleChangeDot), which no chip may cover. */
export const MARK_HALO = 11;

type Scale = (v: number) => number;

/**
 * Every step's change chip on a trend line, placed together (see `placeChips`): none covers another
 * chip or a title-change marker, and one with no room is left out rather than drawn over something.
 * A null change draws nothing — the TTC pair and a reporting break carry null.
 *
 * `LabelList` placed each chip from its own point alone, which on a date axis put a 38px chip on a
 * marker 18px away. Rendered through Recharts' `<Customized>`, this sees the chart's scales and so
 * every chip at once. Its own props are prefixed `chip` because Recharts merges the chart's props
 * over a customized element's, and names like `data` would be overwritten.
 */
export function YoyChips(props: {
  chipRows: readonly object[];
  chipValueKey: string;
  chipYoyKey: string;
  chipAxis: string;
  /** Row indices carrying a title-change marker: obstacles, and their own chip tries below first. */
  chipMarks?: readonly number[];
  /** Every chip tries below its point first — for a line that runs along the top of its plot, where
   *  "above" fits only now and then and the chips would zigzag. */
  chipBelow?: boolean;
  xAxisMap?: Record<string, { scale: Scale }>;
  yAxisMap?: Record<string, { scale: Scale }>;
  offset?: { left: number; top: number; width: number; height: number };
}) {
  const { chipRows, chipValueKey, chipYoyKey, chipAxis, chipMarks = [], chipBelow = false, xAxisMap, yAxisMap, offset } = props;
  const xa = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  const ya = yAxisMap?.[chipAxis];
  if (!xa || !ya || !offset) return null;
  const row = (i: number) => chipRows[i] as Record<string, unknown>;
  const at = (i: number) => {
    const r = row(i);
    const v = r[chipValueKey];
    return typeof v === 'number' && typeof r.x === 'number' ? { x: xa.scale(r.x), y: ya.scale(v) } : null;
  };
  const marks = new Set(chipMarks);
  const obstacles: Box[] = [...marks].flatMap((i) => {
    const p = at(i);
    return p ? [{ left: p.x - MARK_HALO, right: p.x + MARK_HALO, top: p.y - MARK_HALO, bottom: p.y + MARK_HALO }] : [];
  });
  const texts = new Map<number, { text: string; value: number }>();
  const requests = chipRows.flatMap((_, i) => {
    const d = row(i)[chipYoyKey];
    const p = at(i);
    if (typeof d !== 'number' || !p) return [];
    const text = fmtChange(d);
    texts.set(i, { text, value: d });
    // Title changes first, then the largest changes: when a narrow chart cannot hold every chip,
    // the ones it drops are the smallest.
    return [{ id: i, x: p.x, y: p.y, width: pillWidth(text), priority: (marks.has(i) ? 10 : 0) + Math.abs(d), preferBelow: chipBelow || marks.has(i) }];
  });
  const plot: Box = { left: offset.left, right: offset.left + offset.width, top: offset.top, bottom: offset.top + offset.height };
  const placed = placeChips(requests, obstacles, plot);
  return (
    <g className="yoy-chips">
      {placed.map((c) => {
        const t = texts.get(c.id)!;
        return (
          <g key={c.id} className="yoy-chip" data-index={c.id}>
            <SvgPill x={c.cx} y={c.cy} text={t.text} color={changeColor(t.value)} />
          </g>
        );
      })}
    </g>
  );
}
