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
 * estimate. The Nov 2021 to Aug 2022 workbooks wrote the same "unknown" as 0.00025, and listed some
 * hourly pay as the rate itself ($19 rather than $39,520). The ETL's `harmonizeHourly` puts both on
 * this footing before the data ships, so the rule here holds for every snapshot. Keep every actual-pay expression going through this constant — the bug was one literal
 * multiply copied to seven call sites, and it only takes one more copy to reintroduce it.
 */
export const FTE_MULT = 'COALESCE(NULLIF(fte, 0), 1)';

/**
 * The same zero-means-unknown rule, applied one column up.
 *
 * `FTE_MULT` fixed the multiply this app performs. It did not fix the multiply the *source* already
 * performed: the Apr-2024 and Sep-2024 workbooks report `salary_fte_adjusted` as a literal 0 for
 * hourly appointments, having done `rate x 0` themselves before publishing. `COALESCE` only falls
 * through on NULL, so that zero was taken as a reported figure and won — 2,499 rows across 1,591
 * people, every one of them holding a real annualized rate (median $41,600), all reading as $0.
 *
 * It never happens on a row with a recorded FTE: in this dataset `salary_fte_adjusted = 0` occurs
 * only where `fte = 0`, i.e. only on the hourly rows the paragraph above describes. So the zero is
 * always the artifact, never a genuine "earned nothing" — those are the unpaid affiliate rows, which
 * carry `salary = 0` and are excluded by the `salary > 0` filters instead.
 *
 * The visible symptom was a person page showing "Current $0" for a custodian on $16.50/hr. The
 * invisible one was a 1,000-person dip in the paid headcount at both those snapshots, which read on
 * every trend chart in the app as if the university had shed staff and re-hired them.
 */
export const FTE_ADJUSTED = 'NULLIF(salary_fte_adjusted, 0)';

/** Actual pay for one appointment: the reported FTE-adjusted figure, else rate x FTE. */
export const ACTUAL_PAY = `COALESCE(${FTE_ADJUSTED}, salary * ${FTE_MULT})`;

/**
 * The JS twin of `ACTUAL_PAY`, for rows already fetched — Person's trend and history compute this
 * client-side from the raw columns rather than in SQL, and so need the same two guards. Written as
 * `|| null` / `|| 1` rather than `??` on purpose: `??` passes a zero through, which is exactly how
 * both of these got the multiply wrong in the first place.
 */
export function actualPay(r: { salary: number | null; salary_fte_adjusted: number | null; fte: number | null }): number {
  return (r.salary_fte_adjusted || null) ?? (r.salary ?? 0) * (r.fte || 1);
}

