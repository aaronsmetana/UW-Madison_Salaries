/**
 * The area fill under a line: full-strength at the top, gone at the baseline. Place inside an inline
 * `<defs>` in a Recharts chart — `<defs>{areaGradDef(useId())}</defs>` — then reference
 * `url(#${id}-area-grad)` for the fill.
 *
 * Pass `useId()`, never a string literal. An SVG `id` is document-global, so two instances sharing a
 * literal would both define `#trend-area-grad` and every reference in the document would resolve to
 * whichever mounted first.
 *
 * This is the one gradient the analytic charts keep. The blurred glow line that used to sit under the
 * pay trends and the "lit from above" gradient on every bar are gone: both were decoration competing
 * with the data, and a bar reads its value from its top edge, which a fade does nothing for.
 *
 * `stopOpacity 0` at the base, not a small non-zero value: Home's copy ended at 0.02, which leaves a
 * hairline of tint lying along the axis where the fill should have finished.
 *
 * `color` and `topOpacity` default to the accent treatment every existing caller wants, so this stays
 * one definition rather than growing a second private copy. The peer ribbon passes the population grey
 * instead, because on that chart the accent IS the subject's own mark and painting the crowd with it
 * would erase the one thing the chart picks out. Home's hero passes a custom property
 * (`'var(--curve-wash)'`), so its faint wash under the curve can be stronger on a dark page.
 */
export function areaGradDef(
  id: string,
  color: string = 'var(--mantine-color-accent-6)',
  topOpacity: number | string = 0.28,
) {
  return (
    <linearGradient id={`${id}-area-grad`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}
