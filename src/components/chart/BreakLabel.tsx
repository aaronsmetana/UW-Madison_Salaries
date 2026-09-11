import { measureText, placeSideLabel } from '../../lib/labelLayout';

type Scale = ((v: number) => number) & { domain?: () => number[] };

const FONT = 10;

/**
 * The words beside a known-break marker (snapTime's KNOWN_BREAKS), kept inside the plot's width: after
 * the line when there is room, before it near the right edge, the short wording on a narrow chart. They
 * sit just above the plot, where no series runs — inside it they crossed whatever line ran near the top
 * — so the chart needs a top margin of about 14px. Put it in a `<Customized component={<BreakLabel … />} />`
 * next to the marker's ReferenceLine, which draws the line itself.
 */
export function BreakLabel(props: {
  /** The marker's position on the x axis, in axis units (snapX). */
  at: number;
  texts: readonly string[];
  xAxisMap?: Record<string, { scale: Scale }>;
  offset?: { left: number; top: number; width: number; height: number };
}) {
  const { at, texts, xAxisMap, offset } = props;
  const xa = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  if (!xa || !offset) return null;
  const x = xa.scale(at);
  if (!Number.isFinite(x)) return null;
  const placed = placeSideLabel(x, { left: offset.left, right: offset.left + offset.width }, texts, (t) => measureText(t, FONT));
  if (!placed) return null;
  return (
    <text
      className="break-label"
      x={placed.x}
      y={offset.top - 4}
      textAnchor={placed.anchor}
      fontSize={FONT}
      fill="var(--mantine-color-dimmed)"
    >
      {placed.text}
    </text>
  );
}
