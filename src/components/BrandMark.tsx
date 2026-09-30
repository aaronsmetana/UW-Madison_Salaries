/**
 * The site's mark: campus's pay curve drawn in dots, fifteen of them stacked the way pay stacks up (a steep
 * rise, a long tail to the right), with one lit. The landing graph in miniature, where each dot is one
 * person, and the app's one idea: someone among everyone.
 *
 * It replaced three ascending bars on a gradient tile, which were meant as a distribution but read as
 * growth, or a phone's signal. One shape for every copy: the header's glyph and the phone menu here, and the
 * favicon, app icon, home-screen icon and share card that scripts/brand-images.mjs draws from `DOT_HILL`.
 */
import mark from './brandMark.json';

/** The mark's geometry (brandMark.json, which scripts/brand-images.mjs reads too): 15 dots on a 24-unit
 *  square, column by column from the floor up, and the lit one on the shoulder past the peak. */
export const DOT_HILL = mark;

/** The lit dot's ink, the same on either scheme: a warm point in a cool field. */
export const LIT_INK = mark.litInk;

/** The glyph alone, in the current text colour (the header sets the accent), its lit dot in `LIT_INK`. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  const { view, r, dots, lit } = DOT_HILL;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`} aria-hidden className={className} style={{ flexShrink: 0 }}>
      <g fill="currentColor">
        {dots.map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r={r} />)}
      </g>
      <circle cx={lit.x} cy={lit.y} r={lit.r} fill={LIT_INK} />
    </svg>
  );
}
