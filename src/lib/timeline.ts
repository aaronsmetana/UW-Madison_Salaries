import { COLS, COL_DOLLARS, stableKey, typeRanks, type Strata } from './strata';
import { ACTUAL_PAY } from './queries';
import { sqlStr } from './duckdb';

/**
 * The landing graph through time (mockup 3a §8): everyone paid in every snapshot, as the landing page counts
 * a person — their total pay over their paid appointments, in the category of their highest-paid one
 * (lib/homePeople `homePeopleSql`, for each snapshot at once). Each person has one number across all of
 * them, so a step from one snapshot to the next can move each square from where they were to where they are,
 * drop in who joined and lift out who left. Loaded once, the first time a reader asks for the timeline: the
 * page's first paint stays on home-stats.json.
 */

/** The same category spelled another way in another release: folded into the name the latest uses. */
export const CATEGORY_SPELLINGS: Readonly<Record<string, string>> = {
  'Employee-In-Training': 'Employees in Training',
  'Employee-in-Training': 'Employees in Training',
  'Limited Appointee': 'Limited',
};
/** Before Apr 2024 University Staff and trainees appear only as codes (CP, CL, CJ, ET2–ET4) that no public
 *  source defines and whose raises differ, so they are one kind of their own, never merged on a guess. */
export const CODED = 'Coded only (CP, CL, CJ, ET)';
/** A step's mover: pay up or down by this ratio or more between neighbouring snapshots. */
export const BIG_STEP = 1.08;

/** One snapshot's people: each one's number, pay and kind (an index into the timeline's `names`). */
export interface SnapPeople {
  id: Int32Array;
  pay: Float64Array;
  kind: Uint8Array;
}
export interface Timeline {
  snaps: readonly { id: string; label: string }[];
  /** Each person's key, by their number. */
  keys: readonly string[];
  /** The kinds: the latest's category names, then CODED. */
  names: readonly string[];
  at: SnapPeople[];
}

const peopleCte = (snapshots: readonly string[]) => `p AS (
    SELECT snapshot_id, person_key, sum(rp) AS pay, first(cat ORDER BY rp DESC, cat) AS cat
    FROM (SELECT snapshot_id, person_key, coalesce(employee_category, 'Other') AS cat, ${ACTUAL_PAY} AS rp
          FROM salaries WHERE salary > 0 AND snapshot_id IN (${snapshots.map(sqlStr).join(', ')}))
    GROUP BY snapshot_id, person_key HAVING sum(rp) > 0),
  k AS (SELECT person_key, CAST(row_number() OVER (ORDER BY person_key) - 1 AS INTEGER) AS id FROM (SELECT DISTINCT person_key FROM p))`;

/** Everyone in every snapshot: `snap` (the snapshot's place in `snapshots`), `id`, `pay` and `kind` (its place
 *  in `names`, CODED after them). One row a person a snapshot, 235,000 or so: read as columns. */
export function timelineSql(snapshots: readonly string[], names: readonly string[]): string {
  const folded = `CASE p.cat ${Object.entries(CATEGORY_SPELLINGS).map(([a, b]) => `WHEN ${sqlStr(a)} THEN ${sqlStr(b)}`).join(' ')} ELSE p.cat END`;
  const kind = `CASE ${folded} ${names.map((n, i) => `WHEN ${sqlStr(n)} THEN ${i}`).join(' ')} ELSE ${names.length} END`;
  const snap = `CASE p.snapshot_id ${snapshots.map((s, i) => `WHEN ${sqlStr(s)} THEN ${i}`).join(' ')} END`;
  return `WITH ${peopleCte(snapshots)}
    SELECT CAST(${snap} AS INTEGER) AS snap, k.id AS id, CAST(p.pay AS DOUBLE) AS pay, CAST(${kind} AS INTEGER) AS kind
    FROM p JOIN k USING (person_key) ORDER BY snap, id`;
}
/** The people of `timelineSql`, by their number: the key of person `id` is row `id`. */
export function timelineKeysSql(snapshots: readonly string[]): string {
  return `WITH ${peopleCte(snapshots)} SELECT person_key FROM k ORDER BY id`;
}

/** The query's columns, split by snapshot. */
export function buildTimeline(
  cols: { snap: ArrayLike<number>; id: ArrayLike<number>; pay: ArrayLike<number>; kind: ArrayLike<number> },
  keys: readonly string[], snaps: Timeline['snaps'], names: readonly string[],
): Timeline {
  const n = cols.snap.length;
  const count = new Int32Array(snaps.length);
  for (let r = 0; r < n; r++) count[cols.snap[r]]++;
  const at = Array.from(count, (c) => ({ id: new Int32Array(c), pay: new Float64Array(c), kind: new Uint8Array(c) }));
  const fill = new Int32Array(snaps.length);
  for (let r = 0; r < n; r++) {
    const s = cols.snap[r], k = fill[s]++;
    at[s].id[k] = cols.id[r];
    at[s].pay[k] = cols.pay[r];
    at[s].kind[k] = cols.kind[r];
  }
  return { snaps, keys, names: [...names, CODED], at };
}

