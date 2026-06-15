import type { Metric, Scope } from '../state/controls';
import { sqlStr } from './duckdb';

/** SQL expression for the selected salary metric. */
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

/** WHERE fragment restricting to the current scope. */
export function scopeWhere(scope: Scope): string {
  if (scope.kind === 'school') return `school = ${sqlStr(scope.value)}`;
  if (scope.kind === 'department') return `department = ${sqlStr(scope.value)}`;
  return 'TRUE';
}

export const snapWhere = (snapshotId: string): string => `snapshot_id = ${sqlStr(snapshotId)}`;
