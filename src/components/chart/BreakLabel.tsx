import { measureText, placeSideLabels } from '../../lib/labelLayout';
import { CHART_FONT } from '../../lib/chartStyle';

type Scale = ((v: number | string) => number) & { domain?: () => unknown[]; bandwidth?: () => number };

const FONT = CHART_FONT;
/** A second row of labels, where two would otherwise touch: a line of 12px chart text is about 16px tall,
 *  and rows closer than that touch (at 14px the TTC and 9-month labels on a phone's Trends did). */
const ROW = Math.round(FONT * 4 / 3);

type Props = {
  xAxisMap?: Record<string, { scale: Scale }>;
  offset?: { left: number; top: number; width: number; height: number };
};

type Mark = { at: number | string; texts: readonly string[]; fill?: string };

/**
 * Where each marker's words go, with the box each takes — shared by `BreakLabels`, which draws them,
 * and `EndLabels`, which keeps the lines' names clear of them (the headcount's name and the scope
 * change's words both want the top margin at the right of a phone's plot).
 */
export function layoutBreakLabels(
  marks: readonly Mark[],
  edge: 'top' | 'bottom',
  xAxisMap: Props['xAxisMap'],
  offset: Props['offset'],
) {
  const xa = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xa || !offset || !marks.length) return [];
  // On a category axis the marker sits in the middle of its band, as a ReferenceLine draws it.
  const band = xa.scale.bandwidth?.() ?? 0;
  const xs = marks.map((m) => xa.scale(m.at) + band / 2);
  const placed = placeSideLabels(
    // A marker the axis cannot place gets no words (no texts, so no label).
    marks.map((m, i) => (Number.isFinite(xs[i]) ? { x: xs[i], texts: m.texts } : { x: 0, texts: [] })),
    { left: offset.left, right: offset.left + offset.width },
    (t) => measureText(t, FONT),
  );
  const y = (row: number) => (edge === 'bottom' ? offset.top + offset.height - 4 - row * ROW : offset.top - 4 - row * ROW);
  return placed.flatMap((p, i) => {
    if (!p) return [];
    const w = measureText(p.text, FONT);
    const left = p.anchor === 'start' ? p.x : p.x - w;
    const ly = y(p.row);
    return [{ i, x: p.x, y: ly, text: p.text, anchor: p.anchor, box: { left, right: left + w, top: ly - FONT + 1, bottom: ly + 3 } }];
  });
}

/**
 * The words beside known-break markers (snapTime's KNOWN_BREAKS), placed together so none runs into
 * another, and kept inside the plot's width: after the line when there is room, before it near the
 * right edge, the short wording on a narrow chart or where two would touch, a second row after that.
 * On the `top` edge they sit just above the plot, where no series runs — the chart needs a top margin
 * of about 16px, 32px where two rows may be needed; on the `bottom` edge, just inside the plot along
 * its baseline, for a chart whose top margin already carries other labels. Put it in a
 * `<Customized component={<BreakLabels … />} />` beside the markers' ReferenceLines, which draw the lines.
 */
export function BreakLabels(props: Props & {
  marks: readonly Mark[];
  edge?: 'top' | 'bottom';
}) {
  const { marks, edge = 'top', xAxisMap, offset } = props;
  return (
    <g>
      {layoutBreakLabels(marks, edge, xAxisMap, offset).map((p) => (
        <text
          key={p.i}
          className="break-label"
          x={p.x}
          y={p.y}
          textAnchor={p.anchor}
          fontSize={FONT}
          fill={marks[p.i].fill ?? 'var(--mantine-color-dimmed)'}
        >
          {p.text}
        </text>
      ))}
    </g>
  );
}

/** One marker's words: `BreakLabels` with a single mark. */
export function BreakLabel(props: Props & { at: number; texts: readonly string[] }) {
  const { at, texts, ...rest } = props;
  return <BreakLabels {...rest} marks={[{ at, texts }]} />;
}
