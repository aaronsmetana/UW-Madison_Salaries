import { sqlStr } from './duckdb';

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
