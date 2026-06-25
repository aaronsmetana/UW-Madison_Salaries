/**
 * A thin magnitude bar for table cells — a muted track with a proportional accent fill. Used to give
 * headcount / median / pay columns a visual scale (the Schools, Top-earners and Titles tabs). Static
 * (no per-row animation) so long tables stay smooth.
 */
export function MiniBar({
  frac,
  color = 'var(--mantine-color-accent-4)',
  height = 4,
}: {
  frac: number;
  color?: string;
  height?: number;
}) {
  const w = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * 100;
  return (
    <div
      aria-hidden
      style={{
        height,
        borderRadius: height,
        background: 'var(--mantine-color-default-border)',
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: height }} />
    </div>
  );
}
