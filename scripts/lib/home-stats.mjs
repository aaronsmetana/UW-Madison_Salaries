import zlib from 'node:zlib';
import duckdb from 'duckdb';
import { FTE_MULT_SQL, ACTUAL_PAY_SQL } from './normalize.mjs';

/** What home-stats.json may weigh gzipped. The landing page fetches it on every visit, before anything
 *  else can draw; the per-category counts behind the "By category" dots are most of it. */
export const HOME_STATS_BUDGET = 12 * 1024;

/** home-stats.json's bytes, compact — the per-$100 counts are thousands of small numbers, and pretty-
 *  printed each took a line of its own — refused over its gzipped budget rather than shipped. */
export function serializeHomeStats(stats) {
  const json = JSON.stringify(stats);
  const gz = zlib.gzipSync(json).length;
  if (gz > HOME_STATS_BUDGET) {
    throw new Error(`home-stats.json is ${gz} bytes gzipped, over its ${HOME_STATS_BUDGET}-byte budget — the landing page loads it on every visit`);
  }
  return { json, gz };
}

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

/**
 * One row per person with their summed actual pay — the population the landing figures describe.
 * The bins, quartiles and headline median used to count appointment rows (22,383) under a caption
 * about 22,009 employees; a person with two appointments was two points on the curve, at two partial
 * salaries. This is `peopleSql` in src/lib/queries.ts for the 'fte' metric, where both of personPay's
 * branches reduce to the sum of actual pay over paid appointments.
 */
const people = (src, snap) =>
  `(SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) AS pay FROM ${src} WHERE snapshot_id = '${snap}' GROUP BY person_key)`;

/**
 * The same people, each with one staff category: the category of their highest-paid appointment,
 * ties to the category's name. A dot on the landing page is a person at their total pay, so it can
 * wear one colour only — and 83 people hold appointments in two categories. The "Median pay by group"
 * fact is taken over this too, so the legend beside the dots and the fact can never disagree.
 */
const peopleByCategory = (src, snap) =>
  `(SELECT person_key, sum(rp) AS pay, first(cat ORDER BY rp DESC, cat) AS cat
    FROM (SELECT person_key, coalesce(employee_category, 'Other') AS cat, ${PAY} AS rp
          FROM ${src} WHERE snapshot_id = '${snap}' AND salary > 0)
    GROUP BY person_key)`;

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
                (SELECT min(pay) FROM ${people(src, snap)} WHERE pay > 0) AS lo,
                (SELECT max(pay) FROM ${people(src, snap)} WHERE pay > 0) AS hi
         FROM ${src} WHERE snapshot_id = '${snap}'`
      );
      // The histogram is capped so one $3M outlier can't flatten the whole curve into the baseline.
      // The cap is reported (not silently applied): BIN_CAP and the overflow count travel with the
      // data so the landing page can label the last bin as "and N above" instead of quietly dropping
      // the top tail while its axis still claims to show the distribution.
      const bins = await run(
        `SELECT floor(pay / ${BIN_W}) * ${BIN_W} AS bucket, count(*) AS n FROM ${people(src, snap)}
         WHERE pay > 0 AND pay < ${BIN_CAP} GROUP BY bucket ORDER BY bucket`
      );
      // Everyone under the cap as a count per $100 of pay, floored — what the landing page draws one
      // dot per person from. Floored, not rounded: rounding would move a $59,960 earner into the $60k
      // bin, and re-binned by $1k these counts must be bins exactly. ~2,500 small numbers; ~3 KB
      // gzipped.
      const per100 = await run(
        `SELECT floor(pay / 100) AS b, count(*) AS n FROM ${people(src, snap)}
         WHERE pay > 0 AND pay < ${BIN_CAP} GROUP BY b ORDER BY b`
      );
      // The same counts split by category (peopleByCategory), for the "By category" dots — plus each
      // category's headcount, median and count at or above the cap, over everyone paid (as the
      // headline is), not only the people under the cap.
      const per100Cat = await run(
        `SELECT cat, floor(pay / 100) AS b, count(*) AS n FROM ${peopleByCategory(src, snap)}
         WHERE pay > 0 AND pay < ${BIN_CAP} GROUP BY cat, b ORDER BY cat, b`
      );
      const catRows = await run(
        `SELECT cat, count(*) AS n, median(pay) AS med, count(*) FILTER (WHERE pay >= ${BIN_CAP}) AS over
         FROM ${peopleByCategory(src, snap)} WHERE pay > 0 GROUP BY cat ORDER BY n DESC, cat`
      );
      const [overflowRow] = await run(
        `SELECT count(*) AS n FROM ${people(src, snap)} WHERE pay >= ${BIN_CAP}`
      );
      // Quartiles over the same people the bins describe, so the markers the landing chart draws sit
      // on its own curve, and p50 is the headline median.
      const [quartRow] = await run(
        `SELECT quantile_cont(pay, 0.25) AS p25, quantile_cont(pay, 0.5) AS p50,
                quantile_cont(pay, 0.75) AS p75
         FROM ${people(src, snap)} WHERE pay > 0`
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
            SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) AS pay,
                   any_value(date_of_hire) AS doh, any_value(snapshot_date) AS sd
            FROM ${src} WHERE snapshot_id = '${snap}' GROUP BY person_key)
         SELECT quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) AS p90,
                median(date_diff('day', CAST(doh AS DATE), CAST(sd AS DATE)) / 365.25) FILTER (WHERE doh IS NOT NULL) AS tenure
         FROM p`
      );
      // The three largest categories and their medians, each person once, at their total actual pay, in
      // the category of their highest-paid appointment — the rule the "By category" dots use.
      const byCat = catRows.filter((c) => c.cat !== 'Other').slice(0, 3);

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
          pay_counts: (() => {
            if (!per100.length) return null;
            const lo100 = toNum(per100[0].b);
            const counts = new Array(toNum(per100[per100.length - 1].b) - lo100 + 1).fill(0);
            for (const r of per100) counts[toNum(r.b) - lo100] = toNum(r.n);
            // In stacking order, the largest category first (at the bottom of every column). Each
            // category's counts sit on the same $100 grid, and bin by bin they sum to `counts`.
            const categories = catRows.map((c) => {
              const own = new Array(counts.length).fill(0);
              for (const r of per100Cat) if (r.cat === c.cat) own[toNum(r.b) - lo100] = toNum(r.n);
              return { name: c.cat, n: toNum(c.n), median: toNum(c.med), over: toNum(c.over), counts: own };
            });
            return { lo100, counts, categories };
          })(),
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
