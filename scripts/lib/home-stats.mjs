import duckdb from 'duckdb';

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
        `SELECT sum(salary * COALESCE(fte, 1)) AS total FROM ${src} WHERE snapshot_id = '${snap}' AND salary > 0`
      );
      const [dimsRow] = await run(
        `SELECT count(DISTINCT school) AS schools, count(DISTINCT job_code) AS titles,
                min(salary) FILTER (WHERE salary > 0) AS lo, max(salary) FILTER (WHERE salary > 0) AS hi
         FROM ${src} WHERE snapshot_id = '${snap}'`
      );
      const bins = await run(
        `SELECT floor(salary / 10000) * 10000 AS bucket, count(*) AS n FROM ${src}
         WHERE snapshot_id = '${snap}' AND salary > 0 AND salary < 250000 GROUP BY bucket ORDER BY bucket`
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
