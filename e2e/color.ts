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

