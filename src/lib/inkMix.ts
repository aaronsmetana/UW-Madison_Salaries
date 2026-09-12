/**
 * The stronger ink a highlighted dot takes: its own colour moved part of the way toward the text
 * colour, in OKLab — so a teal dot gets a deeper teal, not a greyer one, and the same rule serves
 * every ink in both schemes (the text colour is dark in light mode, light in dark mode). Done here
 * rather than with CSS `color-mix`, whose computed value comes back in whatever space the browser
 * likes; a canvas fill and a contrast check both want plain sRGB.
 */

/** Any colour getComputedStyle returns — `rgb()`/`rgba()`, `color(srgb …)` (0–1 floats) or `#rrggbb`
 *  — as 0–255 RGB. Null for anything else. */
export function parseRgb(css: string): [number, number, number] | null {
  const c = css.trim();
  let m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return null;
}

const toLin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(fromLin(v))));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `a` moved `t` of the way toward `b`, in OKLab, as `rgb(r, g, b)`. Unparseable input comes back as is. */
export function mixOklab(a: string, b: string, t: number): string {
  const x = parseRgb(a);
  const y = parseRgb(b);
  if (!x || !y) return a;
  const [p, q] = [toOklab(x), toOklab(y)];
  const [r, g, bl] = fromOklab([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** WCAG relative luminance of an sRGB colour, 0–255 channels. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two CSS colours; 1 if either can't be read. */
export function contrastRatio(a: string, b: string): number {
  const x = parseRgb(a);
  const y = parseRgb(b);
  if (!x || !y) return 1;
  const [p, q] = [luminance(x) + 0.05, luminance(y) + 0.05];
  return Math.max(p, q) / Math.min(p, q);
}

/**
 * A stronger version of `ink` for a highlighted dot: moved, in OKLab, toward black on a light page
 * (dark `text`) or white on a dark one, only as far as it takes to stand `apart` from its own ink —
 * a slate or an orange that already sits near the text colour needs to go further than a mid teal.
 */
export function strongerInk(ink: string, text: string, apart = 1.5): string {
  const t = parseRgb(text);
  const toward = t && luminance(t) > 0.4 ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
  let out = ink;
  for (let k = 0.3; k <= 0.9001; k += 0.05) {
    out = mixOklab(ink, toward, k);
    if (contrastRatio(out, ink) >= apart) break;
  }
  return out;
}

/**
 * A dot's tones: `n` versions of `ink`, from the ink itself to `span` of the way toward black (a light
 * card, dark `text`) or white (a dark card) — always away from the card, so no tone has less contrast
 * against it than the ink, which is the one the 3:1 rule was checked on. The first is the ink.
 */
export function toneInks(ink: string, text: string, n = 8, span = 0.16): string[] {
  const t = parseRgb(text);
  const toward = t && luminance(t) < 0.5 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  return Array.from({ length: n }, (_, i) => (i === 0 ? mixOklab(ink, ink, 0) : mixOklab(ink, toward, (span * i) / Math.max(1, n - 1))));
}
