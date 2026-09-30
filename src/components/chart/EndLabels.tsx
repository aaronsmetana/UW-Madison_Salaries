import { measureText, placeEndLabels } from '../../lib/labelLayout';
import { CHART_FONT } from '../../lib/chartStyle';
import { layoutBreakLabels } from './BreakLabel';

/** One line's direct label: which series (`key`, the Line's `dataKey`), what to call it, and a text
 *  colour that clears 4.5:1 on the card — a `--text-*` token, not the line's own stroke. */
export interface EndSeries {
  key: string;
  text: string;
  color: string;
}

type Point = { x: number; y: number | null; value?: unknown };
type Item = {
  item?: { type?: { displayName?: string }; props?: { dataKey?: unknown; stroke?: string } };
  props?: { points?: readonly Point[]; baseLine?: readonly Point[] | number };
};

/** A series' drawn path, split wherever it has no value — a gap is not a segment. */
function runsOf(points: readonly Point[]): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [[]];
  for (const p of points) {
    if (p.y != null && Number.isFinite(p.y) && p.value != null) runs[runs.length - 1].push({ x: p.x, y: p.y });
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter((r) => r.length > 1);
}

const FONT = CHART_FONT;

/** A name written over a chart's marks: a stroke of the card colour painted under the letters, so a
 *  gridline, a band or a dot behind them stops at the word instead of running through it. Shared, so
 *  every name written on a plot carries the same halo. */
export const HALO = { stroke: 'var(--mantine-color-body)', strokeWidth: 3, paintOrder: 'stroke' } as const;

/**
 * Each line's name, written where it ends (`placeEndLabels`) — in place of Recharts' default
 * `<Legend />`, a row of swatches under the plot that had to be matched back to the lines by colour
 * and dash. Placed inside the chart, not in a right margin, so the plot keeps its width on a phone;
 * a halo in the page colour keeps each name legible over a gridline.
 *
 * Rendered through `<Customized>`, which hands it the chart's laid-out series: a line's end is its
 * last point with a value, since a series can stop before the axis does, and every drawn line is an
 * obstacle no name may cover. Its own props are prefixed `end` because Recharts merges the chart's
 * props over a customized element's. A line that ends at the top of its plot needs a top margin for
 * its name to go above it.
 */
export function EndLabels(props: {
  endSeries: readonly EndSeries[];
  /** The chart's break markers, as its `BreakLabels` has them: their words are kept clear too. */
  endBreaks?: readonly { at: number | string; texts: readonly string[] }[];
  endBreakEdge?: 'top' | 'bottom';
  formattedGraphicalItems?: readonly Item[];
  xAxisMap?: Parameters<typeof layoutBreakLabels>[2];
  offset?: { left: number; top: number; width: number; height: number };
}) {
  const { endSeries, endBreaks = [], endBreakEdge = 'top', formattedGraphicalItems = [], xAxisMap, offset } = props;
  if (!offset) return null;
  const lineItems = formattedGraphicalItems.filter((f) => f.item?.type?.displayName === 'Line' && f.props?.points);
  // Every drawn line is kept clear, and every edge an area strokes (the middle-50% band's) is avoided
  // where that costs little (`placeEndLabels`). A band's lower edge is its `baseLine`, whose points
  // carry no `value`, so they are read as having one.
  const edged = formattedGraphicalItems.filter((f) =>
    f.item?.type?.displayName === 'Area' && f.item.props?.stroke && f.item.props.stroke !== 'none' && f.props?.points);
  const lines = lineItems.flatMap((f) => runsOf(f.props!.points!));
  const edges = edged.flatMap((f) => [
    ...runsOf(f.props!.points!),
    ...(Array.isArray(f.props!.baseLine) ? runsOf(f.props!.baseLine.map((p) => ({ ...p, value: p.y }))) : []),
  ]);
  const series = new Map(endSeries.map((s) => [s.key, s]));
  const ends = endSeries.flatMap((s) => {
    // An Area can share its Line's key (the wash under a trend); the name belongs to the line.
    const pts = lineItems.find((f) => f.item?.props?.dataKey === s.key)?.props?.points ?? [];
    const end = [...pts].reverse().find((p) => p.value != null && p.y != null && Number.isFinite(p.y));
    if (!end) return [];
    // The stretch of line the end belongs to, which a name may slide back along; none for a lone point.
    const run = runsOf(pts).find((r) => r.at(-1)?.x === end.x);
    return [{ id: s.key, x: end.x, y: end.y!, width: measureText(s.text, FONT) * 1.06, line: run }];
  });
  const plot = { left: offset.left, right: offset.left + offset.width, top: offset.top, bottom: offset.top + offset.height };
  return (
    <g className="end-labels">
      {placeEndLabels(ends, lines, plot, 1, { edges, avoid: layoutBreakLabels(endBreaks, endBreakEdge, xAxisMap, offset).map((b) => b.box) }).map((p) => {
        const s = series.get(p.id)!;
        return (
          <text
            key={p.id}
            className="end-label"
            data-series={p.id}
            x={p.x}
            y={p.y}
            textAnchor={p.anchor}
            fontSize={FONT}
            fontWeight={600}
            fill={s.color}
            {...HALO}
          >
            {s.text}
          </text>
        );
      })}
    </g>
  );
}
