/**
 * Shared UI scale constants — so icon sizes (and other repeated magic numbers) are chosen from a small
 * deliberate set rather than drifting across ten different values. Import `ICON` instead of hardcoding.
 */
export const ICON = {
  /** Inline with body/label text (badges, list bullets, chips). */
  inline: 13,
  /** Inside buttons, inputs, action icons — the default control size. */
  control: 16,
  /** Primary navigation / sidebar. */
  nav: 20,
  /** Feature or stat-card glyphs (the largest routine size). */
  feature: 22,
} as const;
