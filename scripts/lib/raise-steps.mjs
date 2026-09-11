import duckdb from 'duckdb';
import { FTE_MULT_SQL, ACTUAL_PAY_SQL } from './normalize.mjs';

/**
 * Every step's continuing raises, campus-wide, for each pay measure — shipped as
 * public/data/raise-steps.json so a person's page can say how a raise compares ("larger than 99% ·
 * typical +4.0%") and draw the "if raises had been typical" line without scanning every raise on
 * campus in the browser, which measured ~330ms in DuckDB-WASM against a 300ms budget.
 *
 * The definition is `continuingRaisesSql` in src/lib/queries.ts, restated here in the build's own
 * SQL: one paid appointment on each side of consecutive canonical snapshots (the pre-TTC twin
 * dropped), the same job code, the same FTE, and a pay basis that is the same quantity — unknown on
 * either side counts, Annual → 12 Month is a relabel, Academic → 9 Month is the Sep 2025 reporting
 * change and never a raise. scripts/raise-steps.test.mjs runs both over one fixture and requires the
 * same answer, so the two cannot drift apart unnoticed.
 */

const METRIC_SQL = { fte: ACTUAL_PAY_SQL, full: 'salary', base: 'COALESCE(base_pay, salary)' };
/** Mirrors BASIS_CLASSES in src/lib/queries.ts. */
const BASIS_CLASSES = [['annual', '12 month'], ['academic', '9 month']];
/** Mirrors REPORTING_CHANGES in src/lib/queries.ts (earlier → later). */
const REPORTING = [['academic', '9 month']];
/** The histogram's resolution: raises rounded to 0.1%, the precision the app prints them at. */
export const HIST_STEP = 0.001;
/** Tails are lumped into the end bins: −50% and +100% bound every comparison anyone reads. */
const HIST_MIN = -500;
const HIST_MAX = 1000;

const cls = (c) =>
  `(CASE lower(trim(${c})) ${BASIS_CLASSES.flatMap((k) => k.map((l) => `WHEN '${l}' THEN '${k[k.length - 1]}'`)).join(' ')} ELSE lower(trim(${c})) END)`;
const sameQuantity = (a, b) =>
  `((${a} IS NULL OR trim(${a}) = '' OR ${b} IS NULL OR trim(${b}) = '' OR ${cls(a)} = ${cls(b)}) AND NOT coalesce(${REPORTING.map(
    ([f, t]) => `(lower(trim(${a})) = '${f}' AND lower(trim(${b})) = '${t}')`
  ).join(' OR ')}, FALSE))`;

/** Every continuing raise over `src` (a table or read_parquet(...)), for one pay measure. */
export function continuingRaisesQuery(src, metric) {
  const pay = METRIC_SQL[metric];
  return `WITH snaps AS (
      SELECT snapshot_id, CAST(min(snapshot_date) AS VARCHAR) d,
             row_number() OVER (ORDER BY min(snapshot_date), snapshot_id) i
      FROM ${src} WHERE snapshot_id NOT LIKE '%-pre' GROUP BY snapshot_id),
    one AS (
      SELECT snapshot_id, person_key, any_value(job_code) job, any_value(${FTE_MULT_SQL}) f,
             any_value(comp_basis) b, any_value(${pay}) pay
      FROM ${src} WHERE salary > 0 GROUP BY snapshot_id, person_key HAVING count(*) = 1)
    SELECT a.snapshot_id from_id, b.snapshot_id to_id, sa.d from_date, sb.d to_date, b.pay / a.pay - 1 r
    FROM one a JOIN snaps sa USING (snapshot_id)
    JOIN one b ON b.person_key = a.person_key AND b.job = a.job AND b.f = a.f
    JOIN snaps sb ON sb.snapshot_id = b.snapshot_id AND sb.i = sa.i + 1
    WHERE a.job IS NOT NULL AND a.pay > 0 AND b.pay > 0 AND ${sameQuantity('a.b', 'b.b')}`;
}

/** Per step: n, median, p90. */
export function raiseStepsQuery(src, metric) {
  return `SELECT from_id, to_id, any_value(from_date) from_date, any_value(to_date) to_date,
      count(*) n, median(r) med, quantile_cont(r, 0.9) p90
    FROM (${continuingRaisesQuery(src, metric)}) GROUP BY from_id, to_id ORDER BY from_date`;
}

/** Per step: a histogram of raises in 0.1% bins, tails lumped into the end bins. */
export function raiseHistQuery(src, metric) {
  return `SELECT from_id, least(greatest(CAST(round(r / ${HIST_STEP}) AS INTEGER), ${HIST_MIN}), ${HIST_MAX}) k, count(*) c
    FROM (${continuingRaisesQuery(src, metric)}) GROUP BY 1, 2 ORDER BY 1, 2`;
}

/** BIGINT counts arrive as bigint; the JSON wants numbers. */
const numbers = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
const all = (db, sql) =>
  new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows.map(numbers))));
  });

/** raise-steps.json: { hist_step, metrics: { fte|full|base: [{ from_id, to_id, from_date, to_date, n, med, p90, hist: [[k, c], …] }] } } */
export async function computeRaiseSteps(parquetPath) {
  const db = new duckdb.Database(':memory:');
  const src = `read_parquet('${parquetPath.replace(/'/g, "''")}')`;
  try {
    const metrics = {};
    for (const metric of Object.keys(METRIC_SQL)) {
      const steps = await all(db, raiseStepsQuery(src, metric));
      const hist = await all(db, raiseHistQuery(src, metric));
      metrics[metric] = steps.map((s) => ({
        ...s,
        med: s.med == null ? null : Math.round(s.med * 1e6) / 1e6,
        p90: s.p90 == null ? null : Math.round(s.p90 * 1e6) / 1e6,
        hist: hist.filter((h) => h.from_id === s.from_id).map((h) => [h.k, h.c]),
      }));
    }
    return { hist_step: HIST_STEP, metrics };
  } finally {
    db.close();
  }
}
