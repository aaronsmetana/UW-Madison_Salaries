/**
 * The landing chart's magnifying glass: the fisheye of Sarkar and Brown (1992). A point at distance d
 * from the glass's centre is shown at g(d) = R·(k+1)(d/R) / (k·d/R + 1) along the same direction. It
 * magnifies k+1 times at the centre and not at all at the rim, which stays where it is — so a glass of
 * radius R covers exactly the disc it magnifies, and its edge meets the field around it.
 */

/** Magnification at the centre is FISHEYE_K + 1. */
export const FISHEYE_K = 3;

/**
 * Where a point `dx, dy` from the centre is drawn inside a glass of radius `R`, and how much bigger a
 * thing there looks (the magnification along the rim's direction: k+1 at the centre, 1 at the rim).
 * Points on or outside the rim are left where they are.
 */
export function fisheye(dx: number, dy: number, R: number, k = FISHEYE_K): { x: number; y: number; scale: number } {
  const d = Math.hypot(dx, dy);
  if (!(R > 0) || d >= R) return { x: dx, y: dy, scale: 1 };
  const scale = (k + 1) / ((k * d) / R + 1);
  return { x: dx * scale, y: dy * scale, scale };
}