/** SQL expression for the selected salary metric (per appointment; full annual rate for full/base). */
export function salaryExpr(metric: Metric): string {
  switch (metric) {
    case 'fte':
      return ACTUAL_PAY;
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
      return ACTUAL_PAY;
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
 * One row per person per group, at their pay within that group — the population every median,
 * quartile and distribution in the app describes.
 *
 * Aggregate pages used to take their medians over appointment ROWS while their headcounts counted
 * PEOPLE, so "652 people" sat beside a median of 735 appointments: Vet Med's read $58,240 by
 * appointment against ~$62,700 by person, and the landing page's "median salary" described 22,383
 * appointments under a sentence about 22,009 employees. Within any group (UW, a school, a department,
 * a title) a person now counts once, at the sum of their appointments in that group — `personPay`,
 * the rule the person pages already used. In the Full-time rate view that means a person with
 * concurrent appointments counts at their combined earnings, not at either rate.
 *
 * `by` are the group's columns; `extra` adds any per-person columns the caller needs.
 */
export function peopleSql(o: { metric: Metric; where: string; by?: readonly string[]; extra?: string }): string {
  const keys = [...(o.by ?? []), 'person_key'].join(', ');
  return `SELECT ${keys}, ${personPay(o.metric)} pay${o.extra ? `, ${o.extra}` : ''} FROM salaries WHERE ${o.where} GROUP BY ${keys}`;
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
  if (scope.kind === 'department') {
    const dept = `department = ${sqlStr(scope.value)}`;
    return scope.school ? `school = ${sqlStr(scope.school)} AND ${dept}` : dept;
  }
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

/**
 * The one relabel that also changed the quantity.
 *
 * `Annual` → `12 Month` is a pure rename: 531 faculty who kept their job and FTE across it moved by
 * the 3.0% pay-plan raise and nothing else. `Academic` → `9 Month` is not. Of the 9-month stayers
 * across the Apr 2025 → Sep 2025 boundary, 1,474 moved by exactly ×1.259 — 11/9 times that same 3%
 * — so the Sep 2025 workbook reports 9-month pay on a different footing than the one before it.
 * Read as a raise, it put a +25.9% jump on 2,206 people's histories and topped every raise list.
 *
 * The figures stay as published. This names the boundary so no change is ever computed across it.
 * `from`/`to` are normalized-lowercase labels in the order the snapshots run.
 */
export const REPORTING_CHANGES = [
  { from: 'academic', to: '9 month', factor: 11 / 9, since: '2025-09', note: '9-month pay reported differently' },
] as const;

export type ReportingChange = (typeof REPORTING_CHANGES)[number];

/** The reporting change between an earlier and a later `comp_basis`, or null. */
export function reportingChange(
  earlier: string | null | undefined,
  later: string | null | undefined
): ReportingChange | null {
  const a = earlier?.trim().toLowerCase();
  const b = later?.trim().toLowerCase();
  if (!a || !b) return null;
  return REPORTING_CHANGES.find((c) => c.from === a && c.to === b) ?? null;
}

/**
 * Whether a pay figure under `earlier` and one under `later` measure the same thing, so a change
 * between them is a change in pay. `sameBasis` answers "same class of appointment" for cohort
 * scoping, where both sides come from one snapshot; this answers it across time, where the 9-month
 * reporting change also has to be excluded.
 */
export function sameQuantity(earlier: string | null | undefined, later: string | null | undefined): boolean {
  return sameBasis(earlier, later) && !reportingChange(earlier, later);
}

/** SQL twin of `basisClass`: the normalized class label of a `comp_basis` column. */
function basisClassSql(col: string): string {
  const cases = BASIS_CLASSES.flatMap((c) => c.map((l) => `WHEN ${sqlStr(l)} THEN ${sqlStr(c[c.length - 1])}`)).join(' ');
  return `(CASE lower(trim(${col})) ${cases} ELSE lower(trim(${col})) END)`;
}

/** SQL twin of `sameQuantity(a, b)` for two `comp_basis` columns, `a` the earlier. */
export function sameQuantitySql(a: string, b: string): string {
  const changes = REPORTING_CHANGES.map((c) => `(lower(trim(${a})) = ${sqlStr(c.from)} AND lower(trim(${b})) = ${sqlStr(c.to)})`).join(' OR ');
  // `coalesce(…, FALSE)`: with a NULL basis on either side (every snapshot before Sep 2024 has none)
  // the reporting-change test is NULL, and `NOT NULL` would drop the step from any WHERE.
  return `((${a} IS NULL OR trim(${a}) = '' OR ${b} IS NULL OR trim(${b}) = '' OR ${basisClassSql(a)} = ${basisClassSql(b)}) AND NOT coalesce(${changes}, FALSE))`;
}

/**
 * Every continuing raise: the one definition of "a raise" the app states anywhere.
 *
 * A step counts only when it measures pay and nothing else moved: the same person, holding ONE paid
 * appointment on each side, in the same job code, at the same FTE, on the same pay basis (and not
 * across the 9-month reporting change). Title changes, FTE changes, concurrent appointments and new
 * hires are all excluded — each would otherwise pass for a raise or a cut. Snapshots follow their
 * canonical order with the pre-TTC twin dropped, so the TTC reclassification is never a step; with
 * `pair`, the step is exactly `from` → `to` instead (the Changes panel lets a reader pick both ends).
 *
 * Columns: from_id, to_id, person_key, job_code, pay_from, pay_to, r (the raise as a fraction).
 */
export function continuingRaisesSql(o: { metric: Metric; where?: string; pair?: { from: string; to: string } }): string {
  const where = o.where ?? 'TRUE';
  const pay = salaryExpr(o.metric);
  const steps = o.pair
    ? `a.snapshot_id = ${sqlStr(o.pair.from)} AND b.snapshot_id = ${sqlStr(o.pair.to)}`
    : `sb.i = sa.i + 1`;
  return `WITH cr_snaps AS (
      SELECT snapshot_id, row_number() OVER (ORDER BY min(snapshot_date), snapshot_id) i
      FROM salaries WHERE snapshot_id NOT LIKE '%-pre' GROUP BY snapshot_id
    ),
    cr_one AS (
      SELECT snapshot_id, person_key, any_value(job_code) job_code, any_value(${FTE_MULT}) fte,
             any_value(comp_basis) basis, any_value(${pay}) pay
      FROM salaries WHERE salary > 0 AND ${where}
      GROUP BY snapshot_id, person_key HAVING count(*) = 1
    )
    SELECT a.snapshot_id from_id, b.snapshot_id to_id, b.person_key, b.job_code,
           a.pay pay_from, b.pay pay_to, b.pay / a.pay - 1 r
    FROM cr_one a JOIN cr_snaps sa ON sa.snapshot_id = a.snapshot_id
    JOIN cr_one b ON b.person_key = a.person_key AND b.job_code = a.job_code AND b.fte = a.fte
    JOIN cr_snaps sb ON sb.snapshot_id = b.snapshot_id
    WHERE ${steps} AND a.job_code IS NOT NULL AND a.pay > 0 AND b.pay > 0
      AND ${sameQuantitySql('a.basis', 'b.basis')}`;
}

/**
 * Where one person's pay stands in each pool they belong to, as counts: `n_*` people with pay in the
 * pool and `b_*` of them paid strictly less than `pay`. One query for the page and the printed report,
 * so they cannot disagree: pay per PERSON (`personPay`), the department pool inside its school, and
 * the strictly-below, n−1 percentile rule of `percentile()` applied by the caller.
 */
export function standingSql(o: {
  snapshotId: string; pay: number; metric: Metric;
  school?: string | null; department?: string | null; grade?: number | null; jobCode?: string | null;
}): string {
  const lit = (v: string | null | undefined) => sqlStr(v ?? '');
  // Membership is "holds an appointment in the pool" (bool_or), not whichever row `any_value` picked:
  // a person split across two schools belongs to both, at their one pay.
  return `WITH pp AS (SELECT person_key, ${personPay(o.metric)} pay,
        bool_or(school = ${lit(o.school)}) in_div,
        bool_or(school = ${lit(o.school)} AND department = ${lit(o.department)}) in_dept,
        bool_or(grade_number = ${o.grade ?? -1}) in_grade,
        bool_or(job_code = ${lit(o.jobCode)}) in_title
      FROM salaries WHERE snapshot_id = ${sqlStr(o.snapshotId)} GROUP BY person_key)
     SELECT
       count(*) FILTER (WHERE pay > 0) n_all,
       count(*) FILTER (WHERE pay > 0 AND pay < ${o.pay}) b_all,
       count(*) FILTER (WHERE pay > 0 AND in_div) n_div,
       count(*) FILTER (WHERE pay > 0 AND in_div AND pay < ${o.pay}) b_div,
       count(*) FILTER (WHERE pay > 0 AND in_dept) n_dept,
       count(*) FILTER (WHERE pay > 0 AND in_dept AND pay < ${o.pay}) b_dept,
       count(*) FILTER (WHERE pay > 0 AND in_grade) n_grade,
       count(*) FILTER (WHERE pay > 0 AND in_grade AND pay < ${o.pay}) b_grade,
       count(*) FILTER (WHERE pay > 0 AND in_title) n_title,
       count(*) FILTER (WHERE pay > 0 AND in_title AND pay < ${o.pay}) b_title
     FROM pp`;
}

/** The percentile a `standingSql` pool gives: share of the OTHER members strictly below. */
export function poolPercentile(below: number, n: number): number | null {
  return n <= 1 ? null : Math.min(100, Math.round((below / (n - 1)) * 100));
}
