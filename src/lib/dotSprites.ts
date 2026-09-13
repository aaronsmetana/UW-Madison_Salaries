/**
 * The landing dots' look: each dot a small bead — a true circle with a faint highlight up and to the
 * left and a slightly deeper edge — drawn once per ink and size into a tiny canvas and stamped with
 * `drawImage`, which costs what the old squares did. In dark mode a faint halo round each dot makes a
 * dense field glow a little against the card; a field draws the halos as a layer beneath its beads
 * (`halo`), so a glow lights the gaps and never veils a neighbour.
 *
 * Each sprite is an odd number of pixels across with its disc centred on a pixel centre: a dot placed on
 * a device-pixel centre stamps it at whole pixels, with no resampling blur.
 */
import { mixOklab } from './inkMix';

/** Radii (device px) under which the highlight cannot show: a plain disc there. */
const GLOSS_FROM = 1.25;
/** The halo's reach, as a multiple of the dot's radius, and its strongest alpha: within the room a
 *  packed field leaves between dots, and a little stronger for being tighter. */
const HALO_REACH = 1.6;
const HALO_ALPHA = 0.16;

export interface Bead {
  /** The sprite, and the offset from a dot's centre to its top-left corner (device px). */
  img: HTMLCanvasElement;
  half: number;
}

const cache = new Map<string, Bead>();

/** A sprite canvas `reach` device px about its centre: odd-sized, the centre on a pixel centre. */
function sprite(reach: number) {
  const h = Math.ceil(reach) + 1;
  const img = document.createElement('canvas');
  img.width = img.height = h * 2 + 1;
  return { img, ctx: img.getContext('2d')!, c: h + 0.5 };
}

function drawHalo(ctx: CanvasRenderingContext2D, c: number, ink: string, radius: number) {
  const reach = radius * HALO_REACH;
  const g = ctx.createRadialGradient(c, c, radius * 0.6, c, c, reach);
  g.addColorStop(0, withAlpha(ink, HALO_ALPHA));
  g.addColorStop(1, withAlpha(ink, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, reach, 0, Math.PI * 2);
  ctx.fill();
}

/** A bead of `ink`, `radius` device px, with its halo when `glow` (the magnifying glass draws them so; a
 *  field draws its halos beneath, with `halo`). Cached. */
export function bead(ink: string, radius: number, glow: boolean): Bead {
  const key = `${ink}|${radius.toFixed(2)}|${glow ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { img, ctx, c } = sprite(glow ? radius * HALO_REACH : radius);
  if (glow) drawHalo(ctx, c, ink, radius);
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
  const out = { img, half: c };
  if (cache.size > 600) cache.clear();
  cache.set(key, out);
  return out;
}

/** The halo alone, for a field's layer beneath its beads. Cached. */
export function halo(ink: string, radius: number): Bead {
  const key = `${ink}|${radius.toFixed(2)}|halo`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { img, ctx, c } = sprite(radius * HALO_REACH);
  drawHalo(ctx, c, ink, radius);
  const out = { img, half: c };
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

/** The ink of `b`, with the halo `under` it when there is one. */
export function beadInk(b: Bead, under?: Bead | null): BeadInk {
  const hit = !under ? inks.get(b.img) : undefined;
  if (hit) return hit;
  const n = Math.max(b.img.width, under ? under.img.width : 0);
  // Read from a copy, so the sprite itself is never read back and stays where drawImage wants it.
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = scratch!;
  if (ctx.canvas.width < n || ctx.canvas.height < n) { ctx.canvas.width = Math.max(ctx.canvas.width, n); ctx.canvas.height = Math.max(ctx.canvas.height, n); }
  ctx.clearRect(0, 0, n, n);
  // Both centred on the copy's centre, the halo first, as a field draws them.
  if (under) ctx.drawImage(under.img, n / 2 - under.half, n / 2 - under.half);
  ctx.drawImage(b.img, n / 2 - b.half, n / 2 - b.half);
  const px = ctx.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, bl = 0, a = 0;
  for (let k = 0; k < px.length; k += 4) {
    const al = px[k + 3] / 255;
    r += px[k] * al; g += px[k + 1] * al; bl += px[k + 2] * al; a += al;
  }
  const ink: BeadInk = a > 0
    ? { fill: `rgb(${(r / a).toFixed(2)}, ${(g / a).toFixed(2)}, ${(bl / a).toFixed(2)})`, side: Math.sqrt(a) }
    : { fill: 'rgba(0, 0, 0, 0)', side: 0 };
  if (!under) inks.set(b.img, ink);
  return ink;
}

function withAlpha(css: string, a: number): string {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : css;
}
