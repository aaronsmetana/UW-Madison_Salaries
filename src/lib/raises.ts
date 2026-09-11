import type { Metric } from '../state/controls';
import { sqlStr } from './duckdb';
import { continuingRaisesSql } from './queries';

/**
 * Raises in context: what a typical raise was at each step, and what one person's came to.
 *
 * Every figure here reads `continuingRaisesSql`, the app's one definition of a raise, so the person
 * page, the Changes panel and the printed report mean the same thing when they say "typical".
 */

const YEAR_MS = 365.25 * 864e5;

/** One step between consecutive snapshots: its continuing raises campus-wide, and in one job code. */
export interface RaiseStep {
  from_id: string;
  to_id: string;
  from_date: string;
  to_date: string;
  n: number;
  med: number | null;
  n_title: number;
  med_title: number | null;
}

/** Per-step counts and medians of continuing raises, campus-wide and for `jobCode`. */
export function raiseStepsSql(o: { metric: Metric; jobCode?: string | null }): string {
  const job = sqlStr(o.jobCode ?? '');
  return `SELECT from_id, to_id, any_value(from_date) from_date, any_value(to_date) to_date,
       count(*) n, median(r) med,
       count(*) FILTER (WHERE job_code = ${job}) n_title, median(r) FILTER (WHERE job_code = ${job}) med_title
     FROM (${continuingRaisesSql({ metric: o.metric })}) GROUP BY from_id, to_id ORDER BY from_date`;
}

/** Fewer people than this continuing in a title across a step, and its median is typical of nothing. */
export const MIN_TITLE_STEP = 10;

/**
 * A run of step rates, compounded and expressed per year of the time those steps span (a gap
 * between steps adds nothing). Null under half a year, where "per year" would magnify one step.
 */
export function annualized(steps: readonly { from: string; to: string; rate: number }[]): number | null {
  let growth = 1;
  let ms = 0;
  for (const s of steps) {
    growth *= 1 + s.rate;
    ms += Date.parse(s.to) - Date.parse(s.from);
  }
  const years = ms / YEAR_MS;
  return years >= 0.5 ? Math.pow(growth, 1 / years) - 1 : null;
}

/**
 * The logarithmic mean of two positive amounts: (a − b) / (ln a − ln b), and a itself when a = b —
 * the limit, not a special case. It is the one weight that splits a gap between two compounded
 * paths into per-step shares that add up to exactly the gap (see `whereTheDifferenceCameFrom`).
 */
export function logMean(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return NaN;
  if (Math.abs(a - b) <= 1e-9 * Math.max(a, b)) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

/** One step of a person's pay path and of the "typical" path beside it. */
export interface PathStep {
  /** The snapshot this step ends at. */
  toId: string;
  /** Actual pay before and after. */
  from: number;
  to: number;
  /** The typical path's growth over the same stretch: every campus step compounded, including any
   *  snapshot the person was not in. */
  typical: number;
  /** A reporting change's factor on this step (×11/9 across Sep 2025 for 9-month pay), applied to both
   *  paths so it never reads as a raise. 1 when there is none. */
  reporting: number;
}

/** Each step's share of the gap between actual and typical pay, plus the reporting rows. */
export interface GapShare {
  toId: string;
  kind: 'step' | 'reporting';
  amount: number;
}

/**
 * Where the difference between a person's pay and the "if raises had been typical" line came from.
 *
 * Both paths start at the same pay. The actual one ends at a = from0 × Π(1 + r), the typical one at
 * b = from0 × Π(1 + m); so ln(a/b) = Σ ln((1 + r)/(1 + m)), and multiplying through by the
 * logarithmic mean L(a, b) turns that sum of logs into a sum of dollars that is exactly a − b. The
 * naive split — each step's gap over the total — divides by a number that goes to zero when the two
 * paths happen to end close together. A reporting change is its own row: it sits inside both r and m,
 * so it contributes nothing to the gap, and saying so is the point of the row.
 */
export function whereTheDifferenceCameFrom(steps: readonly PathStep[]): { actual: number; typical: number; shares: GapShare[] } {
  if (!steps.length) return { actual: NaN, typical: NaN, shares: [] };
  let a = steps[0].from;
  let b = steps[0].from;
  for (const s of steps) {
    a *= s.to / s.from;
    b *= s.typical;
  }
  const L = logMean(a, b);
  const shares: GapShare[] = [];
  for (const s of steps) {
    if (s.reporting !== 1) shares.push({ toId: s.toId, kind: 'reporting', amount: 0 });
    // The reporting factor is in both, so it cancels out of the ratio exactly.
    shares.push({ toId: s.toId, kind: 'step', amount: L * Math.log(s.to / s.from / s.typical) });
  }
  return { actual: a, typical: b, shares };
}
