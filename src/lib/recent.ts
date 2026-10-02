/**
 * The people this browser has looked at, most recent first: the People page's "Recently viewed". Kept in this
 * browser only (localStorage), as the compare set is, and never sent anywhere. At most RECENT_MAX; a visit
 * moves a person to the front. Storage can be missing or refuse (a private window): then there is no list.
 */
export interface RecentPerson { key: string; name: string; title: string | null }

const KEY = 'recent-people';
export const RECENT_MAX = 8;

export function readRecent(): RecentPerson[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === 'string' && typeof x.name === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function noteRecent(p: RecentPerson) {
  try {
    const next = [p, ...readRecent().filter((x) => x.key !== p.key)].slice(0, RECENT_MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage refused: no list, nothing else changes */
  }
}
