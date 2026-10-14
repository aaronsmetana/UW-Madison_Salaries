import type { SearchIndex } from './manifest';

/** What a search box offers. Pickers that can only take a person ask for `['people']`. */
export type SearchKind = 'people' | 'titles' | 'divisions';
export const ALL_KINDS: readonly SearchKind[] = ['people', 'titles', 'divisions'];

/** How many of each a grouped search shows. People stay first and get the most room. */
export const GROUP_LIMIT = { people: 6, titles: 4, divisions: 3 } as const;

export interface TitleHit {
  code: string;
  title: string;
  n: number;
  med: number | null;
  /** The employee category most of its people are in. */
  cat: string | null;
}

/**
 * A job code ending in N is a title's non-exempt twin: overtime-eligible under the FLSA (every holder of one is
 * recorded non-exempt). Said where the code alone is all that tells two titles of one name apart.
 */
export const isNonExemptCode = (code: string) => /\dN$/.test(code);

export interface DivisionHit {
  school: string;
  n: number;
  med: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * How well `q` names `text`, best first: 0 the whole text, 1 its start, 2 every word of `q` starts a
 * word of `text`, 3 every word of `q` is somewhere in it. `null` when a word of `q` is missing — "system
 * engineer" finds "System Engineer IV" but not "Systems Analyst".
 */
export function matchRank(text: string, q: string): number | null {
  const t = norm(text);
  const n = norm(q);
  if (!n) return null;
  if (t === n) return 0;
  if (t.startsWith(n)) return 1;
  const words = n.split(' ');
  if (!words.every((w) => t.includes(w))) return null;
  const starts = t.split(/[^a-z0-9]+/).filter(Boolean);
  return words.every((w) => starts.some((s) => s.startsWith(w))) ? 2 : 3;
}

const byRank = <T extends { n: number }>(a: { rank: number; hit: T; name: string }, b: { rank: number; hit: T; name: string }) =>
  a.rank - b.rank || b.hit.n - a.hit.n || a.name.localeCompare(b.name);

/**
 * Titles whose name, job code or a former name matches, the closest and then the largest first. A former
 * name (search-index `formerTitlesQuery`: "Admin Asst Dir", now written out) finds the title under its
 * name today, a half-step behind the same match on the current name.
 */
export function matchTitles(index: SearchIndex | undefined, q: string, limit: number = GROUP_LIMIT.titles): TitleHit[] {
  if (!index || norm(q).length < 2) return [];
  const out: { rank: number; hit: TitleHit; name: string }[] = [];
  for (const [code, title, n, med, cat, former] of index.titles) {
    const byCode = norm(code) === norm(q) ? 0 : norm(code).startsWith(norm(q)) ? 1 : null;
    const byName = matchRank(title ?? '', q);
    const byFormer = (former ?? []).reduce<number | null>((best, f) => {
      const r = matchRank(f, q);
      return r == null ? best : Math.min(best ?? 9, r + 0.5);
    }, null);
    const rank = Math.min(byCode ?? 9, byName ?? 9, byFormer ?? 9);
    if (rank < 9) out.push({ rank, hit: { code, title: title ?? code, n, med, cat }, name: title ?? code });
  }
  return out.sort(byRank).slice(0, limit).map((x) => x.hit);
}

/** Divisions whose name matches, the closest and then the largest first. */
export function matchDivisions(index: SearchIndex | undefined, q: string, limit: number = GROUP_LIMIT.divisions): DivisionHit[] {
  if (!index || norm(q).length < 2) return [];
  const out: { rank: number; hit: DivisionHit; name: string }[] = [];
  for (const [school, n, med] of index.divisions) {
    const rank = matchRank(school, q);
    if (rank != null) out.push({ rank, hit: { school, n, med }, name: school });
  }
  return out.sort(byRank).slice(0, limit).map((x) => x.hit);
}

/**
 * The row Enter opens; 'wait' to open the first row once people have answered; null for none. While
 * people are still being searched the first row is a title or a division, and a name typed quickly
 * would open that instead of the person — so until people have answered, Enter acts at once only on a
 * row the reader chose (by arrow key or pointer), and otherwise is kept rather than dropped.
 */
export function enterPick(active: number, rows: number, peopleSearching: boolean, chosen: boolean): number | 'wait' | null {
  if (peopleSearching && !chosen) return 'wait';
  if (active < 0 || active >= rows) return null;
  return active;
}

/** The letter pairs of a name, its words run together: "Law School" → la, aw, ws, sc, ch, ho, oo, ol. */
function bigrams(s: string): Map<string, number> {
  const t = norm(s).replace(/[^a-z0-9]+/g, '');
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

/** How alike two names are, 0 to 1: the share of letter pairs they have in common (Dice's coefficient). */
export function likeness(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b);
  let both = 0, nx = 0, ny = 0;
  for (const [k, c] of x) { nx += c; both += Math.min(c, y.get(k) ?? 0); }
  for (const c of y.values()) ny += c;
  return nx + ny ? (2 * both) / (nx + ny) : 0;
}

/**
 * The names most like one that matched nothing — what a "not found" page offers instead of repeating the
 * address back (NF2): best first, at most `k`, none under `floor`.
 */
export function closeMatches<T>(items: readonly T[], name: (t: T) => string, q: string, k = 5, floor = 0.35): T[] {
  return items
    .map((t) => ({ t, s: likeness(name(t), q) }))
    .filter((x) => x.s >= floor)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.t);
}
