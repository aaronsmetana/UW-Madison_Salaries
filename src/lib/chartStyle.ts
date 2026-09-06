import type { CSSProperties } from 'react';
import { usd } from './format';

/**
 * Shared Recharts styling tokens so every chart's axes, gridlines, and number formatting match.
 * Spread `GRID` onto <CartesianGrid>, pass `AXIS_TICK` to a `tick=` prop, and `Y_PAD` to a YAxis
 * `padding=` (keeps a top/bottom datum off the clip edge on line/scatter charts).
 */
// `fill` matters as much as `fontSize` here — Recharts' own default tick color (#666) ignores dark
// mode entirely, so every axis label washes out on a dark card unless this token supplies the color.
// The axis line and tick marks have the same problem and are fixed in app.css rather than here: they
// are one CSS rule that reaches all 40 axes in the app, where a token would be a prop 40 call sites
// have to remember — the same failure mode that left `isAnimationActive` off 22 marks.
export const AXIS_TICK = { fontSize: 12, fill: 'var(--mantine-color-dimmed)' } as const;
// Horizontal gridlines only — vertical gridlines between categories add visual noise without helping
// reads (a bar/line's own x-position already anchors it to its category).
// `stroke` for the same reason as AXIS_TICK's `fill`: Recharts' default is a fixed `#ccc`, which
// takes no notice of the color scheme. It got away with it only because `opacity: 0.3` is forgiving
// on both grounds — 1.13:1 on the light card (so light mode effectively had no gridlines at all)
// and 2.11:1 on the dark one. `--hairline-strong` carries its own per-scheme alpha, so the blanket
// opacity goes with it: keeping both would multiply 0.16 by 0.3 and erase the grid entirely.
export const GRID = { strokeDasharray: '3 3', stroke: 'var(--hairline-strong)', vertical: false } as const;
export const Y_PAD = { top: 6, bottom: 6 } as const;

/**
 * One glass-surface look for every Recharts *default* tooltip (i.e. any `<Tooltip formatter=…/>`
 * that doesn't render a bespoke `content=` component) — pass as `contentStyle`. Bespoke tooltips get
 * the same look via the `.chart-tip` class (see `TipSurface` in `components/chart/ChartTooltip.tsx`).
 *
 * This has to stay CSS-in-JS: Recharts' `DefaultTooltipContent` writes background, border and
 * padding as inline styles, so the class could only beat it with `!important` three times over.
 * But it is no longer a second COPY of the look — every value below reads the same variable the
 * class does, so the two cannot drift, and the `@supports` / `prefers-reduced-transparency`
 * fallbacks in app.css reach this object too. A media query is unreachable from here; the variable
 * it rewrites is not, which is the whole trick.
 */
export const TIP_STYLE: CSSProperties = {
  background: 'var(--tip-bg)',
  backdropFilter: 'var(--tip-blur)',
  WebkitBackdropFilter: 'var(--tip-blur)',
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 10,
  boxShadow: 'inset 0 1px 0 var(--chart-sheen), var(--mantine-shadow-md)',
  padding: '6px 10px',
};
export const TIP_LABEL_STYLE: CSSProperties = { color: 'var(--mantine-color-text)', fontWeight: 600 };

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

/**
 * Stacks centered, absolutely-positioned labels into as few rows as it takes for no two labels sharing
 * a row to overlap — the generalized form of the two-row stagger used for the title-change dividers on
 * the Person trend chart. Walk left→right and drop each label onto the first row it clears.
 *
 * Two rows are not always enough: when a cohort's interquartile range collapses into a sliver of the
 * track (a few very high earners stretching `max`), p25/median/p75 can *all three* mutually collide, and
 * a fixed two-row stagger would still leave p25 sitting on p75. Row count is therefore unbounded — in
 * practice it is 1 for a healthy spread and at most one row per label in the degenerate case.
 *
 * Takes geometry straight from the DOM rather than re-deriving it from the data: `centersPx` are the
 * labels' resolved anchor offsets (`offsetLeft`) and `widthsPx` their `offsetWidth`. Labels are centered
 * on their anchor (`translateX(-50%)`), so a label spans `center ± width/2`. Recomputing the anchors
 * from percentages instead would let the measurement drift out of step with what is actually painted.
 * `gap` is the minimum breathing room, in px, between two labels sharing a row.
 *
 * Pure so it can be unit-tested. Returns a 0-based row index per label; all-zero widths (i.e. before
 * anything has been measured) collapse to a single row, which is the correct unstaggered layout.
 */
export function assignLabelRows(centersPx: number[], widthsPx: number[], gap = 6): number[] {
  // Right edge of the last label placed on each row, in px; index === row number.
  const rowEnds: number[] = [];

  return centersPx.map((center, i) => {
    const width = widthsPx[i] ?? 0;
    // A zero-width label paints nothing, so it can neither collide nor push anything down a row.
    // Without this, an unmeasured set (all widths 0) would fan out into one row per label.
    if (width <= 0) return 0;

    const left = center - width / 2;
    const right = center + width / 2;

    let row = rowEnds.findIndex((end) => left >= end + gap);
    if (row === -1) row = rowEnds.length; // no existing row clears it — open a new one
    rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, right);
    return row;
  });
}
