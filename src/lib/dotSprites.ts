/**
 * The landing dots' look: each dot a small bead — a true circle with a faint highlight up and to the
 * left and a slightly deeper edge — drawn once per ink and size into a tiny canvas and stamped with
 * `drawImage`, which costs what the old squares did. In dark mode the bead carries a faint halo, so a
 * dense field glows a little against the card.
 */
import { mixOklab } from './inkMix';

/** Radii (device px) under which the highlight cannot show: a plain disc there. */
const GLOSS_FROM = 1.25;
/** The halo's reach, as a multiple of the dot's radius, and its strongest alpha. */
const HALO_REACH = 2;
const HALO_ALPHA = 0.12;

export interface Bead {
  /** The sprite, and the offset from a dot's centre to its top-left corner (device px). */
  img: HTMLCanvasElement;
  half: number;
}

const cache = new Map<string, Bead>();

/** A bead of `ink`, `radius` device px, with a halo when `glow`. Cached. */
export function bead(ink: string, radius: number, glow: boolean): Bead {
  const key = `${ink}|${radius.toFixed(2)}|${glow ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const reach = glow ? radius * HALO_REACH : radius;
  const half = Math.ceil(reach) + 1;
  const img = document.createElement('canvas');
  img.width = img.height = half * 2;
  const ctx = img.getContext('2d')!;
  const c = half;
  if (glow) {
    const g = ctx.createRadialGradient(c, c, radius * 0.6, c, c, reach);
    g.addColorStop(0, withAlpha(ink, HALO_ALPHA));
    g.addColorStop(1, withAlpha(ink, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  if (radius >= GLOSS_FROM) {
    const hx = c - radius * 0.35, hy = c - radius * 0.35;
    const g = ctx.createRadialGradient(hx, hy, 0, c, c, radius);
    g.addColorStop(0, mixOklab(ink, 'rgb(255, 255, 255)', 0.32));
    g.addColorStop(0.55, ink);
    g.addColorStop(1, mixOklab(ink, 'rgb(0, 0, 0)', 0.16));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = ink;
  }
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fill();
  const out = { img, half };
  if (cache.size > 600) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * What a bead lays down, for drawing it as a square while it moves: a square of the same ink — the sum
 * of the bead's alpha, halo and all, so `side²` at full alpha — in the bead's own mean colour. Measured
 * from the sprite once. A square 2r wide in the flat tone, as moving dots were drawn, laid down about
 * 27% more ink than the round bead, so a strip of moving dots was a darker rectangle in the field until
 * it came to rest. (A dark bead's halo is a few percent of its ink outside its disc; a second, wider
 * square to carry it moved a strip by under 1%, so the one square carries it.)
 */
export interface BeadInk { fill: string; side: number }

const inks = new WeakMap<HTMLCanvasElement, BeadInk>();
let scratch: CanvasRenderingContext2D | null = null;

/** The ink of `b`. */
export function beadInk(b: Bead): BeadInk {
  const hit = inks.get(b.img);
  if (hit) return hit;
  const n = b.img.width;
  // Read from a copy, so the sprite itself is never read back and stays where drawImage wants it.
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = scratch!;
  if (ctx.canvas.width < n || ctx.canvas.height < n) { ctx.canvas.width = Math.max(ctx.canvas.width, n); ctx.canvas.height = Math.max(ctx.canvas.height, n); }
  ctx.clearRect(0, 0, n, n);
  ctx.drawImage(b.img, 0, 0);
  const px = ctx.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, bl = 0, a = 0;
  for (let k = 0; k < px.length; k += 4) {
    const al = px[k + 3] / 255;
    r += px[k] * al; g += px[k + 1] * al; bl += px[k + 2] * al; a += al;
  }
  const ink: BeadInk = a > 0
    ? { fill: `rgb(${(r / a).toFixed(2)}, ${(g / a).toFixed(2)}, ${(bl / a).toFixed(2)})`, side: Math.sqrt(a) }
    : { fill: 'rgba(0, 0, 0, 0)', side: 0 };
  inks.set(b.img, ink);
  return ink;
}

function withAlpha(css: string, a: number): string {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : css;
}
