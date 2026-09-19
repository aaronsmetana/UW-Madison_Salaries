import { sqlStr } from './duckdb';
import { ACTUAL_PAY } from './queries';

/**
 * Who the landing page's dots are. The page draws one anonymous dot per person from `home-stats.json`'s
 * counts per $100 of pay (lib/dotLayout `peopleFromCounts`) and loads no database; once a reader has
 * DuckDB up (the search boots it), these name the dots.
 */

/** A person as the landing page counts them: their total actual pay over their paid appointments, in the
 *  category of their highest-paid appointment. */
export interface HomePerson {
  person_key: string;
  pay: number | null;
  cat: string;
}

/**
 * Everyone in `snapshot` as the landing page counts them — the client twin of `peopleByCategory` in
 * scripts/lib/home-stats.mjs, which built the counts the dots are drawn from. The two must agree person
 * for person, or a mark lands on someone else's dot; an e2e oracle rebuilds the shipped counts from this.
 */
export function homePeopleSql(snapshot: string): string {
  return `SELECT person_key, sum(rp) AS pay, first(cat ORDER BY rp DESC, cat) AS cat
    FROM (SELECT person_key, coalesce(employee_category, 'Other') AS cat, ${ACTUAL_PAY} AS rp
          FROM salaries WHERE snapshot_id = ${sqlStr(snapshot)} AND salary > 0)
    GROUP BY person_key`;
}

/** The counts the landing dots are drawn from (`HomeStats['pay_counts']`). */
export interface PayCounts {
  lo100: number;
  counts: readonly number[];
  categories?: readonly { name: string; over: number; counts: readonly number[] }[] | null;
}

/** Where a person's dot is: under the curve (`main`) or in the pile past the cap, and its index there. */
export interface DotSpot {
  field: 'main' | 'pile';
  index: number;
}

/**
 * Each person's dot. Under the cap, `peopleFromCounts` lays a $100's people out bucket by bucket, each
 * bucket's categories in their stacking order; the pile (Home's `pile`) takes each category's people over
 * the cap as a block, in the same order. Within a bucket's category, or a category's block, the dots are
 * alike, so people take them by pay and then by key — the same every time.
 *
 * Null when `people` are not exactly the people the counts describe — a count per bucket and category, or
 * per category over the cap, that they do not fill — so a mark can never land on the wrong dot.
 */
export function dotSpots(people: readonly HomePerson[], pc: PayCounts, cap: number): Map<string, DotSpot> | null {
  const cats = pc.categories;
  if (!cats?.length) return null;
  const C = cats.length, B = pc.counts.length;
  const catOf = new Map(cats.map((c, i) => [c.name, i]));
  const under = new Map<number, { key: string; pay: number }[]>();
  const over: { key: string; pay: number }[][] = cats.map(() => []);
  let nUnder = 0, nOver = 0;
  for (const p of people) {
    if (p.pay == null || !(p.pay > 0)) continue;
    const c = catOf.get(p.cat);
    if (c == null) return null;
    if (p.pay >= cap) { over[c].push({ key: p.person_key, pay: p.pay }); nOver++; continue; }
    const b = Math.floor(p.pay / 100) - pc.lo100;
    if (b < 0 || b >= B) return null;
    const g = b * C + c;
    let list = under.get(g);
    if (!list) under.set(g, (list = []));
    list.push({ key: p.person_key, pay: p.pay });
    nUnder++;
  }
  let total = 0;
  for (const n of pc.counts) total += n;
  const overTotal = cats.reduce((t, c) => t + c.over, 0);
  if (nUnder !== total || nOver !== overTotal) return null;
  const byPay = (a: { key: string; pay: number }, b: { key: string; pay: number }) => a.pay - b.pay || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const base = new Int32Array(B + 1);
  for (let b = 0; b < B; b++) base[b + 1] = base[b] + pc.counts[b];
  const out = new Map<string, DotSpot>();
  for (const [g, list] of under) {
    const b = Math.floor(g / C), c = g % C;
    if (list.length !== (cats[c].counts[b] ?? 0)) return null;
    let at = base[b];
    for (let k = 0; k < c; k++) at += cats[k].counts[b] ?? 0;
    list.sort(byPay);
    list.forEach((p, r) => out.set(p.key, { field: 'main', index: at + r }));
  }
  let at = 0;
  for (let c = 0; c < C; c++) {
    if (over[c].length !== cats[c].over) return null;
    over[c].sort(byPay);
    over[c].forEach((p, r) => out.set(p.key, { field: 'pile', index: at + r }));
    at += cats[c].over;
  }
  return out;
}

