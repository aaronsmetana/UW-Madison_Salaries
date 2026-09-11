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
