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
