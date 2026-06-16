import type { AsyncDuckDB, DuckDBBundles } from '@duckdb/duckdb-wasm';
// Self-hosted bundles (no CDN): Vite emits these as hashed assets.
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let dbPromise: Promise<AsyncDuckDB> | null = null;

async function initDB(): Promise<AsyncDuckDB> {
  if (typeof WebAssembly === 'undefined') {
    throw new Error('This browser does not support WebAssembly, which this dashboard requires.');
  }
  // Dynamic import keeps the ~hundreds-of-KB DuckDB-WASM JS out of the initial bundle.
  const duckdb = await import('@duckdb/duckdb-wasm');
  // Non-threaded bundles (mvp/eh) — no COOP/COEP headers needed (GitHub Pages can't set them).
  const bundles: DuckDBBundles = {
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const url = `${import.meta.env.BASE_URL}data/salaries.parquet`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load salary data (HTTP ${resp.status})`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  await db.registerFileBuffer('salaries.parquet', buf);

  const conn = await db.connect();
  // Expose DATE columns as ISO 'YYYY-MM-DD' strings: DuckDB-WASM hands raw DATE
  // values to JS as non-strings, which breaks string ops (sorting, new Date()).
  // SQL date functions still work via CAST(... AS DATE); ordering stays chronological.
  await conn.query(
    `CREATE VIEW salaries AS SELECT * REPLACE (
       CAST(snapshot_date AS VARCHAR) AS snapshot_date,
       CAST(date_of_hire AS VARCHAR) AS date_of_hire
     ) FROM parquet_scan('salaries.parquet')`
  );

  // Optional pay-band reference table (grade → range). Empty if not provided.
  await conn.query(`CREATE TABLE grades("grade" INTEGER, "basis" VARCHAR, "min" DOUBLE, "max" DOUBLE, effective_year INTEGER)`);
  try {
    const gr = await fetch(`${import.meta.env.BASE_URL}data/grades.json`);
    if (gr.ok) {
      const text = await gr.text();
      if (text.trim() && text.trim() !== '[]') {
        await db.registerFileText('grades.json', text);
        await conn.query(
          `INSERT INTO grades SELECT "grade", "basis", "min", "max", effective_year FROM read_json_auto('grades.json')`
        );
      }
    }
  } catch {
    /* grades are optional — pay-band just shows "no published range" */
  }

  await conn.close();
  return db;
}

/** Lazily instantiate DuckDB-WASM + load the Parquet (once). */
export function getDB(): Promise<AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDB();
  return dbPromise;
}

/** Run SQL, returning plain row objects (BigInt counts coerced to numbers). */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const db = await getDB();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((row: { toJSON: () => Record<string, unknown> }) => {
      const obj = row.toJSON();
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'bigint') obj[k] = Number(obj[k]);
      }
      return obj as T;
    });
  } finally {
    await conn.close();
  }
}

/** Escape a string literal for inline SQL. */
export const sqlStr = (s: string): string => `'${String(s).replace(/'/g, "''")}'`;
