import duckdb from 'duckdb';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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

/**
 * The official ranges the app loads (public/data/grades.json), as a SQL relation `(grade, basis, mn, mx)`
 * — ranges only: a grade published with a minimum and no maximum has no midpoint to read against.
 */
export function rangesSql(): string {
  const all: { grade: number; basis: string; min: number; max: number | null }[] = JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/data/grades.json', import.meta.url)), 'utf8')
  );
  const rows = all.filter((g) => g.max != null && g.max > g.min).map((g) => `(${g.grade}, '${g.basis}', ${g.min}, ${g.max})`);
  return `(SELECT * FROM (VALUES ${rows.join(', ')}) t(grade, basis, mn, mx))`;
}

/**
 * Of a person's paid appointments that carry a grade, the one that pays them most — its grade, schedule,
 * full-time rate and `comp_basis` (which says the units the rate was reported in), from that one row; ties
 * to the higher rate. A pay band is a range of full-time rates, so this is what one is read against. Use in
 * a `GROUP BY person_key`.
 */
export const GRADED = `arg_max({grade: grade_number, basis: grade_basis, rate: salary, comp: comp_basis}, {p: ${PAY}, r: salary, g: grade_number}) FILTER (WHERE salary > 0 AND grade_number IS NOT NULL)`;

/**
 * Who the search box finds for `q` (two letters or more): everyone whose name, in any snapshot, contains
 * it, each named and dated by the latest snapshot their name matched in. Restated from the rule:
 * - `rel`, how well the name matches: 0, a first, last or whole name that is the query; 1, a whole name
 *   (first name first) that starts with it; 2, a last name that starts with it; 3, one that contains it;
 * - `here`, whether they are in the latest snapshot.
 */
function searchHitsSql(q: string) {
  const s = q.toLowerCase().replace(/'/g, "''");
  return `SELECT person_key, fn, ln, last_date >= (SELECT max(snapshot_date) FROM $SAL) here,
      CASE WHEN lower(fn) = '${s}' OR lower(ln) = '${s}' OR lower(fn || ' ' || ln) = '${s}' THEN 0
           WHEN lower(fn || ' ' || ln) LIKE '${s}%' THEN 1
           WHEN lower(ln) LIKE '${s}%' THEN 2 ELSE 3 END rel
    FROM (SELECT person_key, arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln, max(snapshot_date) last_date
          FROM $SAL WHERE contains(lower(first_name || ' ' || last_name), '${s}') GROUP BY person_key)`;
}

/** The people the search lists for `q`, in its order: the best matches first, within those people still
 *  here before people who have left, then by last name and first. */
export async function searchOrder(q: string): Promise<{ person_key: string; fn: string; ln: string; here: boolean; rel: number }[]> {
  return oracle(`SELECT * FROM (${searchHitsSql(q)}) ORDER BY rel, NOT here, lower(ln), lower(fn), person_key`);
}

/** How many people the search finds for `q`, and how many of them are still here. */
export async function searchCounts(q: string): Promise<{ total: number; here: number }> {
  const [r] = await oracle<{ total: number; here: number }>(`SELECT count(*) total, count(*) FILTER (WHERE here) here FROM (${searchHitsSql(q)})`);
  return r;
}
