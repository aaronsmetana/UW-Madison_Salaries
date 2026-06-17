import type { Metric, Scope, Filters } from '../state/controls';
import { sqlStr } from './duckdb';

/** allowed facet columns (canonical names — never user-typed) */
export const FACETS: { field: string; label: string; searchable?: boolean }[] = [
  { field: 'employee_category', label: 'Category' },
  { field: 'employee_type', label: 'Employee type' },
  { field: 'flsa_status', label: 'FLSA' },
  { field: 'pay_rate_type', label: 'Pay type' },
  { field: 'department', label: 'Department', searchable: true },
];
const FACET_FIELDS = new Set(FACETS.map((f) => f.field));

/** SQL expression for the selected salary metric (per appointment; full annual rate for full/base). */
export function salaryExpr(metric: Metric): string {
  switch (metric) {
    case 'fte':
      return 'COALESCE(salary_fte_adjusted, salary * fte)';
    case 'base':
      return 'COALESCE(base_pay, salary)';
    default:
      return 'salary';
  }
}

/** Per-appointment ACTUAL earnings (rate × FTE) for the metric — used to blend concurrent roles. */
export function earningsExpr(metric: Metric): string {
  switch (metric) {
    case 'fte':
      return 'COALESCE(salary_fte_adjusted, salary * COALESCE(fte, 1))';
    case 'base':
      return 'COALESCE(base_pay, salary) * COALESCE(fte, 1)';
    default:
      return 'salary * COALESCE(fte, 1)';
  }
}

/**
 * A person's pay within a `GROUP BY person_key` group — use in place of `sum(salaryExpr)`.
 * One appointment → the metric's value as-is (e.g. full annual rate); multiple concurrent
 * appointments → FTE-blended actual earnings, so split roles aren't double-counted.
 */
export function personPay(metric: Metric): string {
  return `CASE WHEN count(*) > 1 THEN sum(${earningsExpr(metric)}) ELSE any_value(${salaryExpr(metric)}) END`;
}

/** WHERE fragment restricting to the current scope. */
export function scopeWhere(scope: Scope): string {
  if (scope.kind === 'school') return `school = ${sqlStr(scope.value)}`;
  if (scope.kind === 'department') return `department = ${sqlStr(scope.value)}`;
  return 'TRUE';
}

export const snapWhere = (snapshotId: string): string => `snapshot_id = ${sqlStr(snapshotId)}`;

/** WHERE fragment for the active facet filters (only whitelisted columns). */
export function filterWhere(filters: Filters): string {
  const parts = Object.entries(filters)
    .filter(([field, vals]) => FACET_FIELDS.has(field) && vals && vals.length)
    .map(([field, vals]) => `${field} IN (${vals.map(sqlStr).join(', ')})`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/** scope + facet filters combined. */
export function whereAll(scope: Scope, filters: Filters): string {
  return `${scopeWhere(scope)} AND ${filterWhere(filters)}`;
}

/** stable string key for the active filters (for query caching). */
export const filterKey = (filters: Filters): string => JSON.stringify(filters);
