/**
 * Shared UI scale constants — so icon sizes (and other repeated magic numbers) are chosen from a small
 * deliberate set rather than drifting across ten different values. Import `ICON` instead of hardcoding.
 *
 * `compact` was added rather than rounded away: 14px was the single most common icon size in the app
 * (27 call sites), used consistently inside `size="xs"` controls, which `control: 16` is too large for.
 * A scale that 27 call sites have to ignore isn't a scale — the missing step was real.
 *
 * A handful of sizes stay off-scale on purpose rather than being rounded into it: the 64px feature
 * glyph on Compare's empty state (larger than any routine size), an 11px clear-affordance inside a
 * 14px ActionIcon (a token would overflow its own target), and the 18px alert/empty-state glyphs,
 * which sit between `control` and `nav` and would need a sixth step to absorb. Everything that maps
 * cleanly should use a token.
 */
export const ICON = {
  /** Inline with body/label text (badges, list bullets, chips). */
  inline: 13,
  /** Inside a compact control — an `xs` Button, a small ActionIcon, a chip. */
  compact: 14,
  /** Inside buttons, inputs, action icons — the default control size. */
  control: 16,
  /** Primary navigation / sidebar. */
  nav: 20,
  /** Feature or stat-card glyphs (the largest routine size). */
  feature: 22,
} as const;
