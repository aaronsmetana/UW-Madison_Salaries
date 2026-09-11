import { measureText, placeSideLabels } from '../../lib/labelLayout';

type Scale = ((v: number | string) => number) & { domain?: () => unknown[]; bandwidth?: () => number };

const FONT = 10;
/** A second row of labels, where two would otherwise touch. */
const ROW = 12;

type Props = {
  xAxisMap?: Record<string, { scale: Scale }>;
  offset?: { left: number; top: number; width: number; height: number };
};

/**
 * The words beside known-break markers (snapTime's KNOWN_BREAKS), placed together so none runs into
 * another, and kept inside the plot's width: after the line when there is room, before it near the
 * right edge, the short wording on a narrow chart or where two would touch, a second row after that.
 * On the `top` edge they sit just above the plot, where no series runs — the chart needs a top margin
 * of about 14px, 26px where two rows may be needed; on the `bottom` edge, just inside the plot along
 * its baseline, for a chart whose top margin already carries other labels. Put it in a
 * `<Customized component={<BreakLabels … />} />` beside the markers' ReferenceLines, which draw the lines.
 */
export function BreakLabels(props: Props & {
  marks: readonly { at: number | string; texts: readonly string[]; fill?: string }[];
  edge?: 'top' | 'bottom';
}) {
  const { marks, edge = 'top', xAxisMap, offset } = props;
  const xa = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xa || !offset || !marks.length) return null;
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
  return (
    <g>
      {placed.map((p, i) => p && (
        <text
          key={i}
          className="break-label"
          x={p.x}
          y={y(p.row)}
          textAnchor={p.anchor}
          fontSize={FONT}
          fill={marks[i].fill ?? 'var(--mantine-color-dimmed)'}
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
