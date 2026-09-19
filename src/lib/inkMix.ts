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

/** A colour's OKLab coordinates, for how far apart two colours look. Null for anything unparseable. */
export function oklab(css: string): [number, number, number] | null {
  const rgb = parseRgb(css);
  return rgb ? toOklab(rgb) : null;
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


/** OKLab to linear sRGB, unclamped — out of gamut where a channel leaves [0, 1]. */
function oklabToLinear([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** An OKLCH colour — lightness, chroma, hue (radians) — as `rgb()`, its chroma taken down until it fits
 *  sRGB rather than a channel clipped: clipping a channel moves the hue, and these are meant to keep it. */
function oklch(L: number, C: number, h: number): string {
  const Lc = Math.min(1, Math.max(0, L));
  const c = gamutChroma(Lc, C, h);
  const [r, g, b] = fromOklab([Lc, c * Math.cos(h), c * Math.sin(h)]);
  return `rgb(${r}, ${g}, ${b})`;
}

/** The most of chroma `C` that sRGB can show at OKLCH lightness `L` and hue `h`. */
function gamutChroma(L: number, C: number, h: number): number {
  const fits = (c: number) => oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  const c = Math.max(0, C);
  if (fits(c)) return c;
  let lo = 0, hi = c;
  for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

/** How far toward `L` a tone can go from `L0` and still show `keep` of chroma `C` at hue `h`. Near white
 *  (or black) sRGB has little colour left to give: a violet crest raised to the ceiling kept 40% of its
 *  chroma and read as a pale lavender nearer the grey ink than its own. Held short instead, it stays violet. */
function lightnessKeeping(L0: number, L: number, C: number, h: number, keep: number): number {
  if (gamutChroma(L, C, h) >= keep * C) return L;
  let lo = 0, hi = 1;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (gamutChroma(L0 + (L - L0) * mid, C, h) >= keep * C) lo = mid; else hi = mid;
  }
  return L0 + (L - L0) * lo;
}

/** The share of an ink's chroma every tone keeps: lightness gives way before colour does. */
export const KEEP_CHROMA = 0.75;

/** How a field's dots are shaded (see `dotTones`). */
export interface DotLook {
  /** Depth steps from the ink out to the crest (dark page) or the floor (light page). */
  steps: number;
  /** How far the last step moves, as a share of the room the ink has left toward the lightness limit on
   *  its side (`LIGHT_CEILING` on a dark page, `LIGHT_FLOOR` on a light one) — not a fixed amount, which
   *  ran an ink that starts light, like orange, into the gamut's white corner, where it has no colour left. */
  reach: number;
  /** Hue variants of every step: the ink's own hue, then turned either way by `turn` degrees. */
  hues: number;
  turn: number;
  /** The crest's rim: on a dark page a further share of the room past the last step; on a light page a
   *  chroma boost at the ink's own lightness. */
  rimLift: number;
  rimChroma: number;
}

/**
 * A dot's tones, as a flat list indexed `step * look.hues + hue`: `look.steps` depth steps of `ink`, then
 * the crest rim, each in `look.hues` hue variants — the first of all being the ink itself.
 *
 * Depth moves OKLCH lightness away from the card with chroma held, eased so the change gathers near the
 * crest (a dark page) or the floor (a light one): a crest that catches the light rather than one mixed
 * toward white, which only washes a colour out to pastel. Away from the card only, so no step has less
 * contrast against it than the ink. Where sRGB could only reach a step's lightness by giving up more than
 * a quarter of the ink's chroma, the step stops short (`KEEP_CHROMA`). A hue variant turns the hue at the
 * same lightness and chroma; one that would fall below `min` against `card` is turned less, down to none.
 */
/** The lightness a crest may reach on a dark page, and a floor may sink to on a light one (OKLCH). */
export const LIGHT_CEILING = 0.9;
export const LIGHT_FLOOR = 0.3;

export function dotTones(ink: string, text: string, card: string, look: DotLook, min = 3): string[] {
  const rgb = parseRgb(ink);
  if (!rgb) return Array.from({ length: (look.steps + 1) * look.hues }, () => ink);
  const t = parseRgb(text);
  const dark = !!t && luminance(t) > 0.5;
  const [L0, a0, b0] = toOklab(rgb);
  const C0 = Math.hypot(a0, b0);
  const h0 = Math.atan2(b0, a0);
  // The room this ink has on its side, and a step's lightness as a share of it.
  const room = dark ? Math.max(0, LIGHT_CEILING - L0) : -Math.max(0, L0 - LIGHT_FLOOR);
  const turns = Array.from({ length: look.hues }, (_, k) => (k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * look.turn));
  const floor = contrastRatio(ink, card);
  const out: string[] = [];
  for (let s = 0; s <= look.steps; s++) {
    const rim = s === look.steps;
    const eased = look.steps > 1 ? (s / (look.steps - 1)) ** 1.6 : 0;
    const L = rim ? (dark ? L0 + room * Math.min(1, look.reach + look.rimLift) : L0) : L0 + room * look.reach * eased;
    const C = rim && !dark ? C0 * look.rimChroma : C0;
    for (const deg of turns) {
      if (s === 0 && deg === 0) { out.push(mixOklab(ink, ink, 0)); continue; }
      // Turned less, halving, while the variant would fall under the bar the ink itself clears.
      const tone = (deg: number) => {
        const h = h0 + (deg * Math.PI) / 180;
        return oklch(lightnessKeeping(L0, L, C, h, KEEP_CHROMA), C, h);
      };
      let turn = deg;
      let c = tone(turn);
      for (let k = 0; k < 4 && turn !== 0 && contrastRatio(c, card) < Math.min(min, floor); k++) {
        turn /= 2;
        c = tone(turn);
      }
      out.push(c);
    }
  }
  return out;
}
