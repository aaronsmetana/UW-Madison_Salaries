import type { Metric } from '../state/controls';
import { sqlStr } from './duckdb';
import { continuingRaisesSql, comparableSql, reportingFactorSql, salaryExpr, FTE_MULT } from './queries';
import { belowMinimumSql, bandScaleSql } from './bands';
import { familySql } from './jobFamilies';
import { raiseBucketSql } from './raiseBuckets';

/**
 * Who got more than the usual raise between two snapshots, and what may explain it (the Raises page).
 *
 * A raise here is a continuing raise (queries `continuingRaisesSql`), the app's one definition: the same
 * person, one paid appointment on each side, the same job code, FTE and pay basis. So "a raise" on this
 * page means what it means on a person's page and in Divisions → Changes.
 *
 * The usual raise is the pay plan's step: the raise most people in an employee category got, read at 0.1%,
 * the resolution raises are printed at (a 2.0% step rounded to the cent is +2.008%, which reads as 2.0%).
 * It is read campus-wide for the pair whatever the page is filtered to, because a department does not set
 * the pay plan: filtered to one department, the page asks who in it got more than the plan gave.
 */

/** A category's most common raise is its usual raise only if at least this share of it got exactly that. */
export const USUAL_SHARE = 0.4;
/** Fewer continuing raises than this in a category, and its most common raise is chance: campus's is used. */
export const USUAL_MIN_N = 20;
/** A title or a department needs this many continuing raises before its pattern explains anyone's. */
export const PATTERN_MIN_N = 5;
/** Within this of the title's median raise, a person's raise is the title's adjustment. */
export const NEAR_TITLE = 0.01;
/** Brought up to a range's minimum: at it, or no more than this share above it. */
export const AT_MINIMUM = 0.005;

/**
 * One employee category, spelled one way. Releases spelled the same category differently —
 * "Employee-In-Training" (Apr 2024), "Employee-in-Training" (Apr 2025), "Employees in Training"; "Limited
 * Appointee" (Apr 2024) and "Limited" — and a usual raise per spelling would split one pay plan in two.
 * The codes the source recorded before 2024 (CP, CL, CJ, ET2–ET4) are kept as recorded: it does not say
 * what they stand for.
 */
const SPELLINGS: Readonly<Record<string, string>> = {
  'employee-in-training': 'Employees in Training',
  'employees in training': 'Employees in Training',
  'limited appointee': 'Limited',
};
export const UNCATEGORIZED = 'Uncategorized';

export function categoryOf(raw: string | null | undefined): string {
  const t = raw?.trim();
  if (!t) return UNCATEGORIZED;
  return SPELLINGS[t.toLowerCase()] ?? t;
}

/** `categoryOf` in SQL, over an expression holding the recorded category. */
export function categorySql(expr: string): string {
  const when = Object.entries(SPELLINGS).map(([k, v]) => `WHEN ${sqlStr(k)} THEN ${sqlStr(v)}`).join(' ');
  return `(CASE lower(trim(${expr})) ${when} ELSE coalesce(nullif(trim(${expr}), ''), ${sqlStr(UNCATEGORIZED)}) END)`;
}

/** What the page is narrowed to. Every filter is on where the person is at the later snapshot. */
export interface RaiseFilters {
  school?: string | null;
  /** Only inside its school: the source reuses department names across schools. */
  department?: string | null;
  jobCode?: string | null;
  /** A job group's letters (lib/jobFamilies). */
  family?: string | null;
}

/**
 * The filters as a predicate on one appointment row of the later snapshot. On the later side only: a
 * continuing raise keeps its job code but can change school or department, and filtering both sides
 * would drop those people without a word.
 */
