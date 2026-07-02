import { usd } from './format';

/**
 * Shared Recharts styling tokens so every chart's axes, gridlines, and number formatting match.
 * Spread `GRID` onto <CartesianGrid>, pass `AXIS_TICK` to a `tick=` prop, and `Y_PAD` to a YAxis
 * `padding=` (keeps a top/bottom datum off the clip edge on line/scatter charts).
 */
export const AXIS_TICK = { fontSize: 12 } as const;
// Horizontal gridlines only — vertical gridlines between categories add visual noise without helping
// reads (a bar/line's own x-position already anchors it to its category).
export const GRID = { strokeDasharray: '3 3', opacity: 0.3, vertical: false } as const;
export const Y_PAD = { top: 6, bottom: 6 } as const;

/** Rounded data-end / square baseline for bar marks: [topLeft, topRight, bottomRight, bottomLeft]. */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Axis/number formatters: full currency and compact "$NNk". */
export const fmtUsd = (v: number) => usd(v);
export const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

/** Shortens a snapshot label for a crowded x-axis: "Nov 2021 (Pre-TTC)" → "Nov '21·pre", "Mar 2026" →
 *  "Mar '26". The pre/post suffix only appears when the source label carries it (the one pair of
 *  snapshots sharing a calendar month); the full label stays available in tooltips/ChartData. */
export function fmtSnapTick(label: string): string {
  const m = label.match(/^(\w{3})\w*\s+(\d{4})(?:\s*\((Pre|Post)-TTC\))?/i);
  if (!m) return label;
  const [, mon, year, variant] = m;
  return `${mon} '${year.slice(2)}${variant ? `·${variant.toLowerCase()}` : ''}`;
}

/**
 * Fixed-order categorical series palette for multi-item comparisons (e.g. Compare's tray). The brand
 * accent leads; the rest were chosen and checked with the dataviz skill's validate_palette.js against
 * both this app's light (#fff) and dark (#1a1b1e) card surfaces, and under protanopia/deuteranopia/
 * tritanopia simulation (grape↔blue lands in the 8–12 "legal only with secondary encoding" band —
 * covered here by the legend + direct end-of-line labels). Reserved status hues (pos/red) are
 * deliberately excluded. Never cycle past this list — color follows the entity, not its position (see
 * useTray's colorIdx) — a 9th+ item reuses the last slot with a dashed line instead of a repeated hue.
 */
export const CHART_SERIES = [
  'var(--series-accent)',
  'var(--mantine-color-blue-7)',
  'var(--mantine-color-grape-6)',
  'var(--mantine-color-orange-8)',
  'var(--mantine-color-violet-6)',
  'var(--mantine-color-lime-9)',
  'var(--mantine-color-pink-8)',
] as const;

/**
 * "Nice" currency tick values spanning [min, max] (Recharts' auto ticks otherwise pick ugly steps
 * like -$9,500/-$19,000/-$28,500 for an all-negative range). Snaps the step to 1/2/2.5/5 × 10^k so
 * ticks land on round numbers; because the low end is always an exact multiple of the step, 0 falls
 * on a tick automatically whenever the range crosses or touches it — no special-casing needed.
 */
export function niceCurrencyTicks(min: number, max: number, maxTicks = 5): number[] {
  if (min === max) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(min) || 1)));
    return [min - magnitude, min, min + magnitude];
  }
  const rawStep = (max - min) / Math.max(1, maxTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
  const normalized = Math.abs(rawStep) / magnitude;
  const niceNormalized = [1, 2, 2.5, 5, 10].find((n) => n >= normalized) ?? 10;
  const step = niceNormalized * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  // Round away floating-point drift from repeated addition (e.g. 0.1 + 0.2 artifacts at small steps).
  const roundingFactor = 10 ** Math.max(0, 6 - Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v * roundingFactor) / roundingFactor);
  }
  return ticks;
}
