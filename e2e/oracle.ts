import duckdb from 'duckdb';
import { fileURLToPath } from 'node:url';

/**
 * Expected values for data-dependent assertions, computed in the test process straight from the
 * parquet the preview serves, with SQL written here rather than imported from the app.
 *
 * A test that hard-codes "439" is only true until the next data build; a test that imports the app's
 * own query builder can only ever agree with it. This is neither: an independent statement of the
 * rule, run against the same file. In SQL below, `$SAL` is the parquet.
 */
const PARQUET = fileURLToPath(new URL('../public/data/salaries.parquet', import.meta.url));

let db: duckdb.Database | null = null;

export function oracle<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  db ??= new duckdb.Database(':memory:');
  const q = sql.replaceAll('$SAL', `read_parquet('${PARQUET.replace(/'/g, "''")}')`);
  return new Promise((resolve, reject) =>
    db!.all(q, (err: Error | null, rows: Record<string, unknown>[]) => {
      if (err) return reject(err);
      // BIGINT counts arrive as bigint; every assertion here compares numbers.
      resolve(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))) as T[]);
    })
  );
}

/** Actual pay for one appointment row: the reported FTE-adjusted figure, else rate × FTE, where a
 *  zero means "not recorded" in both columns. Stated independently of src/lib/queries.ts. */
export const PAY = 'coalesce(nullif(salary_fte_adjusted, 0), salary * coalesce(nullif(fte, 0), 1))';

/** The latest snapshot id in the data. */
export async function latestSnapshot(): Promise<string> {
  const [r] = await oracle<{ id: string }>('SELECT snapshot_id id FROM $SAL ORDER BY snapshot_date DESC, snapshot_id DESC LIMIT 1');
  return r.id;
}

/** A person's pay the way a reader would see it formatted: "$76,694". */
export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