/** A snapshot's squares, with each one's person. */
export interface TimelineStrata extends Strata {
  mainId: Int32Array;
  pileId: Int32Array;
  /** Each square's own pay: under the cap, and in the pile (`pilePay`). */
  mainPay: Float64Array;
}

/** A pay's $5k column on the graph. */
const colOf = (pay: number) => Math.min(COLS - 1, Math.max(0, Math.floor(pay / COL_DOLLARS)));

/**
 * A snapshot as squares (lib/strata): under the cap each person in their $5k column, the pile past it — the
 * same columns and pile the counts give the latest. Each one's place in their band is a hash of their number,
 * the same in every snapshot, so from one to the next the people who stayed keep their order.
 */
export function strataFromPeople(p: SnapPeople, names: readonly string[], cap: number): TimelineStrata {
  const order = Array.from(p.pay.keys()).sort((a, b) => p.pay[a] - p.pay[b] || p.id[a] - p.id[b]);
  const under = order.filter((r) => p.pay[r] < cap);
  // The pile in kind blocks, as the counts' pile is laid out (lib/homePeople `dotSpots`).
  const over = order.filter((r) => p.pay[r] >= cap).sort((a, b) => p.kind[a] - p.kind[b] || p.pay[a] - p.pay[b] || p.id[a] - p.id[b]);
  const n = under.length, m = over.length;
  const col = new Uint8Array(n), kind = new Uint8Array(n), key = new Uint32Array(n), mainId = new Int32Array(n), mainPay = new Float64Array(n);
  const colCount = new Uint32Array(COLS);
  under.forEach((r, i) => {
    const c = colOf(p.pay[r]);
    col[i] = c;
    kind[i] = p.kind[r];
    key[i] = stableKey(p.id[r]);
    mainId[i] = p.id[r];
    mainPay[i] = p.pay[r];
    colCount[c]++;
  });
  const pileKind = new Uint8Array(m), pileKey = new Uint32Array(m), pileId = new Int32Array(m), pilePay = new Float64Array(m);
  over.forEach((r, j) => {
    pileKind[j] = p.kind[r];
    pileKey[j] = stableKey(p.id[r]);
    pileId[j] = p.id[r];
    pilePay[j] = p.pay[r];
  });
  return { col, kind, key, pay: mainPay, pileKind, pileKey, pilePay: m ? pilePay : null, colCount, rank: typeRanks(names), names: [...names], mainId, pileId, mainPay };
}

/** DuckDB's `quantile_cont`: the value at (n − 1)·q along the sorted values, between neighbours linearly. */
export function quantileCont(sorted: ArrayLike<number>, q: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  const at = (n - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export interface SnapStats {
  headcount: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  /** At the cap or more. */
  over: number;
  /** Each kind's people and median pay. */
  byKind: { n: number; median: number | null }[];
}
/** What the graph says of a snapshot: as home-stats.json says it of the latest. */
export function snapStats(p: SnapPeople, kinds: number, cap: number): SnapStats {
  const all = Float64Array.from(p.pay).sort();
  const per: number[][] = Array.from({ length: kinds }, () => []);
  let over = 0;
  for (let r = 0; r < p.pay.length; r++) {
    per[p.kind[r]]?.push(p.pay[r]);
    if (p.pay[r] >= cap) over++;
  }
  return {
    headcount: all.length, p25: quantileCont(all, 0.25), median: quantileCont(all, 0.5), p75: quantileCont(all, 0.75), over,
    byKind: per.map((v) => { const s = Float64Array.from(v).sort(); return { n: s.length, median: quantileCont(s, 0.5) }; }),
  };
}

/**
 * Who moved pay by `BIG_STEP` or more between neighbouring snapshots `a` and `b`, by person number: +1 up,
 * −1 down, 0 not (or not in both).
 */
export function bigMoves(a: SnapPeople, b: SnapPeople, people: number): Int8Array {
  const was = new Float64Array(people);
  for (let r = 0; r < a.id.length; r++) was[a.id[r]] = a.pay[r];
  const out = new Int8Array(people);
  for (let r = 0; r < b.id.length; r++) {
    const before = was[b.id[r]], now = b.pay[r];
    if (!(before > 0)) continue;
    if (now >= before * BIG_STEP) out[b.id[r]] = 1;
    else if (now * BIG_STEP <= before) out[b.id[r]] = -1;
  }
  return out;
}

/** The followed person's label: their pay, counting from `from` as `e` goes 0 → 1; arrived, with the change. */
export function followText(f: { name: string; pay: number | null; from: number | null }, e: number): string {
  if (f.pay == null) return f.name;
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  if (f.from == null || !(f.from > 0)) return `${f.name} · ${usd(f.pay)}`;
  if (e < 1) return `${f.name} · ${usd(f.from + (f.pay - f.from) * e)}`;
  const pct = ((f.pay - f.from) / f.from) * 100;
  if (Math.abs(pct) < 0.05) return `${f.name} · ${usd(f.pay)} (no change)`;
  return `${f.name} · ${usd(f.pay)} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`;
}