export function filterSql(f: RaiseFilters, table = ''): string {
  const c = (col: string) => (table ? `${table}.${col}` : col);
  const parts: string[] = [];
  if (f.school) parts.push(`${c('school')} = ${sqlStr(f.school)}`);
  if (f.school && f.department) parts.push(`${c('department')} = ${sqlStr(f.department)}`);
  if (f.jobCode) parts.push(`${c('job_code')} = ${sqlStr(f.jobCode)}`);
  if (f.family) parts.push(`${familySql(c('job_code'))} = ${sqlStr(f.family)}`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/** Each person's one paid appointment in a snapshot, as the page shows it. Anyone with two has no row. */
function oneSql(snapshot: string): string {
  return `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(title) title, any_value(job_code) job_code,
      any_value(school) school, any_value(department) department, ${categorySql('any_value(employee_category)')} cat,
      any_value(salary) rate, any_value(grade_number) grade, any_value(grade_basis) grade_basis, any_value(comp_basis) comp
    FROM salaries WHERE snapshot_id = ${sqlStr(snapshot)} AND salary > 0 GROUP BY person_key HAVING count(*) = 1`;
}

interface Pair { metric: Metric; from: string; to: string }
const raisesOf = (o: Pair) => continuingRaisesSql({ metric: o.metric, pair: { from: o.from, to: o.to } });

/** A category's raises at their most common: `k` the raise at 0.1%, `c` how many got it, `n` of how many.
 *  `cat` null is campus as a whole. */
export interface ModeRow { cat: string | null; n: number; k: number | null; c: number; med: number | null }

/** Each category's most common raise and median over the pair, and campus's (`cat` null). Ties go to the
 *  smaller raise. */
export function usualModesSql(o: Pair): string {
  return `WITH x AS (SELECT cr.r, t.cat FROM (${raisesOf(o)}) cr JOIN (${oneSql(o.to)}) t USING (person_key)),
    g AS (SELECT cat, round(r, 3) k, count(*) c FROM x GROUP BY GROUPING SETS ((cat, round(r, 3)), (round(r, 3)))),
    m AS (SELECT cat, k, c, CAST(sum(c) OVER (PARTITION BY cat) AS BIGINT) n, row_number() OVER (PARTITION BY cat ORDER BY c DESC, k) rn FROM g),
    md AS (SELECT cat, median(r) med FROM x GROUP BY GROUPING SETS ((cat), ()))
    SELECT m.cat, m.n, m.k, m.c, md.med FROM m JOIN md ON md.cat IS NOT DISTINCT FROM m.cat WHERE m.rn = 1`;
}

/** How a category's usual raise was found. */
export type UsualHow = 'mode' | 'median' | 'campus' | 'set';

export interface Usual {
  /** null: campus as a whole. */
  cat: string | null;
  usual: number;
  how: UsualHow;
  /** Continuing raises in the category. */
  n: number;
  /** Its most common raise, and the share that got exactly it. */
  k: number | null;
  share: number | null;
  med: number | null;
}

export interface Usuals { campus: Usual; cats: Usual[] }

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Each category's usual raise, and campus's. A category's most common raise, when at least `USUAL_SHARE` of
 * it got exactly that; otherwise no one raise is usual there, and its median stands in. A category with fewer
 * than `USUAL_MIN_N` continuing raises takes campus's. `set` (a fraction) is the reader's own, for everyone.
 */
export function usualRaises(rows: readonly ModeRow[], set?: number | null): Usuals | null {
  const whole = rows.find((r) => r.cat == null);
  if (!whole || !whole.n) return null;
  const own = (r: ModeRow): Pick<Usual, 'usual' | 'how'> =>
    r.k != null && r.c / r.n >= USUAL_SHARE ? { usual: r.k, how: 'mode' } : { usual: round3(r.med ?? 0), how: 'median' };
  const facts = (r: ModeRow) => ({ cat: r.cat, n: r.n, k: r.k, share: r.k != null && r.n ? r.c / r.n : null, med: r.med });
  const campus: Usual = { ...facts(whole), ...(set != null ? { usual: set, how: 'set' as const } : own(whole)) };
  const cats = rows
    .filter((r) => r.cat != null)
    .sort((a, b) => b.n - a.n || (a.cat! < b.cat! ? -1 : 1))
    .map((r): Usual => {
      if (set != null) return { ...facts(r), usual: set, how: 'set' };
      if (r.n < USUAL_MIN_N) return { ...facts(r), usual: campus.usual, how: 'campus' };
      return { ...facts(r), ...own(r) };
    });
  return { campus, cats };
}

/**
 * Each person's usual raise, by their category: a SQL expression over `col`. A DOUBLE, said so: the literals
 * alone type as DECIMAL, which DuckDB-WASM hands the page unscaled — 0.02 arrived as 2, and every row read
 * "usual +200.0%" while the comparisons in SQL, on the true value, were right.
 */
export function usualCaseSql(u: Usuals, col: string): string {
  const when = u.cats.filter((c) => c.cat != null).map((c) => `WHEN ${sqlStr(c.cat!)} THEN ${c.usual}`).join(' ');
  return when ? `CAST((CASE ${col} ${when} ELSE ${u.campus.usual} END) AS DOUBLE)` : `CAST(${u.campus.usual} AS DOUBLE)`;
}

/** What may explain a raise above the usual, in the order they are tried: the first that fits is given. */
export type Why = 'range' | 'title' | 'unit' | 'individual';
export const WHY_ORDER: readonly Why[] = ['range', 'title', 'unit', 'individual'];

export interface ReviewRow {
  person_key: string;
  fn: string | null;
  ln: string | null;
  title: string | null;
  job_code: string;
  school: string | null;
  department: string | null;
  cat: string;
  pay_from: number;
  pay_to: number;
  r: number;
  usual: number;
  why: Why;
  /** The title campus-wide: continuing raises, how many above their usual, and its median raise. */
  tn: number;
  tb: number;
  tmed: number;
  /** The department (in its school): its continuing raises that no range minimum or title-wide adjustment
   *  explains, and how many of those were above their usual. */
  un: number;
  ub: number;
}

/**
 * Everyone in the filter whose continuing raise was above their category's usual raise, each with what may
 * explain it, first match wins:
 *
 * 1. `range`: brought up to their grade's minimum — below it before, at it after, to HR's rounding. Only when
 *    `ranges` (the later snapshot is the one the published ranges came out with: HR publishes no history).
 * 2. `title`: at least half the title's continuing raises campus-wide were above the usual, and this one is
 *    within a point of the title's median raise.
 * 3. `unit`: the same of their department's raises, leaving out those a range minimum or a title-wide adjustment
 *    already explains. Otherwise one title's adjustment — 164 Crowd Control Officers at +16.7% — made its whole
 *    department look like a department-wide pattern, and labelled everyone else in it so.
 * 4. `individual`: none of these. The records don't say which of merit, equity, retention or a counter-offer.
 *
 * The title's and department's patterns are read over all of campus's continuing raises, not the filter's.
 */
export function reviewSql(o: Pair & { usual: Usuals; filters: RaiseFilters; ranges: boolean }): string {
  const minFrom = `g."min" * ${bandScaleSql('xa.comp_from')}`;
  const minTo = `g."min" * ${bandScaleSql('xa.comp')}`;
  const range = o.ranges
    ? `(g."min" IS NOT NULL AND ${belowMinimumSql('xa.rate_from', minFrom, 'xa.grade_basis')}
        AND NOT ${belowMinimumSql('xa.rate', minTo, 'xa.grade_basis')} AND xa.rate <= ${minTo} * ${1 + AT_MINIMUM})`
    : 'FALSE';
  return `WITH cr AS (SELECT * FROM (${raisesOf(o)})),
    t AS (${oneSql(o.to)}),
    f AS (SELECT person_key, any_value(salary) rate_from, any_value(comp_basis) comp_from FROM salaries
          WHERE snapshot_id = ${sqlStr(o.from)} AND salary > 0 GROUP BY person_key HAVING count(*) = 1),
    xa AS (SELECT cr.person_key, cr.job_code, cr.pay_from, cr.pay_to, cr.r, t.fn, t.ln, t.title, t.school, t.department, t.cat,
                  t.rate, t.grade, t.grade_basis, t.comp, f.rate_from, f.comp_from, ${usualCaseSql(o.usual, 't.cat')} usual,
                  round(cr.r, 3) > ${usualCaseSql(o.usual, 't.cat')} above
           FROM cr JOIN t ON t.person_key = cr.person_key JOIN f ON f.person_key = cr.person_key),
    tt AS (SELECT job_code, count(*) tn, count(*) FILTER (WHERE above) tb, median(r) tmed FROM xa GROUP BY job_code),
    xe AS (SELECT xa.*, tt.tn, tt.tb, tt.tmed, coalesce(${range}, FALSE) by_range,
                  tt.tn >= ${PATTERN_MIN_N} AND 2 * tt.tb >= tt.tn AND abs(xa.r - tt.tmed) <= ${NEAR_TITLE} by_title
           FROM xa JOIN tt ON tt.job_code = xa.job_code
           ${o.ranges ? 'LEFT JOIN grades g ON g."grade" = xa.grade AND g."basis" = xa.grade_basis' : ''}),
    uu AS (SELECT school, department, count(*) un, count(*) FILTER (WHERE above) ub FROM xe
           WHERE NOT (above AND (by_range OR by_title)) GROUP BY school, department)
    SELECT xe.person_key, xe.fn, xe.ln, xe.title, xe.job_code, xe.school, xe.department, xe.cat, xe.pay_from, xe.pay_to, xe.r, xe.usual,
           xe.tn, xe.tb, xe.tmed, coalesce(uu.un, 0) un, coalesce(uu.ub, 0) ub,
           CASE WHEN xe.by_range THEN 'range'
                WHEN xe.by_title THEN 'title'
                WHEN uu.un >= ${PATTERN_MIN_N} AND 2 * uu.ub >= uu.un THEN 'unit'
                ELSE 'individual' END why
    FROM xe LEFT JOIN uu ON uu.school IS NOT DISTINCT FROM xe.school AND uu.department IS NOT DISTINCT FROM xe.department
    WHERE xe.above AND ${filterSql(o.filters, 'xe')}`;
}

export interface TitleChangeRow {
  person_key: string;
  fn: string | null;
  ln: string | null;
  title_from: string | null;
  title_to: string | null;
  code_from: string | null;
  code_to: string | null;
  pay_from: number;
  pay_to: number;
  /** The full-time rate each side: what a change of title did to pay, whatever the FTE did. */
  rate_from: number;
  rate_to: number;
  fte_from: number;
  fte_to: number;
  school: string | null;
  department: string | null;
}

/** Each person's paid appointments in a snapshot: how many, and (for one) which. */
function sideSql(o: { metric: Metric; snapshot: string; filters?: RaiseFilters }): string {
  return `SELECT person_key, count(*) k, any_value(job_code) job_code, any_value(title) title, any_value(${FTE_MULT}) fte,
      any_value(comp_basis) basis, any_value(${salaryExpr(o.metric)}) pay, any_value(salary) rate, any_value(school) school, any_value(department) department,
      any_value(first_name) fn, any_value(last_name) ln${o.filters ? `, bool_or(${filterSql(o.filters)}) inside` : ''}
    FROM salaries WHERE snapshot_id = ${sqlStr(o.snapshot)} AND salary > 0 GROUP BY person_key`;
}

/**
 * Everyone in the filter whose job code changed, with one paid appointment on each side — a promotion or a
 * reclassification, on the same footing as a continuing raise. Not a person's highest-paid appointment on each
 * side: for someone holding two, which one that is flips when their pays cross, and would show a change of
 * title that never happened.
 */
export function titleChangesSql(o: Pair & { filters: RaiseFilters }): string {
  // The earlier pay and rate on the later snapshot's footing, as a continuing raise has them (×11/9 across the
  // 9-month reporting change), so a change of title across it reads like for like.
  const f = reportingFactorSql('a.basis', 'b.basis');
  return `SELECT b.person_key, b.fn, b.ln, a.title title_from, b.title title_to, a.job_code code_from, b.job_code code_to,
      a.pay * ${f} pay_from, b.pay pay_to, a.rate * ${f} rate_from, b.rate rate_to, a.fte fte_from, b.fte fte_to, b.school, b.department
    FROM (${sideSql({ metric: o.metric, snapshot: o.from })}) a JOIN (${sideSql({ metric: o.metric, snapshot: o.to })}) b ON b.person_key = a.person_key
    WHERE a.k = 1 AND b.k = 1 AND a.job_code IS DISTINCT FROM b.job_code AND ${filterSql(o.filters, 'b')}`;
}

/** Everyone in the filter paid on both sides, by what the page can say of them. */
export interface Account {
  paid_both: number;
  /** In the same job: every continuing raise. */
  same_job: number;
  changed_title: number;
  /** More than one paid appointment on a side. */
  several: number;
  fte_changed: number;
  /** The same job at the same FTE, on a pay basis that cannot be compared (not the 9-month reporting change, a raise like for like). */
  basis_changed: number;
}

/**
 * The people paid on both sides, accounted for: every one is a continuing raise, a change of title, or not
 * compared for a reason given here, so no one leaves the page's count without saying why. In the filter by
 * where they are at the later snapshot — for someone with several appointments there, any of them.
 */
export function accountSql(o: Pair & { filters: RaiseFilters }): string {
  return `WITH a AS (${sideSql({ metric: o.metric, snapshot: o.from })}),
    b AS (${sideSql({ metric: o.metric, snapshot: o.to, filters: o.filters })}),
    cr AS (SELECT DISTINCT person_key pk FROM (${raisesOf(o)})),
    p AS (SELECT a.k ka, b.k kb, a.job_code ja, b.job_code jb, a.fte fa, b.fte fb, a.basis ba, b.basis bb, cr.pk IS NOT NULL raise
          FROM a JOIN b ON b.person_key = a.person_key LEFT JOIN cr ON cr.pk = a.person_key WHERE b.inside)
    SELECT count(*) paid_both,
      count(*) FILTER (WHERE raise) same_job,
      count(*) FILTER (WHERE NOT raise AND ka = 1 AND kb = 1 AND ja IS DISTINCT FROM jb) changed_title,
      count(*) FILTER (WHERE NOT raise AND (ka > 1 OR kb > 1)) several,
      count(*) FILTER (WHERE NOT raise AND ka = 1 AND kb = 1 AND ja = jb AND fa <> fb) fte_changed,
      count(*) FILTER (WHERE NOT raise AND ka = 1 AND kb = 1 AND ja = jb AND fa = fb AND NOT ${comparableSql('ba', 'bb')}) basis_changed
    FROM p`;
}

/** The filter's continuing raises in the site's 1% bins (lib/raiseBuckets). */
export function distributionSql(o: Pair & { filters: RaiseFilters }): string {
  return `SELECT ${raiseBucketSql('cr.r')} AS bucket, count(*) n FROM (${raisesOf(o)}) cr JOIN (${oneSql(o.to)}) t ON t.person_key = cr.person_key
    WHERE ${filterSql(o.filters, 't')} GROUP BY 1 ORDER BY 1`;
}

/** Points above the usual raise, printed: "+4.1 pts". */
export function fmtBeyond(r: number, usual: number): string {
  return `+${Math.max(0, (Math.round(r * 1000) - Math.round(usual * 1000)) / 10).toFixed(1)} pts`;
}
