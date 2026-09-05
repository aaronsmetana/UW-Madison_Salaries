import duckdb from 'duckdb';
import { FTE_MULT_SQL, ACTUAL_PAY_SQL } from './normalize.mjs';

/** Upper edge of the landing-page histogram, in dollars. Salaries at or above this are counted into
 *  `bins_overflow` rather than binned, so a handful of extreme outliers don't compress the bars that
 *  describe where almost everyone actually sits. */
const BIN_CAP = 250000;

/** Width of one histogram bucket, in dollars.
 *
 *  It was $10k, which is 25 points across a ~880px chart — a vertex every 35px, so the "curve" was a
 *  visibly faceted polyline that flattened the two features actually in the distribution (the
 *  University Staff shoulder near $57k and the step near $130k where the faculty tail begins) into
 *  straight runs. $1k resolves both. It is not drawn raw: at this width the round-number comb that
 *  payroll data carries dominates, so `smoothBins` in src/lib/distribution.ts estimates a density
 *  from these counts before anything is plotted. The counts shipped here stay raw. */
const BIN_W = 1000;

/** The measure the landing page describes, matching `earningsExpr('fte')` in src/lib/queries.ts and
 *  the manifest's own `salary_median` (build-data.mjs) — i.e. "Actual pay", the app's default metric.
 *  It has to be the same expression the headline median is computed from: the bins used the raw
 *  full-time rate while the median came from FTE-adjusted pay, so the landing chart was drawing its
 *  median marker ~$5k off, on a curve built from a different quantity. */
const PAY = ACTUAL_PAY_SQL;

// Mirrors the six useSql queries in src/routes/Home.tsx so the landing page can render from a
// ~2KB static JSON instead of booting DuckDB-WASM + downloading the full parquet.
export function computeHomeStats(parquetPath, latestSnapshotId) {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const con = db.connect();
    const esc = (s) => String(s).replace(/'/g, "''");
    const src = `read_parquet('${esc(parquetPath)}')`;
    const snap = esc(latestSnapshotId);
    const run = (sql) => new Promise((res, rej) => con.all(sql, (err, rows) => (err ? rej(err) : res(rows))));
    const toNum = (v) => (v == null ? null : Number(v));

    (async () => {
      const [payrollRow] = await run(
        `SELECT sum(salary * ${FTE_MULT_SQL}) AS total FROM ${src} WHERE snapshot_id = '${snap}' AND salary > 0`
      );
      const [dimsRow] = await run(
        `SELECT count(DISTINCT school) AS schools, count(DISTINCT job_code) AS titles,
                min(salary) FILTER (WHERE salary > 0) AS lo, max(salary) FILTER (WHERE salary > 0) AS hi
         FROM ${src} WHERE snapshot_id = '${snap}'`
      );
      // The histogram is capped so one $3M outlier can't flatten the whole curve into the baseline.
      // The cap is reported (not silently applied): BIN_CAP and the overflow count travel with the
      // data so the landing page can label the last bin as "and N above" instead of quietly dropping
      // the top tail while its axis still claims to show the distribution.
      const bins = await run(
        `SELECT floor(${PAY} / ${BIN_W}) * ${BIN_W} AS bucket, count(*) AS n FROM ${src}
         WHERE snapshot_id = '${snap}' AND ${PAY} > 0 AND ${PAY} < ${BIN_CAP} GROUP BY bucket ORDER BY bucket`
      );
      const [overflowRow] = await run(
        `SELECT count(*) AS n FROM ${src} WHERE snapshot_id = '${snap}' AND ${PAY} >= ${BIN_CAP}`
      );
      // Quartiles over the same population the bins describe (per appointment, positive salary), so
      // the markers the landing chart draws sit on its own curve rather than on a different one.
      const [quartRow] = await run(
        `SELECT quantile_cont(${PAY}, 0.25) AS p25, quantile_cont(${PAY}, 0.5) AS p50,
                quantile_cont(${PAY}, 0.75) AS p75
         FROM ${src} WHERE snapshot_id = '${snap}' AND ${PAY} > 0`
      );
      const [titleTop] = await run(
        `SELECT title, count(*) AS n FROM ${src} WHERE snapshot_id = '${snap}' AND title IS NOT NULL
         GROUP BY title ORDER BY n DESC LIMIT 1`
      );
      const [divTop] = await run(
        `SELECT school, count(*) AS n FROM ${src} WHERE snapshot_id = '${snap}' AND school IS NOT NULL
         GROUP BY school ORDER BY n DESC LIMIT 1`
      );
      const [factRow] = await run(
        `WITH p AS (
            SELECT person_key, sum(salary) FILTER (WHERE salary > 0) AS pay,
                   any_value(date_of_hire) AS doh, any_value(snapshot_date) AS sd
            FROM ${src} WHERE snapshot_id = '${snap}' GROUP BY person_key)
         SELECT quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) AS p90,
                median(date_diff('day', CAST(doh AS DATE), CAST(sd AS DATE)) / 365.25) FILTER (WHERE doh IS NOT NULL) AS tenure
         FROM p`
      );
      const byCat = await run(
        `SELECT employee_category AS cat, median(salary) FILTER (WHERE salary > 0) AS med, count(*) AS n
         FROM ${src} WHERE snapshot_id = '${snap}' AND employee_category IS NOT NULL
         GROUP BY employee_category ORDER BY n DESC LIMIT 3`
      );

      con.close();
      db.close(() => {
        resolve({
          snapshot_id: latestSnapshotId,
          payroll_total: toNum(payrollRow?.total),
          schools: toNum(dimsRow?.schools),
          titles: toNum(dimsRow?.titles),
          salary_lo: toNum(dimsRow?.lo),
          salary_hi: toNum(dimsRow?.hi),
          bins: bins.map((b) => ({ bucket: toNum(b.bucket), n: toNum(b.n) })),
          bin_cap: BIN_CAP,
          bins_overflow: toNum(overflowRow?.n) ?? 0,
          p25: toNum(quartRow?.p25),
          p50: toNum(quartRow?.p50),
          p75: toNum(quartRow?.p75),
          top_title: titleTop ? { title: titleTop.title, n: toNum(titleTop.n) } : null,
          top_division: divTop ? { school: divTop.school, n: toNum(divTop.n) } : null,
          p90: toNum(factRow?.p90),
          median_tenure_years: toNum(factRow?.tenure),
          category_medians: byCat.map((c) => ({ category: c.cat, median: toNum(c.med) })),
        });
      });
    })().catch(reject);
  });
}
