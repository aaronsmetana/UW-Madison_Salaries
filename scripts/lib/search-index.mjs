import zlib from 'node:zlib';
import duckdb from 'duckdb';
import { ACTUAL_PAY_SQL } from './normalize.mjs';

/**
 * Gzipped bytes the search index may cost. The landing page autofocuses its search, so the index
 * loads with the page — it is paid for by every visitor, most of whom never type.
 */
export const SEARCH_INDEX_BUDGET = 30 * 1024;

/**
 * One row per person per group, at their pay in that group — `peopleSql` in src/lib/queries.ts for
 * the 'fte' metric, where both of personPay's branches reduce to the sum of actual pay over paid
 * appointments.
 */
const people = (src, snap, col) =>
  `SELECT ${col}, person_key, min(title) title, sum(${ACTUAL_PAY_SQL}) FILTER (WHERE salary > 0) pay
   FROM ${src} WHERE snapshot_id = '${snap}' AND ${col} IS NOT NULL GROUP BY ${col}, person_key`;

/**
 * Every title held in the snapshot: its job code, its most common name, headcount and median, as the
 * title page states them. Ties are broken by name, never by scan order, so the same data builds the
 * same file — `mode()` and `any_value()` picked a different spelling from run to run.
 */
export const titlesQuery = (src, snap) =>
  `WITH pe AS (${people(src, snap, 'job_code')}),
        spellings AS (SELECT job_code, title, count(*) c FROM pe WHERE title IS NOT NULL GROUP BY job_code, title),
        named AS (SELECT job_code, first(title ORDER BY c DESC, title) title FROM spellings GROUP BY job_code)
   SELECT job_code code, any_value(named.title) title, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med
   FROM pe LEFT JOIN named USING (job_code)
   GROUP BY job_code HAVING count(*) FILTER (WHERE pay > 0) > 0 ORDER BY n DESC, code`;

/** Every division in the snapshot, with the headcount and median the Divisions table gives it. */
export const divisionsQuery = (src, snap) =>
  `WITH pe AS (${people(src, snap, 'school')})
   SELECT school, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med
   FROM pe GROUP BY school HAVING count(*) FILTER (WHERE pay > 0) > 0 ORDER BY n DESC, school`;

/**
 * What search can offer before the database loads: titles and divisions in the latest snapshot, as
 * compact rows — `[code, title, headcount, median]` and `[division, headcount, median]`.
 */
export function computeSearchIndex(parquetPath, latest) {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const con = db.connect();
    const src = `read_parquet('${String(parquetPath).replace(/'/g, "''")}')`;
    const snap = String(latest.snapshot_id).replace(/'/g, "''");
    const run = (sql) => new Promise((res, rej) => con.all(sql, (err, rows) => (err ? rej(err) : res(rows))));
    const usd = (v) => (v == null ? null : Math.round(Number(v)));
    (async () => {
      const titles = await run(titlesQuery(src, snap));
      const divisions = await run(divisionsQuery(src, snap));
      return {
        snapshot: latest.snapshot_id,
        label: latest.snapshot_label,
        titles: titles.map((r) => [r.code, r.title, Number(r.n), usd(r.med)]),
        divisions: divisions.map((r) => [r.school, Number(r.n), usd(r.med)]),
      };
    })()
      .then(resolve, reject)
      .finally(() => db.close());
  });
}

/** The index as shipped, refused when it would cost the landing page more than its budget. */
export function serializeSearchIndex(index) {
  const json = JSON.stringify(index);
  const gz = zlib.gzipSync(json).length;
  if (gz > SEARCH_INDEX_BUDGET) {
    throw new Error(`search-index.json is ${gz} bytes gzipped, over its ${SEARCH_INDEX_BUDGET}-byte budget — the landing page loads it on every visit`);
  }
  return { json, gz };
}
