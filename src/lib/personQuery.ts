import { sqlStr } from './duckdb';
import { compareMain, mainRow, type MainFields } from './queries';
import { hourly } from './format';

/**
 * The query a person's page waits on before it draws anything: every appointment row they have, oldest
 * snapshot first. Here rather than in the page so the landing page's reveal (components/PersonReveal) can
 * start it the moment a reader picks someone, under the same cache key the page reads — by the time the
 * page mounts, its rows are usually there.
 */
export function personRowsSql(key: string): string {
  return `SELECT first_name, last_name, snapshot_id, snapshot_label, snapshot_date, school, department,
            title, job_code, salary, salary_fte_adjusted, fte, date_of_hire, employee_category,
            grade_number, grade_basis, salary_grade_raw, flsa_status, comp_basis, pay_rate_type,
            employee_type, contract_type
     FROM salaries WHERE person_key = ${sqlStr(key)} ORDER BY snapshot_date`;
}

/** The cache key `useSql(['person', key], personRowsSql(key))` stores those rows under. */
export const personRowsKey = (key: string) => ['sql', 'person', key, personRowsSql(key)] as const;

/** A person's hire date as their latest record gives it: someone a changed hire date had split in two
 *  (scripts/lib/identity) carries the earlier date on their earlier rows. Rows oldest first. */
export function latestHire(rows: readonly { date_of_hire: string | null }[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].date_of_hire) return rows[i].date_of_hire;
  return null;
}

/**
 * A person's rows in their latest snapshot, and the main appointment among them (queries `mainRow`): the job
 * their page names them by. The pre- and post-TTC twins share a date; the post-TTC one is the later. Rows
 * in any order.
 */
export function latestRows<T extends { snapshot_id: string; snapshot_date: string }>(rows: readonly T[]): T[] {
  let last: T | undefined;
  for (const r of rows) {
    if (!last || String(r.snapshot_date) > String(last.snapshot_date)
      || (String(r.snapshot_date) === String(last.snapshot_date) && last.snapshot_id.endsWith('-pre') && !r.snapshot_id.endsWith('-pre'))) last = r;
  }
  return last ? rows.filter((r) => r.snapshot_id === last!.snapshot_id) : [];
}

/** The main appointment of a person's latest snapshot. */
export function latestMain<T extends MainFields & { snapshot_id: string; snapshot_date: string }>(rows: readonly T[]): T | undefined {
  return mainRow(latestRows(rows));
}

/** One snapshot's appointments other than the main one, the next most main first. */
export function otherAppts<T extends MainFields>(rows: readonly T[]): T[] {
  const m = mainRow(rows);
  return rows.filter((r) => r !== m).sort((a, b) => compareMain(b, a));
}

/** What sets an appointment apart beside its title: "hourly, $43.00/hr", "50% FTE" or "unpaid" — and, for an
 *  hourly job actual pay leaves out (queries `countedAppts`: one held beside a salaried job, or beside a
 *  better-paid hourly one), that it does and why. */
export function apptTerms(r: { salary: number | null; fte: number | null }, counted = true): string {
  if (!(r.salary && r.salary > 0)) return 'unpaid';
  if (!r.fte) return `hourly, ${hourly(r.salary)}${counted ? '' : '; hours not reported, not in actual pay'}`;
  return `${Math.round(r.fte * 100)}% FTE`;
}
