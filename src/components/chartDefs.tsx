import { Fragment } from 'react';

/**
 * Reusable SVG `<defs>` for the "primary line" hero treatment: a vertical accent gradient (for the area
 * fill under the line) and a soft Gaussian-blur glow (applied to a duplicated underlay line). Place inside
 * an inline `<defs>` in a Recharts chart — `<defs>{lineGlowDefs(useId())}</defs>` — then reference
 * `url(#${id}-area-grad)` for the fill and `url(#${id}-line-glow)` for the glow. Kept generic and id-scoped
 * so the exact same look can be dropped into any other single-accent-line chart later.
 *
 * Pass `useId()`, never a string literal. An SVG `id` is document-global, so two instances sharing a
 * literal would both define `#trend-area-grad` and every reference in the document would resolve to
 * whichever mounted first. `barGradientDefs` below is already called that way at all four of its
 * sites; these two were the holdouts, and they were safe only by the accident of being on different
 * routes.
 */
/**
 * The area fill under an accent line: full-strength at the top, gone at the baseline. Split out of
 * `lineGlowDefs` so a chart can take the fill without the glow filter it does not use — Home's hero
 * distribution is drawn by hand and had been carrying its own private copy of these stops.
 *
 * `stopOpacity 0` at the base, not a small non-zero value: Home's copy ended at 0.02, which leaves a
 * hairline of tint lying along the axis where the fill should have finished.
 */
export function areaGradDef(id: string) {
  return (
    <linearGradient id={`${id}-area-grad`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.28} />
      <stop offset="100%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0} />
    </linearGradient>
  );
}

export function lineGlowDefs(id: string) {
  return (
    <Fragment>
      {areaGradDef(id)}
      <filter id={`${id}-line-glow`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
    </Fragment>
  );
}

/**
 * One vertical gradient per bar color: full strength at the top fading to ~72% opacity at the base, so
 * every bar chart in the app shares the same subtle "lit from above" depth instead of a flat fill.
 * `id` scopes the `<defs>` (unique per chart instance); `colors` is a `{ slot: cssColorVar }` map —
 * reference a slot's gradient via `url(#${id}-bar-${slot})`.
 */
export function barGradientDefs(id: string, colors: Record<string, string>) {
  return (
    <Fragment>
      {Object.entries(colors).map(([slot, color]) => (
        <linearGradient key={slot} id={`${id}-bar-${slot}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={0.72} />
        </linearGradient>
      ))}
    </Fragment>
  );
}