/** A filter on the graph: a title, a school, or a title within a school. */
export interface GraphFilter {
  jobCode?: string;
  school?: string;
}

/**
 * The people a filter covers, at their dots' pay. Anyone with a paid appointment in `snapshot` with that
 * job code, in that school, or — with both — both in the one appointment: "Research Associates in the
 * School of Medicine" are people who are a Research Associate there, not a Research Associate somewhere
 * and something else there. Paid appointments only, the rows the dots are drawn from (`homePeopleSql`),
 * and the pay is the dot's — every paid appointment summed — rather than the matching one's, because it is
 * the dot that gets lit and the dot that stands at that pay.
 */
export function filterPeopleSql(snapshot: string, f: GraphFilter): string {
  const conds = [
    f.jobCode != null ? `job_code = ${sqlStr(f.jobCode)}` : null,
    f.school != null ? `school = ${sqlStr(f.school)}` : null,
  ].filter((c): c is string => c != null);
  if (!conds.length) throw new Error('filterPeopleSql: a filter with neither a title nor a school');
  return `WITH dots AS (${homePeopleSql(snapshot)}),
    hit AS (SELECT DISTINCT person_key FROM salaries
            WHERE snapshot_id = ${sqlStr(snapshot)} AND salary > 0 AND ${conds.join(' AND ')})
    SELECT person_key, pay FROM dots JOIN hit USING (person_key) WHERE pay > 0 ORDER BY person_key`;
}

/** The continuous median of values already in ascending order — DuckDB's `quantile_cont(x, 0.5)`. */
export function medianOf(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** What a filter lights on the graph. */
export interface Emphasis {
  /** One per dot under the curve: 1 for a dot that dims, 0 for one of the group. */
  main: Uint8Array;
  /** The same for the pile past the cap. */
  pile: Uint8Array;
  /** How many of the group have a dot. */
  count: number;
  /** Their median pay, the continuous one the campus median is (`quantile_cont(pay, 0.5)` in
   *  scripts/lib/home-stats.mjs), so "N% below campus" compares like with like. */
  median: number | null;
  /** Their pays, ascending — the group's curve is drawn from these. */
  pays: number[];
}

/**
 * The masks for both fields, from the group's people and where their dots are (`dotSpots`). A person with
 * no dot — not in the counts the field was drawn from — lights nothing and is not counted, so the count
 * and the median describe exactly what is lit.
 */
export function emphasis(
  spots: ReadonlyMap<string, DotSpot>,
  people: readonly { person_key: string; pay: number }[],
  sizes: { main: number; pile: number },
): Emphasis {
  const main = new Uint8Array(sizes.main).fill(1);
  const pile = new Uint8Array(sizes.pile).fill(1);
  const pays: number[] = [];
  for (const p of people) {
    const at = spots.get(p.person_key);
    if (!at) continue;
    const mask = at.field === 'main' ? main : pile;
    if (!(at.index >= 0 && at.index < mask.length) || mask[at.index] === 0) continue;
    mask[at.index] = 0;
    pays.push(p.pay);
  }
  pays.sort((a, b) => a - b);
  return { main, pile, count: pays.length, median: medianOf(pays), pays };
}

/**
 * A school's largest titles, by people with a paid appointment of that title in the school — the rows a
 * filter covers, so a title offered here is one that lights someone when put on beside the school.
 */
export function topTitlesInSql(snapshot: string, school: string, limit = 5): string {
  return `SELECT job_code AS code, count(DISTINCT person_key) AS n FROM salaries
    WHERE snapshot_id = ${sqlStr(snapshot)} AND salary > 0 AND school = ${sqlStr(school)}
    GROUP BY job_code ORDER BY n DESC, job_code LIMIT ${Math.max(1, Math.floor(limit))}`;
}

/** The schools that employ most of a title, by people paid in it there — the same rows again. */
export function topSchoolsForSql(snapshot: string, jobCode: string, limit = 4): string {
  return `SELECT school, count(DISTINCT person_key) AS n FROM salaries
    WHERE snapshot_id = ${sqlStr(snapshot)} AND salary > 0 AND job_code = ${sqlStr(jobCode)} AND school IS NOT NULL
    GROUP BY school ORDER BY n DESC, school LIMIT ${Math.max(1, Math.floor(limit))}`;
}
