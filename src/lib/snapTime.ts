import { fmtSnapTick } from './chartStyle';
import { reportingChange } from './queries';

/**
 * Snapshots on a true date axis.
 *
 * Every chart over time used to space snapshots evenly, one category each. The gaps between them run
 * from zero (the pre- and post-TTC pair share a date) to fourteen months (Aug 2022 → Oct 2023), so
 * an even spacing gave a same-day relabel as much width as a year and a quarter, and bent every slope
 * drawn across it. Here x is the snapshot's own date.
 */

const DAY = 864e5;

/** How far either side of their shared date the pre- and post-TTC twins sit. They are one date in the
 *  source; drawn on it they would stack into one point, and the reclassification between them is the
 *  thing a reader needs to see. 15 days is a sliver on a four-year axis (~1% of its width). */
export const TTC_OFFSET_DAYS = 15;

const dayOf = (date: string): number => Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);

/** -1 for the pre-TTC twin, +1 for post-TTC, 0 for any other snapshot. */
function ttcSide(idOrLabel: string): number {
  const s = idOrLabel.toLowerCase();
  if (s.endsWith('-pre') || s.includes('pre-ttc')) return -1;
  if (s.endsWith('-post') || s.includes('post-ttc')) return 1;
  return 0;
}

/** A snapshot's position on the date axis, in epoch ms. Accepts a snapshot id or label. */
export function snapX(date: string, idOrLabel: string): number {
  return dayOf(date) + ttcSide(idOrLabel) * TTC_OFFSET_DAYS * DAY;
}

export interface SnapTick {
  x: number;
  label: string;
}

/**
 * One tick per snapshot DATE. The TTC twins share one tick, "Nov '21", at their common date: two
 * ticks 30 days apart sit ~17px apart on a laptop-width axis and print on top of each other.
 */
export function snapTicks(rows: readonly { date: string; label: string }[]): SnapTick[] {
  const byDate = new Map<number, string>();
  for (const r of rows) {
    const x = dayOf(r.date);
    if (!byDate.has(x)) byDate.set(x, fmtSnapTick(r.label).replace(/·(pre|post)$/i, ''));
  }
  return [...byDate.entries()].sort((a, b) => a[0] - b[0]).map(([x, label]) => ({ x, label }));
}

/**
 * Props for a Recharts `<XAxis>` on the date axis. Rows must carry `x` from `snapX` under `dataKey`.
 * `interval="preserveStartEnd"` with `minTickGap` lets Recharts drop the ticks whose measured labels
 * would collide at the chart's real width, keeping the first and last.
 */
export function snapAxisProps(rows: readonly { date: string; label: string }[], dataKey = 'x') {
  const ticks = snapTicks(rows);
  const xs = rows.map((r) => snapX(r.date, r.label));
  const lo = xs.length ? Math.min(...xs) : 0;
  const hi = xs.length ? Math.max(...xs) : 1;
  const labelAt = (v: number) => ticks.find((t) => Math.abs(t.x - v) < DAY)?.label ?? '';
  return {
    type: 'number' as const,
    dataKey,
    scale: 'time' as const,
    domain: [lo, hi] as [number, number],
    ticks: ticks.map((t) => t.x),
    tickFormatter: labelAt,
    interval: 'preserveStartEnd' as const,
    minTickGap: 14,
    padding: { left: 16, right: 16 },
  };
}

/**
 * The breaks in this data that are not changes in pay or staff: the reclassification, the report
 * that stopped covering students and trainees, and the Sep 2025 change in how 9-month pay is
 * reported. One list, so every chart marks the same three dates the same way — the Retention tab
 * used to guess its "coverage change" as whichever step had the most churn, which in some divisions
 * is a different step entirely.
 */
export const KNOWN_BREAKS = [
  { id: 'ttc', snapshotId: '2021-11-post', date: '2021-11-01', label: 'TTC reclassification', kind: 'relabel' },
  { id: 'scope2023', snapshotId: '2023-10', date: '2023-10-01', label: 'Oct 2023 scope change', kind: 'coverage' },
  { id: 'nineMonth2025', snapshotId: '2025-09', date: '2025-09-01', label: '9-month pay reported differently', kind: 'reporting' },
] as const;

export type KnownBreak = (typeof KNOWN_BREAKS)[number];

export function knownBreak(id: KnownBreak['id']): KnownBreak {
  return KNOWN_BREAKS.find((b) => b.id === id)!;
}

/**
 * Indices where a pay series must break rather than draw a line: the point at `i` is on a different
 * reporting footing from the one at `i - 1` (today, only the 9-month change). Drawn joined, the ×11/9
 * step reads as a 26% raise.
 */
export function reportingBreaks(rows: readonly { basis: string | null | undefined }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) if (reportingChange(rows[i - 1].basis, rows[i].basis)) out.push(i);
  return out;
}
