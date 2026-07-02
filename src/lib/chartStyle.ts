import { usd } from './format';

/**
 * Shared Recharts styling tokens so every chart's axes, gridlines, and number formatting match.
 * Spread `GRID` onto <CartesianGrid>, pass `AXIS_TICK` to a `tick=` prop, and `Y_PAD` to a YAxis
 * `padding=` (keeps a top/bottom datum off the clip edge on line/scatter charts).
 */
export const AXIS_TICK = { fontSize: 12 } as const;
export const GRID = { strokeDasharray: '3 3', opacity: 0.3 } as const;
export const Y_PAD = { top: 6, bottom: 6 } as const;

/** Axis/number formatters: full currency and compact "$NNk". */
export const fmtUsd = (v: number) => usd(v);
export const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

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
