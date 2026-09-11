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
}

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

/** Titles whose name or job code matches, the closest and then the largest first. */
export function matchTitles(index: SearchIndex | undefined, q: string, limit: number = GROUP_LIMIT.titles): TitleHit[] {
  if (!index || norm(q).length < 2) return [];
  const out: { rank: number; hit: TitleHit; name: string }[] = [];
  for (const [code, title, n, med] of index.titles) {
    const byCode = norm(code) === norm(q) ? 0 : norm(code).startsWith(norm(q)) ? 1 : null;
    const byName = matchRank(title ?? '', q);
    const rank = Math.min(byCode ?? 9, byName ?? 9);
    if (rank < 9) out.push({ rank, hit: { code, title: title ?? code, n, med }, name: title ?? code });
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
 * The row Enter opens, or null for none. While people are still being searched the first row is a
 * title or a division, and a name typed quickly would open that instead of the person — so until
 * people have answered, Enter acts only on a row the reader chose (by arrow key or pointer).
 */
export function enterPick(active: number, rows: number, peopleSearching: boolean, chosen: boolean): number | null {
  if (active < 0 || active >= rows) return null;
  if (peopleSearching && !chosen) return null;
  return active;
}
