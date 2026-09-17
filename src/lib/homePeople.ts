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
