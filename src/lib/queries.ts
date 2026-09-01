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

/**
 * The FTE multiplier used by every actual-pay expression below.
 *
 * `fte = 0` in this source does NOT mean "earns nothing". Every zero-FTE row is an hourly
 * appointment (`pay_rate_type` Hourly / Hourly_Timeclock) where no fixed appointment percentage is
 * recorded — 1,178 people in the Mar 2026 snapshot, mostly temporary University Staff, with a real
 * median rate of $45,760. Multiplying by a literal zero turned all of them into $0 earners, which
 * quietly did three things: depressed the published median by ~$2,700 ($74,387 against $77,126),
 * dropped them from every FTE-gated headcount (the long-standing gap between Home's 22,009 and
 * Explore's 20,872), and removed the lowest-paid group in the data from the cohort medians,
 * percentiles, and Screening runs this tool exists to produce.
 *
 * `NULLIF(fte, 0)` maps that zero to "unknown" so the annualized rate stands as the best available
 * estimate. Keep every actual-pay expression going through this constant — the bug was one literal
 * multiply copied to seven call sites, and it only takes one more copy to reintroduce it.
 */
export const FTE_MULT = 'COALESCE(NULLIF(fte, 0), 1)';

/** SQL expression for the selected salary metric (per appointment; full annual rate for full/base). */
export function salaryExpr(metric: Metric): string {
  switch (metric) {
    case 'fte':
      return `COALESCE(salary_fte_adjusted, salary * ${FTE_MULT})`;
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
      return `COALESCE(salary_fte_adjusted, salary * ${FTE_MULT})`;
    case 'base':
      return `COALESCE(base_pay, salary) * ${FTE_MULT}`;
    default:
      return `salary * ${FTE_MULT}`;
  }
}

/**
 * A person's pay within a `GROUP BY person_key` group — use in place of `sum(salaryExpr)`.
 * One appointment → the metric's value as-is (e.g. full annual rate); multiple concurrent
 * appointments → FTE-blended actual earnings, so split roles aren't double-counted.
 */
export function personPay(metric: Metric): string {
  // Only count real (positive-salary) appointments: one → the metric value; several concurrent →
  // FTE-blended actual earnings. Guarding on salary>0 avoids a $0 placeholder row triggering a blend.
  return `CASE WHEN count(*) FILTER (WHERE salary > 0) > 1
            THEN sum(${earningsExpr(metric)}) FILTER (WHERE salary > 0)
            ELSE any_value(${salaryExpr(metric)}) FILTER (WHERE salary > 0) END`;
}

/**
 * Distinct people with at least one paid (positive-metric) appointment — the "employee" headcount.
 * Use instead of `count(DISTINCT person_key)` so headcount runs on the same population as the medians
 * and totals (which already filter `${salaryExpr(metric)} > 0`), excluding unpaid $0 affiliate
 * appointments. Multi-appointment people keep counting as long as one role is paid.
 */
export function paidHeadcount(metric: Metric): string {
  return `count(DISTINCT person_key) FILTER (WHERE ${salaryExpr(metric)} > 0)`;
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

// ── Compensation-basis equivalence — the source relabeled the `comp_basis` column mid-series, so
//    the SAME pay basis appears under different labels in different snapshots, and there's no basis
//    recorded at all before Sep 2024. 'Annual' (through Apr 2024 snapshots) and '12 Month' (Sep 2025
//    on) mean the same thing; likewise 'Academic' ↔ '9 Month'. (Mirrors BASIS_ALIASES in ./format.ts,
//    which normalizes these for DISPLAY; this is the query-side equivalence.) ──
const BASIS_CLASSES: string[][] = [
  ['annual', '12 month'],
  ['academic', '9 month'],
];
/** The equivalence class (normalized-lowercase labels) a basis belongs to — its own singleton when
 *  the label isn't part of a known relabeling. */
function basisClass(basis: string): string[] {
  const key = basis.trim().toLowerCase();
  return BASIS_CLASSES.find((c) => c.includes(key)) ?? [key];
}

/**
 * SQL predicate scoping a same-title/grade cohort to the subject's own pay basis, so a 9-month
 * (academic-year) salary is never compared raw against a 12-month one. Matches every label in the
 * subject's equivalence class (see `BASIS_CLASSES`) AND keeps NULL-basis rows (snapshots before the
 * column existed) rather than dropping their whole history. Returns '' (no filter) when the subject's
 * basis is unknown. Begins with `AND ` (callers append it after an existing WHERE, with their own
 * leading space in the template — matching the original inline predicate it replaced).
 */
export function basisEquivWhere(subjBasis: string | null | undefined): string {
  if (!subjBasis || !subjBasis.trim()) return '';
  const cls = basisClass(subjBasis);
  return `AND (lower(comp_basis) IN (${cls.map(sqlStr).join(', ')}) OR comp_basis IS NULL)`;
}

/** Whether two `comp_basis` values name the same pay basis (label-drift-tolerant — see
 *  `basisEquivWhere`). A null/blank on either side is treated as "unknown → don't exclude" (true),
 *  matching the query-side predicate's NULL tolerance. */
export function sameBasis(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !a.trim() || !b || !b.trim()) return true;
  return basisClass(a).includes(b.trim().toLowerCase());
}
