/**
 * Shared UI scale constants — so icon sizes (and other repeated magic numbers) are chosen from a small
 * deliberate set rather than drifting. Import `ICON` instead of hardcoding.
 *
 * Four sizes, by role (P2). Measured across every page there were nine (11 to 26px): an `inline` step at 13px
 * a pixel off `compact`, 18px alert, empty-state and navigation glyphs between steps, and strays at 11, 12 and
 * 26. Each folded to its role: 13 and under to `compact`, an alert's or a nav control's 18 to `nav`, a field's
 * 18 to `control`, the landing search's 26 to `feature`. e2e/polish.spec.ts fails on any other size.
 */
export const ICON = {
  /** Inside a compact control (a 28px button or icon button), a chip, a badge, inline with text. */
  compact: 14,
  /** Inside a default control or a field: buttons, inputs, action icons. */
  control: 16,
  /** Navigation, the theme toggle, and an alert's or an empty state's glyph. */
  nav: 20,
  /** Feature or stat-card glyphs, and the landing search's (the largest routine size). */
  feature: 22,
} as const;
