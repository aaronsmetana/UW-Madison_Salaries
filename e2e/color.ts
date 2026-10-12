/**
 * Parse any colour Chrome returns from getComputedStyle into 0-255 RGB plus alpha. It must handle
 * `color(srgb r g b / a)`, whose channels are 0-1 FLOATS — which is what Chrome returns for several of
 * this table's backgrounds in dark mode. Reading those as 0-255 is the mistake that once reported
 * four different lane colours as the same grey and every dark background as black.
 */
export function parseColor(css: string): [number, number, number, number] {
  const c = css.trim();
  let m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
  throw new Error(`unparsed colour: ${css}`);
}
export const flatten = ([r, g, b, a]: number[], [br, bg, bb]: number[]) =>
  [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
export function contrast(x: number[], y: number[]): number {
  const L = ([r, g, b]: number[]) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [L(x) + 0.05, L(y) + 0.05];
  return Math.max(a, b) / Math.min(a, b);
}


/** CIE L*a*b* (D65) of an sRGB colour, 0-255 channels. */
export function lab([r, g, b]: number[]): [number, number, number] {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return labOfLinear([lin(r), lin(g), lin(b)]);
}
function labOfLinear(l: number[]): [number, number, number] {
  const [R, G, B] = l.map((v) => Math.min(1, Math.max(0, v)));
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** Machado et al. (2009) full-severity simulations, applied in linear RGB. */
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
} as const;
/** How far apart two colours are (ΔE76) to someone with full protanopia or deuteranopia: the lower of the two. */
export function cvdDistance(x: number[], y: number[]): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const sim = (c: number[], m: readonly (readonly number[])[]) => { const l = c.slice(0, 3).map(lin); return labOfLinear(m.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2])); };
  return Math.min(...Object.values(CVD).map((m) => Math.hypot(...sim(x, m).map((v, i) => v - sim(y, m)[i]))));
}
